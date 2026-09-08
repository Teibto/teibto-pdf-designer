/**
 * Template Persistence Service — Production Grade
 * Save/load templates using IndexedDB (via idb-keyval).
 * Includes schema validation and version migration on load/import.
 *
 * @author Wichit Wongta
 */
import { get, set, del, keys, update } from 'idb-keyval';
import { nanoid } from 'nanoid';
import type { DocumentTemplate, TemplateCopy, PaginationConfig } from '../models/template';
import type { AppStore } from '../state/store';
import type { PageConfig } from '../models/page';
import type { CanvasElement } from '../models/element';
import type { Band } from '../models/bands';
import { createDefaultPage } from '../models/page';
import { createDefaultPagination } from '../models/template';
import { validateTemplate } from './validation.service';
import { lintBfoXml, summarizeLint } from './bfo-lint.service';
import { migrateTemplate, needsMigration, isFutureVersion, CURRENT_VERSION } from './migration.service';
import { clearPaginationCache } from './pagination.service';
import { elementsToBands } from './band-layout.service';
import { extractJsonKeys } from '../state/actions';
import { exportBfoXml, type BfoExportOptions } from './bfo-export.service';
import { saveNsTemplate, getNsContext, getCachedBindingContract } from './netsuite-adapter.service';

const TEMPLATE_PREFIX = 'pld-template-';

// NetSuite Long Text (CLOBTEXT) fields cap at ~1,000,000 characters. Both the
// designer JSON and the BFO XML land in such a field, and embedded images live
// as base64 in BOTH — so a few large images silently overflow and the server
// save fails with an opaque error. Guard client-side with headroom (#143).
const CLOBTEXT_MAX = 1_000_000;
const CLOBTEXT_SAFE = 990_000;

/** Throw a clear, actionable error before POST when a CLOBTEXT payload is too big (#143). */
function assertClobSize(label: string, value: string): void {
  if (value.length > CLOBTEXT_SAFE) {
    throw new Error(
      `${label} ใหญ่เกินไป (${Math.round(value.length / 1000)}K ตัวอักษร, จำกัด ~${CLOBTEXT_MAX / 1000}K) — ` +
        'รูปที่ฝังในเทมเพลตถูกเก็บเป็น base64 ซึ่งกินพื้นที่มาก ลดขนาด/จำนวนรูปแล้วบันทึกใหม่',
    );
  }
}

// ═══════════════════════════════════════
// LIST
// ═══════════════════════════════════════

/** List all saved templates */
export async function listTemplates(): Promise<DocumentTemplate[]> {
  const allKeys = await keys();
  const templateKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(TEMPLATE_PREFIX),
  );

  const templates: DocumentTemplate[] = [];
  for (const key of templateKeys) {
    try {
      const t = await get<DocumentTemplate>(key as string);
      if (t) templates.push(t);
    } catch (err) {
      console.warn(`Failed to load template ${key}:`, err);
    }
  }

  return templates.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

// ═══════════════════════════════════════
// SAVE
// ═══════════════════════════════════════

const pendingSaves = new WeakSet<AppStore>();

async function withSaveLock<T>(store: AppStore, save: () => Promise<T>): Promise<T> {
  if (pendingSaves.has(store)) throw new Error('กำลังบันทึกเทมเพลต กรุณารอให้เสร็จก่อน');
  pendingSaves.add(store);
  try { return await save(); }
  finally { pendingSaves.delete(store); }
}

/** Attach the saved identity only to its editing session; preserve newer edits. */
async function acknowledgeSave(store: AppStore, saved: AppStore['state'], session: number, id: string): Promise<void> {
  const current = store.state;
  if (store.documentSession !== session || current.template.id !== saved.template.id) return;
  const unchanged = current.template.name === saved.template.name &&
      current.elements === saved.elements && current.bands === saved.bands &&
      current.page === saved.page && current.pagination === saved.pagination &&
      current.copies === saved.copies && current.jsonData === saved.jsonData;
  store.dispatch((d) => {
    d.template.id = id;
    d.template.isDirty = !unchanged;
  });
  if (unchanged) {
    const owner = draftOwner(store, session);
    try {
      await update<TemplateDraft | undefined>(DRAFT_KEY, (draft) => draft?.owner === owner && store.documentSession === session && !store.state.template.isDirty ? undefined : draft);
    } catch (err) { console.warn('Failed to clear saved draft:', err); }
  }
}

/** Save current state as a template */
export async function saveTemplate(store: AppStore): Promise<DocumentTemplate> {
  return withSaveLock(store, () => persistTemplate(store));
}

async function persistTemplate(store: AppStore): Promise<DocumentTemplate> {
  const state = store.state;
  const session = store.documentSession;
  const now = new Date().toISOString();

  const template: DocumentTemplate = {
    id: state.template.id || nanoid(10),
    name: state.template.name || 'Untitled Template',
    version: CURRENT_VERSION,
    createdAt: now,
    updatedAt: now,
    page: structuredClone(state.page),
    pagination: structuredClone(state.pagination),
    elements: structuredClone(state.elements),
    // Persist band edits so they survive reload (#47 3b). Only when non-empty —
    // an element-only template regenerates its bands from elements on load.
    bands: state.bands.length ? structuredClone(state.bands) : undefined,
    copies: state.copies && state.copies.length ? structuredClone(state.copies) : undefined,
    jsonData: state.jsonData ? structuredClone(state.jsonData) : null,
  };

  await set(`${TEMPLATE_PREFIX}${template.id}`, template);

  await acknowledgeSave(store, state, session, template.id);

  return template;
}

/**
 * Save the current design to the NetSuite template custom record (#137).
 *
 * The 💾 button used to call saveTemplate() (IndexedDB only) even inside NetSuite,
 * so a "saved" template never reached the account. This persists both the designer
 * JSON and the BFO XML generated from the authoritative band layout (#47), and
 * **throws on failure** — the caller must surface the error rather than fall back
 * to a silent local write (R4: no silent fallback).
 *
 * rectype defaults to the record the designer was opened from (nsContext), so a
 * plain 💾 save associates the template with that transaction type. The Save
 * dialog (#138) overrides it and may flag the template as the record type's print
 * default via opts.
 */
export async function saveTemplateToNetSuite(
  store: AppStore,
  opts: { rectype?: string; isDefault?: boolean } = {},
): Promise<{ id: string; warning?: string }> {
  return withSaveLock(store, () => persistTemplateToNetSuite(store, opts));
}

async function persistTemplateToNetSuite(
  store: AppStore,
  opts: { rectype?: string; isDefault?: boolean },
): Promise<{ id: string; warning?: string }> {
  const state = store.state;
  const session = store.documentSession;
  const ctx = getNsContext();

  const options: BfoExportOptions = {
    useBands: true,           // band layout is authoritative (#47 cutover)
    useFreeMarker: true,
    includePageHeaders: true,
  };
  // The Thai font is bound to the config record inside exportBfoXml (#156) — no
  // per-account URL is baked in here, so a saved template keeps working after the
  // font file is re-saved in the File Cabinet (its h= token changes).
  const xml = exportBfoXml(state, options);

  const designerJson = JSON.stringify({
    elements: state.elements,
    page: state.page,
    pagination: state.pagination,
    // Persist band edits so a re-edit restores them (#47 3b).
    bands: state.bands.length ? state.bands : undefined,
    copies: state.copies && state.copies.length ? state.copies : undefined,
  });

  // กับดัก BFO ที่พิสูจน์แล้วว่าทำให้เอกสารพิมพ์ไม่ออกหรือพิมพ์ว่าง ต้องตายตรงนี้ (#191).
  // ปล่อยผ่านไปแล้วมันจะไปโผล่ตอนผู้ใช้กด Print ที่หน้างาน ซึ่งไกลจากคนที่แก้ได้ที่สุด
  // — และเทมเพลตนั้นได้ทับของเดิมไปแล้ว (R4: ล้มให้เห็น ไม่ใช่เงียบ)
  const lint = lintBfoXml(xml, getCachedBindingContract());
  if (!lint.ok) {
    throw new Error(
      `บันทึกไม่ได้ — เทมเพลตนี้จะพิมพ์ไม่ออกหรือพิมพ์ออกมาว่าง (${lint.errors.length} ข้อ):
` +
      `${summarizeLint(lint)}
` +
      'ดูรายการเต็มและวิธีแก้ในกล่อง "🔶 NetSuite BFO"',
    );
  }

  // Fail before the POST with an actionable message, rather than let the server
  // reject an over-cap CLOBTEXT with an opaque error (#143).
  assertClobSize('ข้อมูลเทมเพลต (Designer Data)', designerJson);
  assertClobSize('BFO XML', xml);

  const result = await saveNsTemplate({
    id: state.template.id || undefined,
    name: state.template.name || 'Untitled Template',
    data: designerJson,
    xml,
    rectype: opts.rectype ?? (state.template.id ? undefined : ctx?.recordType ?? undefined),
    isDefault: opts.isDefault,
  });

  await acknowledgeSave(store, state, session, result.id);
  if (store.documentSession === session && store.state.template.id === result.id) {
    const rectype = opts.rectype ?? state.template.nsMetadata?.rectype ?? (!state.template.id ? ctx?.recordType : undefined);
    const isDefault = opts.isDefault ?? state.template.nsMetadata?.isDefault;
    if (rectype && isDefault !== undefined) store.dispatch((d) => {
      d.template.nsMetadata = { rectype, isDefault };
    });
  }

  return { id: result.id, ...(result.warning ? { warning: result.warning } : {}) };
}

// ═══════════════════════════════════════
// LOAD (with migration + validation)
// ═══════════════════════════════════════

/** Load a template into the store with migration and validation */
export async function loadTemplate(
  store: AppStore,
  templateId: string,
): Promise<{ warnings: string[] }> {
  const raw = await get<Record<string, unknown>>(`${TEMPLATE_PREFIX}${templateId}`);
  if (!raw) throw new Error(`Template not found: ${templateId}`);

  const warnings: string[] = [];

  // Newer-than-this-build schema: needsMigration() is false, so warn explicitly —
  // a future field set may be dropped/mis-read silently otherwise (#145).
  if (isFutureVersion(raw)) {
    warnings.push(
      `เทมเพลตนี้สร้างจาก designer เวอร์ชันใหม่กว่า (v${raw.version}) — บาง field อาจไม่รองรับและถูกละไว้`,
    );
  }

  // Step 1: Migrate if needed
  let data = raw;
  if (needsMigration(raw)) {
    const migResult = migrateTemplate(raw);
    data = migResult.template;
    if (migResult.errors.length > 0) {
      throw new Error(`Migration failed: ${migResult.errors.join('; ')}`);
    }
    if (migResult.migrated) {
      warnings.push(`Template migrated from v${migResult.fromVersion} to v${CURRENT_VERSION}`);
      // Save migrated version back to IndexedDB
      await set(`${TEMPLATE_PREFIX}${templateId}`, data);
    }
  }

  // Step 2: Validate
  const validation = validateTemplate(data);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Template validation failed:\n${errorMessages.join('\n')}`);
  }
  if (validation.warnings.length > 0) {
    warnings.push(...validation.warnings.map((w) => `${w.path}: ${w.message}`));
  }

  // Step 3: Apply to store
  clearPaginationCache();
  store.beginDocumentSession();
  const template = data as unknown as DocumentTemplate;
  store.dispatch((d) => {
    d.elements = template.elements;
    // Restore persisted bands; legacy element-only templates regenerate them from
    // elements so band mode always has a structure (#47 3b).
    d.bands = template.bands ?? elementsToBands(template.elements);
    d.copies = template.copies ?? null;
    d.page = template.page;
    d.pagination = { ...createDefaultPagination(), ...template.pagination };
    d.jsonData = template.jsonData || null;
    d.jsonKeys = template.jsonData ? extractJsonKeys(template.jsonData) : [];
    d.template.id = template.id;
    d.template.name = template.name;
    d.template.isDirty = false;
    d.selectedId = null;
    d.multiSelect = [];
    d.currentPage = 1;
  });

  return { warnings };
}

// ═══════════════════════════════════════
// DUPLICATE
// ═══════════════════════════════════════

/**
 * Duplicate a saved template under a new id, named "<name> (copy)" (#105).
 * Deep-copies the stored record so later edits never bleed into the source.
 */
export async function duplicateTemplate(templateId: string): Promise<DocumentTemplate> {
  const src = await get<DocumentTemplate>(`${TEMPLATE_PREFIX}${templateId}`);
  if (!src) throw new Error(`Template not found: ${templateId}`);

  const now = new Date().toISOString();
  const copy: DocumentTemplate = {
    ...structuredClone(src),
    id: nanoid(10),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };

  await set(`${TEMPLATE_PREFIX}${copy.id}`, copy);
  return copy;
}

// ═══════════════════════════════════════
// DELETE
// ═══════════════════════════════════════

/** Delete a saved template */
export async function deleteTemplate(templateId: string): Promise<void> {
  await del(`${TEMPLATE_PREFIX}${templateId}`);
}

// ═══════════════════════════════════════
// EXPORT JSON
// ═══════════════════════════════════════

/** Export template as JSON string */
export function exportTemplateJson(store: AppStore): string {
  const state = store.state;

  const template: DocumentTemplate = {
    id: state.template.id || nanoid(10),
    name: state.template.name,
    version: CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: structuredClone(state.page),
    pagination: structuredClone(state.pagination),
    elements: structuredClone(state.elements),
    bands: state.bands.length ? structuredClone(state.bands) : undefined,
    copies: state.copies && state.copies.length ? structuredClone(state.copies) : undefined,
    jsonData: state.jsonData ? structuredClone(state.jsonData) : null,
  };

  return JSON.stringify(template, null, 2);
}

// ═══════════════════════════════════════
// IMPORT JSON (with validation + migration)
// ═══════════════════════════════════════

/**
 * Import template from JSON string with full validation and migration.
 * Throws on invalid JSON or failed validation.
 */
export function importTemplateJson(
  store: AppStore,
  json: string,
): { warnings: string[] } {
  // Step 0: Parse JSON safely
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Template must be a JSON object');
  }

  const warnings: string[] = [];

  // Newer-than-this-build schema — warn (needsMigration is false for these) (#145).
  if (isFutureVersion(raw)) {
    warnings.push(
      `เทมเพลตนี้สร้างจาก designer เวอร์ชันใหม่กว่า (v${raw.version}) — บาง field อาจไม่รองรับและถูกละไว้`,
    );
  }

  // Step 1: Migrate if needed
  if (needsMigration(raw)) {
    const migResult = migrateTemplate(raw);
    raw = migResult.template;
    if (migResult.errors.length > 0) {
      throw new Error(`Migration failed: ${migResult.errors.join('; ')}`);
    }
    if (migResult.migrated) {
      warnings.push(...migResult.migrationsApplied);
    }
  }

  // Step 2: Validate
  const validation = validateTemplate(raw);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Template validation failed:\n${errorMessages.join('\n')}`);
  }
  if (validation.warnings.length > 0) {
    warnings.push(...validation.warnings.map((w) => `${w.path}: ${w.message}`));
  }

  // Step 3: Apply
  clearPaginationCache();
  store.beginDocumentSession();
  const template = raw as unknown as DocumentTemplate;
  store.dispatch((d) => {
    d.elements = template.elements || [];
    d.bands = template.bands ?? elementsToBands(template.elements || []);
    d.copies = template.copies ?? null;
    d.page = template.page || createDefaultPage();
    d.pagination = { ...createDefaultPagination(), ...(template.pagination || {}) };
    d.jsonData = template.jsonData || null;
    d.jsonKeys = template.jsonData ? extractJsonKeys(template.jsonData) : [];
    d.template.id = template.id;
    d.template.name = template.name;
    d.template.isDirty = false;
    d.selectedId = null;
    d.multiSelect = [];
    d.currentPage = 1;
  });

  return { warnings };
}

// ═══════════════════════════════════════
// DRAFT (autosave + recovery, #140)
// ═══════════════════════════════════════

/** Fixed IndexedDB key for the single in-progress autosave slot. Only one draft
 *  is ever kept — a newer autosave overwrites the previous one. */
export const DRAFT_KEY = 'pld-draft-current';

/** Shape of an autosaved draft — enough to fully restore an in-progress edit
 *  after a crash, session timeout, or accidental tab close (#140). */
export interface TemplateDraft {
  owner?: string;
  nsMetadata?: { rectype: string; isDefault: boolean };
  templateId: string | null;
  templateName: string;
  page: PageConfig;
  pagination: PaginationConfig;
  elements: CanvasElement[];
  bands?: Band[];
  copies?: TemplateCopy[] | null;
  jsonData?: Record<string, unknown> | null;
  /** ISO timestamp of the autosave. Passed in by the caller — app-shell uses
   *  new Date().toISOString() — so this module stays free of nondeterministic
   *  time calls and is straightforward to unit test. */
  savedAt: string;
}

/**
 * Autosave the current in-progress design to IndexedDB (#140).
 * `now` is supplied by the caller rather than computed here (no Date.now()/
 * new Date() inside this function) so saveDraft stays pure and deterministic
 * for unit tests.
 */
const draftOwners = new WeakMap<AppStore, { session: number; owner: string }>();
function draftOwner(store: AppStore, session: number): string {
  let entry = draftOwners.get(store);
  if (!entry || entry.session !== session) {
    entry = { session, owner: nanoid() };
    draftOwners.set(store, entry);
  }
  return entry.owner;
}

export async function saveDraft(store: AppStore, now: string): Promise<void> {
  const state = store.state;

  const draft: TemplateDraft = {
    owner: draftOwner(store, store.documentSession),
    nsMetadata: state.template.nsMetadata,
    templateId: state.template.id,
    templateName: state.template.name,
    page: structuredClone(state.page),
    pagination: structuredClone(state.pagination),
    elements: structuredClone(state.elements),
    bands: state.bands.length ? structuredClone(state.bands) : undefined,
    copies: state.copies && state.copies.length ? structuredClone(state.copies) : undefined,
    jsonData: state.jsonData ? structuredClone(state.jsonData) : null,
    savedAt: now,
  };

  await set(DRAFT_KEY, draft);
}

/** Return the autosaved draft, or null when none exists. */
export async function getDraft(): Promise<TemplateDraft | null> {
  const draft = await get<TemplateDraft>(DRAFT_KEY);
  return draft ?? null;
}

/** Claim restored recovery data without replacing a newer draft from another editor. */
export async function claimDraft(store: AppStore, expected: TemplateDraft): Promise<void> {
  const owner = draftOwner(store, store.documentSession);
  const snapshot = JSON.stringify(expected);
  await update<TemplateDraft | undefined>(DRAFT_KEY, (draft) =>
    JSON.stringify(draft) === snapshot ? { ...expected, owner } : draft);
}

/** Discard only the recovery entry the user actually reviewed. */
export async function dismissDraft(expected: TemplateDraft): Promise<void> {
  const snapshot = JSON.stringify(expected);
  await update<TemplateDraft | undefined>(DRAFT_KEY, (draft) =>
    JSON.stringify(draft) === snapshot ? undefined : draft);
}

/** Delete the autosaved draft — call after a successful save, a restore, or a
 *  discard so a stale draft never resurfaces on the next load (#140). */
export async function clearDraft(): Promise<void> {
  await del(DRAFT_KEY);
}

/**
 * NetSuite API Adapter
 * Bridges the PDF Layout Designer with NetSuite Suitelet backend.
 * Detects if running inside NetSuite and provides:
 * - Record data loading
 * - Template CRUD (save to Custom Record)
 * - BFO XML save (to Custom Record, NOT Advanced PDF Templates)
 * - PDF render via Render Suitelet
 *
 * @author Wichit Wongta
 */

/**
 * Thrown when a Suitelet call comes back as a login/interstitial page instead of
 * JSON — i.e. the NetSuite session has expired mid-use (#139). A distinct type so
 * callers/UI can show a re-open-from-NetSuite prompt rather than a raw parse error.
 */
export class SessionExpiredError extends Error {
  constructor(
    message = 'เซสชัน NetSuite หมดอายุหรือถูก redirect ไปหน้า login — เปิด designer ใหม่จาก NetSuite แล้วบันทึกอีกครั้ง',
  ) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/** NetSuite context injected by the Suitelet */
export interface NsContext {
  userId: number;
  userName: string;
  userEmail: string;
  role: number;
  subsidiary: number;
  accountId: string;
  scriptId: string;
  deploymentId: string;
  environment: string;
  recordType: string | null;
  recordId: string | null;
  /** File Cabinet URLs of THSarabunNew TTFs (script params — see engine/DEPLOYMENT.md) */
  fontRegularUrl?: string | null;
  fontBoldUrl?: string | null;
}

/** Saved template metadata from NetSuite custom record */
export interface NsTemplate {
  id: string;
  name: string;
  rectype: string;
  isDefault: boolean;
  created: string;
  modified: string;
}

// ═══════════════════════════════════════
// DETECTION
// ═══════════════════════════════════════

export function isNetSuiteEnv(): boolean {
  return !!(window as any).__NS_CONTEXT__;
}

export function getNsContext(): NsContext | null {
  return (window as any).__NS_CONTEXT__ || null;
}

function getDesignerUrl(): string {
  return (window as any).__NS_SUITELET_URL__ || '';
}

function getRendererUrl(): string {
  return (window as any).__NS_RENDER_URL__ || '';
}

// ═══════════════════════════════════════
// API HELPER (with retry + timeout)
// ═══════════════════════════════════════

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/** Retryable HTTP status codes */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function suiteletFetch(
  baseUrl: string,
  action: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<unknown> {
  if (!baseUrl) throw new Error('Suitelet URL not configured');

  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set('action', action);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }

  const options: RequestInit = { method };
  if (method === 'POST' && body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetch(url.toString(), {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        // NetSuite returns HTTP 200 + an HTML login page when the session has
        // expired (not 401), so a naive response.json() would throw a cryptic
        // "Unexpected token '<'". Detect the redirect/HTML and surface a clear
        // session-expired error instead (#139).
        const text = await response.text();
        const head = text.trimStart().slice(0, 200).toLowerCase();
        const looksLikeHtml = head.startsWith('<');
        if (response.redirected || looksLikeHtml) {
          throw new SessionExpiredError();
        }
        try {
          return JSON.parse(text);
        } catch {
          // 200 but not valid JSON — almost always a login/interstitial page.
          throw new SessionExpiredError();
        }
      }

      // Non-retryable error
      if (!RETRYABLE_STATUS.has(response.status)) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`NetSuite API error ${response.status}: ${errorText || response.statusText}`);
      }

      // Retryable error — will retry
      lastError = new Error(`NetSuite API error ${response.status}: ${response.statusText}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error(`NetSuite API timeout after ${DEFAULT_TIMEOUT_MS}ms`);
      } else if (err instanceof TypeError) {
        // Network error (offline, DNS failure, etc.)
        lastError = new Error(`Network error: ${err.message}`);
      } else {
        throw err; // Non-retryable error (e.g., our own thrown error)
      }
    }

    // Exponential backoff before retry
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[NS API] Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${lastError?.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError || new Error('NetSuite API failed after retries');
}

// ═══════════════════════════════════════
// RECORD DATA
// ═══════════════════════════════════════

export async function loadRecordData(
  recordType: string,
  recordId: string,
): Promise<Record<string, unknown>> {
  const result = await suiteletFetch(getDesignerUrl(), 'load-record', {
    rectype: recordType,
    recid: recordId,
  });
  if ((result as any).error) throw new Error((result as any).error);
  return result as Record<string, unknown>;
}

export async function autoLoadRecordIfAvailable(): Promise<Record<string, unknown> | null> {
  const ctx = getNsContext();
  if (!ctx?.recordType || !ctx?.recordId) return null;
  return loadRecordData(ctx.recordType, ctx.recordId);
}

// ═══════════════════════════════════════
// TEMPLATE CRUD (Custom Record)
// ═══════════════════════════════════════

export async function listNsTemplates(
  recordType?: string,
): Promise<NsTemplate[]> {
  const params: Record<string, string> = {};
  if (recordType) params.rectype = recordType;

  const result = await suiteletFetch(getRendererUrl() || getDesignerUrl(), 'list', params);
  if ((result as any).error) throw new Error((result as any).error);
  return result as NsTemplate[];
}

/**
 * Save template to NetSuite Custom Record.
 * Saves both designer JSON state AND BFO XML.
 */
export async function saveNsTemplate(opts: {
  id?: string;
  name: string;
  data: string;    // Designer JSON state
  xml: string;     // BFO XML output
  rectype?: string;
  isDefault?: boolean;
}): Promise<{ id: string; success: boolean }> {
  const baseUrl = getRendererUrl() || getDesignerUrl();
  const result = await suiteletFetch(baseUrl, 'save', {}, 'POST', {
    id: opts.id || null,
    name: opts.name,
    data: opts.data,
    xml: opts.xml,
    rectype: opts.rectype || '',
    isDefault: opts.isDefault || false,
  });
  if ((result as any).error) throw new Error((result as any).error);
  return result as { id: string; success: boolean };
}

export async function getNsTemplate(
  tplId: string,
): Promise<{ id: string; name: string; data: string; xml: string; rectype: string }> {
  const baseUrl = getRendererUrl() || getDesignerUrl();
  const result = await suiteletFetch(baseUrl, 'get', { tplid: tplId });
  if ((result as any).error) throw new Error((result as any).error);
  return result as any;
}

/**
 * Delete a NetSuite template record (#142). Server-side guard reports whether
 * the deleted record WAS this record type's default, so the caller can warn
 * that the record type is now left without a default (Print falls back to
 * "no template found" until a new default is set).
 */
export async function deleteNsTemplate(
  tplId: string,
): Promise<{ success: boolean; wasDefault?: boolean }> {
  const baseUrl = getRendererUrl() || getDesignerUrl();
  const result = await suiteletFetch(baseUrl, 'delete', { tplid: tplId }, 'POST');
  if ((result as any).error) throw new Error((result as any).error);
  return result as { success: boolean; wasDefault?: boolean };
}

/**
 * Duplicate a NetSuite template record server-side (#105): read the source
 * record's designer JSON + BFO XML and save them as a NEW record named
 * "<name> (copy)". The default flag is never copied — a fresh copy must not
 * hijack Print for its record type.
 */
export async function duplicateNsTemplate(
  tplId: string,
): Promise<{ id: string; name: string }> {
  const src = await getNsTemplate(tplId);
  const name = `${src.name} (copy)`;
  const result = await saveNsTemplate({
    name,
    data: src.data,
    xml: src.xml,
    rectype: src.rectype || undefined,
  });
  return { id: result.id, name };
}

// ═══════════════════════════════════════
// PDF RENDER (via Render Suitelet)
// ═══════════════════════════════════════

/**
 * Open rendered PDF in a new tab.
 * Uses the Render Suitelet which does:
 * Template (Custom Record) + Record Data → N/render → PDF
 */
export function openRenderedPdf(
  recordType: string,
  recordId: string,
  templateId?: string,
  download = false,
): void {
  const baseUrl = getRendererUrl();
  if (!baseUrl) {
    console.error('Render Suitelet URL not configured');
    return;
  }

  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set('action', 'render');
  url.searchParams.set('rectype', recordType);
  url.searchParams.set('recid', recordId);
  if (templateId) url.searchParams.set('tplid', templateId);
  if (download) url.searchParams.set('download', 'T');

  window.open(url.toString(), download ? '_self' : '_blank');
}

/**
 * Preview PDF with sample data (no real record).
 */
export function openPdfPreview(templateId: string): void {
  const baseUrl = getRendererUrl();
  if (!baseUrl) return;

  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set('action', 'preview');
  url.searchParams.set('tplid', templateId);

  window.open(url.toString(), '_blank');
}

/**
 * Render the CURRENT (unsaved) designer XML server-side and return the PDF blob.
 * Uses the render Suitelet's `preview-live` action, which binds the XML to the
 * real record via the SAME N/render path as Print — so preview == print (#12).
 */
export async function renderLivePreview(opts: {
  xml: string;
  rectype: string;
  recid: string;
  copies?: { th: string; en: string }[] | null;
}): Promise<Blob> {
  const baseUrl = getRendererUrl();
  if (!baseUrl) throw new Error('Render Suitelet URL not configured');

  const target = new URL(baseUrl, window.location.origin);
  target.searchParams.set('action', 'preview-live');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: opts.xml, rectype: opts.rectype, recid: opts.recid, copies: opts.copies }),
      signal: controller.signal,
    });

    // The Suitelet returns HTTP 200 with a JSON error body on failure (its
    // onRequest catch), so a non-PDF content-type means the render failed.
    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok || contentType.indexOf('application/pdf') === -1) {
      const errText = await response.text().catch(() => '');
      let message = errText || response.statusText;
      try { message = JSON.parse(errText).message || message; } catch { /* not JSON */ }
      throw new Error(`Preview render failed: ${message}`);
    }

    return await response.blob();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Preview render timeout after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ═══════════════════════════════════════
// URL BUILDER
// ═══════════════════════════════════════

export function buildDesignerUrl(
  recordType: string,
  recordId: string,
): string {
  const ctx = getNsContext();
  const sid = ctx?.scriptId || 'customscript_pld_designer';
  const did = ctx?.deploymentId || 'customdeploy_pld_designer';
  return `/app/site/hosting/scriptlet.nl?script=${sid}&deploy=${did}&rectype=${recordType}&recid=${recordId}`;
}

export function buildRenderUrl(
  recordType: string,
  recordId: string,
  templateId?: string,
): string {
  let url = `/app/site/hosting/scriptlet.nl?script=customscript_pld_render&deploy=customdeploy_pld_render`;
  url += `&action=render&rectype=${recordType}&recid=${recordId}`;
  if (templateId) url += `&tplid=${templateId}`;
  return url;
}

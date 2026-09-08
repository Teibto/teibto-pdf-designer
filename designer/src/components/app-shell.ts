/**
 * <pld-app-shell>
 * Root application component.
 * Provides the global store context, wires up modals, history,
 * keyboard shortcuts, and pagination engine.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { provide } from '@lit/context';
import { AppStore, storeContext } from '../state/store';
import { HistoryService } from '../services/history.service';
import { registerKeyboardShortcuts, shouldIgnoreShortcut } from '../services/keyboard.service';
import { applyPagination, clearPaginationCache } from '../services/pagination.service';
import {
  saveTemplate,
  saveTemplateToNetSuite,
  saveDraft,
  getDraft,
  claimDraft,
  dismissDraft,
  type TemplateDraft,
} from '../services/template.service';
import { showToast } from './shared/toast-notification';
import { getSampleTemplates } from '../constants/sample-templates';
import { isNetSuiteEnv, autoLoadRecordIfAvailable, getNsContext, hasThaiFontConfigured, fetchNsSampleData } from '../services/netsuite-adapter.service';
import { loadJsonData, extractJsonKeys } from '../state/actions';
import { confirmDiscardUnsaved } from '../utils/unsaved-guard';
import { applyMiddleware } from '../state/middleware';
import { debounce } from '../utils/debounce';
import { elementsToBands } from '../services/band-layout.service';
import { createDefaultPagination } from '../models/template';

// ─── Import all child components ───
import './layout/app-header';
import './layout/template-bar';
import './layout/sidebar-left';
import './canvas/band-view';
import './layout/sidebar-right';
import './flow/flow-view';
import './shared/toast-notification';
import './shared/error-boundary';

// ─── Import modals ───
import './modals/column-config-modal';
import './modals/template-manager-modal';
import './modals/preview-modal';
import './modals/bfo-export-modal';
import './modals/save-ns-modal';
import './modals/shortcuts-modal';

@customElement('pld-app-shell')
export class PldAppShell extends LitElement {
  @provide({ context: storeContext })
  store = new AppStore();

  private _history!: HistoryService;
  private _cleanupKeyboard: (() => void) | null = null;
  private _cleanupMiddleware: (() => void) | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private _saveHandler: (() => void) | null = null;
  // Autosave (#140): debounced draft write, cleaned up like the other listeners.
  private _autosaveHandler: (() => void) | null = null;
  private _autosaveDebounced: (() => void) & { cancel(): void } = debounce(() => {
    if (!this.store.state.template.isDirty) return;
    saveDraft(this.store, new Date().toISOString()).catch((err) => {
      console.warn('Autosave draft failed:', err);
    });
  }, 1500);

  @state() private view: 'design' | 'flow' = 'design';

  // Modal states
  @state() private showTemplateManager = false;
  @state() private showColumnConfig = false;
  @state() private columnConfigElementId = '';
  @state() private showPreview = false;
  @state() private showBfoExport = false;
  @state() private showSaveNs = false;
  @state() private showShortcuts = false;

  // Draft recovery banner (#140) — non-blocking, shown when a leftover autosave
  // is found on mount that the freshly-loaded state doesn't already reflect.
  @state() private showDraftBanner = false;
  private _pendingDraft: TemplateDraft | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      font-family: var(--font-sans);
      background: var(--color-bg-deep);
      color: var(--color-text);
    }

    .main-content {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    .canvas-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .canvas-area.hidden {
      display: none;
    }

    /* Draft recovery banner (#140) */
    .draft-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      background: var(--color-bg-panel);
      color: var(--color-warning);
      border-bottom: 1px solid var(--color-border);
      font-size: 13px;
    }

    .draft-banner span {
      flex: 1;
    }

    .draft-banner button {
      border: 1px solid var(--color-border);
      background: transparent;
      color: var(--color-text);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
    }

    .draft-banner button.primary {
      background: var(--color-accent);
      color: var(--color-bg-deep);
      border-color: transparent;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    // Initialize history service with proper middleware (no monkey-patching)
    this._history = new HistoryService(this.store);
    this._cleanupMiddleware = applyMiddleware(this.store, [
      this._history.createMiddleware(),
    ]);

    // Register basic keyboard shortcuts
    this._cleanupKeyboard = registerKeyboardShortcuts(this.store);

    // Enhanced keyboard: undo/redo
    this._keyHandler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (shouldIgnoreShortcut(e)) return;

      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (this._history.undo()) showToast('ย้อนกลับ', 'info');
      }
      if ((isMod && e.shiftKey && e.key === 'z') || (isMod && e.key === 'y')) {
        e.preventDefault();
        if (this._history.redo()) showToast('ทำซ้ำ', 'info');
      }
      // `?` (Shift+/) toggles the keyboard-shortcut cheatsheet (#124). No modifier;
      // the input guard above keeps it from firing while typing.
      if (!isMod && e.key === '?') {
        e.preventDefault();
        this.showShortcuts = !this.showShortcuts;
      }
    };
    window.addEventListener('keydown', this._keyHandler);

    // Warn user before leaving with unsaved changes
    this._beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this.store.state.template.isDirty) {
        e.preventDefault();
        // Modern browsers show a generic message; returnValue is still required
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    // Track state changes for view switching and pagination
    let prevPaginationKey = '';
    this.store.addEventListener('state-changed', () => {
      this.view = this.store.state.view;

      // Only recompute pagination when relevant state changes
      const s = this.store.state;
      const pKey = `${s.elements.length}|${s.pagination.mode}|${s.pagination.rowsPerPage}|${s.page.height}|${s.jsonData ? 'data' : ''}`;
      if (pKey !== prevPaginationKey) {
        prevPaginationKey = pKey;
        applyPagination(this.store);
      }
    });

    // Autosave (#140): debounced draft write to IndexedDB while the user has
    // unsaved changes, so a crash/timeout/closed tab doesn't lose the in-progress
    // edit. Named + removed on disconnect, same pattern as the other listeners.
    this._autosaveHandler = () => {
      if (this.store.state.template.isDirty) {
        this._autosaveDebounced();
      } else {
        this._autosaveDebounced.cancel();
      }
    };
    this.store.addEventListener('state-changed', this._autosaveHandler);

    // Draft recovery (#140): a leftover autosave from a previous session that
    // never got a real save. Offer to restore it via a non-blocking banner
    // (never window.confirm) rather than silently discarding or auto-applying it.
    getDraft().then((draft) => {
      if (!draft) return;
      const hasContent = draft.elements.length > 0 || !!(draft.bands && draft.bands.length) || !!draft.jsonData;
      if (!hasContent) return;

      // Only offer recovery when it actually differs from the freshly-loaded
      // state — at this point in connectedCallback the store is still the
      // blank initial state (or, in NetSuite mode, about to be filled in by
      // autoLoadRecordIfAvailable below), so any draft with real content
      // qualifies.
      const current = this.store.state;
      const isBlankState =
        !current.template.isDirty &&
        current.elements.length === 0 &&
        !current.jsonData;
      if (!isBlankState) return;

      this._pendingDraft = draft;
      this.showDraftBanner = true;
    }).catch((err) => {
      console.warn('Failed to read autosave draft:', err);
    });

    // Wire global events from header buttons.
    // NOTE (#131): pld-save-template is handled by the window listener below ONLY.
    // The header dispatches it bubbles+composed, so it reaches window on its own;
    // adding a `this` listener too would fire _saveTemplate twice (double NetSuite
    // save). Ctrl+S dispatches straight on window, so one listener covers both.
    this.addEventListener('pld-show-templates', () => { this.showTemplateManager = true; });
    this.addEventListener('pld-show-export-json', () => this._exportJson());
    this.addEventListener('pld-load-sample', () => this._loadSample());
    this.addEventListener('pld-load-sample-data', () => this._loadSampleData());
    this.addEventListener('pld-show-bfo-export', () => { this.showBfoExport = true; });
    this.addEventListener('pld-show-save-ns', () => { this.showSaveNs = true; });
    this.addEventListener('pld-show-preview', () => { this.showPreview = true; });
    this.addEventListener('pld-show-shortcuts', () => { this.showShortcuts = true; });

    // Column config event from sidebar
    this.addEventListener('pld-open-column-config', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.columnConfigElementId = detail.elementId;
      this.showColumnConfig = true;
    });

    // Sole save handler (#131): catches both Ctrl+S (dispatched on window by
    // keyboard.service) and the header button (bubbles+composed up to window).
    // Named + removed on disconnect (#135) — an inline arrow could not be
    // unregistered, so every remount stacked another listener and brought the
    // #131 double-save straight back.
    this._saveHandler = () => this._saveTemplate();
    window.addEventListener('pld-save-template', this._saveHandler);

    // ─── NetSuite Auto-load ───
    if (isNetSuiteEnv()) {
      const ctx = getNsContext();
      if (ctx) {
        showToast(`Connected to NetSuite (${ctx.userName})`, 'info');
      }
      // Auto-load record data if opened from a record
      autoLoadRecordIfAvailable().then((data) => {
        if (data) {
          loadJsonData(this.store, data);
          showToast(`Loaded ${(data as any)._recordType} #${(data as any)._internalId}`, 'success');
        }
      }).catch((err) => {
        showToast(`Failed to load record: ${err.message}`, 'error');
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._cleanupKeyboard) this._cleanupKeyboard();
    if (this._cleanupMiddleware) this._cleanupMiddleware();
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._beforeUnloadHandler) window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    if (this._saveHandler) window.removeEventListener('pld-save-template', this._saveHandler);
    if (this._autosaveHandler) this.store.removeEventListener('state-changed', this._autosaveHandler);
    this._autosaveDebounced.cancel();
  }

  render() {
    return html`
      <pld-header></pld-header>
      <pld-template-bar></pld-template-bar>

      ${this.showDraftBanner
        ? html`
            <div class="draft-banner">
              <span>พบงานที่บันทึกอัตโนมัติไว้ (ยังไม่ได้กดบันทึก) — ต้องการกู้คืนหรือไม่?</span>
              <button class="primary" @click=${() => this._restoreDraft()}>กู้คืนงาน</button>
              <button @click=${() => this._discardDraft()}>ละทิ้ง</button>
            </div>
          `
        : ''}

      <div class="main-content">
        <pld-sidebar-left></pld-sidebar-left>

        <!-- #145: contain a canvas/flow crash to an inline fallback + Retry
             instead of taking down the whole app (error-boundary was dead code). -->
        <pld-error-boundary label="พื้นที่ออกแบบ">
          <div class="canvas-area ${this.view !== 'design' ? 'hidden' : ''}">
            <pld-band-view></pld-band-view>
          </div>

          ${this.view === 'flow' ? html`<pld-flow-view></pld-flow-view>` : ''}
        </pld-error-boundary>

        <pld-sidebar-right></pld-sidebar-right>
      </div>

      <!-- ═══ MODALS ═══ -->
      <pld-template-manager-modal
        .open=${this.showTemplateManager}
        @close=${() => (this.showTemplateManager = false)}
      ></pld-template-manager-modal>

      <pld-column-config-modal
        .open=${this.showColumnConfig}
        .elementId=${this.columnConfigElementId}
        @close=${() => (this.showColumnConfig = false)}
      ></pld-column-config-modal>

      <pld-preview-modal
        .open=${this.showPreview}
        @close=${() => (this.showPreview = false)}
      ></pld-preview-modal>

      <pld-bfo-export-modal
        .open=${this.showBfoExport}
        @close=${() => (this.showBfoExport = false)}
      ></pld-bfo-export-modal>

      <pld-save-ns-modal
        .open=${this.showSaveNs}
        @close=${() => (this.showSaveNs = false)}
      ></pld-save-ns-modal>

      <pld-shortcuts-modal
        .open=${this.showShortcuts}
        @close=${() => (this.showShortcuts = false)}
      ></pld-shortcuts-modal>

      <pld-toast></pld-toast>
    `;
  }

  // ═══════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════

  private async _saveTemplate() {
    // Inside NetSuite the 💾 button (and Ctrl+S) must persist to the customrecord.
    // Saving only to IndexedDB looked successful but never reached the account (#137).
    if (isNetSuiteEnv()) {
      try {
        const { id, warning } = await saveTemplateToNetSuite(this.store);
        showToast(warning ? `บันทึกแล้ว (ID: ${id}) — ${warning}` : `บันทึกเข้า NetSuite แล้ว (ID: ${id})`, warning ? 'warning' : 'success');
        // #156: the XML binds ${company.fontRegular}, so an account with no Thai
        // font in its config prints every template with the Thai glyphs dropped —
        // and BFO stays silent about it. Say so right after the save.
        if (!hasThaiFontConfigured()) {
          showToast(
            'ยังไม่ได้ตั้งฟอนต์ไทยใน company config — PDF จะพิมพ์ออกมาโดยไม่มีตัวอักษรไทย (ตั้งที่ customrecord_pld_config)',
            'warning',
          );
        }

      } catch (err) {
        // No IndexedDB fallback — a failed NetSuite save must be visible, not
        // masked by a silent local write (R4: no silent fallback).
        showToast(`บันทึกเข้า NetSuite ไม่สำเร็จ: ${(err as Error).message}`, 'error');
      }
      return;
    }
    // Local (non-NetSuite) mode — persist to this browser and say so plainly so
    // the user does not mistake it for a NetSuite save.
    try {
      await saveTemplate(this.store);
      showToast('บันทึกในเครื่องนี้เท่านั้น (ยังไม่เข้า NetSuite)', 'info');

    } catch (err) {
      showToast(`บันทึกไม่สำเร็จ: ${err}`, 'error');
    }
  }

  /** Restore the pending autosave draft into the store (#140). */
  private _restoreDraft() {
    const draft = this._pendingDraft;
    if (!draft) return;

    this.store.beginDocumentSession();
    clearPaginationCache();
    this.store.dispatch((d) => {
      d.elements = draft.elements;
      d.bands = draft.bands ?? elementsToBands(draft.elements);
      d.copies = draft.copies ?? null;
      d.page = draft.page;
      d.pagination = { ...createDefaultPagination(), ...draft.pagination };
      d.jsonData = draft.jsonData ?? null;
      d.jsonKeys = draft.jsonData ? extractJsonKeys(draft.jsonData) : [];
      d.template.nsMetadata = draft.nsMetadata;
      d.template.id = draft.templateId;
      d.template.name = draft.templateName;
      // Restored content never matches what's saved on disk — mark dirty so
      // the user is prompted to save it for real (#140).
      d.template.isDirty = true;
      d.selectedId = null;
      d.multiSelect = [];
      d.currentPage = 1;
    });

    this._pendingDraft = null;
    this.showDraftBanner = false;
    claimDraft(this.store, draft).catch((err) => console.warn('Failed to claim restored draft:', err));
    showToast('กู้คืนงานที่บันทึกอัตโนมัติแล้ว', 'success');
  }

  /** Discard the pending autosave draft without restoring it (#140). */
  private _discardDraft() {
    const draft = this._pendingDraft;
    this._pendingDraft = null;
    this.showDraftBanner = false;
    if (draft) dismissDraft(draft).catch((err) => console.warn('Failed to dismiss draft:', err));
  }

  private _exportJson() {
    const { template, page, pagination, elements, jsonData } = this.store.state;
    const json = JSON.stringify({ name: template.name, page, pagination, elements, jsonData }, null, 2);
    navigator.clipboard?.writeText(json);
    showToast('Template JSON copied to clipboard!', 'success');
  }

  /**
   * โหลดข้อมูลตัวอย่างจาก engine เข้า data panel (#191) — ให้ผูก binding ได้โดยไม่ต้อง
   * เปิดดีไซเนอร์จาก transaction · ตัวอย่างมาจาก engine ไม่ใช่จาก SPA เพราะเจ้าของ
   * binding contract คือ engine (SPA ถือลิสต์เองเมื่อไหร่ มันจะหลุด sync เมื่อนั้น)
   */
  private async _loadSampleData() {
    const ctx = getNsContext();
    try {
      const sample = await fetchNsSampleData(ctx?.recordType || 'invoice');
      loadJsonData(this.store, sample.data);
      showToast('โหลดข้อมูลตัวอย่างแล้ว — ตัวเลขและชื่อทั้งหมดเป็นของสมมติ', 'success');
    } catch (err) {
      showToast(`โหลดข้อมูลตัวอย่างไม่สำเร็จ: ${(err as Error).message}`, 'error');
    }
  }

  private _loadSample() {
    const samples = getSampleTemplates();
    if (samples.length === 0) return;
    if (!confirmDiscardUnsaved(this.store)) return;
    const tpl = samples[0];

    this.store.beginDocumentSession();
    clearPaginationCache();
    this.store.dispatch((draft) => {
      draft.elements = structuredClone(tpl.elements);
      // Sample carries its band structure (#47 3b) — load it so band mode shows the
      // authored layout directly instead of regenerating from elements on entry.
      draft.bands = tpl.bands ? structuredClone(tpl.bands) : [];
      draft.page = { ...tpl.page };
      draft.pagination = { ...tpl.pagination };
      draft.jsonData = tpl.jsonData ? structuredClone(tpl.jsonData) : null;
      draft.jsonKeys = tpl.jsonData ? extractJsonKeys(tpl.jsonData) : [];
      draft.template.id = null;
      draft.template.name = tpl.name;
      draft.template.isDirty = true;
      draft.selectedId = null;
      draft.multiSelect = [];
      draft.currentPage = 1;
    });

    showToast(`Loaded sample: ${tpl.name}`, 'success');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-app-shell': PldAppShell;
  }
}

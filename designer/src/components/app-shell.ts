/**
 * <pld-app-shell>
 * Root application component.
 * Provides the global store context, wires up modals, history,
 * keyboard shortcuts, and pagination engine.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { provide } from '@lit/context';
import { AppStore, storeContext } from '../state/store';
import { HistoryService } from '../services/history.service';
import { registerKeyboardShortcuts, shouldIgnoreShortcut } from '../services/keyboard.service';
import { applyPagination, clearPaginationCache } from '../services/pagination.service';
import {
  saveTemplate,
  saveTemplateToNetSuite,
  needsNetSuiteRecordType,
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
import { DRAWER_MAX_WIDTH } from './layout/app-header';
import { icon } from './shared/icon';
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

  // The shell and its store can be detached/reconnected by a host without being
  // recreated. Keep one history instance for that store so reconnecting does not
  // discard the undo/redo stacks; only the middleware wrapper is reinstalled.
  private readonly _history = new HistoryService(this.store);
  private _cleanupKeyboard: (() => void) | null = null;
  private _cleanupMiddleware: (() => void) | null = null;
  private _connectionGeneration = 0;
  private _dataLoadGeneration = 0;
  private _jsonDataRevision = 0;
  private _observedJsonData: Readonly<Record<string, unknown>> | null = null;
  private readonly _keyHandler = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && (this.leftPanelOpen || this.rightPanelOpen)) {
      e.preventDefault();
      this._closePanels();
      return;
    }
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
    if (!isMod && e.key === '?') {
      e.preventDefault();
      this.showShortcuts = !this.showShortcuts;
    }
  };
  private readonly _beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (this.store.state.template.isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  private readonly _saveHandler = () => this._saveTemplate();
  private readonly _showTemplatesHandler = () => { this.showTemplateManager = true; };
  private readonly _exportJsonHandler = () => this._exportJson();
  private readonly _loadSampleHandler = () => this._loadSample();
  private readonly _loadSampleDataHandler = () => this._loadSampleData();
  private readonly _showBfoExportHandler = () => { this.showBfoExport = true; };
  private readonly _showSaveNsHandler = () => { this.showSaveNs = true; };
  private readonly _showPreviewHandler = () => { this.showPreview = true; };
  private readonly _showShortcutsHandler = () => { this.showShortcuts = true; };
  private readonly _openColumnConfigHandler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    this.columnConfigElementId = detail.elementId;
    this.showColumnConfig = true;
  };
  private _paginationInputs: readonly unknown[] | null = null;
  private readonly _paginationHandler = () => {
    const state = this.store.state;
    this.view = state.view;
    if (state.jsonData !== this._observedJsonData) {
      this._observedJsonData = state.jsonData;
      this._jsonDataRevision++;
    }

    // Immer preserves references for untouched branches. Comparing the complete
    // pagination inputs catches edits inside elements/bands/data that the old
    // length-only key missed, without serializing a potentially large document.
    const nextInputs = [
      state.elements,
      state.bands,
      state.jsonData,
      state.pagination,
      state.page,
    ] as const;
    const changed = !this._paginationInputs
      || nextInputs.some((value, index) => value !== this._paginationInputs![index]);
    if (!changed) return;
    this._paginationInputs = nextInputs;
    applyPagination(this.store);
  };
  // Autosave (#140): debounced draft write, cleaned up like the other listeners.
  private readonly _autosaveHandler = () => {
    if (this.store.state.template.isDirty) {
      this._autosaveDebounced();
    } else {
      this._autosaveDebounced.cancel();
    }
  };
  private _autosaveDebounced: (() => void) & { cancel(): void } = debounce(() => {
    if (!this.store.state.template.isDirty) return;
    saveDraft(this.store, new Date().toISOString()).catch((err) => {
      console.warn('Autosave draft failed:', err);
    });
  }, 1500);

  @state() private view: 'design' | 'flow' = 'design';
  @state() private narrow = false;
  private _drawerMedia: MediaQueryList | null = null;
  private _drawerTrigger: HTMLElement | null = null;
  private _focusedDrawerPanel: string | null = null;
  private readonly _drawerFocusHandler = (event: Event) => {
    const target = event.composedPath()[0];
    this._focusedDrawerPanel = target instanceof HTMLElement && target.matches('.drawer-toggle')
      ? target.getAttribute('aria-controls') : null;
  };
  private readonly _mediaHandler = () => {
    this.narrow = this._drawerMedia?.matches ?? false;
    const active = this.shadowRoot?.activeElement;
    if (!this.narrow && this._focusedDrawerPanel) {
      const panel = this._focusedDrawerPanel;
      this.updateComplete.then(() => {
        if (this.isConnected && !this.narrow) this.renderRoot.querySelector<HTMLElement>(`#${panel}`)?.focus();
      });
    }
    if (this.narrow && active) {
      for (const [panel, slot] of [['tools-panel', 'tools-toggle'], ['properties-panel', 'properties-toggle']]) {
        if (this.renderRoot.querySelector(`#${panel}`)?.contains(active)) {
          this._drawerTrigger = this.renderRoot.querySelector<HTMLElement>(`[slot="${slot}"]`);
        }
      }
    }
    this._closePanels();
  };
  private readonly _toggleLeftHandler = () => this._togglePanel('left');
  private readonly _toggleRightHandler = () => this._togglePanel('right');
  @state() private leftPanelOpen = false;
  @state() private rightPanelOpen = false;

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
      font-family: var(--f-sans);
      background: var(--c-bg);
      color: var(--c-text);
    }

    .main-content {
      flex: 1;
      display: flex;
      position: relative;
      overflow: hidden;
      min-height: 0;
    }

    .workspace-panel {
      position: relative;
      z-index: 2;
      display: flex;
      flex: none;
      min-width: 0;
      background: var(--c-surface);
    }

    .workspace-panel.left { border-right: 1px solid var(--c-border); }
    .workspace-panel.right { border-left: 1px solid var(--c-border); }

    pld-sidebar-left,
    pld-sidebar-right {
      display: flex;
      flex-direction: column;
      width: var(--layout-sidebar);
      max-width: var(--layout-sidebar);
    }

    pld-sidebar-right {
      width: var(--layout-inspector);
      max-width: var(--layout-inspector);
    }

    pld-error-boundary {
      flex: 1;
      display: flex;
      min-width: 0;
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
      background: var(--c-warning-soft);
      color: var(--c-warning);
      border-bottom: 1px solid var(--c-warning);
      font-size: var(--t-sm);
    }

    .draft-banner span {
      flex: 1;
    }

    .draft-banner button {
      min-height: var(--btn-h);
      border: 1px solid var(--c-border-control);
      background: var(--c-surface);
      color: var(--c-text);
      border-radius: var(--r-md);
      padding: 0 var(--s-3);
      font-size: var(--t-sm);
      cursor: pointer;
    }

    .draft-banner button.primary {
      background: var(--c-brand);
      color: var(--c-brand-on);
      border-color: var(--c-brand);
    }

    .draft-banner button:focus-visible,
    .drawer-scrim:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }

    .drawer-scrim { display: none; }
    .drawer-toggle { display: none; width: var(--tap-min); height: var(--tap-min); border: 0;
      border-radius: var(--r-md); background: transparent; color: var(--c-text); cursor: pointer; }
    .drawer-toggle:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .workspace-panel:focus-visible { outline: 2px solid var(--c-brand); outline-offset: -2px; }

    @media (max-width: ${unsafeCSS(DRAWER_MAX_WIDTH)}px) {
      .drawer-toggle { display: inline-grid; place-items: center; flex: none; }
      .workspace-panel {
        position: absolute;
        inset-block: 0;
        z-index: var(--z-overlay);
        box-shadow: var(--sh-lg);
        transition: transform var(--transition-base);
      }

      .workspace-panel.left {
        left: 0;
        transform: translateX(-105%);
      }

      .workspace-panel.right {
        right: 0;
        transform: translateX(105%);
      }

      .workspace-panel.open { transform: translateX(0); }

      .drawer-scrim {
        position: absolute;
        inset: 0;
        z-index: calc(var(--z-overlay) - 1);
        display: block;
        border: 0;
        background: var(--c-scrim);
        cursor: default;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .workspace-panel { transition: none; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    const generation = ++this._connectionGeneration;
    this._drawerMedia = window.matchMedia?.(`(max-width: ${DRAWER_MAX_WIDTH}px)`) ?? null;
    this.narrow = this._drawerMedia?.matches ?? false;
    this._drawerMedia?.addEventListener('change', this._mediaHandler);

    // Initialize history service with proper middleware (no monkey-patching)
    this._cleanupMiddleware?.();
    this._cleanupMiddleware = applyMiddleware(this.store, [
      this._history.createMiddleware(),
    ]);

    // Drawer dismissal must consume Escape before canvas deselection. Keep both
    // listeners in the bubble phase so inner controls/modals handle it first.
    this._cleanupKeyboard?.();
    window.removeEventListener('keydown', this._keyHandler);
    window.addEventListener('keydown', this._keyHandler);
    this._cleanupKeyboard = registerKeyboardShortcuts(this.store);

    // Warn user before leaving with unsaved changes
    window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    // Track view/pagination using a stable listener so reconnects do not leak.
    this._paginationInputs = null;
    this.store.removeEventListener('state-changed', this._paginationHandler);
    this.store.addEventListener('state-changed', this._paginationHandler);
    this._paginationHandler();

    // Autosave (#140): debounced draft write to IndexedDB while the user has
    // unsaved changes, so a crash/timeout/closed tab doesn't lose the in-progress
    // edit. Named + removed on disconnect, same pattern as the other listeners.
    this.store.removeEventListener('state-changed', this._autosaveHandler);
    this.store.addEventListener('state-changed', this._autosaveHandler);

    // Draft recovery (#140): a leftover autosave from a previous session that
    // never got a real save. Offer to restore it via a non-blocking banner
    // (never window.confirm) rather than silently discarding or auto-applying it.
    getDraft().then((draft) => {
      if (!this._isCurrentConnection(generation)) return;
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
      if (!this._isCurrentConnection(generation)) return;
      console.warn('Failed to read autosave draft:', err);
    });

    // Wire global events from header buttons.
    // NOTE (#131): pld-save-template is handled by the window listener below ONLY.
    // The header dispatches it bubbles+composed, so it reaches window on its own;
    // adding a `this` listener too would fire _saveTemplate twice (double NetSuite
    // save). Ctrl+S dispatches straight on window, so one listener covers both.
    this._removeHostListeners();
    this.renderRoot.addEventListener('focusin', this._drawerFocusHandler);
    this.addEventListener('pld-toggle-left-panel', this._toggleLeftHandler);
    this.addEventListener('pld-toggle-right-panel', this._toggleRightHandler);
    this.addEventListener('pld-show-templates', this._showTemplatesHandler);
    this.addEventListener('pld-show-export-json', this._exportJsonHandler);
    this.addEventListener('pld-load-sample', this._loadSampleHandler);
    this.addEventListener('pld-load-sample-data', this._loadSampleDataHandler);
    this.addEventListener('pld-show-bfo-export', this._showBfoExportHandler);
    this.addEventListener('pld-show-save-ns', this._showSaveNsHandler);
    this.addEventListener('pld-show-preview', this._showPreviewHandler);
    this.addEventListener('pld-show-shortcuts', this._showShortcutsHandler);

    // Column config event from sidebar
    this.addEventListener('pld-open-column-config', this._openColumnConfigHandler);

    // Sole save handler (#131): catches both Ctrl+S (dispatched on window by
    // keyboard.service) and the header button (bubbles+composed up to window).
    // Named + removed on disconnect (#135) — an inline arrow could not be
    // unregistered, so every remount stacked another listener and brought the
    // #131 double-save straight back.
    window.removeEventListener('pld-save-template', this._saveHandler);
    window.addEventListener('pld-save-template', this._saveHandler);

    // ─── NetSuite Auto-load ───
    if (isNetSuiteEnv()) {
      const ctx = getNsContext();
      if (ctx) {
        showToast(`Connected to NetSuite (${ctx.userName})`, 'info');
      }
      // Auto-load record data if opened from a record
      const intent = this._beginDataLoad(generation);
      autoLoadRecordIfAvailable().then((data) => {
        if (!this._isCurrentDataLoad(intent)) return;
        if (data) {
          loadJsonData(this.store, data);
          showToast(`Loaded ${(data as any)._recordType} #${(data as any)._internalId}`, 'success');
        }
      }).catch((err) => {
        if (!this._isCurrentDataLoad(intent)) return;
        showToast(`Failed to load record: ${err.message}`, 'error');
      });
    }
  }

  disconnectedCallback() {
    this._drawerMedia?.removeEventListener('change', this._mediaHandler);
    this._drawerMedia = null;
    ++this._connectionGeneration;
    ++this._dataLoadGeneration;
    super.disconnectedCallback();
    this._cleanupKeyboard?.();
    this._cleanupKeyboard = null;
    this._cleanupMiddleware?.();
    this._cleanupMiddleware = null;
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    window.removeEventListener('pld-save-template', this._saveHandler);
    this._removeHostListeners();
    this.store.removeEventListener('state-changed', this._paginationHandler);
    this._paginationInputs = null;
    this.store.removeEventListener('state-changed', this._autosaveHandler);
    this._autosaveDebounced.cancel();
  }

  private _isCurrentConnection(generation: number): boolean {
    return this.isConnected && generation === this._connectionGeneration;
  }

  private _beginDataLoad(connectionGeneration = this._connectionGeneration) {
    return {
      generation: ++this._dataLoadGeneration,
      connectionGeneration,
      documentSession: this.store.documentSession,
      jsonDataRevision: this._jsonDataRevision,
    };
  }

  private _isCurrentDataLoad(intent: ReturnType<PldAppShell['_beginDataLoad']>): boolean {
    return this._isCurrentConnection(intent.connectionGeneration)
      && intent.generation === this._dataLoadGeneration
      && intent.documentSession === this.store.documentSession
      && intent.jsonDataRevision === this._jsonDataRevision;
  }

  private _removeHostListeners(): void {
    this.renderRoot.removeEventListener('focusin', this._drawerFocusHandler);
    this.removeEventListener('pld-toggle-left-panel', this._toggleLeftHandler);
    this.removeEventListener('pld-toggle-right-panel', this._toggleRightHandler);
    this.removeEventListener('pld-show-templates', this._showTemplatesHandler);
    this.removeEventListener('pld-show-export-json', this._exportJsonHandler);
    this.removeEventListener('pld-load-sample', this._loadSampleHandler);
    this.removeEventListener('pld-load-sample-data', this._loadSampleDataHandler);
    this.removeEventListener('pld-show-bfo-export', this._showBfoExportHandler);
    this.removeEventListener('pld-show-save-ns', this._showSaveNsHandler);
    this.removeEventListener('pld-show-preview', this._showPreviewHandler);
    this.removeEventListener('pld-show-shortcuts', this._showShortcutsHandler);
    this.removeEventListener('pld-open-column-config', this._openColumnConfigHandler);
  }

  render() {
    return html`
      <pld-header>
        <button slot="tools-toggle" class="drawer-toggle" type="button" aria-label="เปิดเครื่องมือ (Open tools)"
          aria-expanded=${this.leftPanelOpen} aria-controls="tools-panel" @click=${this._toggleLeftHandler}>${icon('menu')}</button>
        <button slot="properties-toggle" class="drawer-toggle" type="button" aria-label="เปิดคุณสมบัติ (Open properties)"
          aria-expanded=${this.rightPanelOpen} aria-controls="properties-panel" @click=${this._toggleRightHandler}>${icon('settings')}</button>
      </pld-header>
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
        ${this.leftPanelOpen || this.rightPanelOpen
          ? html`<button class="drawer-scrim" type="button" aria-label="ปิดแผงด้านข้าง"
              @click=${this._closePanels}></button>`
          : ''}

        <aside class="workspace-panel left ${this.leftPanelOpen ? 'open' : ''}"
          id="tools-panel" tabindex="-1" ?inert=${this.narrow && !this.leftPanelOpen} aria-label="เครื่องมือออกแบบ">
          <pld-sidebar-left></pld-sidebar-left>
        </aside>

        <!-- #145: contain a canvas/flow crash to an inline fallback + Retry
             instead of taking down the whole app (error-boundary was dead code). -->
        <pld-error-boundary label="พื้นที่ออกแบบ">
          <div class="canvas-area ${this.view !== 'design' ? 'hidden' : ''}">
            <pld-band-view></pld-band-view>
          </div>

          ${this.view === 'flow' ? html`<pld-flow-view></pld-flow-view>` : ''}
        </pld-error-boundary>

        <aside class="workspace-panel right ${this.rightPanelOpen ? 'open' : ''}"
          id="properties-panel" tabindex="-1" ?inert=${this.narrow && !this.rightPanelOpen} aria-label="คุณสมบัติองค์ประกอบ">
          <pld-sidebar-right></pld-sidebar-right>
        </aside>
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
      if (needsNetSuiteRecordType(this.store)) {
        this.showSaveNs = true;
        return;
      }
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
    const intent = this._beginDataLoad();
    try {
      const sample = await fetchNsSampleData(ctx?.recordType || 'invoice');
      if (!this._isCurrentDataLoad(intent)) return;
      loadJsonData(this.store, sample.data);
      showToast('โหลดข้อมูลตัวอย่างแล้ว — ตัวเลขและชื่อทั้งหมดเป็นของสมมติ', 'success');
    } catch (err) {
      if (!this._isCurrentDataLoad(intent)) return;
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

  private async _togglePanel(side: 'left' | 'right') {
    if (!this.narrow) return;
    const wasOpen = side === 'left' ? this.leftPanelOpen : this.rightPanelOpen;
    this._closePanels();
    if (wasOpen) return;
    this._drawerTrigger = this.renderRoot.querySelector<HTMLElement>(`[slot="${side === 'left' ? 'tools' : 'properties'}-toggle"]`);
    this.leftPanelOpen = side === 'left';
    this.rightPanelOpen = side === 'right';
    await this.updateComplete;
    if (!this.isConnected || !(side === 'left' ? this.leftPanelOpen : this.rightPanelOpen)) return;
    this.renderRoot.querySelector<HTMLElement>(`#${side === 'left' ? 'tools' : 'properties'}-panel`)?.focus();
  }

  private _closePanels = () => {
    this.leftPanelOpen = false;
    this.rightPanelOpen = false;
    if (this.narrow) this._drawerTrigger?.focus();
    this._drawerTrigger = null;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-app-shell': PldAppShell;
  }
}

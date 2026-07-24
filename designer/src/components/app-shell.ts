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
import { registerKeyboardShortcuts } from '../services/keyboard.service';
import { applyPagination, clearPaginationCache } from '../services/pagination.service';
import { saveTemplate } from '../services/template.service';
import { showToast } from './shared/toast-notification';
import { getSampleTemplates } from '../constants/sample-templates';
import { isNetSuiteEnv, autoLoadRecordIfAvailable, getNsContext } from '../services/netsuite-adapter.service';
import { loadJsonData, extractJsonKeys } from '../state/actions';
import { applyMiddleware } from '../state/middleware';

// ─── Import all child components ───
import './layout/app-header';
import './layout/template-bar';
import './layout/sidebar-left';
import './canvas/band-view';
import './layout/sidebar-right';
import './flow/flow-view';
import './shared/toast-notification';

// ─── Import modals ───
import './modals/column-config-modal';
import './modals/template-manager-modal';
import './modals/preview-modal';
import './modals/bfo-export-modal';

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

  @state() private view: 'design' | 'flow' = 'design';

  // Modal states
  @state() private showTemplateManager = false;
  @state() private showColumnConfig = false;
  @state() private columnConfigElementId = '';
  @state() private showPreview = false;
  @state() private showBfoExport = false;

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
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (this._history.undo()) showToast('Undo', 'info');
      }
      if ((isMod && e.shiftKey && e.key === 'z') || (isMod && e.key === 'y')) {
        e.preventDefault();
        if (this._history.redo()) showToast('Redo', 'info');
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

    // Wire global events from header buttons.
    // NOTE (#131): pld-save-template is handled by the window listener below ONLY.
    // The header dispatches it bubbles+composed, so it reaches window on its own;
    // adding a `this` listener too would fire _saveTemplate twice (double NetSuite
    // save). Ctrl+S dispatches straight on window, so one listener covers both.
    this.addEventListener('pld-show-templates', () => { this.showTemplateManager = true; });
    this.addEventListener('pld-show-export-json', () => this._exportJson());
    this.addEventListener('pld-load-sample', () => this._loadSample());
    this.addEventListener('pld-show-bfo-export', () => { this.showBfoExport = true; });
    this.addEventListener('pld-show-preview', () => { this.showPreview = true; });

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
  }

  render() {
    return html`
      <pld-header></pld-header>
      <pld-template-bar></pld-template-bar>

      <div class="main-content">
        <pld-sidebar-left></pld-sidebar-left>

        <div class="canvas-area ${this.view !== 'design' ? 'hidden' : ''}">
          <pld-band-view></pld-band-view>
        </div>

        ${this.view === 'flow' ? html`<pld-flow-view></pld-flow-view>` : ''}

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

      <pld-toast></pld-toast>
    `;
  }

  // ═══════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════

  private async _saveTemplate() {
    try {
      await saveTemplate(this.store);
      showToast('Template saved!', 'success');
    } catch (err) {
      showToast(`Save failed: ${err}`, 'error');
    }
  }

  private _exportJson() {
    const { template, page, pagination, elements, jsonData } = this.store.state;
    const json = JSON.stringify({ name: template.name, page, pagination, elements, jsonData }, null, 2);
    navigator.clipboard?.writeText(json);
    showToast('Template JSON copied to clipboard!', 'success');
  }

  private _loadSample() {
    const samples = getSampleTemplates();
    if (samples.length === 0) return;
    const tpl = samples[0];

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

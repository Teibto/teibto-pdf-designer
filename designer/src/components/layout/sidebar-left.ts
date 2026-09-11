/**
 * <pld-sidebar-left>
 * Left sidebar with tabbed navigation:
 *   - Elements: drag palette + page settings
 *   - Layers: full layers panel (reorder, lock, visibility)
 *   - Data: JSON editor with validation & sample data
 *   - Settings: grid, pagination, snap config
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import type { ElementType } from '../../models/element';
import type { PageSizeName } from '../../models/page';
import { setPageSize, setOrientation, setDragType } from '../../state/actions';

// ─── Import panel components ───
import '../panels/layers-panel';
import '../panels/json-editor';
import '../panels/pagination-panel';

type TabId = 'elements' | 'layers' | 'data' | 'settings';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'elements', icon: '◈', label: 'องค์ประกอบ' },
  { id: 'layers',   icon: '≡', label: 'เลเยอร์' },
  { id: 'data',     icon: '{}', label: 'ข้อมูล' },
  { id: 'settings', icon: '⚙', label: 'ตั้งค่า' },
];

@customElement('pld-sidebar-left')
export class PldSidebarLeft extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private activeTab: TabId = 'elements';
  @state() private pageSize: PageSizeName = 'A4';
  @state() private orientation: 'portrait' | 'landscape' = 'portrait';

  static styles = css`
    :host {
      width: 100%;
      background: var(--c-sidebar);
      color: var(--c-sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
    }

    /* ─── Tab Bar ─── */
    .tab-bar {
      display: flex;
      min-height: 60px;
      border-bottom: 1px solid var(--c-sidebar-border);
      flex-shrink: 0;
    }

    .tab {
      flex: 1;
      min-width: 0;
      padding: var(--s-2) var(--s-1);
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      text-align: center;
      cursor: pointer;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: rgba(255, 255, 255, 0.72);
      transition: background var(--transition-fast), color var(--transition-fast);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      user-select: none;
    }

    .tab:hover {
      color: var(--c-sidebar-text);
      background: var(--c-sidebar-hover);
    }

    .tab.active {
      color: var(--c-sidebar-text);
      border-bottom-color: var(--c-sidebar-text);
      background: var(--c-sidebar-active);
    }

    .tab-icon {
      font-size: 14px;
      line-height: 1;
    }

    /* ─── Tab Content ─── */
    .tab-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
      background: var(--c-surface);
      color: var(--c-text);
    }

    /* ─── Section ─── */
    .section {
      padding: var(--s-4);
      border-bottom: 1px solid var(--c-border);
    }

    .section-title {
      font-size: var(--t-sm);
      font-weight: var(--w-bold);
      color: var(--c-text-subtle);
      margin-bottom: var(--s-3);
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }

    /* ─── Element Grid ─── */
    .element-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--s-2);
    }

    .element-item {
      min-height: 64px;
      padding: var(--s-2);
      background: var(--c-surface-2);
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      cursor: grab;
      transition: background var(--transition-fast), border-color var(--transition-fast);
      text-align: center;
      font-size: 11.5px;
      color: var(--c-text-subtle);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      user-select: none;
    }

    .element-item:hover {
      border-color: var(--c-brand);
      background: var(--c-brand-soft);
      color: var(--c-text);
    }

    .element-item:active {
      cursor: grabbing;
      background: var(--c-surface-3);
    }

    .el-icon {
      width: 28px;
      height: 28px;
      border-radius: var(--r-md);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .el-icon.header, .el-icon.text { background: var(--c-brand-soft); color: var(--c-brand); }
    .el-icon.image, .el-icon.list { background: var(--c-success-soft); color: var(--c-success); }
    .el-icon.table, .el-icon.barcode { background: var(--c-warning-soft); color: var(--c-warning); }
    .el-icon.shape { background: var(--c-danger-soft); color: var(--c-danger); }
    .el-icon.line { background: var(--c-surface-3); color: var(--c-text-subtle); }

    /* ─── Page Size Buttons ─── */
    .page-sizes {
      display: flex;
      gap: var(--s-2);
      flex-wrap: wrap;
    }

    .page-size-btn {
      min-height: var(--btn-h);
      padding: 0 var(--s-3);
      border: 1px solid var(--c-border-control);
      border-radius: var(--r-md);
      background: var(--c-surface);
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
      font-family: inherit;
    }

    .page-size-btn.active,
    .page-size-btn:hover {
      border-color: var(--c-brand);
      color: var(--c-brand);
      background: var(--c-brand-soft);
    }

    .orient-row {
      display: flex;
      gap: 8px;
      margin-top: var(--s-3);
    }

    .orient-row .page-size-btn {
      flex: 1;
    }

    /* ─── Settings/Data Panel ─── */
    .panel-section {
      padding: var(--s-4);
      border-bottom: 1px solid var(--c-border);
    }

    .data-panel {
      padding: var(--s-4);
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .tab:focus-visible,
    .page-size-btn:focus-visible,
    .element-item:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring-inverse);
    }

    .element-item:focus-visible,
    .page-size-btn:focus-visible { box-shadow: var(--focus-ring); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('state-changed', (e: Event) => {
      const s = (e as StateChangedEvent).state;
      this.pageSize = s.page.size;
      this.orientation = s.page.orientation;
    });
  }

  render() {
    return html`
      <!-- Tab Bar -->
      <div class="tab-bar" role="tablist" aria-label="เครื่องมือออกแบบ">
        ${TABS.map((t) => html`
          <button type="button"
            class="tab ${this.activeTab === t.id ? 'active' : ''}"
            role="tab"
            aria-selected=${this.activeTab === t.id}
            @click=${() => (this.activeTab = t.id)}
          >
            <span class="tab-icon" aria-hidden="true">${t.icon}</span>
            ${t.label}
          </button>
        `)}
      </div>

      <!-- Tab Content -->
      <div class="tab-content" role="tabpanel">
        ${this._renderTabContent()}
      </div>
    `;
  }

  private _renderTabContent() {
    switch (this.activeTab) {
      case 'elements': return this._renderElementsTab();
      case 'layers':   return this._renderLayersTab();
      case 'data':     return this._renderDataTab();
      case 'settings': return this._renderSettingsTab();
      default:         return nothing;
    }
  }

  // ═══════════════════════════════════════
  // ELEMENTS TAB
  // ═══════════════════════════════════════

  private _renderElementsTab() {
    return html`
      <div class="section">
        <div class="section-title"><span>◈</span> ลากวางองค์ประกอบ</div>
        <div class="element-grid">
          ${this._elItem('header', 'H', 'Header')}
          ${this._elItem('text', 'T', 'Text')}
          ${this._elItem('image', '◻', 'Image')}
          ${this._elItem('table', '⊞', 'Table')}
          ${this._elItem('shape', '■', 'Shape')}
          ${this._elItem('line', '─', 'Line')}
          ${this._elItem('barcode', '|||', 'Barcode')}
          ${this._elItem('list', '≡', 'List')}
        </div>
      </div>

      <div class="section">
        <div class="section-title"><span>▦</span> ตั้งค่าหน้ากระดาษ</div>
        <div class="page-sizes">
          ${(['A4', 'Letter', 'A3', 'A5', 'Custom'] as PageSizeName[]).map(
            (size) => html`
              <button
                class="page-size-btn ${this.pageSize === size ? 'active' : ''}"
                @click=${() => setPageSize(this.store, size)}
              >${size}</button>
            `,
          )}
        </div>
        <div class="orient-row">
          <button
            class="page-size-btn ${this.orientation === 'portrait' ? 'active' : ''}"
            @click=${() => setOrientation(this.store, 'portrait')}
          >↕ แนวตั้ง</button>
          <button
            class="page-size-btn ${this.orientation === 'landscape' ? 'active' : ''}"
            @click=${() => setOrientation(this.store, 'landscape')}
          >↔ แนวนอน</button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // LAYERS TAB
  // ═══════════════════════════════════════

  private _renderLayersTab() {
    return html`<pld-layers-panel></pld-layers-panel>`;
  }

  // ═══════════════════════════════════════
  // DATA TAB
  // ═══════════════════════════════════════

  private _renderDataTab() {
    return html`
      <div class="data-panel">
        <pld-json-editor></pld-json-editor>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // SETTINGS TAB
  // ═══════════════════════════════════════

  private _renderSettingsTab() {
    return html`
      <div class="panel-section">
        <pld-pagination-panel></pld-pagination-panel>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  private _elItem(type: ElementType, icon: string, label: string) {
    return html`
      <div class="element-item" draggable="true" tabindex="0" role="button"
        aria-label="ลาก ${label} ไปยังพื้นที่ออกแบบ"
        @dragstart=${(e: DragEvent) => this._onDragStart(e, type)}>
        <div class="el-icon ${type}">${icon}</div>
        <span>${label}</span>
      </div>
    `;
  }

  private _onDragStart(e: DragEvent, type: ElementType) {
    e.dataTransfer?.setData('element-type', type);
    // Transient UI flag — must NOT be undoable (#129).
    setDragType(this.store, type);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-sidebar-left': PldSidebarLeft;
  }
}

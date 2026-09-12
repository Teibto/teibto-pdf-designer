/**
 * <pld-sidebar-left>
 * Left sidebar with tabbed navigation:
 *   - Elements: drag palette + page settings
 *   - Layers: full layers panel (reorder, lock, visibility)
 *   - Data: JSON editor with validation & sample data
 *   - Settings: grid, pagination, snap config
 *
 * @since 2026-09-12
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import type { ElementType, ElementRoleType } from '../../models/element';
import type { PageSizeName } from '../../models/page';
import { setPageSize, setOrientation, setDragType, addElementToNewBand } from '../../state/actions';

import { BAND_ORDER, bandAccepts } from '../../models/bands';
import { icon, type IconName } from '../shared/icon';
import { showToast } from '../shared/toast-notification';

// ─── Import panel components ───
import '../panels/layers-panel';
import '../panels/json-editor';
import '../panels/pagination-panel';

type TabId = 'elements' | 'layers' | 'data' | 'settings';

const TABS: { id: TabId; icon: IconName; label: string }[] = [
  { id: 'elements', icon: 'shapes', label: 'องค์ประกอบ' },
  { id: 'layers',   icon: 'layers', label: 'เลเยอร์' },
  { id: 'data',     icon: 'database', label: 'ข้อมูล' },
  { id: 'settings', icon: 'settings', label: 'ตั้งค่า' },
];

@customElement('pld-sidebar-left')
export class PldSidebarLeft extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  private _paletteDragType: ElementType | null = null;
  @state() private activeTab: TabId = 'elements';
  @state() private destination: ElementRoleType = 'content';
  @state() private pageSize: PageSizeName = 'A4';
  @state() private orientation: 'portrait' | 'landscape' = 'portrait';

  private readonly _onStateChanged = (event: Event) => {
    const state = (event as StateChangedEvent).state;
    this.pageSize = state.page.size;
    this.orientation = state.page.orientation;
  };

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
      font-size: var(--t-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: normal;
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
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      user-select: none;
    }

    .element-item:disabled { opacity: 0.45; cursor: not-allowed; }
    .element-item:hover:not(:disabled) {
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

    select { width: 100%; min-height: var(--btn-h); font: inherit; color: var(--c-text); background: var(--c-surface); border: 1px solid var(--c-border-control); border-radius: var(--r-md); margin-block: var(--s-2); }
    .palette-help { font-size: var(--t-sm); margin: 0 0 var(--s-3); }
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
    this.pageSize = this.store.state.page.size;
    this.orientation = this.store.state.page.orientation;
    this.store.addEventListener('state-changed', this._onStateChanged);
  }

  disconnectedCallback() {
    this._onPaletteDragEnd();
    this.store.removeEventListener('state-changed', this._onStateChanged);
    super.disconnectedCallback();
  }

  render() {
    return html`
      <!-- Tab Bar -->
      <div class="tab-bar" role="tablist" aria-label="เครื่องมือออกแบบ">
        ${TABS.map((t) => html`
          <button type="button"
            class="tab ${this.activeTab === t.id ? 'active' : ''}"
            role="tab" id="tab-${t.id}" aria-controls="palette-panel" tabindex=${this.activeTab === t.id ? 0 : -1}
            @keydown=${(event: KeyboardEvent) => this._onTabKeydown(event, t.id)}
            aria-selected=${this.activeTab === t.id}
            @click=${() => (this.activeTab = t.id)}
          >
            <span class="tab-icon" aria-hidden="true">${icon(t.icon)}</span>
            ${t.label}
          </button>
        `)}
      </div>

      <!-- Tab Content -->
      <div class="tab-content" id="palette-panel" role="tabpanel" aria-labelledby="tab-${this.activeTab}" tabindex="0">
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
        <div class="section-title">${icon('shapes')} เพิ่มองค์ประกอบ</div>
        <label for="insert-destination">เพิ่มแถวใหม่ในส่วน (Destination)</label>
        <select id="insert-destination" .value=${this.destination}
          @change=${(event: Event) => { this.destination = (event.target as HTMLSelectElement).value as ElementRoleType; }}>
          ${BAND_ORDER.filter(role => role !== 'watermark').map(role => html`<option value=${role}>${role}</option>`)}
        </select>
        <p class="palette-help">คลิกหรือกด Enter / Space เพื่อเพิ่มแถวใหม่ หรือ drag ไปยังช่องที่ต้องการ</p>
        <div class="element-grid">
          ${this._elItem('header', 'heading', 'Header')}
          ${this._elItem('text', 'text', 'Text')}
          ${this._elItem('image', 'image', 'Image')}
          ${this._elItem('table', 'table', 'Table')}
          ${this._elItem('shape', 'square', 'Shape')}
          ${this._elItem('line', 'minus', 'Line')}
          ${this._elItem('barcode', 'barcode', 'Barcode')}
          ${this._elItem('list', 'list', 'List')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">${icon('file')} ตั้งค่าหน้ากระดาษ</div>
        <div class="page-sizes">
          ${(['A4', 'Letter', 'A3', 'A5', 'Custom'] as PageSizeName[]).map(
            (size) => html`
              <button
                aria-pressed=${this.pageSize === size}
                class="page-size-btn ${this.pageSize === size ? 'active' : ''}"
                @click=${() => setPageSize(this.store, size)}
              >${size}</button>
            `,
          )}
        </div>
        <div class="orient-row">
          <button
            aria-pressed=${this.orientation === 'portrait'}
            class="page-size-btn ${this.orientation === 'portrait' ? 'active' : ''}"
            @click=${() => setOrientation(this.store, 'portrait')}
          >${icon('arrow-up-down')} แนวตั้ง</button>
          <button
            aria-pressed=${this.orientation === 'landscape'}
            class="page-size-btn ${this.orientation === 'landscape' ? 'active' : ''}"
            @click=${() => setOrientation(this.store, 'landscape')}
          >${icon('arrow-left-right')} แนวนอน</button>
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

  private _elItem(type: ElementType, iconName: IconName, label: string) {
    return html`
      <button type="button" class="element-item" draggable="true"
        title=${bandAccepts(this.destination, type) ? `เพิ่มใน ${this.destination}` : `ส่วน ${this.destination} ไม่รองรับ ${label} — เลือกส่วนอื่นหรือลากไปยังช่องที่รองรับ`}
        aria-label="เพิ่ม ${label} ใน ${this.destination}"
        @click=${() => this._insert(type, label)}
        @dragstart=${(e: DragEvent) => this._onDragStart(e, type)}
        @dragend=${this._onPaletteDragEnd}>
        <div class="el-icon ${type}">${icon(iconName)}</div>
        <span>${label}</span>
      </button>
    `;
  }

  private _onTabKeydown(event: KeyboardEvent, current: TabId) {
    const index = TABS.findIndex(tab => tab.id === current);
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % TABS.length; break;
      case 'ArrowLeft': next = (index + TABS.length - 1) % TABS.length; break;
      case 'Home': next = 0; break;
      case 'End': next = TABS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    this.activeTab = TABS[next].id;
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`#tab-${this.activeTab}`)?.focus());
  }

  private _insert(type: ElementType, label: string) {
    const id = addElementToNewBand(this.store, type, this.destination);
    if (id) showToast(`เพิ่ม ${label} ใน ${this.destination} แล้ว`, 'success');
    else showToast(`ส่วน ${this.destination} ไม่รองรับ ${label} — กรุณาเลือกส่วนอื่น`, 'warning');
  }

  private readonly _onPaletteDragEnd = () => {
    // A completed drop may already have consumed the flag. Only clear the drag
    // this palette owns; cleanup remains transient and must not add an undo step.
    if (this._paletteDragType && this.store.state.dragType === this._paletteDragType) {
      setDragType(this.store, null);
    }
    this._paletteDragType = null;
  };

  private _onDragStart(e: DragEvent, type: ElementType) {
    this._paletteDragType = type;
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

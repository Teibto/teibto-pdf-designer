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
      width: 280px;
      background: var(--color-bg-panel);
      border-right: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
      animation: fadeIn 0.35s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ─── Tab Bar ─── */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .tab {
      flex: 1;
      padding: 8px 4px;
      text-align: center;
      cursor: pointer;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--color-text-muted);
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      user-select: none;
    }

    .tab:hover {
      color: var(--color-text-dim);
      background: var(--color-bg-hover);
    }

    .tab.active {
      color: var(--color-accent);
      border-bottom-color: var(--color-accent);
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
    }

    /* ─── Section ─── */
    .section {
      padding: 14px;
      border-bottom: 1px solid var(--color-border);
    }

    .section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--color-text-muted);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ─── Element Grid ─── */
    .element-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    .element-item {
      padding: 10px 8px;
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      cursor: grab;
      transition: all 0.2s;
      text-align: center;
      font-size: 11.5px;
      color: var(--color-text-dim);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      user-select: none;
    }

    .element-item:hover {
      border-color: var(--color-accent);
      background: var(--color-bg-hover);
      color: var(--color-text);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(79, 110, 247, 0.15);
    }

    .element-item:active {
      cursor: grabbing;
      transform: scale(0.96);
    }

    .el-icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .el-icon.header  { background: rgba(79, 110, 247, 0.2);  color: var(--color-accent); }
    .el-icon.text    { background: rgba(79, 110, 247, 0.15); color: var(--color-accent); }
    .el-icon.image   { background: rgba(34, 211, 167, 0.15); color: var(--color-accent2); }
    .el-icon.table   { background: rgba(245, 158, 66, 0.15); color: var(--color-accent3); }
    .el-icon.shape   { background: rgba(231, 76, 139, 0.15); color: var(--color-accent4); }
    .el-icon.line    { background: rgba(138, 140, 160, 0.2); color: var(--color-text-dim); }
    .el-icon.barcode { background: rgba(245, 158, 66, 0.2);  color: var(--color-accent3); }
    .el-icon.list    { background: rgba(34, 211, 167, 0.2);  color: var(--color-accent2); }

    /* ─── Page Size Buttons ─── */
    .page-sizes {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .page-size-btn {
      padding: 5px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-bg-card);
      color: var(--color-text-dim);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }

    .page-size-btn.active,
    .page-size-btn:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
      background: rgba(79, 110, 247, 0.08);
    }

    .orient-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    .orient-row .page-size-btn {
      flex: 1;
    }

    /* ─── Settings/Data Panel ─── */
    .panel-section {
      padding: 14px;
      border-bottom: 1px solid var(--color-border);
    }

    .data-panel {
      padding: 14px;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
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
      <div class="tab-bar">
        ${TABS.map((t) => html`
          <div
            class="tab ${this.activeTab === t.id ? 'active' : ''}"
            @click=${() => (this.activeTab = t.id)}
          >
            <span class="tab-icon">${t.icon}</span>
            ${t.label}
          </div>
        `)}
      </div>

      <!-- Tab Content -->
      <div class="tab-content">
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
      <div class="element-item" draggable="true"
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

/**
 * <pld-layers-panel>
 * Full-featured layers panel inspired by Figma.
 * Features: drag-to-reorder, inline rename, lock/visibility toggles,
 * type icons, role badges, multi-select highlight, and document-order management.
 *
 * @author Wichit Wongta
 */
import { icon, type IconName } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { BAND_ORDER, type Band } from '../../models/bands';
import { showToast } from '../shared/toast-notification';
import type { CanvasElement, ElementType } from '../../models/element';
import {
  selectElement,
  toggleMultiSelect,
  toggleLock,
  toggleVisibility,
  updateElement,
  reorderDocumentElement,
} from '../../state/actions';

/** Icon map per element type */
const TYPE_ICONS: Record<ElementType, IconName> = {
  header: 'heading', text: 'text', image: 'image', table: 'table',
  shape: 'square', line: 'minus', barcode: 'barcode', list: 'list',
};


@customElement('pld-layers-panel')
export class PldLayersPanel extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private elements: CanvasElement[] = [];
  @state() private bands: Band[] = [];
  @state() private selectedId: string | null = null;
  @state() private multiSelect: string[] = [];
  @state() private editingId: string | null = null;
  @state() private dragOverId: string | null = null;
  @state() private announcement = '';
  @state() private dragPosition: 'above' | 'below' | null = null;

  @query('.edit-input') private editInput!: HTMLInputElement;

  private _dragSourceId: string | null = null;
  private _stateHandler: ((e: Event) => void) | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    /* ─── Header ─── */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--color-border);
    }

    .panel-title {
      font-size: var(--t-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .count-badge {
      background: var(--color-bg-deep);
      padding: 1px 6px;
      border-radius: 8px;
      font-size: var(--t-sm);
      color: var(--color-text-dim);
    }

    /* ─── Layer List ─── */
    .layer-list {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }

    .layer-list::-webkit-scrollbar {
      width: 4px;
    }
    .layer-list::-webkit-scrollbar-thumb {
      background: var(--color-border);
      border-radius: 2px;
    }

    /* ─── Layer Item ─── */
    .layer-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px 6px 14px;
      cursor: pointer;
      transition: all 0.12s;
      border-left: 3px solid transparent;
      position: relative;
      user-select: none;
    }

    .layer-item:hover {
      background: var(--color-bg-hover);
    }

    .layer-item.selected {
      background: var(--c-brand-soft);
      border-left-color: var(--color-accent);
    }

    .layer-item.multi-selected {
      background: var(--c-brand-soft);
      border-left-color: var(--c-brand);
    }

    .layer-item.locked {
      font-style: italic;
    }

    .layer-item.hidden-el {
      text-decoration: line-through;
    }

    /* Drag indicators */
    .layer-item.drag-above::before {
      content: '';
      position: absolute;
      top: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--color-accent);
      border-radius: 1px;
    }

    .layer-item.drag-below::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--color-accent);
      border-radius: 1px;
    }

    /* ─── Type Icon ─── */
    .type-icon {
      width: 22px;
      height: 22px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--t-sm);
      font-weight: 700;
      flex-shrink: 0;
      transition: background 0.15s;
    }

    .type-icon.header, .type-icon.text { background: var(--c-brand-soft); color: var(--c-brand); }
    .type-icon.image { background: var(--c-success-soft); color: var(--c-success); }
    .type-icon.table { background: var(--c-warning-soft); color: var(--c-warning); }
    .type-icon.shape { background: var(--c-danger-soft); color: var(--c-danger); }
    .type-icon.line    { background: var(--c-surface-3);  color: var(--color-text-dim); }
    .type-icon.barcode { background: var(--c-warning-soft); color: var(--c-warning); }
    .type-icon.list { background: var(--c-success-soft); color: var(--c-success); }

    /* ─── Layer Info ─── */
    .layer-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .layer-select { display: block; width: 100%; border: none; padding: 4px 0; background: transparent; text-align: left; font: inherit; cursor: pointer; min-height: var(--btn-h); }
    .layer-help { margin: 8px 14px; font-size: var(--t-sm); color: var(--c-text-subtle); }
    .sr-only { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
    .layer-name {
      font-size: var(--t-sm);
      color: var(--color-text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.12s;
    }

    .layer-item.selected .layer-name {
      color: var(--color-text);
      font-weight: 500;
    }

    .layer-meta {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .role-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .layer-role {
      font-size: var(--t-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-muted);
    }

    .layer-binding {
      font-family: var(--font-mono);
      font-size: var(--t-sm);
      color: var(--color-accent);
      opacity: 0.7;
      margin-left: auto;
    }

    .group-badge {
      font-size: var(--t-sm);
      padding: 0 4px;
      border-radius: 3px;
      background: var(--c-info-soft);
      color: var(--c-info);
      letter-spacing: 0.3px;
      font-weight: 600;
      white-space: nowrap;
    }

    /* ─── Action Buttons ─── */
    .layer-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 1;
      transition: opacity 0.15s;
      flex-shrink: 0;
    }

    .layer-item:hover .layer-actions,
    .layer-item.selected .layer-actions {
      opacity: 1;
    }

    .action-btn {
      width: var(--btn-h);
      height: var(--btn-h);
      border: none;
      background: none;
      color: var(--color-text-muted);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s;
      padding: 0;
      font-family: inherit;
    }

    .action-btn:hover {
      background: var(--color-bg-deep);
      color: var(--color-text);
    }

    .action-btn.active {
      color: var(--color-accent);
    }

    /* ─── Inline Edit ─── */
    .edit-input {
      font-size: var(--t-sm);
      background: var(--color-bg-deep);
      border: 1px solid var(--color-accent);
      border-radius: 3px;
      color: var(--color-text);
      padding: 1px 4px;
      outline: none;
      font-family: inherit;
      width: 100%;
      box-sizing: border-box;
    }

    /* ─── Empty State ─── */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--color-text-muted);
      font-size: var(--t-sm);
      text-align: center;
    }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately (panel may connect after elements already exist)
    const s = this.store.state;
    this.elements = s.elements;
    this.bands = s.bands;
    this.selectedId = s.selectedId;
    this.multiSelect = s.multiSelect;

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      const st = (e as StateChangedEvent).state;
      this.elements = st.elements;
      this.bands = st.bands;
      this.selectedId = st.selectedId;
      this.multiSelect = st.multiSelect;
    };
    this.store.addEventListener('state-changed', this._stateHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._stateHandler) {
      this.store.removeEventListener('state-changed', this._stateHandler);
      this._stateHandler = null;
    }
  }

  render() {
    const sorted = this._orderedElements();

    return html`
      <div class="panel-header">
        <div class="panel-title">
          <span>${icon('layers')}</span> Layers
          <span class="count-badge">${this.elements.length}</span>
        </div>
      </div>

      <p id="layer-help" class="layer-help">Enter: เลือก · F2: เปลี่ยนชื่อ · Alt+↑/↓: จัดลำดับเอกสาร</p>
      <span class="sr-only" role="status">${this.announcement}</span>
      <div class="layer-list" role="list" aria-label="Layers" @dragover=${this._onListDragOver} @drop=${this._onListDrop}>
        ${sorted.length === 0
          ? html`<div class="empty-state">ลาก element ลงพื้นที่ออกแบบ<br>เพื่อสร้างเลเยอร์</div>`
          : sorted.map((el) => this._renderLayer(el))
        }
      </div>
    `;
  }

  private _renderLayer(el: CanvasElement) {
    const isSelected = el.id === this.selectedId;
    const isMulti = this.multiSelect.includes(el.id);
    const isEditing = this.editingId === el.id;
    const dragAbove = this.dragOverId === el.id && this.dragPosition === 'above';
    const dragBelow = this.dragOverId === el.id && this.dragPosition === 'below';

    const classes = [
      'layer-item',
      isSelected ? 'selected' : '',
      isMulti && !isSelected ? 'multi-selected' : '',
      el.locked ? 'locked' : '',
      !el.visible ? 'hidden-el' : '',
      dragAbove ? 'drag-above' : '',
      dragBelow ? 'drag-below' : '',
    ].filter(Boolean).join(' ');

    return html`
      <div
        class=${classes}
        role="listitem"
        data-layer-id=${el.id}
        draggable="true"
        @click=${(e: MouseEvent) => this._onClick(e, el.id)}
        @dblclick=${() => this._startEdit(el.id)}
        @dragstart=${(e: DragEvent) => this._onDragStart(e, el.id)}
        @dragover=${(e: DragEvent) => this._onDragOver(e, el.id)}
        @dragleave=${() => this._onDragLeave()}
        @dragend=${() => this._onDragEnd()}
        @drop=${(e: DragEvent) => this._onDrop(e, el.id)}
      >
        <!-- Type Icon -->
        <div class="type-icon ${el.type}">${icon(TYPE_ICONS[el.type])}</div>

        <!-- Layer Info -->
        <div class="layer-info">
          ${isEditing
            ? html`
                <input
                  class="edit-input" aria-label="ชื่อเลเยอร์"
                  .value=${el.name}
                  @blur=${(e: FocusEvent) => this._finishEdit(el.id, e)}
                  @keydown=${(e: KeyboardEvent) => this._editKeyDown(e, el.id)}
                />
              `
            : html`<button class="layer-select layer-name" type="button" aria-pressed=${isSelected || isMulti}
                aria-describedby="layer-help" data-select-id=${el.id}
                @keydown=${(e: KeyboardEvent) => this._onLayerKeyDown(e, el.id)}>${el.name}</button>`
          }
          <div class="layer-meta">
            <span class="role-dot" style="background:var(--color-role-${el.role})"></span>
            <span class="layer-role">${el.role}</span>
            ${el.groupId
              ? html`<span class="group-badge" title="Grouped">G</span>`
              : nothing
            }
            ${el.binding
              ? html`<span class="layer-binding">{{${el.binding}}}</span>`
              : nothing
            }
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="layer-actions">
          <button
            class="action-btn ${el.visible ? '' : 'active'}"
            aria-label="${el.visible ? 'Hide' : 'Show'} ${el.name}" aria-pressed=${!el.visible}
            title="${el.visible ? 'Hide' : 'Show'}"
            @click=${(e: MouseEvent) => { e.stopPropagation(); toggleVisibility(this.store, el.id); }}
          >
            ${icon(el.visible ? 'eye' : 'eye-off')}
          </button>
          <button
            class="action-btn ${el.locked ? 'active' : ''}"
            aria-label="${el.locked ? 'Unlock' : 'Lock'} ${el.name}" aria-pressed=${el.locked}
            title="${el.locked ? 'Unlock' : 'Lock'}"
            @click=${(e: MouseEvent) => { e.stopPropagation(); toggleLock(this.store, el.id); }}
          >
            ${icon(el.locked ? 'lock' : 'unlock')}
          </button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // CLICK / SELECT
  // ═══════════════════════════════════════

  private _onClick(e: MouseEvent, id: string) {
    if (this.editingId) return;
    if (e.shiftKey) {
      toggleMultiSelect(this.store, id);
    } else {
      selectElement(this.store, id);
    }
  }

  private _onLayerKeyDown(e: KeyboardEvent, id: string) {
    if (e.key === 'F2') {
      e.preventDefault(); e.stopPropagation(); this._startEdit(id);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      const sorted = this._orderedElements();
      const index = sorted.findIndex((el) => el.id === id);
      const target = sorted[index + (e.key === 'ArrowUp' ? -1 : 1)];
      if (target) this._reorder(id, target.id, e.key === 'ArrowUp' ? 'above' : 'below');
    }
  }

  /** The list follows actual BFO band/row/cell traversal, never legacy zIndex. */
  private _orderedElements(): CanvasElement[] {
    const byId = new Map(this.elements.map(el => [el.id, el]));
    const ordered: CanvasElement[] = [];
    for (const role of BAND_ORDER) {
      for (const band of this.bands.filter(band => band.role === role)) {
        for (const row of band.rows) for (const col of row.columns) {
          for (const id of col.elementIds) {
            const element = byId.get(id);
            if (element) { ordered.push(element); byId.delete(id); }
          }
        }
      }
    }
    // Keep orphaned imported elements discoverable; the canonical move refuses
    // ambiguous/unlinked references so a gesture cannot silently discard data.
    return [...ordered, ...byId.values()];
  }

  private _reorder(sourceId: string, targetId: string, position: 'above' | 'below') {
    if (!reorderDocumentElement(this.store, sourceId, targetId, position)) {
      this.announcement = 'ไม่ได้ย้ายเลเยอร์: ตำแหน่งเดิม ถูกล็อก หรือโครงสร้างปลายทางไม่รองรับ';
      showToast(this.announcement, 'warning');
      return;
    }
    const ordered = this._orderedElements();
    const at = ordered.findIndex(el => el.id === sourceId);
    this.announcement = `${ordered[at]?.name}: ลำดับเอกสาร ${at + 1} / ${ordered.length}`;
    void this.updateComplete.then(() => {
      this.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-select-id]').forEach((button) => {
        if (button.dataset.selectId === sourceId) button.focus();
      });
    });
  }

  // ═══════════════════════════════════════
  // INLINE RENAME
  // ═══════════════════════════════════════

  private _startEdit(id: string) {
    this.editingId = id;
    requestAnimationFrame(() => {
      if (this.editInput) {
        this.editInput.focus();
        this.editInput.select();
      }
    });
  }

  private _finishEdit(id: string, e: FocusEvent) {
    const val = (e.target as HTMLInputElement).value.trim();
    if (val) {
      updateElement(this.store, id, 'name', val as any);
    }
    this.editingId = null;
  }

  private _editKeyDown(e: KeyboardEvent, _id: string) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Escape') {
      this.editingId = null;
    }
  }

  // ═══════════════════════════════════════
  // DRAG-TO-REORDER
  // ═══════════════════════════════════════

  private _onDragStart(e: DragEvent, id: string) {
    this._dragSourceId = id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', id);
  }

  private _onDragOver(e: DragEvent, targetId: string) {
    if (!this._dragSourceId || this._dragSourceId === targetId) {
      this.dragOverId = null;
      return;
    }
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    this.dragOverId = targetId;
    this.dragPosition = e.clientY < midY ? 'above' : 'below';
  }

  private _onListDragOver(e: DragEvent) {
    e.preventDefault();
  }

  private _onDragLeave() {
    this.dragOverId = null;
    this.dragPosition = null;
  }

  private _onDragEnd() {
    this._dragSourceId = null;
    this.dragOverId = null;
    this.dragPosition = null;
  }

  private _onDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const sourceId = this._dragSourceId;
    if (!sourceId || sourceId === targetId) return;

    this._reorder(sourceId, targetId, this.dragPosition ?? 'below');

    this._onDragEnd();
  }

  private _onListDrop(e: DragEvent) {
    e.preventDefault();
    this._onDragEnd();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-layers-panel': PldLayersPanel;
  }
}

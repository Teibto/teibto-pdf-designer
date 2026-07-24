/**
 * <pld-layers-panel>
 * Full-featured layers panel inspired by Figma.
 * Features: drag-to-reorder, inline rename, lock/visibility toggles,
 * type icons, role badges, multi-select highlight, and z-index management.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import type { CanvasElement, ElementType, ElementRoleType } from '../../models/element';
import {
  selectElement,
  toggleMultiSelect,
  toggleLock,
  toggleVisibility,
  updateElement,
} from '../../state/actions';

/** Icon map per element type */
const TYPE_ICONS: Record<ElementType, string> = {
  header:  'H',
  text:    'T',
  image:   '◻',
  table:   '⊞',
  shape:   '■',
  line:    '─',
  barcode: '|||',
  list:    '≡',
};

/** Role badge colors */
const ROLE_COLORS: Record<ElementRoleType, string> = {
  header:    '#4f6ef7',
  content:   '#22d3a7',
  table:     '#f59e42',
  summary:   '#8b5cf6',
  footer:    '#64748b',
  watermark: '#94a3b8',
};

@customElement('pld-layers-panel')
export class PldLayersPanel extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private elements: CanvasElement[] = [];
  @state() private selectedId: string | null = null;
  @state() private multiSelect: string[] = [];
  @state() private editingId: string | null = null;
  @state() private dragOverId: string | null = null;
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
      font-size: 10px;
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
      font-size: 9px;
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
      background: rgba(79, 110, 247, 0.06);
      border-left-color: var(--color-accent);
    }

    .layer-item.multi-selected {
      background: rgba(79, 110, 247, 0.04);
      border-left-color: rgba(79, 110, 247, 0.4);
    }

    .layer-item.locked {
      opacity: 0.55;
    }

    .layer-item.hidden-el {
      opacity: 0.35;
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
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
      transition: background 0.15s;
    }

    .type-icon.header  { background: rgba(79, 110, 247, 0.18);  color: var(--color-accent); }
    .type-icon.text    { background: rgba(79, 110, 247, 0.12);  color: var(--color-accent); }
    .type-icon.image   { background: rgba(34, 211, 167, 0.15);  color: var(--color-accent2); }
    .type-icon.table   { background: rgba(245, 158, 66, 0.15);  color: var(--color-accent3); }
    .type-icon.shape   { background: rgba(231, 76, 139, 0.15);  color: var(--color-accent4); }
    .type-icon.line    { background: rgba(138, 140, 160, 0.18);  color: var(--color-text-dim); }
    .type-icon.barcode { background: rgba(245, 158, 66, 0.18);  color: var(--color-accent3); }
    .type-icon.list    { background: rgba(34, 211, 167, 0.18);  color: var(--color-accent2); }

    /* ─── Layer Info ─── */
    .layer-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .layer-name {
      font-size: 11.5px;
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
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-muted);
    }

    .layer-binding {
      font-family: var(--font-mono);
      font-size: 8.5px;
      color: var(--color-accent);
      opacity: 0.7;
      margin-left: auto;
    }

    .group-badge {
      font-size: 8px;
      padding: 0 4px;
      border-radius: 3px;
      background: rgba(139, 92, 246, 0.18);
      color: #a78bfa;
      letter-spacing: 0.3px;
      font-weight: 600;
      white-space: nowrap;
    }

    /* ─── Action Buttons ─── */
    .layer-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
      flex-shrink: 0;
    }

    .layer-item:hover .layer-actions,
    .layer-item.selected .layer-actions {
      opacity: 1;
    }

    .action-btn {
      width: 22px;
      height: 22px;
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
      font-size: 11.5px;
      background: var(--color-bg-deep);
      border: 1px solid var(--color-accent);
      border-radius: 3px;
      color: var(--color-text);
      padding: 1px 4px;
      outline: none;
      font-family: inherit;
      width: 100%;
    }

    /* ─── Empty State ─── */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--color-text-muted);
      font-size: 11px;
      text-align: center;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately (panel may connect after elements already exist)
    const s = this.store.state;
    this.elements = s.elements;
    this.selectedId = s.selectedId;
    this.multiSelect = s.multiSelect;

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      const st = (e as StateChangedEvent).state;
      this.elements = st.elements;
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
    // Sort by zIndex descending (top layer first)
    const sorted = [...this.elements].sort((a, b) => b.zIndex - a.zIndex);

    return html`
      <div class="panel-header">
        <div class="panel-title">
          <span>◫</span> Layers
          <span class="count-badge">${this.elements.length}</span>
        </div>
      </div>

      <div class="layer-list" @dragover=${this._onListDragOver} @drop=${this._onListDrop}>
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
        <div class="type-icon ${el.type}">${TYPE_ICONS[el.type]}</div>

        <!-- Layer Info -->
        <div class="layer-info">
          ${isEditing
            ? html`
                <input
                  class="edit-input"
                  .value=${el.name}
                  @blur=${(e: FocusEvent) => this._finishEdit(el.id, e)}
                  @keydown=${(e: KeyboardEvent) => this._editKeyDown(e, el.id)}
                />
              `
            : html`<span class="layer-name">${el.name}</span>`
          }
          <div class="layer-meta">
            <span class="role-dot" style="background:${ROLE_COLORS[el.role]}"></span>
            <span class="layer-role">${el.role}</span>
            ${el.groupId
              ? html`<span class="group-badge">⊞ G</span>`
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
            title="${el.visible ? 'Hide' : 'Show'}"
            @click=${(e: MouseEvent) => { e.stopPropagation(); toggleVisibility(this.store, el.id); }}
          >
            ${el.visible ? '👁' : '👁‍🗨'}
          </button>
          <button
            class="action-btn ${el.locked ? 'active' : ''}"
            title="${el.locked ? 'Unlock' : 'Lock'}"
            @click=${(e: MouseEvent) => { e.stopPropagation(); toggleLock(this.store, el.id); }}
          >
            ${el.locked ? '🔒' : '🔓'}
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

    // Reorder by swapping zIndex values
    const targetEl = this.elements.find((el) => el.id === targetId);
    const sourceEl = this.elements.find((el) => el.id === sourceId);
    if (!targetEl || !sourceEl) return;

    // In the list, items are sorted by zIndex descending.
    // "above" means higher zIndex (closer to front)
    // "below" means lower zIndex (closer to back)
    if (this.dragPosition === 'above') {
      // Place source just above target (higher z)
      this.store.dispatch((draft) => {
        const src = draft.elements.find((el: CanvasElement) => el.id === sourceId);
        const tgt = draft.elements.find((el: CanvasElement) => el.id === targetId);
        if (src && tgt) {
          src.zIndex = tgt.zIndex + 1;
          draft.template.isDirty = true;
        }
      });
    } else {
      // Place source just below target (lower z)
      this.store.dispatch((draft) => {
        const src = draft.elements.find((el: CanvasElement) => el.id === sourceId);
        const tgt = draft.elements.find((el: CanvasElement) => el.id === targetId);
        if (src && tgt) {
          src.zIndex = tgt.zIndex - 1;
          draft.template.isDirty = true;
        }
      });
    }

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

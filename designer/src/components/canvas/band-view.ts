/**
 * <pld-band-view> — band layout EDITOR (#13/#47, strangler slices 1–2b)
 *
 * Renders the current design through the band model (bands → rows → columns) and
 * lets the consultant edit the band structure directly: column width, split/merge
 * column, add/remove/reorder row, and drag an element between cells of the SAME
 * band. All edits mutate `state.bands` through band actions — `elements` stays the
 * sole source of truth for the free canvas until cutover (big-bang, #13 §7 Q1), so
 * the two paths never sync. Bands are regenerated from elements only when empty
 * (band mode is a parallel path — a stray Canvas↔Bands toggle must not wipe edits);
 * an explicit "re-sync from canvas" button re-runs the migration on demand.
 * Dev-gated in app-shell so it never reaches consultants on the live SB2 build
 * until the editor is done.
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import {
  regenerateBands,
  setColumnWidth,
  dragColumnBoundary,
  addBandRow,
  removeBandRow,
  moveBandRow,
  setRowHeight,
  splitColumn,
  mergeColumn,
  moveElementToCell,
  addElementToCell,
  addElementToNewBand,
  removeBandElement,
  selectElement,
} from '../../state/actions';
import { ELEMENT_ROLES } from '../../constants/roles';
import { BAND_ORDER, bandAccepts, type Band } from '../../models/bands';
import { showToast } from '../shared/toast-notification';
import type { ElementType, ElementRoleType, CanvasElement } from '../../models/element';

@customElement('pld-band-view')
export class PldBandView extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private _tick = 0;
  /** Id of the element currently being dragged between cells (band-local). */
  private _dragElId: string | null = null;
  private _onState = () => { this._tick++; };

  connectedCallback() {
    super.connectedCallback();
    // Seed bands from elements only on first entry (empty). Re-entering band mode
    // must NOT discard structural edits — bands are their own source of truth here.
    if (this.store.state.bands.length === 0) regenerateBands(this.store);
    this.store.addEventListener('state-changed', this._onState);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.store.removeEventListener('state-changed', this._onState);
  }

  static styles = css`
    :host { display: block; overflow: auto; height: 100%; padding: 20px; background: var(--color-bg-deep, #0a0b10); }
    .doc { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .toolbar { display: flex; justify-content: flex-end; }
    .band { border: 1px solid var(--band-color, #2a2c3a); border-radius: 8px; overflow: hidden; }
    .band-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: color-mix(in srgb, var(--band-color) 16%, transparent); font-size: 12px; font-weight: 600; color: var(--band-color); }
    .band-head .sp { flex: 1; }
    .band-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--color-bg-card, #1a1b25); }
    .rowwrap { display: flex; align-items: stretch; gap: 6px; }
    .row { display: flex; gap: 8px; flex: 1; }
    .rowtools { display: flex; flex-direction: column; gap: 2px; justify-content: center; }
    .row-h {
      width: 48px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      color: var(--color-text-dim, #8a8ca0);
      font-size: 10px;
      padding: 2px 4px;
      font-family: inherit;
    }
    .col-resizer {
      flex: 0 0 6px;
      cursor: col-resize;
      border-radius: 3px;
      align-self: stretch;
      transition: background 0.1s;
    }
    .col-resizer:hover, .col-resizer:active {
      background: var(--color-accent, #4f6ef7);
    }

    .cell { border: 1px dashed var(--color-border, #2a2c3a); border-radius: 6px; padding: 8px; min-height: 34px; display: flex; flex-direction: column; gap: 4px; }
    .cell.drop { border-color: var(--band-color, #4f6ef7); border-style: solid; background: color-mix(in srgb, var(--band-color) 10%, transparent); }
    .cell.drop-deny, .empty-slot.drop-deny {
      outline: 2px dashed var(--color-danger, #ef4444);
      outline-offset: -2px;
      cursor: not-allowed;
    }
    .cell-w { display: flex; align-items: center; gap: 4px; font-size: 10px; font-family: var(--font-mono, monospace); color: var(--color-text-dim, #8a8ca0); }
    .cell-w .sp { flex: 1; }
    button { width: 18px; height: 18px; line-height: 1; border: 1px solid var(--color-border, #2a2c3a); border-radius: 3px; background: var(--color-bg-hover, #222430); color: var(--color-text, #e8e9f0); cursor: pointer; padding: 0; font-size: 11px; }
    button:disabled { opacity: .35; cursor: default; }
    button.wide { width: auto; padding: 0 8px; height: 20px; font-size: 11px; }
    .cell-w button { width: 16px; height: 16px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--color-text, #e8e9f0); background: var(--color-bg-hover, #222430); border-radius: 4px; padding: 2px 4px 2px 6px; cursor: grab; border: 1px solid transparent; }
    .chip.sel { border-color: var(--band-color, #4f6ef7); background: color-mix(in srgb, var(--band-color) 22%, transparent); }
    .chip[dragging] { opacity: .4; }
    .chip .del { width: 14px; height: 14px; font-size: 9px; border-color: transparent; background: transparent; color: var(--color-text-dim, #8a8ca0); }
    .chip .del:hover { color: #e74c8b; background: var(--color-bg-deep, #0a0b10); }
    .chip .t { color: var(--color-text-dim, #8a8ca0); font-family: var(--font-mono, monospace); font-size: 10px; }
    .empty { color: var(--color-text-dim, #8a8ca0); font-size: 13px; text-align: center; padding: 40px; }
    .empty-slot { border-style: dashed; opacity: .7; }
    .empty-slot.drop { opacity: 1; border-style: solid; background: color-mix(in srgb, var(--band-color) 10%, transparent); }
    .empty-slot .slot-hint { padding: 12px; text-align: center; font-size: 11px; color: var(--color-text-dim, #8a8ca0); }
  `;

  render() {
    void this._tick;
    const { bands, elements, selectedId } = this.store.state;
    const byId = new Map(elements.map((e) => [e.id, e]));

    // Always show all six role slots (BAND_ORDER): a populated band renders its
    // rows/cells; an empty role is a drop-zone so a blank template (or an unused
    // role) can receive its first element without a free canvas (#47 cutover).
    return html`
      <div class="doc">
        <div class="toolbar">
          ${elements.length
            ? html`<button class="wide" title="สร้าง bands ใหม่จาก canvas (ทับ layout ปัจจุบัน)"
                @click=${() => regenerateBands(this.store)}>↻ re-sync จาก canvas</button>`
            : nothing}
        </div>
        ${BAND_ORDER.map((roleType) => {
          const bi = bands.findIndex((b) => b.role === roleType);
          return bi >= 0
            ? this._renderBand(bands[bi], bi, byId, selectedId)
            : this._renderEmptyRole(roleType);
        })}
      </div>
    `;
  }

  /** Render an empty role slot as a compact drop-zone for a palette element. */
  private _renderEmptyRole(roleType: ElementRoleType) {
    const role = ELEMENT_ROLES[roleType];
    return html`
      <div class="band empty-slot" style="--band-color: ${role.color};"
        @dragover=${(e: DragEvent) => this._onDragOver(e, roleType)}
        @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
        @drop=${(e: DragEvent) => this._onEmptyDrop(e, roleType)}>
        <div class="band-head">${role.label} <span style="opacity:.7;font-weight:400;">· ว่าง</span></div>
        <div class="slot-hint">ลาก element มาวางที่นี่เพื่อเริ่ม</div>
      </div>
    `;
  }

  /** Render a populated band with its rows, cells and tools. */
  private _renderBand(band: Band, bi: number, byId: Map<string, CanvasElement>, selectedId: string | null) {
    const role = ELEMENT_ROLES[band.role];
    const itemTable = band.role === 'table'
      ? band.rows.flatMap((r) => r.columns.flatMap((c) => c.elementIds))
          .map((id) => byId.get(id))
          .find((el) => el?.type === 'table')
      : undefined;
    return html`
            <div class="band" style="--band-color: ${role.color};">
              <div class="band-head">
                ${role.label} <span style="opacity:.7;font-weight:400;">· ${band.rows.length} row</span>
                <span class="sp"></span>
                ${itemTable ? html`
                  <button class="wide" title="ตั้งค่าคอลัมน์ของตาราง item (#119)"
                    @click=${() => this._openColumnConfig(itemTable.id)}>⚙ คอลัมน์</button>
                ` : nothing}
                <button class="wide" title="เพิ่มแถว" @click=${() => addBandRow(this.store, bi)}>+ row</button>
              </div>
              <div class="band-body">
                ${repeat(band.rows, (row) => row.id, (row, ri) => html`
                  <div class="rowwrap">
                    <div class="row">
                      ${repeat(row.columns, (col) => col.id, (col, ci) => html`
                        <div class="cell"
                          @dragover=${(e: DragEvent) => this._onDragOver(e, band.role)}
                          @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
                          @drop=${(e: DragEvent) => this._onDrop(e, bi, ri, ci)}
                          style="flex: ${col.widthPct} 1 0;">
                          <span class="cell-w">
                            ${row.columns.length > 1 ? html`
                              <button ?disabled=${col.widthPct <= 5} @click=${() => setColumnWidth(this.store, bi, ri, ci, col.widthPct - 5)}>−</button>
                              <span>${col.widthPct}%</span>
                              <button ?disabled=${col.widthPct >= 95} @click=${() => setColumnWidth(this.store, bi, ri, ci, col.widthPct + 5)}>+</button>
                            ` : html`<span>${col.widthPct}%</span>`}
                            <span class="sp"></span>
                            ${ci > 0 ? html`<button title="รวมกับคอลัมน์ซ้าย" @click=${() => mergeColumn(this.store, bi, ri, ci)}>⇤</button>` : nothing}
                            <button title="แยกคอลัมน์" @click=${() => splitColumn(this.store, bi, ri, ci)}>⇥</button>
                          </span>
                          ${col.elementIds.length
                            ? col.elementIds.map((id) => {
                                const el = byId.get(id);
                                if (!el) return nothing;
                                return html`
                                  <span class="chip ${selectedId === el.id ? 'sel' : ''}" draggable="true"
                                    @click=${() => selectElement(this.store, el.id)}
                                    @dragstart=${(e: DragEvent) => this._onDragStart(e, el.id)}
                                    @dragend=${(e: DragEvent) => this._onDragEnd(e)}>
                                    ${el.name || el.type} <span class="t">${el.type}</span>
                                    <button class="del" title="ลบ element"
                                      @click=${(e: Event) => { e.stopPropagation(); removeBandElement(this.store, el.id); }}>✕</button>
                                  </span>`;
                              })
                            : nothing}
                        </div>
                        ${ci < row.columns.length - 1 ? html`
                          <div class="col-resizer" title="ลากปรับความกว้าง"
                            @pointerdown=${(e: PointerEvent) => this._onResizeStart(e, bi, ri, ci, col.widthPct, row.columns[ci + 1].widthPct)}
                            @pointermove=${(e: PointerEvent) => this._onResizeMove(e)}
                            @pointerup=${(e: PointerEvent) => this._onResizeEnd(e)}></div>
                        ` : nothing}
                      `)}
                    </div>
                    <div class="rowtools">
                      ${band.role === 'header' || band.role === 'footer' ? html`
                        <input class="row-h" type="number" min="4" step="1"
                          title="ความสูงแถว (pt) — คุมความสูง header/footer ที่พิมพ์; ว่าง = auto"
                          placeholder="auto"
                          .value=${row.height != null ? String(Math.round(row.height)) : ''}
                          @change=${(e: Event) => setRowHeight(this.store, bi, ri, Number((e.target as HTMLInputElement).value))} />
                      ` : nothing}
                      <button title="เลื่อนขึ้น" ?disabled=${ri === 0} @click=${() => moveBandRow(this.store, bi, ri, -1)}>↑</button>
                      <button title="เลื่อนลง" ?disabled=${ri === band.rows.length - 1} @click=${() => moveBandRow(this.store, bi, ri, 1)}>↓</button>
                      <button title="ลบแถว" @click=${() => this._removeRow(bi, ri)}>✕</button>
                    </div>
                  </div>
                `)}
              </div>
            </div>
    `;
  }

  // ─── column boundary drag (#98) ───
  private _resizing: { bi: number; ri: number; ci: number; startX: number; rowW: number; startLeft: number } | null = null;

  private _onResizeStart(e: PointerEvent, bi: number, ri: number, ci: number, leftPct: number, _rightPct: number) {
    const rowEl = (e.currentTarget as HTMLElement).closest('.row') as HTMLElement | null;
    this._resizing = { bi, ri, ci, startX: e.clientX, rowW: rowEl?.offsetWidth || 1, startLeft: leftPct };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* synthetic events have no active pointer */ }
    e.preventDefault();
  }

  private _onResizeMove(e: PointerEvent) {
    if (!this._resizing) return;
    const r = this._resizing;
    const deltaPct = ((e.clientX - r.startX) / r.rowW) * 100;
    dragColumnBoundary(this.store, r.bi, r.ri, r.ci, r.startLeft + deltaPct);
  }

  private _onResizeEnd(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    this._resizing = null;
  }

  // ─── element drag between cells (same band) ───
  private _onDragStart(e: DragEvent, elId: string) {
    this._dragElId = elId;
    (e.target as HTMLElement).setAttribute('dragging', '');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', elId); }
  }
  private _onDragEnd(e: DragEvent) {
    (e.target as HTMLElement).removeAttribute('dragging');
    this._dragElId = null;
  }
  /** Shortcut from the Table band head (#119): select the item table and open
   *  its column config directly — no need to find and click the chip first. */
  private _openColumnConfig(elementId: string) {
    selectElement(this.store, elementId);
    this.dispatchEvent(new CustomEvent('pld-open-column-config', {
      detail: { elementId }, bubbles: true, composed: true,
    }));
  }

  /** Delete a row, confirming first when it still holds elements (#136) — the
   *  action drops those elements, so a non-empty row is destructive. */
  private _removeRow(bi: number, ri: number) {
    const row = this.store.state.bands[bi]?.rows[ri];
    const count = row ? row.columns.reduce((n, c) => n + c.elementIds.length, 0) : 0;
    if (count > 0 && !confirm(`ลบแถวนี้พร้อม ${count} element ที่อยู่ในแถว?`)) return;
    removeBandRow(this.store, bi, ri);
  }

  private _onDragOver(e: DragEvent, role: ElementRoleType) {
    // Acceptance matrix (#49): a palette drag (dragType set) the band rejects
    // gets a deny cursor and NO preventDefault — the drop never fires. Chip
    // moves (no dragType) are within-band and always allowed.
    const dragType = this.store.state.dragType;
    if (dragType && !bandAccepts(role, dragType as ElementType)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      (e.currentTarget as HTMLElement).classList.add('drop-deny');
      return;
    }
    e.preventDefault(); // required to allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    (e.currentTarget as HTMLElement).classList.add('drop');
  }
  private _onDragLeave(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('drop', 'drop-deny');
  }
  private _onDrop(e: DragEvent, bi: number, ri: number, ci: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drop');
    // A cell has two drop sources: a palette add (sets store.dragType) and a chip
    // move (sets this._dragElId). dragType is the robust discriminator — it dodges
    // HTML5 protected-mode getData and is never set by a chip drag.
    const type = this.store.state.dragType;
    if (type) {
      const id = addElementToCell(this.store, type as ElementType, bi, ri, ci);
      if (id === null) {
        const role = this.store.state.bands[bi]?.role;
        showToast(`band ${role ?? ''} ไม่รับ element ชนิด ${type} (#49)`, 'warning');
      }
      this.store.dispatch((d) => { d.dragType = null; });
    } else if (this._dragElId) {
      moveElementToCell(this.store, this._dragElId, bi, ri, ci);
    }
    this._dragElId = null;
  }
  /** Drop onto an empty role slot: only a palette add applies (creates the band). */
  private _onEmptyDrop(e: DragEvent, role: ElementRoleType) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drop');
    const type = this.store.state.dragType;
    if (type) {
      const id = addElementToNewBand(this.store, type as ElementType, role);
      if (id === null) {
        showToast(`band ${role} ไม่รับ element ชนิด ${type} (#49)`, 'warning');
      }
      this.store.dispatch((d) => { d.dragType = null; });
    }
    this._dragElId = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-band-view': PldBandView;
  }
}

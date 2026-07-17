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
  addBandRow,
  removeBandRow,
  moveBandRow,
  splitColumn,
  mergeColumn,
  moveElementToCell,
  addElementToCell,
  removeBandElement,
  selectElement,
} from '../../state/actions';
import { ELEMENT_ROLES } from '../../constants/roles';
import type { ElementType } from '../../models/element';

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
    .cell { border: 1px dashed var(--color-border, #2a2c3a); border-radius: 6px; padding: 8px; min-height: 34px; display: flex; flex-direction: column; gap: 4px; }
    .cell.drop { border-color: var(--band-color, #4f6ef7); border-style: solid; background: color-mix(in srgb, var(--band-color) 10%, transparent); }
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
  `;

  render() {
    void this._tick;
    const { bands, elements, selectedId } = this.store.state;
    const byId = new Map(elements.map((e) => [e.id, e]));
    if (bands.length === 0) return html`<div class="empty">ยังไม่มี element — กด Sample หรือวางของบน canvas ก่อน</div>`;

    return html`
      <div class="doc">
        <div class="toolbar">
          <button class="wide" title="สร้าง bands ใหม่จาก canvas (ทับ layout ปัจจุบัน)"
            @click=${() => regenerateBands(this.store)}>↻ re-sync จาก canvas</button>
        </div>
        ${bands.map((band, bi) => {
          const role = ELEMENT_ROLES[band.role];
          return html`
            <div class="band" style="--band-color: ${role.color};">
              <div class="band-head">
                ${role.label} <span style="opacity:.7;font-weight:400;">· ${band.rows.length} row</span>
                <span class="sp"></span>
                <button class="wide" title="เพิ่มแถว" @click=${() => addBandRow(this.store, bi)}>+ row</button>
              </div>
              <div class="band-body">
                ${repeat(band.rows, (row) => row.id, (row, ri) => html`
                  <div class="rowwrap">
                    <div class="row">
                      ${repeat(row.columns, (col) => col.id, (col, ci) => html`
                        <div class="cell"
                          @dragover=${(e: DragEvent) => this._onDragOver(e)}
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
                      `)}
                    </div>
                    <div class="rowtools">
                      <button title="เลื่อนขึ้น" ?disabled=${ri === 0} @click=${() => moveBandRow(this.store, bi, ri, -1)}>↑</button>
                      <button title="เลื่อนลง" ?disabled=${ri === band.rows.length - 1} @click=${() => moveBandRow(this.store, bi, ri, 1)}>↓</button>
                      <button title="ลบแถว" @click=${() => removeBandRow(this.store, bi, ri)}>✕</button>
                    </div>
                  </div>
                `)}
              </div>
            </div>
          `;
        })}
      </div>
    `;
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
  private _onDragOver(e: DragEvent) {
    e.preventDefault(); // required to allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    (e.currentTarget as HTMLElement).classList.add('drop');
  }
  private _onDragLeave(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('drop');
  }
  private _onDrop(e: DragEvent, bi: number, ri: number, ci: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drop');
    // A cell has two drop sources: a palette add (sets store.dragType) and a chip
    // move (sets this._dragElId). dragType is the robust discriminator — it dodges
    // HTML5 protected-mode getData and is never set by a chip drag.
    const type = this.store.state.dragType;
    if (type) {
      addElementToCell(this.store, type as ElementType, bi, ri, ci);
      this.store.dispatch((d) => { d.dragType = null; });
    } else if (this._dragElId) {
      moveElementToCell(this.store, this._dragElId, bi, ri, ci);
    }
    this._dragElId = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-band-view': PldBandView;
  }
}

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
import { icon } from '../shared/icon';
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
  setDragType,
} from '../../state/actions';
import { ELEMENT_ROLES } from '../../constants/roles';
import { BAND_ORDER, bandAccepts, type Band } from '../../models/bands';
import { tagAction } from '../../state/middleware';
import { showToast } from '../shared/toast-notification';
import type { ElementType, ElementRoleType, CanvasElement } from '../../models/element';

let nextResizeGestureId = 0;

@customElement('pld-band-view')
export class PldBandView extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private _tick = 0;
  /** Dismissed the blank-doc onboarding CTA this session (#124 — user chose to
   *  start from an empty template; don't nag again even if they clear it). */
  @state() private _ctaDismissed = false;
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
    this.store.removeEventListener('state-changed', this._onState);
    this._cancelPendingResize();
    this._resizing = null;
    super.disconnectedCallback();
  }

  static styles = css`
    :host { display: block; overflow: auto; height: 100%; padding: 20px; background: var(--c-bg); }
    .doc { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .toolbar { display: flex; justify-content: flex-end; }
    .band { border: 1px solid var(--band-color, var(--c-border)); border-radius: var(--r-lg); }
    .band-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; background: color-mix(in srgb, var(--band-color) 16%, transparent); font-size: 12px; font-weight: 600; color: var(--band-color); }
    .band-head .sp { flex: 1; }
    .band-body { overflow-x: auto; padding: var(--s-3); display: flex; flex-direction: column; gap: var(--s-2); background: var(--c-surface-2); }
    .rowwrap { display: flex; align-items: stretch; gap: 6px; }
    .row { display: flex; gap: 8px; flex: 1; }
    .rowtools { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
    .row-h {
      width: 48px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 4px;
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
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
      background: var(--c-brand);
    }

    .cell { min-width: 140px; border: 1px dashed var(--c-border); border-radius: 6px; padding: 8px; min-height: 34px; display: flex; flex-direction: column; gap: 4px; }
    .cell.drop { border-color: var(--band-color, var(--c-brand)); border-style: solid; background: color-mix(in srgb, var(--band-color) 10%, transparent); }
    .cell.drop-deny, .empty-slot.drop-deny {
      outline: 2px dashed var(--c-danger);
      outline-offset: -2px;
      cursor: not-allowed;
    }
    .cell-w { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--t-sm); font-family: var(--font-mono, monospace); color: var(--c-text-subtle); }
    .cell-w .sp { flex: 1; }
    button { width: var(--btn-h); height: var(--btn-h); line-height: 1; border: 1px solid var(--c-border); border-radius: 4px; background: var(--c-surface-3); color: var(--c-text); cursor: pointer; padding: 0; font-size: 12px; transition: background 0.1s, border-color 0.1s; }
    button:hover:not(:disabled) { background: color-mix(in srgb, var(--band-color, var(--c-brand)) 24%, var(--c-surface-3)); border-color: var(--band-color, var(--c-brand)); }
    button:disabled { opacity: .3; cursor: default; }
    button.wide { width: auto; padding: 0 10px; height: var(--btn-h); font-size: var(--t-sm); }
    /* Segmented groups (#124): width −/%/+ and the column merge/split ops read as
       two distinct control clusters instead of a dense button row. */
    .wgroup, .cgroup { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--c-border); border-radius: 6px; background: var(--c-bg); }
    .wgroup .pct { min-width: 32px; text-align: center; font-size: var(--t-sm); }
    .cell-w button { width: var(--btn-h); height: var(--btn-h); font-size: var(--t-sm); }
    .chip { display: inline-flex; align-items: center; gap: 5px; font-size: var(--t-sm); color: var(--c-text); background: var(--c-surface-3); border-radius: 4px; padding: 2px 4px 2px 6px; cursor: grab; border: 1px solid transparent; }
    .chip-select { width: auto; height: auto; min-height: var(--btn-h); text-align: left; background: transparent; border: none; font: inherit; overflow-wrap: anywhere; }
    .chip.sel { border-color: var(--band-color, var(--c-brand)); background: color-mix(in srgb, var(--band-color) 22%, transparent); }
    .chip[dragging] { opacity: .4; }
    .chip .del { width: var(--btn-h); height: var(--btn-h); font-size: var(--t-sm); border-color: transparent; background: transparent; color: var(--c-text-subtle); }
    .chip .del:hover { color: var(--c-brand-on); background: var(--c-danger); border-color: var(--c-danger); }
    /* Destructive controls flush danger on hover, not on the neutral band tint. */
    button.danger:hover:not(:disabled) { background: var(--c-danger); border-color: var(--c-danger); color: var(--c-brand-on); }
    .chip .t { color: var(--c-text-subtle); font-family: var(--font-mono, monospace); font-size: var(--t-sm); }
    .empty { color: var(--c-text-subtle); font-size: 13px; text-align: center; padding: 40px; }
    .empty-slot { border-style: dashed; border-color: var(--c-border); background: var(--c-surface-2); }
    .empty-slot.drop { border-style: solid; background: color-mix(in srgb, var(--band-color) 10%, transparent); }
    .empty-slot .slot-hint { padding: 12px; text-align: center; font-size: var(--t-sm); color: var(--c-text-subtle); }

    /* Blank-doc onboarding CTA (#124) */
    .cta {
      border: 1px solid var(--c-brand);
      border-radius: 10px;
      background: var(--c-brand-soft);
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
      text-align: center;
    }
    .cta h3 { margin: 0; font-size: 15px; color: var(--c-text); }
    .cta p { margin: 0 0 8px; font-size: 12px; color: var(--c-text-subtle); max-width: 460px; }
    .cta-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    .cta button {
      width: auto; height: auto; padding: 8px 16px; font-size: 13px; border-radius: 6px;
      border: 1px solid var(--c-border); background: var(--c-surface-3);
      color: var(--c-text); cursor: pointer;
    }
    .cta button.primary { border-color: var(--c-brand); background: var(--c-brand); color: var(--c-brand-on); font-weight: var(--w-semibold); }
    .cta button:hover { filter: brightness(1.1); }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
`;

  render() {
    void this._tick;
    const { bands, elements, selectedId } = this.store.state;
    const byId = new Map(elements.map((e) => [e.id, e]));

    // Always show all six role slots (BAND_ORDER): a populated band renders its
    // rows/cells; an empty role is a drop-zone so a blank template (or an unused
    // role) can receive its first element without a free canvas (#47 cutover).
    // Blank-doc onboarding CTA (#124): when nothing has been added yet, offer a
    // fast start (load a sample) or an explicit "start blank" — without forcing a
    // workflow; the empty role drop-zones below stay usable either way.
    const showCta = elements.length === 0 && !this._ctaDismissed;

    return html`
      <div class="doc">
        ${showCta ? html`
          <div class="cta">
            <h3>เริ่มออกแบบเอกสาร</h3>
            <p>โหลดเทมเพลตตัวอย่างเพื่อเริ่มได้เร็ว หรือเริ่มจากหน้าว่างแล้วลากองค์ประกอบจากแถบซ้ายมาวางในแต่ละส่วน</p>
            <div class="cta-actions">
              <button class="primary" @click=${this._loadSampleFromCta}>${icon('file')} โหลดเทมเพลตตัวอย่าง</button>
              <button @click=${() => { this._ctaDismissed = true; }}>เริ่มจากว่าง</button>
            </div>
          </div>
        ` : nothing}
        <div class="toolbar">
          ${elements.length
            ? html`<button type="button" class="wide" title="สร้างโครงแถวและคอลัมน์ใหม่ โดยแทนที่ layout ปัจจุบัน"
                @click=${this._rebuildLayout}>${icon('refresh')} สร้างโครงหน้าใหม่ · Rebuild layout</button>`
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
      <div class="band empty-slot" style="--band-color: var(--color-role-${roleType});"
        @dragover=${(e: DragEvent) => this._onDragOver(e, roleType)}
        @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
        @drop=${(e: DragEvent) => this._onEmptyDrop(e, roleType)}>
        <div class="band-head">${role.label} <span style="opacity:.7;font-weight:400;">· ว่าง</span></div>
        <div class="slot-hint">${roleType === 'watermark'
          ? 'ตั้งค่าลายน้ำจากแผงตั้งค่า'
          : `ลากองค์ประกอบมาที่นี่ หรือเลือกส่วน ${roleType} ในแผงองค์ประกอบ แล้วคลิกหรือกด Enter / Space เพื่อเพิ่ม`}</div>
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
            <div class="band" style="--band-color: var(--color-role-${band.role});">
              <div class="band-head">
                ${role.label} <span style="opacity:.7;font-weight:400;">· ${band.rows.length} row</span>
                <span class="sp"></span>
                ${itemTable ? html`
                  <button class="wide" title="ตั้งค่าคอลัมน์ของตาราง item (#119)"
                    @click=${() => this._openColumnConfig(itemTable.id)}>${icon('settings')} คอลัมน์</button>
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
                            <span class="wgroup">
                              ${row.columns.length > 1 ? html`
                                <button title="ลดความกว้าง 5%" ?disabled=${col.widthPct <= 5} @click=${() => setColumnWidth(this.store, bi, ri, ci, col.widthPct - 5)}>${icon('minus')}</button>
                                <span class="pct">${col.widthPct}%</span>
                                <button title="เพิ่มความกว้าง 5%" ?disabled=${col.widthPct >= 95} @click=${() => setColumnWidth(this.store, bi, ri, ci, col.widthPct + 5)}>${icon('plus')}</button>
                              ` : html`<span class="pct">${col.widthPct}%</span>`}
                            </span>
                            <span class="sp"></span>
                            <span class="cgroup">
                              ${ci > 0 ? html`<button title="รวมกับคอลัมน์ซ้าย" @click=${() => mergeColumn(this.store, bi, ri, ci)}>${icon('left')}</button>` : nothing}
                              <button title="แยกคอลัมน์" @click=${() => splitColumn(this.store, bi, ri, ci)}>${icon('arrow-left-right')}</button>
                            </span>
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
                                    <button class="chip-select" type="button" aria-pressed=${selectedId === el.id}>${el.name || el.type} <span class="t">${el.type}</span></button>
                                    <button class="del" title="ลบ element"
                                      @click=${(e: Event) => { e.stopPropagation(); removeBandElement(this.store, el.id); }}>${icon('close')}</button>
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
                      <button title="เลื่อนขึ้น" ?disabled=${ri === 0} @click=${() => moveBandRow(this.store, bi, ri, -1)}>${icon('up')}</button>
                      <button title="เลื่อนลง" ?disabled=${ri === band.rows.length - 1} @click=${() => moveBandRow(this.store, bi, ri, 1)}>${icon('down')}</button>
                      <button class="danger" title="ลบแถว" @click=${() => this._removeRow(bi, ri)}>${icon('close')}</button>
                    </div>
                  </div>
                `)}
              </div>
            </div>
    `;
  }

  // ─── column boundary drag (#98) ───
  private _resizing: { bi: number; ri: number; ci: number; startX: number; rowW: number; startLeft: number } | null = null;
  private _pendingResize: { bi: number; ri: number; ci: number; leftPct: number } | null = null;
  private _resizeFrame: number | null = null;
  private _resizeHasDispatched = false;
  private _resizeHistoryBatchKey: string | null = null;

  private _onResizeStart(e: PointerEvent, bi: number, ri: number, ci: number, leftPct: number, _rightPct: number) {
    this._cancelPendingResize();
    this._resizeHasDispatched = false;
    this._resizeHistoryBatchKey = `band-resize-gesture-${++nextResizeGestureId}`;
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
    this._pendingResize = { bi: r.bi, ri: r.ri, ci: r.ci, leftPct: r.startLeft + deltaPct };
    if (this._resizeFrame === null) {
      this._resizeFrame = requestAnimationFrame(() => {
        this._resizeFrame = null;
        this._flushPendingResize();
      });
    }
  }

  private _onResizeEnd(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    if (this._resizeFrame !== null) {
      cancelAnimationFrame(this._resizeFrame);
      this._resizeFrame = null;
    }
    this._flushPendingResize();
    this._resizing = null;
    this._resizeHasDispatched = false;
    this._resizeHistoryBatchKey = null;
  }

  private _flushPendingResize() {
    const pending = this._pendingResize;
    this._pendingResize = null;
    if (!pending) return;
    const changed = dragColumnBoundary(
      this.store,
      pending.bi,
      pending.ri,
      pending.ci,
      pending.leftPct,
      !this._resizeHasDispatched,
      this._resizeHistoryBatchKey ?? undefined,
    );
    if (changed) this._resizeHasDispatched = true;
  }

  private _cancelPendingResize() {
    if (this._resizeFrame !== null) cancelAnimationFrame(this._resizeFrame);
    this._resizeFrame = null;
    this._pendingResize = null;
    this._resizeHasDispatched = false;
    this._resizeHistoryBatchKey = null;
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
  /** Blank-doc CTA (#124): load the built-in sample. Reuses the same bubbling
   *  event the header ★ button fires, so there's one load-sample path. */
  private _loadSampleFromCta() {
    this.dispatchEvent(new CustomEvent('pld-load-sample', { bubbles: true, composed: true }));
  }

  /** Shortcut from the Table band head (#119): select the item table and open
   *  its column config directly — no need to find and click the chip first. */
  private _openColumnConfig(elementId: string) {
    selectElement(this.store, elementId);
    this.dispatchEvent(new CustomEvent('pld-open-column-config', {
      detail: { elementId }, bubbles: true, composed: true,
    }));
  }

  private _rebuildLayout() {
    if (!confirm(
      'สร้างโครงหน้าใหม่ (Rebuild layout)?\n'
      + 'ระบบจะสร้างแถวและคอลัมน์ใหม่จากองค์ประกอบ และแทนที่ลำดับแถว ความกว้างคอลัมน์ และ layout ที่ปรับไว้\n'
      + 'องค์ประกอบยังอยู่ สามารถกด Ctrl/Cmd+Z เพื่อ Undo และคืน layout เดิมได้',
    )) return;
    regenerateBands(this.store);
    // Keep the rebuild and its dirty marker in one undo step.
    this.store.dispatch(tagAction(draft => { draft.template.isDirty = true; }, {
      name: 'markBandLayoutRebuilt', undoable: false,
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
      setDragType(this.store, null); // transient flag, not undoable (#129)
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
      setDragType(this.store, null); // transient flag, not undoable (#129)
    }
    this._dragElId = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-band-view': PldBandView;
  }
}

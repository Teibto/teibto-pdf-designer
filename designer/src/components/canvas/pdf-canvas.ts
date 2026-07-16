/**
 * <pld-canvas>
 * Main design canvas — Phase 2 upgrade.
 * Features: drag/drop, move, resize, context menu, snap guides,
 * multi-select (Shift+click), rubber band selection, grid overlay.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import {
  addElement,
  selectElement,
  toggleMultiSelect,
  moveElement,
  resizeElement,
  resizeTableColumn,
  getGroupMemberIds,
  setZoom,
  zoomIn,
  zoomOut,
  resetZoom,
  nextPage,
  prevPage,
  showContextMenu,
  hideContextMenu,
  snapToGrid,
} from '../../state/actions';
import type { CanvasElement, ElementType } from '../../models/element';
import type { GridConfig } from '../../state/app-state';
import { computeSnap, type SnapGuide } from '../../services/snap-guide.service';
import { throttle } from '../../utils/debounce';

// Import child renderers
import '../elements/canvas-element';
import '../shared/context-menu';

@customElement('pld-canvas')
export class PldCanvas extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private elements: CanvasElement[] = [];
  @state() private selectedId: string | null = null;
  @state() private multiSelect: string[] = [];
  @state() private zoom = 100;
  @state() private pageW = 595;
  @state() private pageH = 842;
  @state() private currentPage = 1;
  @state() private totalPages = 1;
  @state() private grid: GridConfig = {
    enabled: true, size: 10, snapToGrid: false, showRulers: true, showGuides: true,
  };
  @state() private jsonData: Record<string, unknown> | null = null;

  // Snap guide overlay
  @state() private activeGuides: SnapGuide[] = [];

  // Rubber band selection
  @state() private rubberBand: { x: number; y: number; w: number; h: number } | null = null;
  private _rbStartX = 0;
  private _rbStartY = 0;
  private _isRubberBand = false;

  // Drag state
  private _isDragging = false;
  private _dragId: string | null = null;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;

  // Resize state
  private _isResizing = false;
  private _resizeId: string | null = null;
  private _resizeStartX = 0;
  private _resizeStartY = 0;
  private _resizeStartW = 0;
  private _resizeStartH = 0;

  // Table column resize state
  private _isColResizing = false;
  private _colResizeTableId: string | null = null;
  private _colResizeIndex = -1;
  private _colResizeStartX = 0;
  private _colResizeStartWidths: number[] = [];

  @query('.page') private pageEl!: HTMLElement;

  static styles = css`
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--color-bg-deep);
    }

    /* ─── Zoom Bar ─── */
    .zoom-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 14px;
      background: var(--color-bg-panel);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .zoom-btn {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--color-border);
      background: var(--color-bg-card);
      color: var(--color-text-dim);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .zoom-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text);
    }

    .zoom-btn.active-preset {
      color: var(--color-accent);
      border-color: var(--color-accent);
    }

    .zoom-label {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--color-text-dim);
      min-width: 50px;
      text-align: center;
      cursor: pointer;
    }

    .zoom-label:hover { color: var(--color-accent); }

    .page-nav {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .page-label {
      font-size: 11px;
      color: var(--color-text-dim);
      font-family: var(--font-mono);
    }

    /* ─── Scroll Area ─── */
    .scroll-area {
      flex: 1;
      overflow: auto;
      display: flex;
      justify-content: center;
      padding: 30px;
      min-height: 0;
      position: relative;
    }

    /* ─── Page ─── */
    .page {
      position: relative;
      background: #fff;
      box-shadow:
        0 4px 30px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(255, 255, 255, 0.05);
      flex-shrink: 0;
      transform-origin: top center;
    }

    .page.drop-active {
      outline: 2px dashed var(--color-accent);
      outline-offset: 4px;
    }

    /* ─── Grid Overlay ─── */
    .grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
    }

    .grid-overlay.visible {
      background-image:
        linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px);
    }

    /* ─── Snap Guides ─── */
    .snap-guide {
      position: absolute;
      pointer-events: none;
      z-index: 500;
    }

    .snap-guide.vertical {
      width: 1px;
      top: 0;
      bottom: 0;
      background: var(--color-accent, #4f6ef7);
      opacity: 0.6;
    }

    .snap-guide.horizontal {
      height: 1px;
      left: 0;
      right: 0;
      background: var(--color-accent, #4f6ef7);
      opacity: 0.6;
    }

    .snap-label {
      position: absolute;
      font-size: 8px;
      color: var(--color-accent);
      background: rgba(79, 110, 247, 0.15);
      padding: 1px 4px;
      border-radius: 2px;
      white-space: nowrap;
      pointer-events: none;
    }

    /* ─── Rubber Band Selection ─── */
    .rubber-band {
      position: absolute;
      border: 1px solid var(--color-accent);
      background: rgba(79, 110, 247, 0.08);
      pointer-events: none;
      z-index: 600;
    }

    /* ─── Rulers ─── */
    .ruler-h {
      position: absolute;
      top: -20px;
      left: 0;
      width: 100%;
      height: 20px;
      pointer-events: none;
      z-index: 100;
    }

    .ruler-v {
      position: absolute;
      top: 0;
      left: -20px;
      width: 20px;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately (prevents missing data on initial load)
    const init = this.store.state;
    this.elements = init.elements;
    this.selectedId = init.selectedId;
    this.multiSelect = init.multiSelect;
    this.zoom = init.zoom;
    this.pageW = init.page.width;
    this.pageH = init.page.height;
    this.currentPage = init.currentPage;
    this.totalPages = init.totalPages;
    this.grid = { ...init.grid };
    this.jsonData = init.jsonData;

    // Listen for future changes
    this.store.addEventListener('state-changed', (e: Event) => {
      const s = (e as StateChangedEvent).state;
      this.elements = s.elements;
      this.selectedId = s.selectedId;
      this.multiSelect = s.multiSelect;
      this.zoom = s.zoom;
      this.pageW = s.page.width;
      this.pageH = s.page.height;
      this.currentPage = s.currentPage;
      this.totalPages = s.totalPages;
      this.grid = { ...s.grid };
      this.jsonData = s.jsonData;
    });

    // Global mousemove/mouseup for drag, resize, rubber band
    this._boundMove = throttle(this._onMouseMove.bind(this), 16);
    this._boundUp = this._onMouseUp.bind(this);
    window.addEventListener('mousemove', this._boundMove);
    window.addEventListener('mouseup', this._boundUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('mousemove', this._boundMove!);
    window.removeEventListener('mouseup', this._boundUp!);
  }

  private _boundMove: ((e: MouseEvent) => void) | null = null;
  private _boundUp: ((e: MouseEvent) => void) | null = null;

  render() {
    const scale = this.zoom / 100;
    const gridBgSize = `${this.grid.size}px ${this.grid.size}px`;

    return html`
      <!-- Zoom Bar -->
      <div class="zoom-bar">
        <div class="zoom-controls">
          <button class="zoom-btn" @click=${() => zoomOut(this.store)}>−</button>
          <span class="zoom-label" @click=${() => resetZoom(this.store)}>${this.zoom}%</span>
          <button class="zoom-btn" @click=${() => zoomIn(this.store)}>+</button>
        </div>

        <div class="page-nav">
          <button class="zoom-btn" @click=${() => prevPage(this.store)}>‹</button>
          <span class="page-label">${this.currentPage} / ${this.totalPages}</span>
          <button class="zoom-btn" @click=${() => nextPage(this.store)}>›</button>
        </div>

        <div class="zoom-controls">
          ${([50, 75, 100, 125, 150] as number[]).map(
            (z) => html`
              <button
                class="zoom-btn ${this.zoom === z ? 'active-preset' : ''}"
                @click=${() => setZoom(this.store, z)}
              >${z === 100 ? '1x' : `${z}`}</button>
            `,
          )}
        </div>
      </div>

      <!-- Scroll Area -->
      <div
        class="scroll-area"
        @click=${this._onCanvasClick}
        @mousedown=${this._onScrollAreaMouseDown}
        @wheel=${this._onWheel}
        @contextmenu=${this._onContextMenu}
      >
        <!-- Page -->
        <div
          class="page"
          style="width: ${this.pageW}px; height: ${this.pageH}px; transform: scale(${scale});"
          @dragover=${this._onDragOver}
          @dragleave=${this._onDragLeave}
          @drop=${this._onDrop}
        >
          <!-- Grid -->
          <div
            class="grid-overlay ${this.grid.enabled ? 'visible' : ''}"
            style="${this.grid.enabled ? `background-size: ${gridBgSize};` : ''}"
          ></div>

          <!-- Ruler Markers -->
          ${this.grid.showRulers ? html`
            <canvas class="ruler-h" width="${this.pageW}" height="20"></canvas>
            <canvas class="ruler-v" width="20" height="${this.pageH}"></canvas>
          ` : nothing}

          <!-- Snap Guides -->
          ${this.activeGuides.map((g) => g.type === 'vertical'
            ? html`<div class="snap-guide vertical" style="left: ${g.position}px;">
                ${g.label ? html`<span class="snap-label" style="top: 4px; left: 4px;">${g.label}</span>` : nothing}
              </div>`
            : html`<div class="snap-guide horizontal" style="top: ${g.position}px;">
                ${g.label ? html`<span class="snap-label" style="left: 4px; top: -12px;">${g.label}</span>` : nothing}
              </div>`
          )}

          <!-- Elements -->
          ${this.elements.map(
            (el) => html`
              <pld-canvas-element
                .element=${el}
                .selected=${el.id === this.selectedId || this.multiSelect.includes(el.id)}
                .zoom=${this.zoom}
                .jsonData=${this.jsonData}
                @element-mousedown=${(e: CustomEvent) => this._startDrag(e)}
                @element-resize-start=${(e: CustomEvent) => this._startResize(e)}
                @table-col-resize-start=${(e: CustomEvent) => this._startColResize(e)}
              ></pld-canvas-element>
            `,
          )}

          <!-- Rubber Band -->
          ${this.rubberBand ? html`
            <div class="rubber-band" style="
              left: ${this.rubberBand.x}px;
              top: ${this.rubberBand.y}px;
              width: ${this.rubberBand.w}px;
              height: ${this.rubberBand.h}px;
            "></div>
          ` : nothing}
        </div>
      </div>

      <!-- Context Menu -->
      <pld-context-menu></pld-context-menu>
    `;
  }

  // ═══════════════════════════════════════
  // DRAG & DROP FROM PALETTE
  // ═══════════════════════════════════════

  private _onDragOver(e: DragEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add('drop-active');
  }

  private _onDragLeave(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('drop-active');
  }

  private _onDrop(e: DragEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drop-active');

    const type = e.dataTransfer?.getData('element-type') as ElementType;
    if (!type) return;

    const page = e.currentTarget as HTMLElement;
    const rect = page.getBoundingClientRect();
    const scale = this.zoom / 100;
    let x = (e.clientX - rect.left) / scale;
    let y = (e.clientY - rect.top) / scale;

    // Snap to grid if enabled
    if (this.grid.snapToGrid) {
      x = snapToGrid(x, this.grid.size);
      y = snapToGrid(y, this.grid.size);
    }

    addElement(this.store, type, x, y);
    this.store.dispatch((d) => { d.dragType = null; });
  }

  // ═══════════════════════════════════════
  // ELEMENT DRAG (MOVE) WITH SNAP GUIDES
  // ═══════════════════════════════════════

  private _startDrag(e: CustomEvent) {
    const { id, clientX, clientY, elementX, elementY, shiftKey } = e.detail;
    const scale = this.zoom / 100;

    // Shift+click for multi-select
    if (shiftKey) {
      toggleMultiSelect(this.store, id);
      return;
    }

    const page = this.pageEl;
    if (!page) return;
    const rect = page.getBoundingClientRect();

    this._isDragging = true;
    this._dragId = id;
    this._dragOffsetX = (clientX - rect.left) / scale - elementX;
    this._dragOffsetY = (clientY - rect.top) / scale - elementY;

    // Auto-select all group members when clicking a grouped element
    const groupIds = getGroupMemberIds(this.store, id);
    if (groupIds.length > 1) {
      this.store.dispatch((d) => {
        d.selectedId = id;
        d.multiSelect = groupIds;
      });
    } else {
      selectElement(this.store, id);
    }
  }

  // ═══════════════════════════════════════
  // ELEMENT RESIZE
  // ═══════════════════════════════════════

  private _startResize(e: CustomEvent) {
    const { id, clientX, clientY, elementW, elementH } = e.detail;

    this._isResizing = true;
    this._resizeId = id;
    this._resizeStartX = clientX;
    this._resizeStartY = clientY;
    this._resizeStartW = elementW;
    this._resizeStartH = elementH;
  }

  // ═══════════════════════════════════════
  // TABLE COLUMN RESIZE
  // ═══════════════════════════════════════

  private _startColResize(e: CustomEvent) {
    const { tableId, leftColIdx, rightColIdx, clientX, leftWidth, rightWidth } = e.detail;
    const scale = this.zoom / 100;

    this._isColResizing = true;
    this._colResizeTableId = tableId;
    this._colResizeIndex = leftColIdx;
    this._colResizeStartX = clientX / scale;

    // Store original widths and indices
    this._colResizeStartWidths = [leftWidth, rightWidth, rightColIdx];
  }

  // ═══════════════════════════════════════
  // RUBBER BAND SELECTION
  // ═══════════════════════════════════════

  private _onScrollAreaMouseDown(e: MouseEvent) {
    // Only start rubber band if clicking on empty area
    const target = e.target as HTMLElement;
    if (target.closest('pld-canvas-element') || target.closest('.zoom-btn') || target.closest('.zoom-label') || target.closest('.page-nav')) return;
    if (e.button !== 0) return;

    // Get position relative to page
    const page = this.pageEl;
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const scale = this.zoom / 100;

    // Check if click is within page bounds
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) return;

    this._isRubberBand = true;
    this._rbStartX = (e.clientX - rect.left) / scale;
    this._rbStartY = (e.clientY - rect.top) / scale;
  }

  // ═══════════════════════════════════════
  // GLOBAL MOUSE MOVE/UP
  // ═══════════════════════════════════════

  private _onMouseMove(e: MouseEvent) {
    const scale = this.zoom / 100;
    const page = this.pageEl;

    // ─── Element Drag ───
    if (this._isDragging && this._dragId && page) {
      const rect = page.getBoundingClientRect();
      let newX = (e.clientX - rect.left) / scale - this._dragOffsetX;
      let newY = (e.clientY - rect.top) / scale - this._dragOffsetY;

      // Snap to grid
      if (this.grid.snapToGrid) {
        newX = snapToGrid(newX, this.grid.size);
        newY = snapToGrid(newY, this.grid.size);
        this.activeGuides = [];
      }
      // Snap guides (element-to-element alignment)
      else if (this.grid.showGuides) {
        const el = this.elements.find((e) => e.id === this._dragId);
        if (el) {
          const result = computeSnap(
            this._dragId!, newX, newY, el.w, el.h,
            this.elements, this.pageW, this.pageH,
          );
          newX = result.x;
          newY = result.y;
          this.activeGuides = result.guides;
        }
      }

      moveElement(this.store, this._dragId, newX, newY);
    }

    // ─── Element Resize ───
    if (this._isResizing && this._resizeId) {
      const dx = (e.clientX - this._resizeStartX) / scale;
      const dy = (e.clientY - this._resizeStartY) / scale;
      let newW = this._resizeStartW + dx;
      let newH = this._resizeStartH + dy;

      if (this.grid.snapToGrid) {
        newW = snapToGrid(newW, this.grid.size);
        newH = snapToGrid(newH, this.grid.size);
      }

      resizeElement(this.store, this._resizeId, newW, newH);
    }

    // ─── Table Column Resize ───
    if (this._isColResizing && this._colResizeTableId) {
      const dx = (e.clientX / scale) - this._colResizeStartX;
      const leftIdx = this._colResizeIndex;
      const rightIdx = this._colResizeStartWidths[2]; // stored right column index
      const origLeft = this._colResizeStartWidths[0];
      const origRight = this._colResizeStartWidths[1];
      const newLeft = Math.max(20, origLeft + dx);
      const newRight = Math.max(20, origRight - dx);

      resizeTableColumn(this.store, this._colResizeTableId, leftIdx, newLeft);
      resizeTableColumn(this.store, this._colResizeTableId, rightIdx, newRight);
    }

    // ─── Rubber Band ───
    if (this._isRubberBand && page) {
      const rect = page.getBoundingClientRect();
      const curX = (e.clientX - rect.left) / scale;
      const curY = (e.clientY - rect.top) / scale;

      const x = Math.min(this._rbStartX, curX);
      const y = Math.min(this._rbStartY, curY);
      const w = Math.abs(curX - this._rbStartX);
      const h = Math.abs(curY - this._rbStartY);

      this.rubberBand = { x, y, w, h };
    }
  }

  private _onMouseUp(_e: MouseEvent) {
    // ─── Finish Drag ───
    if (this._isDragging) {
      this.activeGuides = [];
    }
    this._isDragging = false;
    this._dragId = null;

    // ─── Finish Resize ───
    this._isResizing = false;
    this._resizeId = null;

    // ─── Finish Column Resize ───
    this._isColResizing = false;
    this._colResizeTableId = null;

    // ─── Finish Rubber Band → select elements inside ───
    if (this._isRubberBand && this.rubberBand) {
      const rb = this.rubberBand;
      if (rb.w > 5 && rb.h > 5) {
        // Find elements intersecting rubber band
        const ids = this.elements
          .filter((el) => {
            return !(el.x + el.w < rb.x || el.x > rb.x + rb.w ||
                     el.y + el.h < rb.y || el.y > rb.y + rb.h);
          })
          .map((el) => el.id);

        if (ids.length > 0) {
          this.store.dispatch((draft) => {
            draft.multiSelect = ids;
            draft.selectedId = ids[ids.length - 1];
          });
        }
      }
      this.rubberBand = null;
    }
    this._isRubberBand = false;
  }

  // ═══════════════════════════════════════
  // CANVAS CLICK (DESELECT)
  // ═══════════════════════════════════════

  private _onCanvasClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('pld-canvas-element')) return;
    if (target.closest('pld-context-menu')) return;

    selectElement(this.store, null);
    this.store.dispatch((d) => { d.multiSelect = []; });
    hideContextMenu(this.store);
  }

  // ═══════════════════════════════════════
  // CONTEXT MENU (RIGHT CLICK)
  // ═══════════════════════════════════════

  private _onContextMenu(e: MouseEvent) {
    e.preventDefault();

    const target = e.target as HTMLElement;
    const canvasEl = target.closest('pld-canvas-element') as any;
    const elementId = canvasEl?.element?.id ?? null;

    if (elementId) {
      selectElement(this.store, elementId);
    }

    showContextMenu(this.store, e.clientX, e.clientY, elementId);
  }

  // ═══════════════════════════════════════
  // ZOOM WITH MOUSE WHEEL
  // ═══════════════════════════════════════

  private _onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      setZoom(this.store, this.zoom + delta);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-canvas': PldCanvas;
  }
}

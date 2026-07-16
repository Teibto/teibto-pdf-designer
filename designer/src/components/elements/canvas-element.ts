/**
 * <pld-canvas-element>
 * Renders a single element on the design canvas.
 * Shows selection border, resize handle, role badge, and binding tag.
 * Enhanced for better UX visibility: binding chips, element outlines,
 * improved image placeholders, and readable sample data.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type {
  CanvasElement,
  TextElement,
  ImageElement,
  TableElement,
  TableColumn,
  ShapeElement,
  LineElement,
  BarcodeElement,
  ListElement,
} from '../../models/element';
import { ELEMENT_ROLES } from '../../constants/roles';
import { resolveTemplateString, resolveBinding } from '../../services/binding.service';
import { getCachedBarcodeSvg } from '../../services/barcode.service';

@customElement('pld-canvas-element')
export class PldCanvasElement extends LitElement {
  @property({ type: Object }) element!: CanvasElement;
  @property({ type: Boolean }) selected = false;
  @property({ type: Number }) zoom = 100;
  @property({ type: Object }) jsonData: Record<string, unknown> | null = null;

  static styles = css`
    :host {
      position: absolute;
      cursor: move;
      user-select: none;
    }

    .wrapper {
      width: 100%;
      height: 100%;
      position: relative;
      border: 1.5px solid transparent;
      transition: border-color 0.15s;
    }

    /* Subtle dashed outline when idle — helps identify element boundaries */
    .wrapper.outline-idle {
      border: 1px dashed rgba(0, 0, 0, 0.08);
    }

    .wrapper:hover {
      border-color: rgba(79, 110, 247, 0.4);
      border-style: solid;
    }

    .wrapper.selected {
      border-color: var(--color-accent);
      border-style: solid;
      box-shadow: 0 0 0 1px var(--color-accent);
    }

    /* ─── Resize Handle ─── */
    .resize-handle {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 8px;
      height: 8px;
      background: var(--color-accent);
      border-radius: 2px;
      cursor: se-resize;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 10;
    }

    .wrapper.selected .resize-handle,
    .wrapper:hover .resize-handle {
      opacity: 1;
    }

    /* ─── Role Badge ─── */
    .role-badge {
      position: absolute;
      top: -10px;
      left: 4px;
      font-size: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 1px 5px;
      border-radius: 3px;
      color: #fff;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: none;
      white-space: nowrap;
    }

    .wrapper.selected .role-badge,
    .wrapper:hover .role-badge {
      opacity: 0.85;
    }

    /* ─── Binding Tag ─── */
    .binding-tag {
      position: absolute;
      bottom: -12px;
      right: 4px;
      font-size: 8px;
      font-family: var(--font-mono);
      color: var(--color-accent);
      background: rgba(79, 110, 247, 0.1);
      padding: 1px 4px;
      border-radius: 2px;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: none;
      white-space: nowrap;
    }

    .wrapper.selected .binding-tag,
    .wrapper:hover .binding-tag {
      opacity: 0.8;
    }

    /* ─── Element Content ─── */
    .content {
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
    }

    /* ─── Text Elements ─── */
    .el-text {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow: hidden;
      padding: 2px 4px;
      line-height: 1.4;
    }

    /* Binding chip inside text — visual tag for {{path}} */
    .bind-chip {
      display: inline;
      background: rgba(79, 110, 247, 0.12);
      color: #4f6ef7;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.85em;
      font-family: var(--font-mono, monospace);
      border: 1px solid rgba(79, 110, 247, 0.2);
      white-space: nowrap;
    }

    /* ─── Image ─── */
    .el-image {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.03);
      border: 1px dashed rgba(0, 0, 0, 0.15);
      color: rgba(0, 0, 0, 0.35);
      font-size: 20px;
    }

    .el-image img {
      max-width: 100%;
      max-height: 100%;
    }

    .el-image-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .el-image-placeholder .img-icon {
      font-size: 24px;
      opacity: 0.5;
    }

    .el-image-placeholder .img-label {
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: rgba(0, 0, 0, 0.3);
    }

    /* ─── Table ─── */
    .el-table {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .table-header {
      display: flex;
      font-size: 9px;
      font-weight: 600;
      padding: 4px 0;
    }

    .table-header-cell {
      flex: 1;
      padding: 2px 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .table-row {
      display: flex;
      font-size: 9px;
      padding: 3px 0;
      color: #333;
    }

    .table-cell {
      flex: 1;
      padding: 2px 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .table-cell.cell-clip {
      text-overflow: clip;
    }

    /* ─── Table Column Resize Handles ─── */
    .col-resize-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 28px; /* header height area */
      pointer-events: none;
    }

    .col-resize-handle {
      position: absolute;
      top: 0;
      width: 6px;
      height: 100%;
      cursor: col-resize;
      pointer-events: auto;
      z-index: 5;
      transform: translateX(-3px);
    }

    .col-resize-handle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 2px;
      height: calc(100% - 4px);
      background: rgba(79, 110, 247, 0.5);
      border-radius: 1px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .col-resize-handle:hover::after {
      opacity: 1;
    }

    /* ─── Shape ─── */
    .el-shape {
      width: 100%;
      height: 100%;
    }

    /* ─── Line ─── */
    .el-line {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
    }

    .el-line hr {
      width: 100%;
      border: none;
      margin: 0;
    }

    /* ─── Barcode ─── */
    .el-barcode {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #fff;
      gap: 2px;
    }

    .barcode-bars {
      display: flex;
      gap: 1px;
      height: 60%;
      align-items: flex-end;
    }

    .barcode-bar {
      width: 2px;
      background: #000;
    }

    .barcode-text {
      font-family: var(--font-mono);
      font-size: 8px;
      color: #000;
    }

    /* ─── List ─── */
    .el-list {
      padding: 4px 8px;
    }

    .el-list-item {
      display: flex;
      gap: 4px;
      font-size: 10px;
      line-height: 1.6;
    }
  `;

  render() {
    const el = this.element;
    if (!el) return nothing;

    const role = ELEMENT_ROLES[el.role];

    // Show subtle outline for text/image/table elements (not shapes/lines)
    // Helps users see element boundaries on white canvas
    const showOutline = !this.selected && (el.type === 'text' || el.type === 'header' || el.type === 'image' || el.type === 'table' || el.type === 'list' || el.type === 'barcode');

    return html`
      <style>
        :host {
          left: ${el.x}px;
          top: ${el.y}px;
          width: ${el.w}px;
          height: ${el.h}px;
          z-index: ${el.zIndex};
        }
      </style>
      <div
        class="wrapper ${this.selected ? 'selected' : ''} ${showOutline ? 'outline-idle' : ''}"
        @mousedown=${this._onMouseDown}
      >
        <!-- Role Badge -->
        <span class="role-badge" style="background: ${role.color}">
          ${role.label}
        </span>

        <!-- Content -->
        <div class="content">
          ${this._renderContent(el)}
        </div>

        <!-- Table Column Resize Handles (only when selected) -->
        ${this.selected && el.type === 'table' && (el as TableElement).columns.length > 1
          ? this._renderColResizeHandles(el as TableElement)
          : nothing}

        <!-- Binding Tag -->
        ${el.binding
          ? html`<span class="binding-tag">{{${el.binding}}}</span>`
          : nothing}

        <!-- Resize Handle -->
        <div
          class="resize-handle"
          @mousedown=${this._onResizeStart}
        ></div>
      </div>
    `;
  }

  private _renderContent(el: CanvasElement) {
    switch (el.type) {
      case 'text':
      case 'header':
        return this._renderText(el as TextElement);
      case 'image':
        return this._renderImage(el as ImageElement);
      case 'table':
        return this._renderTable(el as TableElement);
      case 'shape':
        return this._renderShape(el as ShapeElement);
      case 'line':
        return this._renderLine(el as LineElement);
      case 'barcode':
        return this._renderBarcode(el as BarcodeElement);
      case 'list':
        return this._renderList(el as ListElement);
      default:
        return html`<div>Unknown</div>`;
    }
  }

  // ═══════════════════════════════════════
  // TEXT — Render with binding chips
  // ═══════════════════════════════════════

  private _renderText(el: TextElement) {
    // If JSON data is available, resolve bindings to show real values
    const hasBindings = /\{\{.+?\}\}/.test(el.content);
    const resolved = hasBindings && this.jsonData
      ? resolveTemplateString(el.content, this.jsonData)
      : null;

    return html`
      <div
        class="el-text"
        style="
          font-size: ${el.fontSize}px;
          font-weight: ${el.fontWeight};
          color: ${el.color};
          text-align: ${el.textAlign};
          font-family: ${el.fontFamily || 'inherit'};
        "
      >
        ${resolved != null ? resolved : this._renderTextContent(el.content, el.color)}
      </div>
    `;
  }

  /**
   * Parse text content and replace {{binding}} with styled chips.
   * Static text renders normally, bindings become colored inline tags.
   */
  private _renderTextContent(content: string, textColor: string) {
    // Split by {{...}} and interleave text + chips
    const parts: Array<{ type: 'text' | 'binding'; value: string }> = [];
    const regex = /\{\{(.+?)\}\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'binding', value: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', value: content.slice(lastIndex) });
    }

    // If no bindings, render as plain text (fast path)
    if (parts.length === 0 || (parts.length === 1 && parts[0].type === 'text')) {
      return content;
    }

    // Determine chip color based on text brightness
    const isLight = this._isLightColor(textColor);
    const chipBg = isLight ? 'rgba(79, 110, 247, 0.25)' : 'rgba(79, 110, 247, 0.12)';
    const chipColor = isLight ? '#8ab4ff' : '#4f6ef7';
    const chipBorder = isLight ? 'rgba(79, 110, 247, 0.35)' : 'rgba(79, 110, 247, 0.2)';

    return parts.map((p) => {
      if (p.type === 'text') {
        // Preserve newlines
        return p.value;
      }
      return html`<span class="bind-chip" style="background:${chipBg}; color:${chipColor}; border-color:${chipBorder};">${p.value}</span>`;
    });
  }

  /** Check if a hex color is light (for contrast calculation) */
  private _isLightColor(color: string): boolean {
    if (!color || !color.startsWith('#')) return false;
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 160;
  }

  // ═══════════════════════════════════════
  // IMAGE — Better placeholder
  // ═══════════════════════════════════════

  private _renderImage(el: ImageElement) {
    if (el.imageData || el.src) {
      return html`
        <div class="el-image" style="border: none; background: transparent;">
          <img src=${el.imageData || el.src || ''} style="object-fit: ${el.objectFit}" />
        </div>
      `;
    }

    // Friendly placeholder with icon & label
    const label = el.name?.toLowerCase().includes('logo')
      ? 'Logo'
      : el.binding
        ? el.binding.split('.').pop() || 'Image'
        : 'Image';

    return html`
      <div class="el-image">
        <div class="el-image-placeholder">
          <span class="img-icon">🖼</span>
          <span class="img-label">${label}</span>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // TABLE — Visible borders & sample data
  // ═══════════════════════════════════════

  private _renderTable(el: TableElement) {
    const defaultCols: TableColumn[] = [
      { key: 'col1', label: 'Column 1', width: 100, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      { key: 'col2', label: 'Column 2', width: 100, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      { key: 'col3', label: 'Column 3', width: 100, align: 'right', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
    ];
    const cols: TableColumn[] = el.columns.length > 0 ? el.columns : defaultCols;

    // Try to resolve real data from JSON binding
    const boundData = el.binding ? resolveBinding(this.jsonData, el.binding) : undefined;
    const realRows = Array.isArray(boundData) ? boundData as Record<string, unknown>[] : null;

    // Use real data if available, otherwise generate sample data
    const displayRows: Record<string, string>[] = realRows
      ? realRows.slice(0, 5).map((item, i) => {
          const row: Record<string, string> = {};
          for (const c of cols) {
            if (c.isIndex) { row[c.key] = String(i + 1); }
            else {
              const val = item[c.key];
              if (val !== undefined && val !== null) {
                if (c.format === 'currency' && typeof val === 'number') {
                  row[c.key] = val.toLocaleString();
                } else {
                  row[c.key] = String(val);
                }
              } else {
                row[c.key] = '';
              }
            }
          }
          return row;
        })
      : [1, 2, 3].map((i) => {
          const row: Record<string, string> = {};
          for (const c of cols) {
            if (c.isIndex) { row[c.key] = String(i); }
            else if (c.format === 'number') { row[c.key] = String(i * 100); }
            else if (c.format === 'currency') { row[c.key] = (i * 1000).toLocaleString(); }
            else if (c.format === 'percent') { row[c.key] = `${i * 10}%`; }
            else { row[c.key] = `${c.label} ${i}`; }
          }
          return row;
        });

    // Show row count hint if real data has more rows
    const totalRows = realRows ? realRows.length : 0;
    const hasMore = realRows && totalRows > 5;

    return html`
      <div class="el-table">
        <div class="table-header" style="background: ${el.headerBgColor}; color: ${el.headerTextColor};">
          ${cols.map((c) => html`<span class="table-header-cell" style="text-align: ${c.align}">${c.label}</span>`)}
        </div>
        ${displayRows.map(
          (row, i) => html`
            <div class="table-row" style="border-top: 1px solid ${el.borderColor}; ${i % 2 !== 0 ? `background: ${el.alternateRowColor}` : ''}">
              ${cols.map((c) => {
                const ov = c.overflow ?? 'ellipsis';
                const cellCss = [
                  `text-align: ${c.align}`,
                  c.bold ? 'font-weight:600' : '',
                  ov === 'wrap' ? `white-space:normal; word-break:break-word;${c.maxLines > 0 ? ` display:-webkit-box; -webkit-line-clamp:${c.maxLines}; -webkit-box-orient:vertical; overflow:hidden;` : ''}` : '',
                  // ellipsis + clip use default .table-cell CSS (nowrap + ellipsis)
                ].filter(Boolean).join('; ');
                return html`<span class="table-cell ${ov === 'clip' ? 'cell-clip' : ''}" style="${cellCss}">${row[c.key]}</span>`;
              })}
            </div>
          `,
        )}
        ${hasMore ? html`
          <div class="table-row" style="border-top: 1px solid ${el.borderColor}; justify-content: center; color: #999; font-size: 8px; font-style: italic;">
            ... +${totalRows - 5} more rows
          </div>
        ` : nothing}
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // SHAPE
  // ═══════════════════════════════════════

  private _renderShape(el: ShapeElement) {
    return html`
      <div
        class="el-shape"
        style="
          background: ${el.bgColor};
          border-radius: ${el.borderRadius}px;
          opacity: ${el.opacity};
        "
      ></div>
    `;
  }

  // ═══════════════════════════════════════
  // LINE — Ensure minimum visible width
  // ═══════════════════════════════════════

  private _renderLine(el: LineElement) {
    // Ensure minimum 1px visual thickness for design canvas
    const visibleWidth = Math.max(el.lineWidth, 1);
    const styles = {
      solid: `${visibleWidth}px solid ${el.lineColor}`,
      dashed: `${visibleWidth}px dashed ${el.lineColor}`,
      dotted: `${visibleWidth}px dotted ${el.lineColor}`,
    };

    return html`
      <div class="el-line">
        <hr style="border-top: ${styles[el.lineStyle]}" />
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // BARCODE
  // ═══════════════════════════════════════

  private _renderBarcode(el: BarcodeElement) {
    // Use cached SVG for synchronous Lit rendering; request re-render if not cached
    const svg = getCachedBarcodeSvg(el.value, el.barcodeType, () => this.requestUpdate());

    if (svg) {
      // Render real barcode SVG
      const wrapper = document.createElement('div');
      wrapper.className = 'el-barcode';
      wrapper.innerHTML = svg;
      // Scale SVG to fit element
      const svgEl = wrapper.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width', '100%');
        svgEl.setAttribute('height', '100%');
        svgEl.style.display = 'block';
      }
      return html`${wrapper}`;
    }

    // Loading fallback
    return html`
      <div class="el-barcode" style="display:flex;align-items:center;justify-content:center;flex-direction:column;height:100%;">
        <span style="font-size:10px;color:#888;">Loading barcode...</span>
        <span class="barcode-text">${el.value}</span>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════

  private _renderList(el: ListElement) {
    const prefix = el.listStyle === 'bullet' ? '•' : el.listStyle === 'dash' ? '–' : '';

    return html`
      <div class="el-list" style="font-size: ${el.fontSize}px; color: ${el.color};">
        ${el.items.map(
          (item, i) => html`
            <div class="el-list-item">
              <span>${el.listStyle === 'number' ? `${i + 1}.` : prefix}</span>
              <span>${item}</span>
            </div>
          `,
        )}
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // TABLE COLUMN RESIZE HANDLES
  // ═══════════════════════════════════════

  private _renderColResizeHandles(el: TableElement) {
    const cols = el.columns.filter((c) => !c.hidden);
    if (cols.length < 2) return nothing;

    // Map visible column indices to full array indices
    const visibleIndices = el.columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.hidden)
      .map(({ i }) => i);

    const totalW = cols.reduce((sum, c) => sum + (c.width || 0), 0);
    let accX = 0;

    return html`
      <div class="col-resize-overlay">
        ${cols.slice(0, -1).map((c, vi) => {
          accX += totalW > 0 ? (c.width / totalW) * el.w : el.w / cols.length;
          const xPos = accX;
          return html`
            <div
              class="col-resize-handle"
              style="left: ${xPos}px;"
              @mousedown=${(e: MouseEvent) => this._onColResizeStart(e, visibleIndices[vi], visibleIndices[vi + 1])}
            ></div>
          `;
        })}
      </div>
    `;
  }

  private _onColResizeStart(e: MouseEvent, leftColIdx: number, rightColIdx: number) {
    e.stopPropagation();
    e.preventDefault();

    this.dispatchEvent(
      new CustomEvent('table-col-resize-start', {
        detail: {
          tableId: this.element.id,
          leftColIdx,
          rightColIdx,
          clientX: e.clientX,
          leftWidth: (this.element as TableElement).columns[leftColIdx]?.width || 50,
          rightWidth: (this.element as TableElement).columns[rightColIdx]?.width || 50,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ═══════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════

  private _onMouseDown(e: MouseEvent) {
    e.stopPropagation();

    this.dispatchEvent(
      new CustomEvent('element-mousedown', {
        detail: {
          id: this.element.id,
          clientX: e.clientX,
          clientY: e.clientY,
          elementX: this.element.x,
          elementY: this.element.y,
          shiftKey: e.shiftKey,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onResizeStart(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    this.dispatchEvent(
      new CustomEvent('element-resize-start', {
        detail: {
          id: this.element.id,
          clientX: e.clientX,
          clientY: e.clientY,
          elementW: this.element.w,
          elementH: this.element.h,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-canvas-element': PldCanvasElement;
  }
}

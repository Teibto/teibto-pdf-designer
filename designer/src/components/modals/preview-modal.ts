/**
 * <pld-preview-modal>
 * PDF preview with rendered page visualization, page navigation,
 * and one-click PDF export.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import type { AppState } from '../../state/app-state';
import type { CanvasElement, TextElement, TableElement, ShapeElement, LineElement, ListElement, BarcodeElement, ImageElement } from '../../models/element';
import { ELEMENT_ROLES } from '../../constants/roles';
import { resolveTemplateString, resolveBinding } from '../../services/binding.service';
import { computePagination, finalizePagination } from '../../services/pagination.service';
import { formatCellValue } from '../../utils/format';
import { getCachedBarcodeSvg } from '../../services/barcode.service';
import { exportBfoXml, type BfoExportOptions } from '../../services/bfo-export.service';
import { isNetSuiteEnv, getNsContext, renderLivePreview, openRenderedPdf } from '../../services/netsuite-adapter.service';
import '../shared/modal';

@customElement('pld-preview-modal')
export class PldPreviewModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;

  @state() private previewPage = 1;
  @state() private totalPages = 1;
  @state() private zoom = 90;

  // Server-side preview (#12) — real N/render PDF, only inside NetSuite + record
  @state() private serverPdfUrl: string | null = null;
  @state() private serverLoading = false;
  @state() private serverError = '';

  static styles = css`
    .preview-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 8px;
    }

    .preview-nav {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .nav-btn {
      width: 30px;
      height: 30px;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 6px;
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text-dim, #8a8ca0);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .nav-btn:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
    }

    .nav-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .page-info {
      font-size: 12px;
      font-family: var(--font-mono, monospace);
      color: var(--color-text-dim, #8a8ca0);
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .zoom-label {
      font-size: 11px;
      font-family: var(--font-mono, monospace);
      color: var(--color-text-dim, #8a8ca0);
      min-width: 40px;
      text-align: center;
    }

    .export-btn {
      padding: 8px 20px;
      background: linear-gradient(135deg, #22d3a7, #4f6ef7);
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }

    .export-btn:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }

    .export-btn:disabled {
      opacity: 0.5;
      cursor: default;
      transform: none;
    }

    /* ─── Server-side preview (#12) ─── */
    .server-frame {
      width: 100%;
      height: 68vh;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 8px;
      background: #fff;
    }

    .server-status {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      height: 68vh;
      color: var(--color-text-dim, #8a8ca0);
      font-size: 13px;
    }

    .server-status .spinner {
      width: 34px;
      height: 34px;
      border: 3px solid var(--color-border, #2a2c3a);
      border-top-color: #4f6ef7;
      border-radius: 50%;
      animation: pld-spin 0.8s linear infinite;
    }

    @keyframes pld-spin {
      to { transform: rotate(360deg); }
    }

    .server-status.error {
      color: #f87171;
      text-align: center;
      padding: 0 24px;
    }

    .server-hint {
      font-size: 11px;
      color: var(--color-text-dim, #8a8ca0);
    }

    /* ─── Page Preview ─── */
    .preview-scroll {
      display: flex;
      justify-content: center;
      overflow: auto;
      max-height: 60vh;
      padding: 10px;
      background: var(--color-bg-deep, #0a0b10);
      border-radius: 8px;
    }

    .page-preview {
      position: relative;
      background: #fff;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
      flex-shrink: 0;
      transform-origin: top center;
      overflow: hidden;
    }

    /* ─── Element renders (simplified for preview) ─── */
    .el-preview {
      position: absolute;
      overflow: hidden;
    }

    .el-text {
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 1px 2px;
    }

    .el-shape {
      width: 100%;
      height: 100%;
    }

    .el-line hr {
      border: none;
      margin: 0;
      width: 100%;
    }

    .el-table {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .el-table table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8px;
    }

    .el-table th {
      padding: 3px 4px;
      font-weight: 600;
      text-align: left;
    }

    .el-table td {
      padding: 2px 4px;
    }

    .el-barcode {
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono, monospace);
      font-size: 8px;
      color: #333;
    }

    .el-list {
      padding: 2px 6px;
    }

    .el-list div {
      line-height: 1.5;
    }

    /* ─── Page break indicators ─── */
    .break-indicator {
      position: absolute;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 9999;
      pointer-events: none;
    }

    .break-indicator .break-line {
      flex: 1;
      border-top: 1.5px dashed var(--break-color, #e74c8b);
    }

    .break-indicator .break-label {
      font-size: 7px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #fff;
      background: var(--break-color, #e74c8b);
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
    }

    .break-indicator.force-break {
      --break-color: #f59e42;
    }

    .break-indicator.page-end {
      --break-color: #4f6ef7;
    }

    .continuation-badge {
      position: absolute;
      right: 8px;
      font-size: 7px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--color-text-dim, #8a8ca0);
      background: rgba(79, 110, 247, 0.12);
      border: 1px solid rgba(79, 110, 247, 0.25);
      padding: 1px 6px;
      border-radius: 3px;
      z-index: 9999;
      pointer-events: none;
    }
  `;

  /** Server-side preview is only meaningful inside NetSuite with a record loaded. */
  private get _serverMode(): boolean {
    return isNetSuiteEnv() && !!getNsContext()?.recordId;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        this.previewPage = 1;
        this.totalPages = this.store.state.totalPages || 1;
        if (this._serverMode) this._loadServerPreview();
      } else {
        this._clearServerPreview();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._clearServerPreview();
  }

  /**
   * Render the current (unsaved) design server-side via N/render and show the
   * real PDF — same engine + record as Print, so preview == print (#12).
   */
  private async _loadServerPreview() {
    const ctx = getNsContext();
    if (!ctx?.recordId || !ctx?.recordType) return;

    this._clearServerPreview();
    this.serverLoading = true;
    this.serverError = '';
    try {
      const options: BfoExportOptions = { useBands: true }; // band layout is authoritative (#47 cutover)
      if (ctx.fontRegularUrl) {
        options.thaiFontUrls = { regular: ctx.fontRegularUrl, bold: ctx.fontBoldUrl || undefined };
      }
      const xml = exportBfoXml(this.store.state, options);
      const blob = await renderLivePreview({ xml, rectype: ctx.recordType, recid: ctx.recordId });
      this.serverPdfUrl = URL.createObjectURL(blob);
    } catch (err) {
      this.serverError = err instanceof Error ? err.message : String(err);
    } finally {
      this.serverLoading = false;
    }
  }

  private _clearServerPreview() {
    if (this.serverPdfUrl) {
      URL.revokeObjectURL(this.serverPdfUrl);
      this.serverPdfUrl = null;
    }
  }

  /** Open/download the print PDF from the same render Suitelet. */
  private _printServer() {
    const ctx = getNsContext();
    if (ctx?.recordType && ctx?.recordId) {
      openRenderedPdf(ctx.recordType, ctx.recordId, undefined, true);
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="▶ PDF Preview"
        size="xl"
        @close=${this._close}
      >
        <div slot="body">
          ${this._serverMode ? this._renderServerBody() : this._renderSimBody()}
        </div>
      </pld-modal>
    `;
  }

  /** Server-side preview body: real N/render PDF in an iframe (#12). */
  private _renderServerBody() {
    return html`
      <div class="preview-toolbar">
        <span class="server-hint">Rendered by NetSuite N/render — identical to Print PDF</span>
        <button class="export-btn" @click=${this._printServer}>📄 Open / Download PDF</button>
      </div>

      ${this.serverLoading
        ? html`<div class="server-status"><div class="spinner"></div><span>Rendering PDF…</span></div>`
        : this.serverError
          ? html`<div class="server-status error">
              <span>Render failed: ${this.serverError}</span>
              <button class="nav-btn" style="width:auto;padding:0 12px;" @click=${this._loadServerPreview}>↻ Retry</button>
            </div>`
          : this.serverPdfUrl
            ? html`<iframe class="server-frame" src=${this.serverPdfUrl} title="PDF Preview"></iframe>`
            : nothing}
    `;
  }

  /** Client-side simulation body (dev / no record) — unchanged legacy preview. */
  private _renderSimBody() {
    const state = this.store.state;
    const scale = this.zoom / 100;

    return html`
      <!-- Toolbar -->
      <div class="preview-toolbar">
        <div class="preview-nav">
          <button class="nav-btn" ?disabled=${this.previewPage <= 1}
            @click=${() => this.previewPage--}>‹</button>
          <span class="page-info">${this.previewPage} / ${this.totalPages}</span>
          <button class="nav-btn" ?disabled=${this.previewPage >= this.totalPages}
            @click=${() => this.previewPage++}>›</button>
        </div>

        <div class="zoom-controls">
          <button class="nav-btn" @click=${() => this.zoom = Math.max(30, this.zoom - 10)}>−</button>
          <span class="zoom-label">${this.zoom}%</span>
          <button class="nav-btn" @click=${() => this.zoom = Math.min(200, this.zoom + 10)}>+</button>
        </div>
      </div>

      <!-- Preview Page -->
      <div class="preview-scroll">
        <div
          class="page-preview"
          style="width: ${state.page.width}px; height: ${state.page.height}px; transform: scale(${scale});"
        >
          ${this._renderPageElements(state, this.previewPage)}
        </div>
      </div>
    `;
  }

  private _renderPageElements(state: Readonly<AppState>, pageNum: number) {
    const elements = state.elements;
    const totalPages = this.totalPages;

    // Get pagination data for dynamicY support
    const paginationResult = finalizePagination(computePagination(state), state);
    const pageData = paginationResult.pagesData.find((p) => p.pageNumber === pageNum);

    // Build dynamicY map from pagination engine
    const dynamicYMap = new Map<string, number>();
    if (pageData) {
      for (const pe of pageData.elements) {
        if (pe.dynamicY !== undefined) {
          dynamicYMap.set(pe.element.id, pe.dynamicY);
        }
      }
    }

    // Filter elements visible on this page
    // Use pagination engine's visibility (respects headerMode, role overrides)
    let visible: CanvasElement[];
    if (pageData) {
      visible = pageData.elements
        .filter((pe) => pe.visible)
        .map((pe) => pe.element);
    } else {
      visible = elements.filter((el: CanvasElement) => {
        const role = ELEMENT_ROLES[el.role];
        switch (role.showOnPages) {
          case 'all': return true;
          case 'first': return pageNum === 1;
          case 'last': return pageNum === totalPages;
          default: return true;
        }
      });
    }

    const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex);

    // Build break indicators
    const indicators = this._buildBreakIndicators(state, pageNum, pageData);

    return html`
      ${indicators}
      ${sorted.map((el) => {
      const opacity = el.role === 'watermark' ? 0.15 : 1;
      // Apply dynamicY for summary/footer elements
      const effectiveY = dynamicYMap.get(el.id) ?? el.y;
      return html`
        <div class="el-preview" style="
          left: ${el.x}px; top: ${effectiveY}px;
          width: ${el.w}px; height: ${el.h}px;
          opacity: ${opacity};
          z-index: ${el.zIndex};
        ">
          ${this._renderElement(el, state.jsonData, pageNum)}
        </div>
      `;
    })}`;
  }

  /**
   * [UI-5] Build visual break indicators for the preview page.
   * Shows force break markers, continuation badges, and page-end lines.
   */
  private _buildBreakIndicators(
    state: Readonly<AppState>,
    pageNum: number,
    pageData?: import('../../services/pagination.service').PageData,
  ) {
    if (!pageData) return nothing;

    const tableEl = state.elements.find((el) => el.type === 'table' && el.role === 'table');
    if (!tableEl) return nothing;

    const forceBreaks = new Set(state.pagination.forceBreakBeforeRows ?? []);
    const indicators: ReturnType<typeof html>[] = [];

    // Continuation badge (top-right of table area)
    if (pageData.isContinuation) {
      indicators.push(html`
        <div class="continuation-badge" style="top: ${tableEl.y - 2}px;">
          ↑ cont'd from page ${pageNum - 1}
        </div>
      `);
    }

    // Force break indicator at top of page (if this page starts at a force break)
    if (forceBreaks.has(pageData.tableRowStart) && pageData.tableRowStart > 0) {
      indicators.push(html`
        <div class="break-indicator force-break" style="top: ${tableEl.y - 6}px;">
          <span class="break-line"></span>
          <span class="break-label">✂ force break before row ${pageData.tableRowStart + 1}</span>
          <span class="break-line"></span>
        </div>
      `);
    }

    // Page-end indicator (dashed line at tableEndY when more pages follow)
    if (pageNum < this.totalPages && !pageData.isSummaryPage && pageData.tableRowEnd > pageData.tableRowStart) {
      indicators.push(html`
        <div class="break-indicator page-end" style="top: ${pageData.tableEndY + 2}px;">
          <span class="break-line"></span>
          <span class="break-label">page ${pageNum} ends — row ${pageData.tableRowEnd} ↓</span>
          <span class="break-line"></span>
        </div>
      `);
    }

    return indicators;
  }

  private _renderElement(el: CanvasElement, jsonData: Record<string, unknown> | null, pageNum: number) {
    // Conditional visibility (#90) — mirror the export-side FreeMarker guard
    if (el.visibleIf && jsonData) {
      const v = resolveBinding(jsonData, el.visibleIf);
      if (v === undefined || v === null || String(v) === '') return nothing;
    }
    switch (el.type) {
      case 'text':
      case 'header': {
        const te = el as TextElement;
        const text = resolveTemplateString(te.content, jsonData);
        return html`<div class="el-text" style="
          font-size: ${te.fontSize}px; font-weight: ${te.fontWeight};
          color: ${te.color}; text-align: ${te.textAlign};
        ">${text}</div>`;
      }
      case 'shape': {
        const se = el as ShapeElement;
        return html`<div class="el-shape" style="
          background: ${se.bgColor}; border-radius: ${se.borderRadius}px; opacity: ${se.opacity};
        "></div>`;
      }
      case 'line': {
        const le = el as LineElement;
        return html`<div class="el-line" style="display:flex;align-items:center;height:100%;">
          <hr style="border-top: ${le.lineWidth}px ${le.lineStyle} ${le.lineColor}" />
        </div>`;
      }
      case 'table': {
        const te = el as TableElement;
        return this._renderTablePreview(te, jsonData, pageNum);
      }
      case 'barcode': {
        const be = el as BarcodeElement;
        const svg = getCachedBarcodeSvg(be.value, be.barcodeType, () => this.requestUpdate());
        if (svg) {
          const wrapper = document.createElement('div');
          wrapper.className = 'el-barcode';
          wrapper.style.width = '100%';
          wrapper.style.height = '100%';
          wrapper.innerHTML = svg;
          const svgEl = wrapper.querySelector('svg');
          if (svgEl) {
            svgEl.setAttribute('width', '100%');
            svgEl.setAttribute('height', '100%');
          }
          return html`${wrapper}`;
        }
        return html`<div class="el-barcode">Loading...</div>`;
      }
      case 'image': {
        const ie = el as ImageElement;
        const src = ie.imageData || ie.src;
        if (src) {
          return html`<img src="${src}" style="width:100%;height:100%;object-fit:${ie.objectFit};" />`;
        }
        return html`<div style="width:100%;height:100%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">Image</div>`;
      }
      case 'list': {
        const le = el as ListElement;
        const prefix = le.listStyle === 'bullet' ? '•' : le.listStyle === 'dash' ? '–' : '';
        return html`<div class="el-list" style="font-size: ${le.fontSize}px; color: ${le.color};">
          ${le.items.map((item, i) => html`<div>${le.listStyle === 'number' ? `${i + 1}.` : prefix} ${item}</div>`)}
        </div>`;
      }
      default:
        return nothing;
    }
  }

  private _renderTablePreview(el: TableElement, jsonData: Record<string, unknown> | null, pageNum: number) {
    const cols = el.columns.filter((c) => !c.hidden);
    if (cols.length === 0) return html`<div style="color: #999; font-size: 10px; padding: 8px;">No columns configured</div>`;

    let rows: Record<string, unknown>[] = [];
    if (jsonData && el.binding) {
      const data = resolveBinding(jsonData, el.binding);
      if (Array.isArray(data)) rows = data as Record<string, unknown>[];
    }

    // Use pagination result for accurate row slicing
    const paginationResult = finalizePagination(computePagination(this.store.state), this.store.state);
    const pageData = paginationResult.pagesData.find((p) => p.pageNumber === pageNum);

    let rowOffset = 0;
    if (pageData) {
      rowOffset = pageData.tableRowStart;
      rows = rows.slice(pageData.tableRowStart, pageData.tableRowEnd);
    } else {
      const pagination = this.store.state.pagination;
      if (pagination.mode === 'rows' && pagination.rowsPerPage > 0) {
        rowOffset = (pageNum - 1) * pagination.rowsPerPage;
        rows = rows.slice(rowOffset, rowOffset + pagination.rowsPerPage);
      }
    }

    const columnSpanField = this.store.state.pagination.columnSpanField ?? '';
    const columnSpanSet = new Set<number>(pageData?.columnSpanRows ?? []);

    return html`
      <div class="el-table">
        <table>
          <thead>
            <tr>
              ${cols.map((c) => html`
                <th style="background: ${el.headerBgColor}; color: ${el.headerTextColor}; text-align: ${c.align}; border: 0.5px solid ${el.borderColor};">
                  ${c.label}
                </th>
              `)}
            </tr>
          </thead>
          <tbody>
            ${rows.length > 0 ? rows.map((row, i) => {
              const absIdx = rowOffset + i;
              const isSpan = columnSpanField && (columnSpanSet.has(absIdx) || row[columnSpanField]);
              if (isSpan) {
                return html`
                  <tr style="${i % 2 === 1 ? `background: ${el.alternateRowColor}` : ''}">
                    <td colspan=${cols.length} style="text-align: left; font-weight: bold; border: 0.5px solid ${el.borderColor}; padding: 4px 6px;">
                      ${formatCellValue(row[cols[0].key], cols[0].format)}
                    </td>
                  </tr>
                `;
              }
              return html`
              <tr style="${i % 2 === 1 ? `background: ${el.alternateRowColor}` : ''}">
                ${cols.map((c) => {
                  const ov = c.overflow ?? 'ellipsis';
                  const cellStyle = [
                    `text-align: ${c.align}`,
                    `border: 0.5px solid ${el.borderColor}`,
                    c.bold ? 'font-weight: 600' : '',
                    ov === 'wrap' ? `white-space: normal; word-break: break-word;${c.maxLines > 0 ? ` display: -webkit-box; -webkit-line-clamp: ${c.maxLines}; -webkit-box-orient: vertical; overflow: hidden;` : ''}` : '',
                    ov === 'ellipsis' ? 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0;' : '',
                    ov === 'clip' ? 'white-space: nowrap; overflow: hidden; max-width: 0;' : '',
                  ].filter(Boolean).join('; ');
                  return html`
                    <td style="${cellStyle}">
                      ${c.isIndex ? absIdx + 1 : formatCellValue(row[c.key], c.format)}
                    </td>
                  `;
                })}
              </tr>
            `;
            }) : html`
              <tr><td colspan=${cols.length} style="text-align: center; color: #999; padding: 8px;">No data</td></tr>
            `}
          </tbody>
        </table>
      </div>
    `;
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-preview-modal': PldPreviewModal;
  }
}

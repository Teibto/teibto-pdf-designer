/**
 * <pld-preview-modal>
 * PDF preview with rendered page visualization, page navigation,
 * and one-click PDF export.
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import type { AppState } from '../../state/app-state';
import type { CanvasElement, TextElement, TableElement, ShapeElement, LineElement, ListElement, BarcodeElement, ImageElement } from '../../models/element';
import { ELEMENT_ROLES } from '../../constants/roles';
import { resolveTemplateString, resolveBinding } from '../../services/binding.service';
import { computePagination, finalizePagination, getPageData } from '../../services/pagination.service';
import { formatCellValue } from '../../utils/format';
import { clearBarcodeCache, getCachedBarcodeSvg } from '../../services/barcode.service';
import { getCurrentBfoXml, type BfoExportOptions } from '../../services/bfo-export.service';
import { isNetSuiteEnv, getNsContext, renderLivePreview } from '../../services/netsuite-adapter.service';
import { resolveSampleRecordType } from '../../services/sample-record-type.service';
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
  private previewRequest = 0;
  private previewController: AbortController | null = null;

  static styles = css`
    .preview-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
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
      border: 1px solid var(--c-border);
      border-radius: 6px;
      background: var(--c-surface-2);
      color: var(--c-text-subtle);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .nav-btn:hover {
      background: var(--c-surface-3);
      color: var(--c-text);
    }

    .nav-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .page-info {
      font-size: 12px;
      font-family: var(--font-mono, monospace);
      color: var(--c-text-subtle);
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .zoom-label {
      font-size: var(--t-sm);
      font-family: var(--font-mono, monospace);
      color: var(--c-text-subtle);
      min-width: 40px;
      text-align: center;
    }

    .export-btn {
      padding: 8px 20px;
      background: var(--c-brand);
      border: none;
      border-radius: 6px;
      color: var(--c-brand-on);
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
      border: 1px solid var(--c-border);
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
      color: var(--c-text-subtle);
      font-size: 13px;
    }

    .server-status .spinner {
      width: 34px;
      height: 34px;
      border: 3px solid var(--c-border);
      border-top-color: var(--c-brand);
      border-radius: 50%;
      animation: pld-spin 0.8s linear infinite;
    }

    @keyframes pld-spin {
      to { transform: rotate(360deg); }
    }

    .server-status.error {
      color: var(--c-danger);
      text-align: center;
      padding: 0 24px;
    }

    .server-hint {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
    }

    /* ─── Page Preview ─── */
    .preview-scroll {
      display: flex;
      justify-content: center;
      overflow: auto;
      max-height: 60vh;
      padding: 10px;
      background: var(--c-bg);
      border-radius: 8px;
    }

    .page-preview {
      position: relative;
      background: #fff;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
      flex-shrink: 0;
      transform-origin: top center;
      overflow: hidden;
      /* mirror BFO body padding="0.5in" (36pt) so flow position ≈ print */
      padding: 36px;
      box-sizing: border-box;
    }


    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    /* ─── Band-flow layout (#107): bands stack like BFO print ─── */
    .flow-row {
      display: flex;
      width: 100%;
      align-items: flex-start;
    }

    .flow-col {
      overflow: hidden;
      min-width: 0;
    }

    .flow-el {
      position: relative;
    }

    .watermark-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.15;
      pointer-events: none;
      z-index: 1;
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

    /* ─── Page break indicators (in-flow, #107) ─── */
    .break-indicator {
      display: flex;
      width: 100%;
      margin: 2px 0;
      align-items: center;
      gap: 6px;
      z-index: 9999;
      pointer-events: none;
    }

    .break-indicator .break-line {
      flex: 1;
      border-top: 1.5px dashed var(--break-color, #b3311f);
    }

    .break-indicator .break-label {
      font-size: 7px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #fff;
      background: var(--break-color, #b3311f);
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
    }

    .break-indicator.force-break {
      --break-color: var(--c-warning);
    }

    .break-indicator.page-end {
      --break-color: var(--c-brand);
    }

    .continuation-badge {
      align-self: flex-end;
      margin-left: auto;
      width: fit-content;
      display: block;
      font-size: 7px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--c-text-subtle);
      background: var(--c-brand-soft);
      border: 1px solid var(--c-brand);
      padding: 1px 6px;
      border-radius: 3px;
      z-index: 9999;
      pointer-events: none;
    }
      button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  /**
   * พรีวิวผ่าน BFO จริงทำได้ทุกครั้งที่อยู่ใน NetSuite (#191) — ไม่มี record ก็ยัง
   * render ได้ด้วยข้อมูลตัวอย่างของ engine · เดิมเงื่อนไขคือ "ต้องมี recordId" ทำให้
   * คนที่เปิดดีไซเนอร์จากเมนูไม่เคยเห็นผลจาก BFO เลยสักครั้ง เห็นแต่ HTML ที่ SPA วาดเอง
   * ซึ่งไม่บอกอะไรเรื่องฟอนต์ไทย/หัวท้ายซ้ำหน้า/ตารางล้น
   */
  private get _serverMode(): boolean {
    return isNetSuiteEnv();
  }

  /** ไม่มี record → พรีวิวด้วยข้อมูลตัวอย่าง และต้องบอกผู้ใช้ให้ชัดว่าเป็นตัวอย่าง */
  private get _sampleMode(): boolean {
    return isNetSuiteEnv() && !getNsContext()?.recordId;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        this.previewPage = 1;
        this.totalPages = this.store.state.totalPages || 1;
        if (this._serverMode) this._loadServerPreview();
      } else {
        this._clearServerPreview();
        clearBarcodeCache();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._clearServerPreview();
    clearBarcodeCache();
  }

  /**
   * Render the current (unsaved) design server-side via N/render and show the
   * real PDF — same engine + record as Print, so preview == print (#12).
   */
  private async _loadServerPreview() {
    const ctx = getNsContext();
    if (!ctx) return;
    const sample = this._sampleMode;
    const rectype = sample
      ? resolveSampleRecordType(this.store.state.template.nsMetadata?.rectype, ctx.recordType)
      : ctx.recordType?.trim();
    if (!sample && !ctx.recordId) return;

    this._clearServerPreview();
    const request = this.previewRequest;
    this.serverLoading = true;
    this.serverError = '';
    const controller = this.previewController = new AbortController();
    try {
      await this.updateComplete;
      // Allow a visible frame before export, but a background tab may never deliver rAF.
      await new Promise<void>((resolve) => {
        let frame: number | null = null;
        let afterFrame: ReturnType<typeof setTimeout> | null = null;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallback);
          if (frame !== null) cancelAnimationFrame(frame);
          if (afterFrame !== null) clearTimeout(afterFrame);
          controller.signal.removeEventListener('abort', finish);
          resolve();
        };
        const fallback = setTimeout(finish, 100);
        controller.signal.addEventListener('abort', finish, { once: true });
        if (controller.signal.aborted) finish();
        else if (typeof requestAnimationFrame === 'function') {
          frame = requestAnimationFrame(() => {
            frame = null;
            afterFrame = setTimeout(finish, 0);
          });
        } else afterFrame = setTimeout(finish, 0);
      });
      if (controller.signal.aborted || !this.open || !this.isConnected) return;
      if (!rectype) throw new Error('ไม่พบประเภทเอกสารจริง กรุณาเปิด Designer จากรายการอีกครั้ง');
      // Font comes from the config record via ${company.fontRegular} (#156) — the
      // preview therefore fails/succeeds on fonts exactly like Print does.
      const options: BfoExportOptions = { useBands: true }; // band layout is authoritative (#47 cutover)
      const xml = getCurrentBfoXml(this.store.state, options);
      const blob = await renderLivePreview({
        xml,
        rectype,
        recid: sample ? undefined : ctx.recordId!,
        copies: this.store.state.copies,
        sample,
        signal: controller.signal,
      });
      if (request !== this.previewRequest || !this.open || !this.isConnected) return;
      this.serverPdfUrl = URL.createObjectURL(blob);
    } catch (err) {
      if (request === this.previewRequest) {
        this.serverError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (request === this.previewRequest) this.serverLoading = false;
    }
  }

  private _clearServerPreview() {
    this.previewRequest++;
    this.previewController?.abort();
    this.previewController = null;
    this.serverLoading = false;
    if (this.serverPdfUrl) {
      URL.revokeObjectURL(this.serverPdfUrl);
      this.serverPdfUrl = null;
    }
  }

  /** Download the displayed PDF, including unsaved layout edits and server-sourced data. */
  private _printServer() {
    if (!this.serverPdfUrl || this.serverLoading) return;
    const link = document.createElement('a');
    link.href = this.serverPdfUrl;
    link.download = 'preview.pdf';
    link.click();
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="ตัวอย่าง PDF (PDF Preview)"
        size="xl"
        @close=${this._close}
      >
        <div slot="body">
          ${this._serverMode
            ? this._renderServerBody()
            : this.store.state.editorMode === 'xml'
              ? html`<div class="server-status error">การพรีวิว Canonical XML ต้องใช้บริการเรนเดอร์ BFO ของ NetSuite (Canonical XML preview requires the NetSuite BFO render service)</div>`
              : this._renderSimBody()}
        </div>
      </pld-modal>
    `;
  }

  /** Server-side preview body: real N/render PDF in an iframe (#12). */
  private _renderServerBody() {
    return html`
      <div class="preview-toolbar">
        <span class="server-hint">
          ${this._sampleMode
            ? 'พรีวิวด้วยข้อมูลตัวอย่างของระบบ รวมการแก้ไขแบบที่ยังไม่บันทึก ข้อมูลที่แก้ในแผง Data ใช้จำลองบนพื้นที่ออกแบบเท่านั้น'
            : 'พรีวิวด้วยข้อมูลจากเอกสารจริง รวมการแก้ไขแบบที่ยังไม่บันทึก ข้อมูลที่แก้ในแผง Data ใช้จำลองบนพื้นที่ออกแบบเท่านั้น บันทึกแบบก่อนสั่ง Print จากเอกสาร'}
        </span>
        <button class="export-btn" ?disabled=${this.serverLoading || !this.serverPdfUrl}
          @click=${this._printServer}>${icon('file')} ดาวน์โหลด PDF ที่แสดง</button>
      </div>

      ${this.serverLoading
        ? html`<div class="server-status"><div class="spinner"></div><span>กำลังเรนเดอร์ PDF…</span></div>`
        : this.serverError
          ? html`<div class="server-status error">
              <span>เรนเดอร์ล้มเหลว: ${this.serverError}</span>
              <button class="nav-btn" style="width:auto;padding:0 12px;" @click=${this._loadServerPreview}>${icon('refresh')} ลองใหม่</button>
            </div>`
          : this.serverPdfUrl
            ? html`<iframe class="server-frame" src=${this.serverPdfUrl} title="ตัวอย่าง PDF (PDF Preview)"></iframe>`
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
          <button class="nav-btn" aria-label="หน้าก่อนหน้า" ?disabled=${this.previewPage <= 1}
            @click=${() => this.previewPage--}>${icon('left')}</button>
          <span class="page-info">${this.previewPage} / ${this.totalPages}</span>
          <button class="nav-btn" aria-label="หน้าถัดไป" ?disabled=${this.previewPage >= this.totalPages}
            @click=${() => this.previewPage++}>${icon('right')}</button>
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
    const totalPages = this.totalPages;
    const paginationResult = finalizePagination(computePagination(state), state);
    const pageData = getPageData(paginationResult, pageNum);

    // Per-element visibility from the pagination engine (headerMode, roles)
    const visibleIds = new Set<string>();
    if (pageData) {
      for (const pe of pageData.elements) {
        if (pe.visible) visibleIds.add(pe.element.id);
      }
    } else {
      for (const el of state.elements) {
        const role = ELEMENT_ROLES[el.role];
        const show = role.showOnPages === 'all'
          || (role.showOnPages === 'first' && pageNum === 1)
          || (role.showOnPages === 'last' && pageNum === totalPages);
        if (show) visibleIds.add(el.id);
      }
    }

    const byId = new Map(state.elements.map((e) => [e.id, e]));
    const { before, after } = this._buildBreakIndicators(state, pageNum, pageData);

    // Band-flow (#107): stack bands top-to-bottom exactly like the BFO export
    // prints them — the sim preview no longer reads element x/y. A footer
    // after the table follows it naturally in flow (old dynamicFooter shift
    // machinery retired with it).
    return html`
      ${state.bands.map((band) => {
        const resolve = (ids: string[]): CanvasElement[] =>
          ids.map((id) => byId.get(id))
            .filter((el): el is CanvasElement => !!el && visibleIds.has(el.id));

        if (band.role === 'watermark') {
          const els = band.rows.flatMap((r) => r.columns.flatMap((c) => resolve(c.elementIds)));
          if (els.length === 0) return nothing;
          return html`<div class="watermark-overlay">
            ${els.map((el) => this._renderElement(el, state.jsonData, pageNum, pageData))}
          </div>`;
        }

        const rowsHtml = band.rows.map((row) => {
          const anyVisible = row.columns.some((c) => resolve(c.elementIds).length > 0);
          if (!anyVisible) return nothing;
          return html`
            <div class="flow-row" style="${row.height != null ? `min-height: ${row.height}px;` : ''}">
              ${row.columns.map((col) => html`
                <div class="flow-col" style="width: ${col.widthPct}%;">
                  ${resolve(col.elementIds).map((el) => html`
                    <div class="flow-el">${this._renderElement(el, state.jsonData, pageNum, pageData)}</div>
                  `)}
                </div>
              `)}
            </div>
          `;
        });

        if (band.role === 'table') {
          return html`${before}${rowsHtml}${after}`;
        }
        return rowsHtml;
      })}
    `;
  }

  /**
   * [UI-5] Break indicators, now in-flow (#107): `before` renders above the
   * table band (continuation badge + force-break), `after` below it
   * (page-end line) — no y coordinates involved.
   */
  private _buildBreakIndicators(
    state: Readonly<AppState>,
    pageNum: number,
    pageData?: import('../../services/pagination.service').PageData,
  ): { before: unknown; after: unknown } {
    const none = { before: nothing, after: nothing };
    if (!pageData) return none;

    const tableEl = state.elements.find((el) => el.type === 'table' && el.role === 'table');
    if (!tableEl) return none;

    const forceBreaks = new Set(state.pagination.forceBreakBeforeRows ?? []);
    const before: ReturnType<typeof html>[] = [];
    const after: ReturnType<typeof html>[] = [];

    if (pageData.isContinuation) {
      before.push(html`
        <div class="continuation-badge">↑ cont'd from page ${pageNum - 1}</div>
      `);
    }

    if (forceBreaks.has(pageData.tableRowStart) && pageData.tableRowStart > 0) {
      before.push(html`
        <div class="break-indicator force-break">
          <span class="break-line"></span>
          <span class="break-label">✂ แบ่งหน้าก่อนแถว ${pageData.tableRowStart + 1} (force break before row)</span>
          <span class="break-line"></span>
        </div>
      `);
    }

    if (pageNum < this.totalPages && !pageData.isSummaryPage && pageData.tableRowEnd > pageData.tableRowStart) {
      after.push(html`
        <div class="break-indicator page-end">
          <span class="break-line"></span>
          <span class="break-label">จบหน้า ${pageNum} — แถว ${pageData.tableRowEnd} (page ${pageNum} ends — row ${pageData.tableRowEnd}) ↓</span>
          <span class="break-line"></span>
        </div>
      `);
    }

    return { before, after };
  }

  private _renderElement(
    el: CanvasElement,
    jsonData: Record<string, unknown> | null,
    pageNum: number,
    pageData?: import('../../services/pagination.service').PageData,
  ) {
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
        return this._renderTablePreview(te, jsonData, pageNum, pageData);
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
        return html`<div class="el-barcode">กำลังโหลด… (Loading...)</div>`;
      }
      case 'image': {
        const ie = el as ImageElement;
        const src = ie.imageData || ie.src;
        if (src) {
          return html`<img src="${src}" style="width:100%;height:100%;object-fit:${ie.objectFit};" />`;
        }
        return html`<div style="width:100%;height:100%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">รูปภาพ (Image)</div>`;
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

  private _renderTablePreview(
    el: TableElement,
    jsonData: Record<string, unknown> | null,
    pageNum: number,
    pageData?: import('../../services/pagination.service').PageData,
  ) {
    const cols = el.columns.filter((c) => !c.hidden);
    if (cols.length === 0) return html`<div style="color: #999; font-size: 10px; padding: 8px;">ยังไม่ได้ตั้งค่าคอลัมน์</div>`;

    let rows: Record<string, unknown>[] = [];
    if (jsonData && el.binding) {
      const data = resolveBinding(jsonData, el.binding);
      if (Array.isArray(data)) rows = data as Record<string, unknown>[];
    }

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
              <tr><td colspan=${cols.length} style="text-align: center; color: #999; padding: 8px;">ไม่มีข้อมูล</td></tr>
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

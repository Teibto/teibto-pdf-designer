/**
 * <pld-bfo-export-modal>
 * NetSuite BFO XML template export modal.
 * Shows XML preview with record type selection and export options.
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import { getCurrentBfoXml, type BfoExportOptions } from '../../services/bfo-export.service';
import { lintBfoXml, type LintReport } from '../../services/bfo-lint.service';
import { showToast } from '../shared/toast-notification';
import {
  getNsContext, isNetSuiteEnv, hasThaiFontConfigured,
  getCachedBindingContract, fetchNsSampleData,
} from '../../services/netsuite-adapter.service';
import { recordTypeOptions, DEFAULT_RECORD_TYPE } from '../../constants/record-types';
import '../shared/modal';

@customElement('pld-bfo-export-modal')
export class PldBfoExportModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;

  // recordType here only drives the FreeMarker preview hints — saving to NetSuite
  // (and choosing the record type it targets) moved to <pld-save-ns-modal> (#138).
  @state() private recordType = DEFAULT_RECORD_TYPE;
  @state() private useFreeMarker = true;
  @state() private includePageHeaders = true;
  @state() private xmlPreview = '';
  @state() private xmlError = '';
  /** ผลตรวจกับดัก BFO ของ XML ที่เห็นอยู่ (#191) */
  @state() private lint: LintReport | null = null;

  connectedCallback() {
    super.connectedCallback();
    // Default the record type to the record the designer was opened from
    // (?rectype=… on the Suitelet URL) instead of a fixed 'transaction'.
    const ctxRectype = getNsContext()?.recordType;
    if (ctxRectype) this.recordType = ctxRectype;
  }

  /**
   * Warn only inside NetSuite (#156): outside it there is no config record to read,
   * and the exported XML is meant to be saved into an account that has one.
   */
  private get _showFontWarning(): boolean {
    return isNetSuiteEnv() && !hasThaiFontConfigured();
  }

  static styles = css`
    .config-section {
      margin-bottom: 16px;
    }

    /* ผลตรวจกับดัก BFO (#191) — error บล็อกการบันทึก, warning แค่เตือน */
    .lint-box {
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.6;
    }
    .lint-box.err {
      background: var(--c-danger-soft);
      border: 1px solid var(--c-danger);
      color: var(--c-danger);
    }
    .lint-box.warn {
      background: var(--c-warning-soft);
      border: 1px solid var(--c-warning);
      color: var(--c-warning);
    }
    .lint-box.ok {
      background: var(--c-success-soft);
      border: 1px solid var(--c-success);
      color: var(--c-text-subtle);
    }
    .lint-box h4 { margin: 0 0 6px; font-size: 12px; }
    .lint-box ul { margin: 0; padding-left: 18px; }
    .lint-box li { margin-bottom: 4px; }
    .lint-box .fix { color: var(--c-text-subtle); }
    .lint-box code { font-size: var(--t-sm); }

    /* ฟอนต์ไทยไม่ได้ตั้งใน config (#156) — เตือนก่อนที่ผู้ใช้จะไปเจอ PDF ที่ไทยหาย */
    .font-warn {
      margin: 0 0 16px;
      padding: 10px 12px;
      border: 1px solid var(--c-warning);
      border-radius: 6px;
      background: var(--c-warning-soft);
      color: var(--c-warning);
      font-size: 12px;
      line-height: 1.6;
    }

    .font-warn code {
      font-family: var(--font-mono, monospace);
    }

    .section-label {
      font-size: var(--t-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--c-text-muted);
      margin-bottom: 8px;
    }

    .config-row {
      display: flex;
      gap: 12px;
      margin-bottom: 10px;
      align-items: center;
    }

    .config-field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .config-field label {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
    }

    .config-field select {
      padding: 8px 10px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 6px;
      color: var(--c-text);
      font-size: 12px;
      font-family: inherit;
      outline: none;
      cursor: pointer;
    }

    .config-field select:focus {
      border-color: var(--c-brand);
    }

    .check-group {
      display: flex;
      gap: 16px;
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      cursor: pointer;
    }

    .check-item input {
      accent-color: var(--c-brand);
      width: 14px;
      height: 14px;
      cursor: pointer;
    }

    /* ─── XML Preview ─── */
    .xml-preview-area {
      margin-top: 12px;
    }

    .xml-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .xml-toolbar h3 {
      font-size: 12px;
      font-weight: 600;
      color: var(--c-text);
      margin: 0;
    }

    .xml-actions {
      display: flex;
      gap: 6px;
    }

    .small-btn {
      padding: 4px 10px;
      border: 1px solid var(--c-border);
      border-radius: 5px;
      background: var(--c-surface-2);
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .small-btn:hover {
      background: var(--c-surface-3);
      color: var(--c-text);
    }

    .xml-code {
      width: 100%;
      min-height: 350px;
      max-height: 450px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 8px;
      color: var(--c-success);
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      line-height: 1.6;
      padding: 14px;
      resize: vertical;
      outline: none;
      tab-size: 2;
      overflow: auto;
      white-space: pre;
    }

    /* ─── Info Panel ─── */
    .info-panel {
      margin-top: 12px;
      padding: 10px 14px;
      background: var(--c-brand-soft);
      border: 1px solid var(--c-brand);
      border-radius: 8px;
    }

    .info-panel p {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      margin: 4px 0;
      line-height: 1.6;
    }

    .info-panel code {
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      color: var(--c-brand);
      background: var(--c-bg);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* Footer */
    .footer-btns {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .btn {
      padding: 7px 16px;
      border-radius: 6px;
      border: 1px solid var(--c-border);
      background: var(--c-surface-2);
      color: var(--c-text);
      font-size: 12.5px;
      font-family: inherit;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
    }

    .btn:hover { background: var(--c-surface-3); }

    .btn-bfo {
      background: var(--c-brand);
      border: none;
      color: var(--c-brand-on);
    }

    .btn.btn-bfo:hover { background: var(--c-brand-strong); color: var(--c-brand-on); }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._generatePreview();
      this._ensureBindingContract();
    }
  }

  /**
   * ดึง binding contract จาก engine ถ้ายังไม่มีในรอบนี้ แล้ว lint ใหม่ (#193).
   *
   * lint เตือน "ฟิลด์นี้ engine ไม่ได้จ่าย" ได้ก็ต่อเมื่อรู้ contract — เดิมมันถูกเติม
   * เฉพาะตอนผู้ใช้กดโหลดข้อมูลตัวอย่าง คำเตือนจึงขึ้นบ้างไม่ขึ้นบ้างโดยที่ผู้ใช้ไม่รู้ว่า
   * ทำไม · ล้มเหลวก็ไม่เป็นไร กฎที่เหลือยังตรวจครบ ด่านตอนบันทึกจึงไม่อ่อนลง
   */
  private async _ensureBindingContract() {
    if (!isNetSuiteEnv() || getCachedBindingContract()) return;
    try {
      await fetchNsSampleData(this.recordType);
      this._generatePreview();
    } catch {
      // contract โหลดไม่ได้ = ไม่มีคำเตือนเรื่องฟิลด์นอกสัญญาเท่านั้น
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="ส่งออก BFO XML สำหรับ NetSuite (NetSuite BFO XML Export)"
        size="xl"
        @close=${this._close}
      >
        <div slot="body">
          <!-- Config Section -->
          ${this.store.state.editorMode === 'visual' ? html`<div class="config-section">
            <div class="section-label">ตั้งค่าการส่งออก (Export Settings)</div>
            <div class="config-row">
              <div class="config-field">
                <label for="bfo-export-record-type">ประเภทเอกสาร NetSuite (NetSuite Record Type)</label>
                <select id="bfo-export-record-type"
                  @change=${(e: Event) => {
                    this.recordType = (e.target as HTMLSelectElement).value;
                    this._generatePreview();
                  }}>
                  ${recordTypeOptions(this.recordType).map((rt) => html`
                    <option value=${rt.value} ?selected=${rt.value === this.recordType}>${rt.label}</option>
                  `)}
                </select>
              </div>
            </div>
            <div class="check-group">
              <label class="check-item">
                <input type="checkbox" .checked=${this.useFreeMarker}
                  @change=${(e: Event) => {
                    this.useFreeMarker = (e.target as HTMLInputElement).checked;
                    this._generatePreview();
                  }} />
                ใช้ไวยากรณ์ FreeMarker (Use FreeMarker Syntax)
              </label>
              <label class="check-item">
                <input type="checkbox" .checked=${this.includePageHeaders}
                  @change=${(e: Event) => {
                    this.includePageHeaders = (e.target as HTMLInputElement).checked;
                    this._generatePreview();
                  }} />
                รวม CSS หัว/ท้ายกระดาษ (Include Page Header/Footer CSS)
              </label>
            </div>
          </div>` : html`<p class="config-section">Canonical XML ถูกส่งออกตามที่แก้ไขจริง — ตัวเลือกของ generator ไม่มีผล (Canonical XML is exported exactly as edited)</p>`}

          <!-- ฟอนต์ไทยยังไม่ได้ตั้งใน config (#156): binding company.fontRegular
               จะว่าง → BFO เมินฟอนต์เงียบ ๆ แล้วตัวอักษรไทยหายทั้งใบ -->
          ${this._showFontWarning
            ? html`<p class="font-warn">
                ⚠ ยังไม่ได้ตั้งฟอนต์ไทยใน company config ของ account นี้ —
                XML อ้าง <code>\${company.fontRegular}</code> ที่ยังว่าง PDF จะพิมพ์ออกมาโดยไม่มีตัวอักษรไทย
                (ตั้งที่ <code>customrecord_pld_config</code> ให้ชี้ไฟล์ THSarabunPSK)
              </p>`
            : nothing}

          ${this.xmlError ? html`<div class="lint-box err" role="alert">${this.xmlError}</div>` : this._renderLint()}

          <!-- XML Preview -->
          <div class="xml-preview-area">
            <div class="xml-toolbar">
              <h3>⟨/⟩ ${this.store.state.editorMode === 'xml' ? 'XML หลัก (Canonical XML)' : 'XML ที่สร้าง (Generated XML)'}</h3>
              <div class="xml-actions">
                <button class="small-btn" ?disabled=${!!this.xmlError} @click=${this._copyToClipboard}>${icon('copy')} คัดลอก (Copy)</button>
                <button class="small-btn" ?disabled=${!!this.xmlError} @click=${this._downloadFile}>${icon('download')} ดาวน์โหลด .xml (Download .xml)</button>
                <button class="small-btn" @click=${this._generatePreview}>${icon('refresh')} สร้างใหม่ (Regenerate)</button>
              </div>
            </div>
            <pre class="xml-code">${this.xmlPreview}</pre>
          </div>

          <!-- Info -->
          <div class="info-panel">
            <p>${icon('info')} <strong>เคล็ดลับ BFO ของ NetSuite (NetSuite BFO Tips):</strong></p>
            <p>• Variable syntax: <code>\${${this.recordType}.fieldName}</code></p>
            <p>• List iteration: <code>&lt;#list ${this.recordType}.items as item&gt;</code></p>
            <p>• Template ถูกเก็บใน Custom Record แยก ไม่ใช้ Advanced PDF Templates</p>
            <p>• Print ผ่าน Render Suitelet + ปุ่ม Print PDF บน Transaction Form</p>
          </div>
        </div>

        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${this._close}>ปิด (Close)</button>
            <button class="btn" ?disabled=${!!this.xmlError} @click=${this._copyToClipboard}>${icon('copy')} คัดลอก XML (Copy XML)</button>
            <button class="btn btn-bfo" ?disabled=${!!this.xmlError} @click=${this._downloadFile}>${icon('download')} ดาวน์โหลด (Download)</button>
          </div>
        </div>
      </pld-modal>
    `;
  }

  /**
   * ผลตรวจกับดัก BFO ของ XML ที่กำลังจะบันทึก/ดาวน์โหลด (#191).
   *
   * error = พิสูจน์แล้วว่าทำให้เอกสารพิมพ์ไม่ออกหรือพิมพ์ว่าง — บันทึกเข้า NetSuite
   * ไม่ได้จนกว่าจะแก้ · warning = พิมพ์ออก แต่หน้าตาบนกระดาษอาจไม่ตรงกับที่เห็นในจอ
   */
  private _renderLint() {
    const report = this.lint;
    if (!report) return nothing;

    if (report.findings.length === 0) {
      return html`<div class="lint-box ok">✓ ตรวจกับดัก BFO แล้ว — ไม่พบปัญหา</div>`;
    }

    const group = (
      items: typeof report.findings,
      cls: string,
      title: string,
    ) => (items.length === 0 ? nothing : html`
      <div class="lint-box ${cls}">
        <h4>${title}</h4>
        <ul>
          ${items.map((f) => html`
            <li>
              ${f.message}
              ${f.sample ? html`<br /><code>${f.sample}</code>` : nothing}
              <br /><span class="fix">วิธีแก้: ${f.hint}</span>
            </li>
          `)}
        </ul>
      </div>
    `);

    return html`
      ${group(report.errors, 'err',
        `✕ ต้องแก้ก่อนบันทึก (${report.errors.length}) — เอกสารจะพิมพ์ไม่ออกหรือพิมพ์ออกมาว่าง`)}
      ${group(report.warnings, 'warn',
        `⚠ ควรตรวจ (${report.warnings.length}) — พิมพ์ออก แต่ผลบนกระดาษอาจไม่ตรงกับที่เห็นในดีไซเนอร์`)}
    `;
  }

  private _generatePreview() {
    const options: BfoExportOptions = {
      recordType: this.recordType,
      useFreeMarker: this.useFreeMarker,
      includePageHeaders: this.includePageHeaders,
      useBands: true, // band layout is authoritative (#47 cutover)
    };

    // The Thai <link type="font"> is bound to the config record (#156) — nothing
    // account-specific is baked into the XML, so this output is safe to commit.
    try {
      this.xmlPreview = getCurrentBfoXml(this.store.state, options);
      this.xmlError = '';
      this.lint = lintBfoXml(this.xmlPreview, getCachedBindingContract());
    } catch (error) {
      this.xmlPreview = '';
      this.lint = null;
      this.xmlError = error instanceof Error ? error.message : String(error);
    }
  }

  private _copyToClipboard() {
    navigator.clipboard?.writeText(this.xmlPreview);
    showToast('คัดลอก BFO XML ไปยังคลิปบอร์ดแล้ว (BFO XML copied to clipboard)', 'success');
  }

  private _downloadFile() {
    const blob = new Blob([this.xmlPreview], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.store.state.template.name || 'template'}_bfo.xml`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('ดาวน์โหลด BFO XML แล้ว (BFO XML downloaded)', 'success');
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-bfo-export-modal': PldBfoExportModal;
  }
}

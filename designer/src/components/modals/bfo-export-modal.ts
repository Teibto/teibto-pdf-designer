/**
 * <pld-bfo-export-modal>
 * NetSuite BFO XML template export modal.
 * Shows XML preview with record type selection and export options.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import { exportBfoXml, type BfoExportOptions } from '../../services/bfo-export.service';
import { showToast } from '../shared/toast-notification';
import { isNetSuiteEnv, saveNsTemplate } from '../../services/netsuite-adapter.service';
import '../shared/modal';

const RECORD_TYPES = [
  { value: 'transaction', label: 'Transaction (Invoice, SO, PO)' },
  { value: 'salesorder', label: 'Sales Order' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'purchaseorder', label: 'Purchase Order' },
  { value: 'estimate', label: 'Estimate / Quotation' },
  { value: 'cashsale', label: 'Cash Sale / Receipt' },
  { value: 'itemfulfillment', label: 'Item Fulfillment' },
  { value: 'vendorbill', label: 'Vendor Bill' },
  { value: 'customer', label: 'Customer' },
  { value: 'employee', label: 'Employee' },
];

@customElement('pld-bfo-export-modal')
export class PldBfoExportModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;

  @state() private recordType = 'transaction';
  @state() private useFreeMarker = true;
  @state() private includePageHeaders = true;
  @state() private xmlPreview = '';

  static styles = css`
    .config-section {
      margin-bottom: 16px;
    }

    .section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--color-text-muted, #5c5e72);
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
      font-size: 10px;
      color: var(--color-text-dim, #8a8ca0);
    }

    .config-field select {
      padding: 8px 10px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 6px;
      color: var(--color-text, #e8e9f0);
      font-size: 12px;
      font-family: inherit;
      outline: none;
      cursor: pointer;
    }

    .config-field select:focus {
      border-color: var(--color-accent, #4f6ef7);
    }

    .check-group {
      display: flex;
      gap: 16px;
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--color-text-dim, #8a8ca0);
      cursor: pointer;
    }

    .check-item input {
      accent-color: var(--color-accent, #4f6ef7);
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
      color: var(--color-text, #e8e9f0);
      margin: 0;
    }

    .xml-actions {
      display: flex;
      gap: 6px;
    }

    .small-btn {
      padding: 4px 10px;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 5px;
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text-dim, #8a8ca0);
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .small-btn:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
    }

    .xml-code {
      width: 100%;
      min-height: 350px;
      max-height: 450px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 8px;
      color: var(--color-accent2, #22d3a7);
      font-family: var(--font-mono, monospace);
      font-size: 11px;
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
      background: rgba(79, 110, 247, 0.06);
      border: 1px solid rgba(79, 110, 247, 0.15);
      border-radius: 8px;
    }

    .info-panel p {
      font-size: 11px;
      color: var(--color-text-dim, #8a8ca0);
      margin: 4px 0;
      line-height: 1.6;
    }

    .info-panel code {
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      color: var(--color-accent, #4f6ef7);
      background: var(--color-bg-deep, #0a0b10);
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
      border: 1px solid var(--color-border, #2a2c3a);
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text, #e8e9f0);
      font-size: 12.5px;
      font-family: inherit;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
    }

    .btn:hover { background: var(--color-bg-hover, #222430); }

    .btn-bfo {
      background: linear-gradient(135deg, #f59e42, #e74c8b);
      border: none;
      color: #fff;
    }

    .btn-bfo:hover { opacity: 0.9; }
  `;

  updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._generatePreview();
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="🔶 NetSuite BFO XML Export"
        size="xl"
        @close=${this._close}
      >
        <div slot="body">
          <!-- Config Section -->
          <div class="config-section">
            <div class="section-label">Export Settings</div>
            <div class="config-row">
              <div class="config-field">
                <label>NetSuite Record Type</label>
                <select .value=${this.recordType}
                  @change=${(e: Event) => {
                    this.recordType = (e.target as HTMLSelectElement).value;
                    this._generatePreview();
                  }}>
                  ${RECORD_TYPES.map((rt) => html`
                    <option value=${rt.value}>${rt.label}</option>
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
                Use FreeMarker Syntax
              </label>
              <label class="check-item">
                <input type="checkbox" .checked=${this.includePageHeaders}
                  @change=${(e: Event) => {
                    this.includePageHeaders = (e.target as HTMLInputElement).checked;
                    this._generatePreview();
                  }} />
                Include Page Header/Footer CSS
              </label>
            </div>
          </div>

          <!-- XML Preview -->
          <div class="xml-preview-area">
            <div class="xml-toolbar">
              <h3>⟨/⟩ Generated XML</h3>
              <div class="xml-actions">
                <button class="small-btn" @click=${this._copyToClipboard}>📋 Copy</button>
                <button class="small-btn" @click=${this._downloadFile}>⬇ Download .xml</button>
                <button class="small-btn" @click=${this._generatePreview}>↻ Regenerate</button>
              </div>
            </div>
            <pre class="xml-code">${this.xmlPreview}</pre>
          </div>

          <!-- Info -->
          <div class="info-panel">
            <p>💡 <strong>NetSuite BFO Tips:</strong></p>
            <p>• Variable syntax: <code>\${${this.recordType}.fieldName}</code></p>
            <p>• List iteration: <code>&lt;#list ${this.recordType}.items as item&gt;</code></p>
            <p>• Template ถูกเก็บใน Custom Record แยก ไม่ใช้ Advanced PDF Templates</p>
            <p>• Print ผ่าน Render Suitelet + ปุ่ม Print PDF บน Transaction Form</p>
          </div>
        </div>

        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${this._close}>Close</button>
            <button class="btn" @click=${this._copyToClipboard}>📋 Copy XML</button>
            <button class="btn btn-bfo" @click=${this._saveToNetsuite}>💾 Save to NetSuite</button>
            <button class="btn btn-bfo" @click=${this._downloadFile}>🔶 Download</button>
          </div>
        </div>
      </pld-modal>
    `;
  }

  private _generatePreview() {
    const options: BfoExportOptions = {
      recordType: this.recordType,
      useFreeMarker: this.useFreeMarker,
      includePageHeaders: this.includePageHeaders,
    };

    this.xmlPreview = exportBfoXml(this.store.state, options);
  }

  private _copyToClipboard() {
    navigator.clipboard?.writeText(this.xmlPreview);
    showToast('BFO XML copied to clipboard!', 'success');
  }

  private _downloadFile() {
    const blob = new Blob([this.xmlPreview], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.store.state.template.name || 'template'}_bfo.xml`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('BFO XML downloaded!', 'success');
  }

  private async _saveToNetsuite() {
    if (!isNetSuiteEnv()) {
      showToast('Not running inside NetSuite. Use Download instead.', 'warning');
      return;
    }

    try {
      const state = this.store.state;
      const designerJson = JSON.stringify({
        elements: state.elements,
        page: state.page,
        pagination: state.pagination,
      });

      const result = await saveNsTemplate({
        id: state.template.id || undefined,
        name: state.template.name || 'Untitled Template',
        data: designerJson,
        xml: this.xmlPreview,
        rectype: this.recordType,
        isDefault: false,
      });

      showToast(`Template saved to NetSuite (ID: ${result.id})`, 'success');
    } catch (err) {
      showToast(`Failed to save: ${(err as Error).message}`, 'error');
    }
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

/**
 * <pld-json-editor>
 * Visual JSON data editor with syntax highlighting,
 * key extraction, validation, and sample data loading.
 * Supports two view modes: Form (visual fields) and JSON (raw text).
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { clearJsonData, loadJsonData } from '../../state/actions';
import { getNsContext } from '../../services/netsuite-adapter.service';
import { showToast } from '../shared/toast-notification';
import './data-form';

const SAMPLE_JSON = {
  company: {
    name: 'ACME Corporation Co., Ltd.',
    address: '123 Business Road, Khlong Toei, Bangkok 10110',
    taxId: '0105561234567',
    phone: '02-123-4567',
    logo: '',
  },
  customer: {
    name: 'John Doe',
    address: '456 Customer Ave, Sathorn, Bangkok 10120',
    taxId: '1234567890123',
  },
  document: {
    number: 'INV-2025-0001',
    date: '2025-01-15',
    dueDate: '2025-02-15',
    poRef: 'PO-2025-100',
    salesperson: 'Jane Smith',
  },
  items: [
    { description: 'Web Development Service', quantity: 1, unit: 'Project', unit_price: 50000, amount: 50000 },
    { description: 'UI/UX Design', quantity: 2, unit: 'Page', unit_price: 15000, amount: 30000 },
    { description: 'Server Hosting (Monthly)', quantity: 12, unit: 'Month', unit_price: 2000, amount: 24000 },
  ],
  totals: {
    subtotal: '104,000.00',
    discount: '0.00',
    afterDiscount: '104,000.00',
    tax: '7,280.00',
    total: '111,280.00',
    totalText: 'หนึ่งแสนหนึ่งหมื่นหนึ่งพันสองร้อยแปดสิบบาทถ้วน',
  },
};

@customElement('pld-json-editor')
export class PldJsonEditor extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private jsonText = '';
  @state() private isValid = true;
  @state() private keyCount = 0;
  @state() private isExpanded = false;
  @state() private viewMode: 'form' | 'json' = 'form';
  @state() private formData: Record<string, unknown> | null = null;
  private _rawDraftDirty = false;
  private _committingLocalData = false;
  private _observedJsonData: Readonly<Record<string, unknown>> | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .title {
      font-size: var(--t-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--c-text-muted);
    }

    .badge {
      font-size: var(--t-sm);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: var(--font-mono, monospace);
    }

    .badge.valid {
      background: var(--c-success-soft);
      color: var(--c-success);
      border: 1px solid var(--c-success);
    }

    .badge.invalid {
      background: var(--c-danger-soft);
      color: var(--c-danger);
      border: 1px solid var(--c-danger);
    }

    .badge.keys {
      background: var(--c-brand-soft);
      color: var(--c-brand);
      border: 1px solid var(--c-brand);
    }

    .actions {
      display: flex;
      gap: 3px;
    }

    .small-btn {
      padding: 3px 8px;
      border: 1px solid var(--c-border);
      border-radius: 4px;
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

    .data-hint {
      margin: 0 0 8px;
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      line-height: 1.5;
    }

    /* ─── View Toggle ─── */
    .view-toggle {
      display: flex;
      gap: 2px;
      margin-bottom: 8px;
      padding: 2px;
      background: var(--c-bg);
      border-radius: 6px;
      border: 1px solid var(--c-border);
    }

    .view-btn {
      flex: 1;
      padding: 5px 8px;
      border: none;
      background: transparent;
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      font-weight: 500;
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
      transition: all 0.15s;
    }

    .view-btn.active {
      background: var(--c-brand);
      color: var(--c-brand-on);
    }

    .view-btn:hover:not(.active) {
      background: var(--c-surface-3);
      color: var(--c-text);
    }

    /* ─── JSON textarea ─── */
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 120px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 6px;
      color: var(--c-success);
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      line-height: 1.6;
      padding: 10px;
      resize: vertical;
      outline: none;
      tab-size: 2;
    }

    textarea:focus {
      border-color: var(--c-brand);
    }

    textarea.invalid {
      border-color: var(--c-danger);
    }

    .expand-toggle {
      border: 0;
      background: transparent;
      font-family: inherit;
      text-align: center;
      padding: 4px;
      cursor: pointer;
      font-size: var(--t-sm);
      color: var(--c-text-muted);
      transition: color 0.15s;
    }

    .expand-toggle:hover {
      color: var(--c-brand);
    }

    /* ─── Form scroll area ─── */
    .form-scroll {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  private _stateHandler: ((e: Event) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately
    const s = this.store.state;
    this._observedJsonData = s.jsonData;
    if (s.jsonData) {
      this.jsonText = this.viewMode === 'json' ? JSON.stringify(s.jsonData, null, 2) : '';
      this.formData = s.jsonData;
      this.keyCount = s.jsonKeys.length;
      this.isValid = true;
      this._rawDraftDirty = false;
    } else {
      this.jsonText = '';
      this.formData = null;
      this.keyCount = 0;
      this.isValid = true;
      this._rawDraftDirty = false;
    }

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      const st = (e as StateChangedEvent).state;
      const dataChanged = st.jsonData !== this._observedJsonData;
      this._observedJsonData = st.jsonData;
      this.keyCount = st.jsonKeys.length;
      if (this._committingLocalData) {
        this.formData = st.jsonData;
        return;
      }
      if (!dataChanged) return;
      // Preserve an in-progress raw draft. Only a genuine external data change
      // may rewrite JSON text, and only when the raw editor is not dirty.
      if (this.viewMode === 'json' && this._rawDraftDirty) return;
      this.formData = st.jsonData;
      if (st.jsonData) {
        this.jsonText = this.viewMode === 'json' ? JSON.stringify(st.jsonData, null, 2) : '';
        this.isValid = true;
        this._rawDraftDirty = false;
      } else {
        this.jsonText = '';
        this.keyCount = 0;
        this._rawDraftDirty = false;
      }
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
    return html`
      <div class="header">
        <div class="header-left">
          <span class="title">{} ข้อมูล (Data)</span>
          ${this.keyCount > 0
            ? html`<span class="badge keys">${this.keyCount} ฟิลด์ (keys)</span>`
            : nothing}
          ${this.jsonText && this.viewMode === 'json'
            ? html`<span class="badge ${this.isValid ? 'valid' : 'invalid'}">
                ${icon(this.isValid ? 'check' : 'error')} ${this.isValid ? 'ถูกต้อง (Valid)' : 'ไม่ถูกต้อง (Invalid)'}
              </span>`
            : nothing}
        </div>
        <div class="actions">
          ${getNsContext()?.recordId
            ? html`<button class="small-btn" @click=${this._loadFromRecord}
                title="โหลดข้อมูลจากระเบียน NetSuite ใหม่ (Reload data from the NetSuite record)">${icon('refresh')} โหลดจาก Record</button>`
            : nothing}
          <button class="small-btn" @click=${this._loadSample} title="โหลดข้อมูลตัวอย่าง (Load sample data)">${icon('file')} ตัวอย่าง</button>
          ${this.viewMode === 'json'
            ? html`<button class="small-btn" @click=${this._format} title="จัดรูปแบบ JSON (Format JSON)">{ }</button>`
            : nothing}
          <button class="small-btn" @click=${this._clear} title="ล้างข้อมูล (Clear)">${icon('close')}</button>
        </div>
      </div>

      <p class="data-hint" id="data-scope-hint">
        แก้ข้อมูลเพื่อจำลองการผูกฟิลด์บนพื้นที่ออกแบบเท่านั้น
        PDF Preview ใน NetSuite ใช้ข้อมูลจากเอกสารจริง หรือข้อมูลตัวอย่างของระบบ
      </p>

      <!-- View Toggle -->
      <div class="view-toggle">
        <button
          class="view-btn ${this.viewMode === 'form' ? 'active' : ''}"
          @click=${() => this._switchView('form')}
        >ฟอร์ม</button>
        <button
          class="view-btn ${this.viewMode === 'json' ? 'active' : ''}"
          @click=${() => this._switchView('json')}
        >JSON</button>
      </div>

      ${this.viewMode === 'form' ? this._renderFormView() : this._renderJsonView()}
    `;
  }

  private _renderFormView() {
    return html`
      <div class="form-scroll">
        <pld-data-form
          .jsonData=${this.formData}
          @data-changed=${this._onFormChanged}
        ></pld-data-form>
      </div>
    `;
  }

  private _renderJsonView() {
    return html`
      <label for="json-source">ข้อมูล JSON (JSON data)</label>
      <textarea id="json-source" aria-describedby="data-scope-hint"
        class="${this.isValid ? '' : 'invalid'}"
        style="min-height: ${this.isExpanded ? '300px' : '120px'};"
        placeholder='วางข้อมูล JSON ที่นี่ (Paste JSON data here)...
{
  "company": { "name": "..." },
  "items": [...]
}'
        .value=${this.jsonText}
        @input=${this._onInput}
      ></textarea>

      <button type="button" class="expand-toggle" aria-controls="json-source" aria-expanded=${this.isExpanded}
        @click=${() => (this.isExpanded = !this.isExpanded)}>
        ${icon(this.isExpanded ? 'up' : 'down')} ${this.isExpanded ? 'ย่อ (Collapse)' : 'ขยาย (Expand)'}
      </button>
    `;
  }

  // ═══════════════════════════════════════
  // VIEW SWITCHING
  // ═══════════════════════════════════════

  private _switchView(mode: 'form' | 'json') {
    if (this.viewMode === mode) return;

    if (mode === 'json') {
      this.jsonText = this.formData ? JSON.stringify(this.formData, null, 2) : '';
      this.isValid = true;
      this._rawDraftDirty = false;
    }

    // When switching to form, sync formData from current jsonText
    if (mode === 'form' && this.jsonText.trim()) {
      try {
        const data = JSON.parse(this.jsonText) as Record<string, unknown>;
        this._commitLocalData(data);
        this.isValid = true;
        this._rawDraftDirty = false;
      } catch {
        // Stay on JSON view if invalid
        showToast('แก้ไขข้อผิดพลาด JSON ก่อนสลับไปมุมมองฟอร์ม (Fix JSON errors before switching to Form view)', 'warning');
        return;
      }
    }

    this.viewMode = mode;
  }

  // ═══════════════════════════════════════
  // FORM CHANGE HANDLER
  // ═══════════════════════════════════════

  private _onFormChanged(e: CustomEvent) {
    const data = e.detail as Record<string, unknown>;
    this._commitLocalData(data);
    this.isValid = true;
  }

  // ═══════════════════════════════════════
  // JSON INPUT HANDLER
  // ═══════════════════════════════════════

  private _onInput(e: Event) {
    const text = (e.target as HTMLTextAreaElement).value;
    this.dispatchEvent(new CustomEvent('pld-cancel-data-load', { bubbles: true, composed: true }));
    this.jsonText = text;
    this._rawDraftDirty = true;

    if (!text.trim()) {
      this.isValid = true;
      this.keyCount = 0;
      this._commitLocalClear();
      this._rawDraftDirty = false;
      return;
    }

    try {
      const data = JSON.parse(text);
      this.isValid = true;
      this._commitLocalData(data);
      this._rawDraftDirty = false;
    } catch {
      this.isValid = false;
    }
  }

  /** Re-fetch curated record data (#82) — Sample/template loads overwrite
   *  jsonData, hiding the record's fields.* from the field picker (#78). */
  private _loadFromRecord() {
    this._rawDraftDirty = false;
    this.dispatchEvent(new CustomEvent('pld-load-record', { bubbles: true, composed: true }));
  }

  private _loadSample() {
    const data = structuredClone(SAMPLE_JSON);
    this.jsonText = JSON.stringify(data, null, 2);
    this._rawDraftDirty = false;
    this._commitLocalData(data);
    this.isValid = true;
    showToast('โหลดข้อมูลตัวอย่างแล้ว (Sample data loaded)', 'success');
  }

  private _format() {
    if (!this.jsonText.trim()) return;
    try {
      const data = JSON.parse(this.jsonText);
      this.jsonText = JSON.stringify(data, null, 2);
      this._commitLocalData(data);
      this.isValid = true;
      this._rawDraftDirty = false;
    } catch {
      showToast('จัดรูปแบบไม่ได้ — JSON ไม่ถูกต้อง (Cannot format — invalid JSON)', 'warning');
    }
  }

  private _clear() {
    this.jsonText = '';
    this.formData = null;
    this.isValid = true;
    this.keyCount = 0;
    this._rawDraftDirty = false;
    this._commitLocalClear();
  }

  private _commitLocalData(data: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent('pld-cancel-data-load', { bubbles: true, composed: true }));
    this.formData = data;
    this._committingLocalData = true;
    try {
      loadJsonData(this.store, data);
    } finally {
      this._committingLocalData = false;
    }
    this.keyCount = this.store.state.jsonKeys.length;
  }

  private _commitLocalClear(): void {
    this.dispatchEvent(new CustomEvent('pld-cancel-data-load', { bubbles: true, composed: true }));
    this.formData = null;
    this._committingLocalData = true;
    try {
      clearJsonData(this.store);
    } finally {
      this._committingLocalData = false;
    }
    this.keyCount = 0;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'pld-json-editor': PldJsonEditor;
  }
}

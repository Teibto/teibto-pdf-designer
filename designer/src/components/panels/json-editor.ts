/**
 * <pld-json-editor>
 * Visual JSON data editor with syntax highlighting,
 * key extraction, validation, and sample data loading.
 * Supports two view modes: Form (visual fields) and JSON (raw text).
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { loadJsonData } from '../../state/actions';
import { getNsContext, autoLoadRecordIfAvailable } from '../../services/netsuite-adapter.service';
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
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--color-text-muted, #5c5e72);
    }

    .badge {
      font-size: 9px;
      padding: 1px 6px;
      border-radius: 3px;
      font-family: var(--font-mono, monospace);
    }

    .badge.valid {
      background: rgba(34, 211, 167, 0.12);
      color: var(--color-accent2, #22d3a7);
      border: 1px solid rgba(34, 211, 167, 0.2);
    }

    .badge.invalid {
      background: rgba(239, 68, 68, 0.12);
      color: var(--color-danger, #ef4444);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .badge.keys {
      background: rgba(79, 110, 247, 0.1);
      color: var(--color-accent, #4f6ef7);
      border: 1px solid rgba(79, 110, 247, 0.2);
    }

    .actions {
      display: flex;
      gap: 3px;
    }

    .small-btn {
      padding: 3px 8px;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text-dim, #8a8ca0);
      font-size: 9px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .small-btn:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
    }

    /* ─── View Toggle ─── */
    .view-toggle {
      display: flex;
      gap: 2px;
      margin-bottom: 8px;
      padding: 2px;
      background: var(--color-bg-deep, #0a0b10);
      border-radius: 6px;
      border: 1px solid var(--color-border, #2a2c3a);
    }

    .view-btn {
      flex: 1;
      padding: 5px 8px;
      border: none;
      background: transparent;
      color: var(--color-text-dim, #8a8ca0);
      font-size: 10px;
      font-weight: 500;
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
      transition: all 0.15s;
    }

    .view-btn.active {
      background: var(--color-accent, #4f6ef7);
      color: #fff;
    }

    .view-btn:hover:not(.active) {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
    }

    /* ─── JSON textarea ─── */
    textarea {
      width: 100%;
      min-height: 120px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 6px;
      color: var(--color-accent2, #22d3a7);
      font-family: var(--font-mono, monospace);
      font-size: 10.5px;
      line-height: 1.6;
      padding: 10px;
      resize: vertical;
      outline: none;
      tab-size: 2;
    }

    textarea:focus {
      border-color: var(--color-accent, #4f6ef7);
    }

    textarea.invalid {
      border-color: var(--color-danger, #ef4444);
    }

    .expand-toggle {
      text-align: center;
      padding: 4px;
      cursor: pointer;
      font-size: 10px;
      color: var(--color-text-muted, #5c5e72);
      transition: color 0.15s;
    }

    .expand-toggle:hover {
      color: var(--color-accent, #4f6ef7);
    }

    /* ─── Form scroll area ─── */
    .form-scroll {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }
  `;

  private _stateHandler: ((e: Event) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately
    const s = this.store.state;
    if (s.jsonData) {
      this.jsonText = JSON.stringify(s.jsonData, null, 2);
      this.formData = s.jsonData;
      this.keyCount = s.jsonKeys.length;
      this.isValid = true;
    }

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      const st = (e as StateChangedEvent).state;
      this.formData = st.jsonData;
      this.keyCount = st.jsonKeys.length;
      // Sync jsonText when store data changes externally (template load, etc.)
      if (st.jsonData) {
        this.jsonText = JSON.stringify(st.jsonData, null, 2);
        this.isValid = true;
      } else {
        this.jsonText = '';
        this.keyCount = 0;
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
          <span class="title">{} Data</span>
          ${this.keyCount > 0
            ? html`<span class="badge keys">${this.keyCount} keys</span>`
            : nothing}
          ${this.jsonText && this.viewMode === 'json'
            ? html`<span class="badge ${this.isValid ? 'valid' : 'invalid'}">
                ${this.isValid ? '✓ Valid' : '✕ Invalid'}
              </span>`
            : nothing}
        </div>
        <div class="actions">
          ${getNsContext()?.recordId
            ? html`<button class="small-btn" @click=${this._loadFromRecord}
                title="Reload data from the NetSuite record">⟳ โหลดจาก Record</button>`
            : nothing}
          <button class="small-btn" @click=${this._loadSample} title="Load sample data">★ ตัวอย่าง</button>
          ${this.viewMode === 'json'
            ? html`<button class="small-btn" @click=${this._format} title="Format JSON">{ }</button>`
            : nothing}
          <button class="small-btn" @click=${this._clear} title="Clear">✕</button>
        </div>
      </div>

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
      <textarea
        class="${this.isValid ? '' : 'invalid'}"
        style="min-height: ${this.isExpanded ? '300px' : '120px'};"
        placeholder='Paste JSON data here...
{
  "company": { "name": "..." },
  "items": [...]
}'
        .value=${this.jsonText}
        @input=${this._onInput}
      ></textarea>

      <div class="expand-toggle" @click=${() => (this.isExpanded = !this.isExpanded)}>
        ${this.isExpanded ? '▲ Collapse' : '▼ Expand'}
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // VIEW SWITCHING
  // ═══════════════════════════════════════

  private _switchView(mode: 'form' | 'json') {
    if (this.viewMode === mode) return;

    // When switching to form, sync formData from current jsonText
    if (mode === 'form' && this.jsonText.trim()) {
      try {
        this.formData = JSON.parse(this.jsonText);
        this.isValid = true;
      } catch {
        // Stay on JSON view if invalid
        showToast('Fix JSON errors before switching to Form view', 'warning');
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
    this.formData = data;
    this.jsonText = JSON.stringify(data, null, 2);
    this.isValid = true;
    loadJsonData(this.store, data);
    this.keyCount = this.store.state.jsonKeys.length;
  }

  // ═══════════════════════════════════════
  // JSON INPUT HANDLER
  // ═══════════════════════════════════════

  private _onInput(e: Event) {
    const text = (e.target as HTMLTextAreaElement).value;
    this.jsonText = text;

    if (!text.trim()) {
      this.isValid = true;
      this.keyCount = 0;
      return;
    }

    try {
      const data = JSON.parse(text);
      this.isValid = true;
      this.formData = data;
      loadJsonData(this.store, data);
      this.keyCount = this.store.state.jsonKeys.length;
    } catch {
      this.isValid = false;
    }
  }

  /** Re-fetch curated record data (#82) — Sample/template loads overwrite
   *  jsonData, hiding the record's fields.* from the field picker (#78). */
  private async _loadFromRecord() {
    try {
      const data = await autoLoadRecordIfAvailable();
      if (!data) return;
      this.jsonText = JSON.stringify(data, null, 2);
      this.formData = data;
      loadJsonData(this.store, data);
      this.isValid = true;
      this.keyCount = this.store.state.jsonKeys.length;
      showToast('Record data loaded!', 'success');
    } catch (err) {
      showToast(`Load record failed: ${(err as Error).message}`, 'error');
    }
  }

  private _loadSample() {
    const data = structuredClone(SAMPLE_JSON);
    this.jsonText = JSON.stringify(data, null, 2);
    this.formData = data;
    loadJsonData(this.store, data);
    this.isValid = true;
    this.keyCount = this.store.state.jsonKeys.length;
    showToast('Sample data loaded!', 'success');
  }

  private _format() {
    if (!this.jsonText.trim()) return;
    try {
      const data = JSON.parse(this.jsonText);
      this.jsonText = JSON.stringify(data, null, 2);
      this.isValid = true;
    } catch {
      showToast('Cannot format — invalid JSON', 'warning');
    }
  }

  private _clear() {
    this.jsonText = '';
    this.formData = null;
    this.isValid = true;
    this.keyCount = 0;
    this.store.dispatch((d) => {
      d.jsonData = null;
      d.jsonKeys = [];
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-json-editor': PldJsonEditor;
  }
}

/**
 * <pld-pagination-panel>
 * Pagination configuration panel for the left sidebar.
 * Allows switching between row-based and height-based pagination modes.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import type { PaginationConfig } from '../../models/template';

@customElement('pld-pagination-panel')
export class PldPaginationPanel extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private config: PaginationConfig = {
    mode: 'rows',
    rowsPerPage: 10,
    baseRowHeight: 24,
    lineHeightPx: 18,
    showContinuationHeader: true,
    orphanWidowMinRows: 2,
    summaryBreak: 'auto',
    dynamicFooter: true,
    dynamicFooterGap: 16,
    forceBreakBeforeRows: [],
    keepTogetherField: '',
    headerMode: 'all',
    columnSpanField: '',
  };

  @state() private jsonKeys: string[] = [];

  /** Collapsible section states */
  @state() private _layoutOpen = false;
  @state() private _breaksOpen = false;

  static styles = css`
    :host {
      display: block;
    }

    .section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--color-text-muted, #5c5e72);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .mode-toggle {
      display: flex;
      gap: 4px;
      margin-bottom: 10px;
      padding: 2px;
      background: var(--color-bg-deep, #0a0b10);
      border-radius: 6px;
      border: 1px solid var(--color-border, #2a2c3a);
    }

    .mode-btn {
      flex: 1;
      padding: 5px 8px;
      text-align: center;
      border: none;
      background: transparent;
      color: var(--color-text-dim, #8a8ca0);
      font-size: 10.5px;
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
      transition: all 0.15s;
    }

    .mode-btn.active {
      background: var(--color-accent, #4f6ef7);
      color: #fff;
    }

    .field-row {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
      align-items: center;
    }

    .field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .field label {
      font-size: 9px;
      color: var(--color-text-dim, #8a8ca0);
    }

    .field label[title] {
      cursor: help;
      border-bottom: 1px dotted var(--color-text-dim, #8a8ca0);
      display: inline;
    }

    .field input {
      padding: 5px 6px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      color: var(--color-text, #e8e9f0);
      font-size: 11px;
      font-family: var(--font-mono, monospace);
      outline: none;
      width: 100%;
    }

    .field input:focus {
      border-color: var(--color-accent, #4f6ef7);
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10.5px;
      color: var(--color-text-dim, #8a8ca0);
      cursor: pointer;
      margin-top: 6px;
    }

    .check-item input {
      accent-color: var(--color-accent, #4f6ef7);
      width: 13px;
      height: 13px;
      cursor: pointer;
    }

    .divider {
      border-top: 1px solid var(--color-border, #2a2c3a);
      margin: 10px 0 8px;
    }

    .field select {
      padding: 5px 6px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      color: var(--color-text, #e8e9f0);
      font-size: 11px;
      font-family: inherit;
      outline: none;
      width: 100%;
      cursor: pointer;
    }

    .field select:focus {
      border-color: var(--color-accent, #4f6ef7);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      padding: 2px 0;
    }

    .section-header:hover {
      opacity: 0.8;
    }

    .collapse-icon {
      font-size: 8px;
      transition: transform 0.15s;
      color: var(--color-text-dim, #8a8ca0);
    }

    .collapse-icon.open {
      transform: rotate(90deg);
    }

    .section-body {
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.2s ease, opacity 0.15s ease;
    }

    .section-body.open {
      max-height: 500px;
      opacity: 1;
    }
  `;

  private _stateHandler: ((e: Event) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately
    this.config = { ...this.store.state.pagination };
    this.jsonKeys = this.store.state.jsonKeys ?? [];

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      const s = (e as StateChangedEvent).state;
      this.config = { ...s.pagination };
      this.jsonKeys = s.jsonKeys ?? [];
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
      <div class="section-title"><span>📄</span> Pagination</div>

      <div class="mode-toggle">
        <button class="mode-btn ${this.config.mode === 'rows' ? 'active' : ''}"
          @click=${() => this._setMode('rows')}>
          Row-based
        </button>
        <button class="mode-btn ${this.config.mode === 'height' ? 'active' : ''}"
          @click=${() => this._setMode('height')}>
          Height-based
        </button>
      </div>

      ${this.config.mode === 'rows' ? html`
        <div class="field-row">
          <div class="field">
            <label title="Maximum number of data rows displayed on each page">Rows per Page</label>
            <input type="number" .value=${String(this.config.rowsPerPage)} min="1" max="100"
              @change=${(e: Event) => this._update('rowsPerPage', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      ` : html`
        <div class="field-row">
          <div class="field">
            <label title="Default height of a single data row in points. Rows with wrapped text may be taller.">Base Row Height (pt)</label>
            <input type="number" .value=${String(this.config.baseRowHeight)} min="10" max="100"
              @change=${(e: Event) => this._update('baseRowHeight', Number((e.target as HTMLInputElement).value))} />
          </div>
          <div class="field">
            <label title="Line height used to estimate text wrapping in height-based mode">Line Height (px)</label>
            <input type="number" .value=${String(this.config.lineHeightPx)} min="10" max="50"
              @change=${(e: Event) => this._update('lineHeightPx', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      `}

      <label class="check-item">
        <input type="checkbox" .checked=${this.config.showContinuationHeader}
          @change=${(e: Event) => this._update('showContinuationHeader', (e.target as HTMLInputElement).checked)} />
        Show continuation header
      </label>

      <label class="check-item"
        title="Pad the table with empty rows to a multiple of Rows per Page so the summary block stays anchored on the last page (#84)">
        <input type="checkbox" .checked=${this.config.fillLastPage ?? false}
          @change=${(e: Event) => this._update('fillLastPage', (e.target as HTMLInputElement).checked)} />
        Fill last page with empty rows
      </label>

      <!-- Copy set (#92): one PDF section per copy (ต้นฉบับ/สำเนา/...) -->
      <div class="divider"></div>
      <div class="section-title" style="margin-top:8px"><span>🗐</span> Document Copies</div>
      ${(this.store.state.copies ?? []).map((c, i) => html`
        <div class="field-row">
          <div class="field">
            <input type="text" placeholder="ป้ายไทย เช่น ต้นฉบับ" .value=${c.th}
              @change=${(e: Event) => this._updateCopy(i, 'th', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <input type="text" placeholder="EN e.g. Original" .value=${c.en}
              @change=${(e: Event) => this._updateCopy(i, 'en', (e.target as HTMLInputElement).value)} />
          </div>
          <button class="mode-btn" title="Remove copy" @click=${() => this._removeCopy(i)}>✕</button>
        </div>
      `)}
      <div class="field-row">
        <button class="mode-btn" @click=${this._addCopy}>+ Add copy</button>
        ${!(this.store.state.copies ?? []).length
          ? html`<span style="font-size:10px; color: var(--color-text-muted, #5c5e72); align-self:center;">
              default: invoice = ต้นฉบับ+สำเนา, อื่น ๆ = ชุดเดียว</span>`
          : nothing}
      </div>

      <!-- Advanced Layout Controls -->
      <div class="divider"></div>
      <div class="section-header" @click=${() => { this._layoutOpen = !this._layoutOpen; }}>
        <span class="collapse-icon ${this._layoutOpen ? 'open' : ''}">▶</span>
        <div class="section-title" style="margin-bottom:0"><span>⚙️</span> Layout Control</div>
      </div>

      <div class="section-body ${this._layoutOpen ? 'open' : ''}">

      <div class="field-row">
        <div class="field">
          <label title="Minimum number of rows on the first or last page. Prevents a single lonely row at the end/start of a page.">Orphan/Widow Min Rows</label>
          <input type="number" .value=${String(this.config.orphanWidowMinRows ?? 2)} min="0" max="10"
            @change=${(e: Event) => this._update('orphanWidowMinRows', Number((e.target as HTMLInputElement).value))} />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label title="Controls whether summary elements start on a new page. Auto: break only when space is insufficient. Always: dedicated summary page. Same page: never break.">Summary Break</label>
          <select .value=${this.config.summaryBreak ?? 'auto'}
            @change=${(e: Event) => this._update('summaryBreak', (e.target as HTMLSelectElement).value)}>
            <option value="auto">Auto (fit or break)</option>
            <option value="always">Always new page</option>
            <option value="samePage">Same page only</option>
          </select>
        </div>
      </div>

      <label class="check-item">
        <input type="checkbox" .checked=${this.config.dynamicFooter !== false}
          @change=${(e: Event) => this._update('dynamicFooter', (e.target as HTMLInputElement).checked)} />
        Dynamic footer position
      </label>

      ${this.config.dynamicFooter !== false ? html`
        <div class="field-row" style="margin-top: 4px;">
          <div class="field">
            <label title="Vertical space in points between the last table row and the footer/summary element">Footer Gap (pt)</label>
            <input type="number" .value=${String(this.config.dynamicFooterGap ?? 16)} min="0" max="100"
              @change=${(e: Event) => this._update('dynamicFooterGap', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      ` : ''}
      </div>

      <!-- Page Break Controls (v2.2) -->
      <div class="divider"></div>
      <div class="section-header" @click=${() => { this._breaksOpen = !this._breaksOpen; }}>
        <span class="collapse-icon ${this._breaksOpen ? 'open' : ''}">▶</span>
        <div class="section-title" style="margin-bottom:0"><span>✂️</span> Page Breaks</div>
      </div>

      <div class="section-body ${this._breaksOpen ? 'open' : ''}">

      <div class="field-row">
        <div class="field">
          <label title="Insert a page break before specific row numbers. Uses visible row numbers (1 = first data row). Breaks inside a keep-together group are ignored.">Force Break Before Row # (1-based, comma-separated)</label>
          <input type="text"
            .value=${(this.config.forceBreakBeforeRows ?? []).map((n) => n + 1).join(', ')}
            placeholder="e.g. 5, 15, 25"
            @change=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              const nums = raw.split(',')
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => !isNaN(n) && n >= 1)
                .map((n) => n - 1)
                .sort((a, b) => a - b);
              this._update('forceBreakBeforeRows', nums);
            }} />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label title="JSON field that groups rows together. Consecutive rows with the same value will never be split across pages.">Keep-Together Field</label>
          <select .value=${this.config.keepTogetherField ?? ''}
            @change=${(e: Event) => this._update('keepTogetherField', (e.target as HTMLSelectElement).value)}>
            <option value="">-- None --</option>
            ${this.jsonKeys.map((k) => html`<option value=${k} ?selected=${k === this.config.keepTogetherField}>${k}</option>`)}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label title="Controls which pages show the header element. 'First only' hides it on continuation pages. 'First + Last' shows on first and last page only.">Header Mode</label>
          <select .value=${this.config.headerMode ?? 'all'}
            @change=${(e: Event) => this._update('headerMode', (e.target as HTMLSelectElement).value)}>
            <option value="all">All pages</option>
            <option value="firstOnly">First page only</option>
            <option value="firstLast">First + Last page</option>
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label title="JSON field used to identify section header rows. When truthy, the row renders as a single full-width merged cell with bold text.">Column Span Field</label>
          <select .value=${this.config.columnSpanField ?? ''}
            @change=${(e: Event) => this._update('columnSpanField', (e.target as HTMLSelectElement).value)}>
            <option value="">-- None --</option>
            ${this.jsonKeys.map((k) => html`<option value=${k} ?selected=${k === this.config.columnSpanField}>${k}</option>`)}
          </select>
        </div>
      </div>
      </div>
    `;
  }

  private _setMode(mode: 'rows' | 'height') {
    this._update('mode', mode);
  }

  private _update(key: keyof PaginationConfig, value: unknown) {
    this.store.dispatch((draft) => {
      (draft.pagination as any)[key] = value;
      draft.template.isDirty = true;
    });
  }

  // ── Copy set (#92) ──

  private _addCopy = () => {
    this.store.dispatch((draft) => {
      const cur = draft.copies ?? [];
      // First add seeds the engine default so editing starts from reality
      draft.copies = cur.length
        ? [...cur, { th: 'สำเนา', en: 'Copy' }]
        : [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }];
      draft.template.isDirty = true;
    });
    this.requestUpdate();
  };

  private _removeCopy(idx: number) {
    this.store.dispatch((draft) => {
      const cur = draft.copies ?? [];
      const next = cur.filter((_, i) => i !== idx);
      draft.copies = next.length ? next : null;
      draft.template.isDirty = true;
    });
    this.requestUpdate();
  }

  private _updateCopy(idx: number, key: 'th' | 'en', value: string) {
    this.store.dispatch((draft) => {
      if (!draft.copies || !draft.copies[idx]) return;
      draft.copies[idx][key] = value;
      draft.template.isDirty = true;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-pagination-panel': PldPaginationPanel;
  }
}

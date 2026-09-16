/**
 * <pld-pagination-panel>
 * Pagination configuration panel for the left sidebar.
 * Allows switching between row-based and height-based pagination modes.
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
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
    forceBreakBeforeRows: [],
    keepTogetherField: '',
    headerMode: 'all',
    columnSpanField: '',
    sectionSubtotal: false,
    sectionSubtotalLabel: '',
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
      font-size: var(--t-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--c-text-muted);
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
      background: var(--c-bg);
      border-radius: 6px;
      border: 1px solid var(--c-border-control);
    }

    .mode-btn {
      min-height: var(--btn-h);
      flex: 1;
      padding: 5px 8px;
      text-align: center;
      border: none;
      background: transparent;
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
      transition: all 0.15s;
    }

    .mode-btn.active {
      background: var(--c-brand);
      color: var(--c-brand-on);
    }

    .field-row {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
      align-items: center;
    }

    .copy-remove { flex: 0 0 var(--btn-h); align-self: flex-end; padding: 0; }

    .field {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .field-help { font-size: var(--t-sm); line-height: var(--lh-normal); color: var(--c-text-subtle); }

    .field label {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
    }

    .field label[title] {
      cursor: help;
      border-bottom: 1px dotted var(--c-text-subtle);
      display: inline;
    }

    .field input {
      box-sizing: border-box;
      min-height: var(--btn-h);
      padding: 5px 6px;
      background: var(--c-bg);
      border: 1px solid var(--c-border-control);
      border-radius: 4px;
      color: var(--c-text);
      font-size: var(--t-sm);
      font-family: var(--font-mono, monospace);
      outline: none;
      width: 100%;
    }

    .field input:focus {
      border-color: var(--c-brand);
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      cursor: pointer;
      margin-top: 6px;
    }

    .check-item input {
      accent-color: var(--c-brand);
      width: 13px;
      height: 13px;
      cursor: pointer;
    }

    .divider {
      border-top: 1px solid var(--c-border);
      margin: 10px 0 8px;
    }

    .field select {
      box-sizing: border-box;
      min-height: var(--btn-h);
      padding: 5px 6px;
      background: var(--c-bg);
      border: 1px solid var(--c-border-control);
      border-radius: 4px;
      color: var(--c-text);
      font-size: var(--t-sm);
      font-family: inherit;
      outline: none;
      width: 100%;
      cursor: pointer;
    }

    .field select:focus {
      border-color: var(--c-brand);
    }

    .section-header {
      width: 100%;
      min-height: var(--tap-min);
      border: none;
      background: transparent;
      font: inherit;
      text-align: left;
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
      font-size: var(--t-sm);
      transition: transform 0.15s;
      color: var(--c-text-subtle);
    }

    .collapse-icon.open {
      transform: rotate(90deg);
    }

    .section-body[hidden] { display: none; }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
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
      <div class="section-title"><span>${icon('file')}</span> การแบ่งหน้า (Pagination)</div>

      <div class="mode-toggle" role="group" aria-label="วิธีแบ่งหน้า">
        <button class="mode-btn ${this.config.mode === 'rows' ? 'active' : ''}"
          aria-pressed=${this.config.mode === 'rows'} @click=${() => this._setMode('rows')}>
          ตามจำนวนแถว
        </button>
        <button class="mode-btn ${this.config.mode === 'height' ? 'active' : ''}"
          aria-pressed=${this.config.mode === 'height'} @click=${() => this._setMode('height')}>
          ตามความสูง
        </button>
      </div>

      ${this.config.mode === 'rows' ? html`
        <div class="field-row">
          <div class="field">
            <label for="pagination-panel-field-1" title="จำนวนแถวข้อมูลสูงสุดที่แสดงในแต่ละหน้า">จำนวนแถวต่อหน้า</label>
            <input id="pagination-panel-field-1" type="number" .value=${String(this.config.rowsPerPage)} min="1" max="100"
              @change=${(e: Event) => this._update('rowsPerPage', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      ` : html`
        <div class="field-row">
          <div class="field">
            <label for="pagination-panel-field-2" title="ความสูงเริ่มต้นของแถวข้อมูลหนึ่งแถว (จุด) — แถวที่ข้อความตัดบรรทัดอาจสูงกว่านี้">ความสูงแถวพื้นฐาน (pt)</label>
            <input id="pagination-panel-field-2" type="number" .value=${String(this.config.baseRowHeight)} min="10" max="100"
              @change=${(e: Event) => this._update('baseRowHeight', Number((e.target as HTMLInputElement).value))} />
          </div>
          <div class="field">
            <label for="pagination-panel-field-3" title="ความสูงบรรทัดที่ใช้ประมาณการตัดบรรทัดในโหมดตามความสูง">ความสูงบรรทัด (px)</label>
            <input id="pagination-panel-field-3" type="number" .value=${String(this.config.lineHeightPx)} min="10" max="50"
              @change=${(e: Event) => this._update('lineHeightPx', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      `}

      <label class="check-item">
        <input type="checkbox" .checked=${this.config.showContinuationHeader}
          @change=${(e: Event) => this._update('showContinuationHeader', (e.target as HTMLInputElement).checked)} />
        แสดงหัวตารางซ้ำหน้าถัดไป
      </label>

      <label class="check-item"
        title="เติมแถวว่างให้จำนวนแถวเป็นเท่าของจำนวนแถวต่อหน้า เพื่อให้ส่วนสรุปอยู่ตำแหน่งเดิมบนหน้าสุดท้าย (Pad the table with empty rows to a multiple of Rows per Page so the summary block stays anchored on the last page)">
        <input type="checkbox" .checked=${this.config.fillLastPage ?? false}
          @change=${(e: Event) => this._update('fillLastPage', (e.target as HTMLInputElement).checked)} />
        เติมแถวว่างให้เต็มหน้า (summary อยู่ตำแหน่งคงที่)
      </label>

      ${this.config.mode === 'height' && this.config.fillLastPage ? html`
        <div class="field-row">
          <div class="field">
            <label for="pagination-fill-row-count">จำนวนแถวสำหรับเติมแถวว่าง</label>
            <input id="pagination-fill-row-count" type="number" min="1" max="100"
              aria-describedby="pagination-fill-row-help"
              .value=${String(this.config.rowsPerPage)}
              @change=${(e: Event) => this._update('rowsPerPage', Number((e.target as HTMLInputElement).value))} />
            <span id="pagination-fill-row-help" class="field-help">
              เติมแถวว่างให้จำนวนแถวรวมเป็นเท่าของค่านี้ แม้แบ่งหน้าตามความสูง
              แถวที่เพิ่มอาจดันส่วนสรุปไปหน้าใหม่
            </span>
          </div>
        </div>
      ` : nothing}

      <!-- Watermark (#100) -->
      <div class="divider"></div>
      <div class="field-row">
        <div class="field">
          <label for="pagination-panel-field-4" title="ข้อความจาง ๆ กลางหน้า หลัง content ทุกหน้า เช่น สำเนา / ยกเลิก / DRAFT (แนวนอนสีเทา — BFO ไม่รองรับตัวเอียง/หมุน)">ลายน้ำ (Watermark)</label>
          <input id="pagination-panel-field-4" type="text" placeholder="เช่น สำเนา / DRAFT" .value=${this.store.state.page.watermarkText ?? ''}
            @change=${(e: Event) => this._updatePage('watermarkText', (e.target as HTMLInputElement).value)} />
        </div>
      </div>

      <!-- Copy set (#92): one PDF section per copy (ต้นฉบับ/สำเนา/...) -->
      <div class="divider"></div>
      <div class="section-title" style="margin-top:8px"><span>${icon('copy')}</span> ชุดสำเนาเอกสาร</div>
      ${(this.store.state.copies ?? []).map((c, i) => html`
        <div class="field-row">
          <div class="field">
            <label for="copy-th-${i}">สำเนา ${i + 1} (ไทย)</label>
            <input id="copy-th-${i}" type="text" placeholder="ป้ายไทย เช่น ต้นฉบับ" .value=${c.th}
              @change=${(e: Event) => this._updateCopy(i, 'th', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="copy-en-${i}">สำเนา ${i + 1} (EN)</label>
            <input id="copy-en-${i}" type="text" placeholder="EN เช่น Original" .value=${c.en}
              @change=${(e: Event) => this._updateCopy(i, 'en', (e.target as HTMLInputElement).value)} />
          </div>
          <button class="mode-btn copy-remove" title="ลบสำเนา" aria-label="ลบสำเนา ${i + 1}" @click=${() => this._removeCopy(i)}>${icon('close')}</button>
        </div>
      `)}
      <div class="field-row">
        <button class="mode-btn" @click=${this._addCopy}>+ เพิ่มสำเนา</button>
        ${!(this.store.state.copies ?? []).length
          ? html`<span style="font-size:var(--t-sm); color: var(--c-text-muted); align-self:center;">
              default: invoice = ต้นฉบับ+สำเนา, อื่น ๆ = ชุดเดียว</span>`
          : nothing}
      </div>

      <!-- Advanced Layout Controls -->
      <div class="divider"></div>
      <button type="button" class="section-header" aria-expanded=${this._layoutOpen} aria-controls="layout-options" @click=${() => { this._layoutOpen = !this._layoutOpen; }}>
        <span class="collapse-icon ${this._layoutOpen ? 'open' : ''}">${icon('right')}</span>
        <span class="section-title" style="margin-bottom:0"><span>${icon('settings')}</span> ควบคุมเลย์เอาต์</span>
      </button>

      <div id="layout-options" class="section-body" ?hidden=${!this._layoutOpen}>

      <div class="field-row">
        <div class="field">
          <label for="pagination-panel-field-5" title="จำนวนแถวขั้นต่ำบนหน้าแรกหรือหน้าสุดท้าย — กันไม่ให้มีแถวโดดเดี่ยวแถวเดียวตกค้างต้น/ท้ายหน้า">แถวขั้นต่ำกันแถวโดดเดี่ยว</label>
          <input id="pagination-panel-field-5" type="number" .value=${String(this.config.orphanWidowMinRows ?? 2)} min="0" max="10"
            @change=${(e: Event) => this._update('orphanWidowMinRows', Number((e.target as HTMLInputElement).value))} />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="pagination-panel-field-6" title="ควบคุมว่าบล็อกสรุปจะขึ้นหน้าใหม่หรือไม่ — อัตโนมัติ: ขึ้นหน้าใหม่เมื่อพื้นที่ไม่พอ, ขึ้นหน้าใหม่เสมอ: แยกหน้าสรุปเฉพาะ, หน้าเดียวกัน: ไม่ขึ้นหน้าใหม่">การขึ้นหน้าใหม่ของสรุป</label>
          <select id="pagination-panel-field-6" .value=${this.config.summaryBreak ?? 'auto'}
            @change=${(e: Event) => this._update('summaryBreak', (e.target as HTMLSelectElement).value)}>
            <option value="auto">อัตโนมัติ (พอดีหรือขึ้นหน้าใหม่)</option>
            <option value="always">ขึ้นหน้าใหม่เสมอ</option>
            <option value="samePage">หน้าเดียวกันเท่านั้น</option>
          </select>
        </div>
      </div>

      </div>

      <!-- Page Break Controls (v2.2) -->
      <div class="divider"></div>
      <button type="button" class="section-header" aria-expanded=${this._breaksOpen} aria-controls="breaks-options" @click=${() => { this._breaksOpen = !this._breaksOpen; }}>
        <span class="collapse-icon ${this._breaksOpen ? 'open' : ''}">${icon('right')}</span>
        <span class="section-title" style="margin-bottom:0"><span>${icon('minus')}</span> จุดแบ่งหน้า</span>
      </button>

      <div id="breaks-options" class="section-body" ?hidden=${!this._breaksOpen}>

      <div class="field-row">
        <div class="field">
          <label for="pagination-panel-field-7" title="แทรกการขึ้นหน้าใหม่ก่อนแถวที่ระบุ ใช้เลขแถวที่เห็น (1 = แถวข้อมูลแรก) — การแบ่งภายในกลุ่มที่จัดไว้ด้วยกันจะถูกข้าม">บังคับขึ้นหน้าใหม่ก่อนแถวที่ # (เริ่มจาก 1, คั่นด้วยจุลภาค)</label>
          <input id="pagination-panel-field-7" type="text"
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
          <label for="pagination-panel-field-8" title="ฟิลด์ JSON ที่ใช้จัดกลุ่มแถวเข้าด้วยกัน — แถวติดกันที่มีค่าเดียวกันจะไม่ถูกแยกข้ามหน้า">ฟิลด์จัดกลุ่มไม่ให้แยกหน้า</label>
          <select id="pagination-panel-field-8" .value=${this.config.keepTogetherField ?? ''}
            @change=${(e: Event) => this._update('keepTogetherField', (e.target as HTMLSelectElement).value)}>
            <option value="">-- ไม่มี --</option>
            ${this.jsonKeys.map((k) => html`<option value=${k} ?selected=${k === this.config.keepTogetherField}>${k}</option>`)}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="pagination-panel-field-9" title="ควบคุมว่าหน้าใดจะแสดงหัวตาราง — 'หน้าแรกเท่านั้น' ซ่อนในหน้าถัดไป, 'หน้าแรก + หน้าสุดท้าย' แสดงเฉพาะหน้าแรกและหน้าสุดท้าย">โหมดหัวตาราง</label>
          <select id="pagination-panel-field-9" .value=${this.config.headerMode ?? 'all'}
            @change=${(e: Event) => this._update('headerMode', (e.target as HTMLSelectElement).value)}>
            <option value="all">ทุกหน้า</option>
            <option value="firstOnly">หน้าแรกเท่านั้น</option>
            <option value="firstLast">หน้าแรก + หน้าสุดท้าย</option>
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="pagination-panel-field-10" title="ฟิลด์ JSON ที่ใช้ระบุแถวหัวข้อ section — เมื่อมีค่า แถวนั้นจะแสดงเป็นเซลล์รวมเต็มความกว้างตัวหนา">ฟิลด์คั่น section (Column Span)</label>
          <select id="pagination-panel-field-10" .value=${this.config.columnSpanField ?? ''}
            @change=${(e: Event) => this._update('columnSpanField', (e.target as HTMLSelectElement).value)}>
            <option value="">-- None --</option>
            ${this.jsonKeys.map((k) => html`<option value=${k} ?selected=${k === this.config.columnSpanField}>${k}</option>`)}
          </select>
        </div>
      </div>

      ${this.config.columnSpanField ? html`
        <label class="check-item"
          title="พิมพ์แถวรวมย่อยตัวหนาท้ายแต่ละ section (คั่นด้วยแถว Column Span) — รวมเฉพาะคอลัมน์ที่ติ๊ก Section Subtotal ใน column config (#106)">
          <input type="checkbox" .checked=${this.config.sectionSubtotal ?? false}
            @change=${(e: Event) => this._update('sectionSubtotal', (e.target as HTMLInputElement).checked)} />
          แถวรวมย่อยต่อ section (Section Subtotal)
        </label>
        ${this.config.sectionSubtotal ? html`
          <div class="field-row">
            <div class="field">
              <label for="pagination-panel-field-11" title="ข้อความในเซลล์แรกของแถวรวมย่อย (ว่าง = รวม)">ป้ายแถวรวมย่อย (Subtotal Label)</label>
              <input id="pagination-panel-field-11" type="text" placeholder="รวม" .value=${this.config.sectionSubtotalLabel ?? ''}
                @change=${(e: Event) => this._update('sectionSubtotalLabel', (e.target as HTMLInputElement).value)} />
            </div>
          </div>
        ` : ''}
      ` : ''}
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

  private _updatePage(key: 'watermarkText', value: string) {
    this.store.dispatch((draft) => {
      draft.page[key] = value;
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

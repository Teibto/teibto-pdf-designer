/**
 * <pld-data-form>
 * Auto-generated form UI for editing JSON data visually.
 * Renders objects as field groups, arrays as editable tables,
 * and primitives as input fields.
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { isNetSuiteEnv } from '../../services/netsuite-adapter.service';
import { customElement, property, state } from 'lit/decorators.js';

type JsonData = Record<string, unknown>;
const ARRAY_PAGE_SIZE = 50;
const MAX_VISIBLE_SECTIONS = 20;
const MAX_ARRAY_COLUMNS = 20;
const MAX_FORM_CONTROLS = 1_000;
const MAX_INLINE_SIMPLE_ARRAY_ITEMS = 200;

type RenderBudget = { controls: number };

@customElement('pld-data-form')
export class PldDataForm extends LitElement {
  @property({ type: Object }) jsonData: JsonData | null = null;
  @state() private _arrayPages = new Map<string, number>();

  static styles = css`
    :host {
      display: block;
    }

    /* ─── Group (section) ─── */
    .group {
      padding: 10px 0;
      border-bottom: 1px solid var(--c-border);
    }

    .group:last-child {
      border-bottom: none;
    }

    .group-title {
      font-size: var(--t-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--c-text-muted);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }

    .group-title:hover {
      color: var(--c-text-subtle);
    }

    /* ─── Field rows ─── */
    .row {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
      align-items: center;
    }

    .field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .field label {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      text-transform: capitalize;
    }

    input, textarea {
      padding: 5px 8px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-sm, 4px);
      color: var(--c-text);
      font-size: var(--t-sm);
      font-family: var(--font-mono, monospace);
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }

    input:focus, textarea:focus {
      border-color: var(--c-brand);
    }

    textarea {
      resize: vertical;
      min-height: 40px;
      font-family: inherit;
    }

    /* ─── Array table ─── */
    .array-section {
      overflow-x: auto;
    }

    .array-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--t-sm);
      margin-top: 4px;
    }

    .array-table th {
      padding: 4px 6px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      color: var(--c-text-subtle);
      font-weight: 600;
      text-transform: capitalize;
      text-align: left;
      font-size: var(--t-sm);
      letter-spacing: 0.5px;
      white-space: nowrap;
    }

    .array-table td {
      padding: 2px 3px;
      border: 1px solid var(--c-border);
      vertical-align: top;
    }

    .array-table input {
      padding: 3px 5px;
      font-size: var(--t-sm);
      border: none;
      border-radius: 2px;
      background: transparent;
    }

    .array-table input:focus {
      background: var(--c-bg);
      border: none;
      outline: 1px solid var(--c-brand);
    }

    .row-num {
      color: var(--c-text-muted);
      font-size: var(--t-sm);
      text-align: center;
      width: 24px;
      min-width: 24px;
    }

    .del-btn {
      background: none;
      border: none;
      color: var(--c-text-muted);
      cursor: pointer;
      font-size: var(--t-sm);
      padding: 2px 4px;
      border-radius: 3px;
      transition: all 0.15s;
      line-height: 1;
    }

    .del-btn:hover {
      color: var(--c-danger);
      background: var(--c-danger-soft);
    }

    .array-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
      align-items: center;
    }

    .array-page-status {
      color: var(--c-text-muted);
      font-size: var(--t-sm);
      margin-right: auto;
    }

    .small-btn {
      padding: 3px 10px;
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

    .small-btn:disabled {
      cursor: default;
      opacity: 0.45;
    }

    /* ─── Empty state ─── */
    .empty {
      text-align: center;
      padding: 30px 14px;
      color: var(--c-text-muted);
      font-size: var(--t-sm);
      line-height: 1.6;
    }

    /* ─── Primitive at top level ─── */
    .sample-btn {
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--c-brand);
      background: transparent;
      color: var(--c-brand);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .sample-btn:hover { background: var(--c-brand-soft); }

    .top-field {
      padding: 6px 0;
    }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  /** ขอข้อมูลตัวอย่างจาก engine (#191) — app-shell เป็นคนโหลดเข้า store */
  private _loadSampleData() {
    this.dispatchEvent(new CustomEvent('pld-load-sample-data', { bubbles: true, composed: true }));
  }

  render() {
    if (!this.jsonData || Object.keys(this.jsonData).length === 0) {
      return html`
        <div class="empty">
          ยังไม่ได้โหลดข้อมูล<br />
          ใช้ <strong>${icon('file')} ตัวอย่าง</strong> หรือวาง JSON ในมุมมอง <strong>JSON</strong>
          ${isNetSuiteEnv() ? html`
            <p style="margin-top: 10px;">
              <button class="sample-btn" @click=${this._loadSampleData}>
                ⬇ โหลดข้อมูลตัวอย่างจาก NetSuite
              </button>
            </p>
            <p style="margin-top: 4px; font-size: 11px;">
              ใช้ข้อมูลเอกสารตัวอย่างเพื่อลองเชื่อมช่องข้อมูลและดูผลลัพธ์ โดยไม่ต้องเปิดเอกสารจริง
            </p>
          ` : nothing}
        </div>
      `;
    }

    const entries = Object.entries(this.jsonData);
    const visibleEntries = entries.slice(0, MAX_VISIBLE_SECTIONS);
    const budget: RenderBudget = { controls: MAX_FORM_CONTROLS };

    return html`
      ${visibleEntries.map(([key, value]) => this._renderEntry(key, value, budget))}
      ${entries.length > visibleEntries.length ? this._renderOverflow(
        `${entries.length - visibleEntries.length} more top-level sections`,
      ) : nothing}
    `;
  }

  private _fieldId(...path: (string | number)[]): string {
    return `data-field-${encodeURIComponent(JSON.stringify(path))}`;
  }

  private _renderEntry(key: string, value: unknown, budget: RenderBudget) {
    if (Array.isArray(value)) {
      return this._renderArray(key, value, budget);
    }
    if (value !== null && typeof value === 'object') {
      return this._renderObject(key, value as JsonData, budget);
    }
    return this._renderTopPrimitive(key, value, budget);
  }

  // ═══════════════════════════════════════
  // OBJECT → Field group
  // ═══════════════════════════════════════

  private _renderObject(key: string, obj: JsonData, budget: RenderBudget) {
    const entries = Object.entries(obj);
    const visibleEntries = entries.slice(0, budget.controls);
    budget.controls -= visibleEntries.length;

    return html`
      <div class="group">
        <div class="group-title">
          <span>▸</span> ${this._formatLabel(key)}
        </div>
        ${visibleEntries.map(([subKey, subVal]) => {
          // Keep nested payloads out of the synchronous visual-form path.
          if (subVal !== null && typeof subVal === 'object') {
            const summary = Array.isArray(subVal)
              ? `Array with ${subVal.length} items`
              : `Object with ${Object.keys(subVal as JsonData).length} keys`;
            return html`
              <div class="row">
                <div class="field">
                  <span>${this._formatLabel(subKey)}</span>
                  <div class="empty">${summary} — edit in JSON view</div>
                </div>
              </div>
            `;
          }

          const isLong = typeof subVal === 'string' && subVal.length > 60;

          return html`
            <div class="row">
              <div class="field">
                <label for=${this._fieldId(key, subKey)}>${this._formatLabel(subKey)}</label>
                ${isLong
                  ? html`<textarea id=${this._fieldId(key, subKey)}
                      .value=${String(subVal ?? '')}
                      @change=${(e: Event) =>
                        this._updateField(key, subKey, (e.target as HTMLTextAreaElement).value)}
                    ></textarea>`
                  : html`<input id=${this._fieldId(key, subKey)}
                      type="${typeof subVal === 'number' ? 'number' : 'text'}"
                      .value=${String(subVal ?? '')}
                      @change=${(e: Event) =>
                        this._updateField(key, subKey, this._coerce((e.target as HTMLInputElement).value, subVal))}
                    />`}
              </div>
            </div>
          `;
        })}
        ${entries.length > visibleEntries.length
          ? this._renderOverflow(`${entries.length - visibleEntries.length} more fields`)
          : nothing}
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // ARRAY → Editable table
  // ═══════════════════════════════════════

  private _renderArray(key: string, arr: unknown[], budget: RenderBudget) {
    if (arr.length === 0 || typeof arr[0] !== 'object' || arr[0] === null) {
      if (arr.length > MAX_INLINE_SIMPLE_ARRAY_ITEMS || budget.controls === 0) {
        return html`
          <div class="group">
            <div class="group-title"><span>▸</span> ${this._formatLabel(key)}</div>
            ${this._renderOverflow(`${arr.length} items`)}
          </div>
        `;
      }
      budget.controls -= 1;
      // Simple array or empty — show as comma-separated
      return html`
        <div class="group">
          <div class="group-title"><span>▸</span> ${this._formatLabel(key)}</div>
          <div class="row">
            <div class="field">
              <label for=${this._fieldId(key)}>${this._formatLabel(key)} (${arr.length} items)</label>
              <input id=${this._fieldId(key)}
                type="text"
                .value=${arr.map(String).join(', ')}
                @change=${(e: Event) => this._updateSimpleArray(key, (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        </div>
      `;
    }

    // Array of objects → table
    if (budget.controls === 0) {
      return html`
        <div class="group">
          <div class="group-title"><span>▸</span> ${this._formatLabel(key)}</div>
          ${this._renderOverflow(`${arr.length} rows`)}
        </div>
      `;
    }
    const allColumns = Object.keys(arr[0] as JsonData);
    const columns = allColumns.slice(0, MAX_ARRAY_COLUMNS);
    const pageCount = Math.max(1, Math.ceil(arr.length / ARRAY_PAGE_SIZE));
    const page = Math.min(Math.max(this._arrayPages.get(key) ?? 0, 0), pageCount - 1);
    const start = page * ARRAY_PAGE_SIZE;
    const end = Math.min(start + ARRAY_PAGE_SIZE, arr.length);
    const affordableRows = columns.length === 0
      ? end - start
      : Math.min(end - start, Math.floor(budget.controls / columns.length));
    const visibleRows = arr.slice(start, start + affordableRows);
    budget.controls -= visibleRows.length * columns.length;

    return html`
      <div class="group">
        <div class="group-title">
          <span>▸</span> ${this._formatLabel(key)}
          <span style="font-weight:400; font-size:9px; color:var(--color-text-muted)">(${arr.length})</span>
        </div>
        <div class="array-section">
          <table class="array-table">
            <thead>
              <tr>
                <th class="row-num">#</th>
                ${columns.map((col) => html`<th>${this._formatLabel(col)}</th>`)}
                <th style="width:28px;"></th>
              </tr>
            </thead>
            <tbody>
              ${visibleRows.map((item, localRowIdx) => {
                const rowIdx = start + localRowIdx;
                const row = item as JsonData;
                return html`
                  <tr data-row-index=${rowIdx}>
                    <td class="row-num">${rowIdx + 1}</td>
                    ${columns.map(
                      (col) => html`
                        <td>
                          <input aria-label=${`${this._formatLabel(key)}, แถวที่ ${rowIdx + 1} (row), ${this._formatLabel(col)}`}
                            type="${typeof row[col] === 'number' ? 'number' : 'text'}"
                            .value=${String(row[col] ?? '')}
                            @change=${(e: Event) =>
                              this._updateArrayCell(key, rowIdx, col, this._coerce((e.target as HTMLInputElement).value, row[col]))}
                          />
                        </td>
                      `,
                    )}
                    <td>
                      <button class="del-btn" title="ลบแถว (Remove row)" @click=${() => this._removeArrayRow(key, rowIdx)}>${icon('close')}</button>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
        ${allColumns.length > columns.length
          ? this._renderOverflow(`${allColumns.length - columns.length} คอลัมน์เพิ่มเติม (more columns)`)
          : nothing}
        ${visibleRows.length < end - start
          ? this._renderOverflow(`ซ่อนอีก ${end - start - visibleRows.length} แถว (rows hidden by the visual-form budget)`)
          : nothing}
        <div class="array-actions">
          <button class="small-btn" @click=${() => this._addArrayRow(key, allColumns)}>+ เพิ่มแถว (Add Row)</button>
          ${arr.length > ARRAY_PAGE_SIZE ? html`
            <span class="array-page-status">แถวที่ ${start + 1}–${end} จาก ${arr.length}</span>
            <button
              class="small-btn array-page-prev"
              aria-label="แถวก่อนหน้า (Previous rows)"
              ?disabled=${page === 0}
              @click=${() => this._setArrayPage(key, page - 1, arr.length)}
            >ก่อนหน้า (Previous)</button>
            <button
              class="small-btn array-page-next"
              aria-label="แถวถัดไป (Next rows)"
              ?disabled=${page === pageCount - 1}
              @click=${() => this._setArrayPage(key, page + 1, arr.length)}
            >ถัดไป (Next)</button>
          ` : nothing}
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // TOP-LEVEL PRIMITIVE
  // ═══════════════════════════════════════

  private _renderTopPrimitive(key: string, value: unknown, budget: RenderBudget) {
    if (budget.controls === 0) return this._renderOverflow(this._formatLabel(key));
    budget.controls -= 1;
    return html`
      <div class="group top-field">
        <div class="row">
          <div class="field">
            <label for=${this._fieldId(key)}>${this._formatLabel(key)}</label>
            <input id=${this._fieldId(key)}
              type="${typeof value === 'number' ? 'number' : 'text'}"
              .value=${String(value ?? '')}
              @change=${(e: Event) =>
                this._updateTopLevel(key, this._coerce((e.target as HTMLInputElement).value, value))}
            />
          </div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // UPDATE HANDLERS
  // ═══════════════════════════════════════

  private _updateField(section: string, field: string, value: unknown) {
    if (!this.jsonData) return;
    const current = this.jsonData[section];
    if (!current || typeof current !== 'object' || Array.isArray(current)) return;
    this._emit({
      ...this.jsonData,
      [section]: { ...(current as JsonData), [field]: value },
    });
  }

  private _updateTopLevel(key: string, value: unknown) {
    if (!this.jsonData) return;
    this._emit({ ...this.jsonData, [key]: value });
  }

  private _updateArrayCell(arrayKey: string, rowIdx: number, col: string, value: unknown) {
    if (!this.jsonData) return;
    const current = this.jsonData[arrayKey];
    if (!Array.isArray(current)) return;
    const currentRow = current[rowIdx];
    if (!currentRow || typeof currentRow !== 'object' || Array.isArray(currentRow)) return;
    const rows = current.slice();
    rows[rowIdx] = { ...(currentRow as JsonData), [col]: value };
    this._emit({ ...this.jsonData, [arrayKey]: rows });
  }

  private _removeArrayRow(arrayKey: string, rowIdx: number) {
    if (!this.jsonData) return;
    const current = this.jsonData[arrayKey];
    if (!Array.isArray(current) || rowIdx < 0 || rowIdx >= current.length) return;
    const rows = current.slice();
    rows.splice(rowIdx, 1);
    this._emit({ ...this.jsonData, [arrayKey]: rows });
  }

  private _addArrayRow(arrayKey: string, columns: string[]) {
    if (!this.jsonData) return;
    const current = this.jsonData[arrayKey];
    if (!Array.isArray(current)) return;

    // Create a new row with empty/default values matching existing column types
    const template = current.length > 0 && current[0] && typeof current[0] === 'object'
      ? current[0] as JsonData
      : null;
    const newRow: JsonData = {};
    for (const col of columns) {
      if (template && typeof template[col] === 'number') {
        newRow[col] = 0;
      } else {
        newRow[col] = '';
      }
    }
    this._emit({ ...this.jsonData, [arrayKey]: [...current, newRow] });
  }

  private _updateSimpleArray(key: string, value: string) {
    if (!this.jsonData) return;
    this._emit({
      ...this.jsonData,
      [key]: value.split(',').map((s) => s.trim()).filter(Boolean),
    });
  }

  private _setArrayPage(key: string, requestedPage: number, rowCount: number) {
    const lastPage = Math.max(0, Math.ceil(rowCount / ARRAY_PAGE_SIZE) - 1);
    const page = Math.min(Math.max(requestedPage, 0), lastPage);
    if ((this._arrayPages.get(key) ?? 0) === page) return;
    const pages = new Map(this._arrayPages);
    pages.set(key, page);
    this._arrayPages = pages;
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  private _renderOverflow(label: string) {
    return html`<div class="empty form-overflow">${label} — use JSON view to inspect or edit the complete data</div>`;
  }

  /** Convert camelCase/snake_case to readable label */
  private _formatLabel(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  /** Preserve original type when editing */
  private _coerce(inputValue: string, originalValue: unknown): unknown {
    if (typeof originalValue === 'number') {
      const n = Number(inputValue);
      return isNaN(n) ? 0 : n;
    }
    return inputValue;
  }

  private _emit(data: JsonData) {
    this.dispatchEvent(
      new CustomEvent('data-changed', {
        detail: data,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-data-form': PldDataForm;
  }
}

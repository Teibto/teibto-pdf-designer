/**
 * <pld-data-form>
 * Auto-generated form UI for editing JSON data visually.
 * Renders objects as field groups, arrays as editable tables,
 * and primitives as input fields.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

type JsonData = Record<string, unknown>;

@customElement('pld-data-form')
export class PldDataForm extends LitElement {
  @property({ type: Object }) jsonData: JsonData | null = null;

  static styles = css`
    :host {
      display: block;
    }

    /* ─── Group (section) ─── */
    .group {
      padding: 10px 0;
      border-bottom: 1px solid var(--color-border, #2a2c3a);
    }

    .group:last-child {
      border-bottom: none;
    }

    .group-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--color-text-muted, #5c5e72);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }

    .group-title:hover {
      color: var(--color-text-dim, #8a8ca0);
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
      font-size: 10px;
      color: var(--color-text-dim, #8a8ca0);
      text-transform: capitalize;
    }

    input, textarea {
      padding: 5px 8px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: var(--radius-sm, 4px);
      color: var(--color-text, #e8e9f0);
      font-size: 11px;
      font-family: var(--font-mono, monospace);
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }

    input:focus, textarea:focus {
      border-color: var(--color-accent, #4f6ef7);
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
      font-size: 10px;
      margin-top: 4px;
    }

    .array-table th {
      padding: 4px 6px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      color: var(--color-text-dim, #8a8ca0);
      font-weight: 600;
      text-transform: capitalize;
      text-align: left;
      font-size: 9px;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }

    .array-table td {
      padding: 2px 3px;
      border: 1px solid var(--color-border, #2a2c3a);
      vertical-align: top;
    }

    .array-table input {
      padding: 3px 5px;
      font-size: 10px;
      border: none;
      border-radius: 2px;
      background: transparent;
    }

    .array-table input:focus {
      background: var(--color-bg-deep, #0a0b10);
      border: none;
      outline: 1px solid var(--color-accent, #4f6ef7);
    }

    .row-num {
      color: var(--color-text-muted, #5c5e72);
      font-size: 9px;
      text-align: center;
      width: 24px;
      min-width: 24px;
    }

    .del-btn {
      background: none;
      border: none;
      color: var(--color-text-muted, #5c5e72);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 3px;
      transition: all 0.15s;
      line-height: 1;
    }

    .del-btn:hover {
      color: var(--color-danger, #ef4444);
      background: rgba(239, 68, 68, 0.1);
    }

    .array-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }

    .small-btn {
      padding: 3px 10px;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
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

    /* ─── Empty state ─── */
    .empty {
      text-align: center;
      padding: 30px 14px;
      color: var(--color-text-muted, #5c5e72);
      font-size: 11px;
      line-height: 1.6;
    }

    /* ─── Primitive at top level ─── */
    .top-field {
      padding: 6px 0;
    }
  `;

  render() {
    if (!this.jsonData || Object.keys(this.jsonData).length === 0) {
      return html`
        <div class="empty">
          ยังไม่ได้โหลดข้อมูล<br />
          ใช้ <strong>★ ตัวอย่าง</strong> หรือวาง JSON ในมุมมอง <strong>JSON</strong>
        </div>
      `;
    }

    const entries = Object.entries(this.jsonData);

    return html`
      ${entries.map(([key, value]) => this._renderEntry(key, value))}
    `;
  }

  private _renderEntry(key: string, value: unknown) {
    if (Array.isArray(value)) {
      return this._renderArray(key, value);
    }
    if (value !== null && typeof value === 'object') {
      return this._renderObject(key, value as JsonData);
    }
    return this._renderTopPrimitive(key, value);
  }

  // ═══════════════════════════════════════
  // OBJECT → Field group
  // ═══════════════════════════════════════

  private _renderObject(key: string, obj: JsonData) {
    const entries = Object.entries(obj);

    return html`
      <div class="group">
        <div class="group-title">
          <span>▸</span> ${this._formatLabel(key)}
        </div>
        ${entries.map(([subKey, subVal]) => {
          // Nested objects/arrays: show as read-only JSON
          if (subVal !== null && typeof subVal === 'object') {
            return html`
              <div class="row">
                <div class="field">
                  <label>${this._formatLabel(subKey)}</label>
                  <textarea
                    readonly
                    .value=${JSON.stringify(subVal, null, 2)}
                    style="min-height: 50px; color: var(--color-text-muted, #5c5e72);"
                  ></textarea>
                </div>
              </div>
            `;
          }

          const isLong = typeof subVal === 'string' && subVal.length > 60;

          return html`
            <div class="row">
              <div class="field">
                <label>${this._formatLabel(subKey)}</label>
                ${isLong
                  ? html`<textarea
                      .value=${String(subVal ?? '')}
                      @change=${(e: Event) =>
                        this._updateField(key, subKey, (e.target as HTMLTextAreaElement).value)}
                    ></textarea>`
                  : html`<input
                      type="${typeof subVal === 'number' ? 'number' : 'text'}"
                      .value=${String(subVal ?? '')}
                      @change=${(e: Event) =>
                        this._updateField(key, subKey, this._coerce((e.target as HTMLInputElement).value, subVal))}
                    />`}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // ARRAY → Editable table
  // ═══════════════════════════════════════

  private _renderArray(key: string, arr: unknown[]) {
    if (arr.length === 0 || typeof arr[0] !== 'object' || arr[0] === null) {
      // Simple array or empty — show as comma-separated
      return html`
        <div class="group">
          <div class="group-title"><span>▸</span> ${this._formatLabel(key)}</div>
          <div class="row">
            <div class="field">
              <label>${arr.length} items</label>
              <input
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
    const columns = Object.keys(arr[0] as JsonData);

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
              ${arr.map((item, rowIdx) => {
                const row = item as JsonData;
                return html`
                  <tr>
                    <td class="row-num">${rowIdx + 1}</td>
                    ${columns.map(
                      (col) => html`
                        <td>
                          <input
                            type="${typeof row[col] === 'number' ? 'number' : 'text'}"
                            .value=${String(row[col] ?? '')}
                            @change=${(e: Event) =>
                              this._updateArrayCell(key, rowIdx, col, this._coerce((e.target as HTMLInputElement).value, row[col]))}
                          />
                        </td>
                      `,
                    )}
                    <td>
                      <button class="del-btn" title="Remove row" @click=${() => this._removeArrayRow(key, rowIdx)}>✕</button>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
        <div class="array-actions">
          <button class="small-btn" @click=${() => this._addArrayRow(key, columns)}>+ Add Row</button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // TOP-LEVEL PRIMITIVE
  // ═══════════════════════════════════════

  private _renderTopPrimitive(key: string, value: unknown) {
    return html`
      <div class="group top-field">
        <div class="row">
          <div class="field">
            <label>${this._formatLabel(key)}</label>
            <input
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
    const updated = structuredClone(this.jsonData);
    const obj = updated[section] as JsonData;
    if (obj && typeof obj === 'object') {
      obj[field] = value;
    }
    this._emit(updated);
  }

  private _updateTopLevel(key: string, value: unknown) {
    if (!this.jsonData) return;
    const updated = structuredClone(this.jsonData);
    updated[key] = value;
    this._emit(updated);
  }

  private _updateArrayCell(arrayKey: string, rowIdx: number, col: string, value: unknown) {
    if (!this.jsonData) return;
    const updated = structuredClone(this.jsonData);
    const arr = updated[arrayKey] as JsonData[];
    if (arr && arr[rowIdx]) {
      arr[rowIdx][col] = value;
    }
    this._emit(updated);
  }

  private _removeArrayRow(arrayKey: string, rowIdx: number) {
    if (!this.jsonData) return;
    const updated = structuredClone(this.jsonData);
    const arr = updated[arrayKey] as unknown[];
    if (arr) {
      arr.splice(rowIdx, 1);
    }
    this._emit(updated);
  }

  private _addArrayRow(arrayKey: string, columns: string[]) {
    if (!this.jsonData) return;
    const updated = structuredClone(this.jsonData);
    const arr = updated[arrayKey] as JsonData[];
    if (!arr) return;

    // Create a new row with empty/default values matching existing column types
    const template = arr.length > 0 ? arr[0] : null;
    const newRow: JsonData = {};
    for (const col of columns) {
      if (template && typeof template[col] === 'number') {
        newRow[col] = 0;
      } else {
        newRow[col] = '';
      }
    }
    arr.push(newRow);
    this._emit(updated);
  }

  private _updateSimpleArray(key: string, value: string) {
    if (!this.jsonData) return;
    const updated = structuredClone(this.jsonData);
    updated[key] = value.split(',').map((s) => s.trim()).filter(Boolean);
    this._emit(updated);
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

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

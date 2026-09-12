/**
 * <pld-column-config-modal>
 * Visual table column configuration editor.
 * Features: drag-to-reorder, column properties, format selection,
 * column presets, add/remove columns, and live preview.
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import type { TableColumn, TableElement } from '../../models/element';
import { COLUMN_PRESETS, type ColumnPreset } from '../../constants/column-presets';
import { listRowKeys } from '../../services/binding.service';
import { showToast } from '../shared/toast-notification';
import '../shared/modal';

@customElement('pld-column-config-modal')
export class PldColumnConfigModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;
  @property({ type: String }) elementId = '';

  @state() private columns: TableColumn[] = [];
  @state() private selectedColIdx = -1;
  @state() private showPresets = false;

  // Drag reorder state
  private _dragIdx = -1;

  static styles = css`
    /* ─── Layout ─── */
    .layout {
      display: flex;
      gap: 16px;
      min-height: 450px;
    }

    /* ─── Column List ─── */
    .col-list-area {
      width: 260px;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .col-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .col-list-header h3 {
      font-size: 12px;
      font-weight: 600;
      color: var(--c-text);
      margin: 0;
    }

    .col-list-actions {
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      width: var(--btn-h);
      height: var(--btn-h);
      border: 1px solid var(--c-border);
      border-radius: 5px;
      background: var(--c-surface-2);
      color: var(--c-text-subtle);
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .icon-btn:hover {
      background: var(--c-surface-3);
      color: var(--c-brand);
      border-color: var(--c-brand);
    }

    .col-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .add-col-btn {
      width: 100%;
      margin-top: 6px;
      padding: 8px;
      border: 1px dashed var(--c-border);
      border-radius: 8px;
      background: transparent;
      color: var(--c-text-subtle);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }

    .add-col-btn:hover {
      border-color: var(--c-brand);
      color: var(--c-brand);
      background: var(--c-brand-soft);
    }

    .col-item {
      width: 100%;
      font: inherit;
      text-align: left;
      color: var(--c-text);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--c-surface-2);
      border: 1px solid var(--c-border);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
    }

    .col-item:hover {
      border-color: var(--c-text-muted);
    }

    .col-item.active {
      border-color: var(--c-brand);
      background: var(--c-brand-soft);
    }

    .col-item.drag-over {
      border-color: var(--c-success);
      border-style: dashed;
    }

    .col-item.hidden-col {
      opacity: 0.4;
    }

    .drag-handle {
      cursor: grab;
      color: var(--c-text-muted);
      font-size: var(--t-sm);
      flex-shrink: 0;
    }

    .drag-handle:active {
      cursor: grabbing;
    }

    .col-name {
      flex: 1;
      font-size: 12px;
      color: var(--c-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .col-key {
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      color: var(--c-text-muted);
      padding: 1px 5px;
      background: var(--c-bg);
      border-radius: 3px;
    }

    .col-width-badge {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      min-width: 35px;
      text-align: right;
    }

    /* ─── Properties Panel ─── */
    .props-area {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .props-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--c-text-muted);
      font-size: 12px;
    }

    .props-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--c-text);
      margin-bottom: 14px;
    }

    .prop-group {
      margin-bottom: 16px;
    }

    .prop-group-title {
      font-size: var(--t-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--c-text-muted);
      margin-bottom: 8px;
    }

    .prop-row {
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
    }

    .prop-field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .prop-field label {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
    }

    .prop-field input,
    .prop-field select {
      padding: 6px 8px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 5px;
      color: var(--c-text);
      font-size: 12px;
      font-family: inherit;
      outline: none;
      width: 100%;
    }

    .prop-field input:focus,
    .prop-field select:focus {
      border-color: var(--c-brand);
    }

    .prop-field input[type="number"] {
      font-family: var(--font-mono, monospace);
    }

    /* Checkboxes */
    .check-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 4px;
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      cursor: pointer;
    }

    .check-item input[type="checkbox"] {
      accent-color: var(--c-brand);
      width: 14px;
      height: 14px;
      cursor: pointer;
    }

    /* ─── Presets Panel ─── */
    .presets-overlay {
      position: absolute;
      inset: 0;
      background: var(--c-surface);
      z-index: 10;
      display: flex;
      flex-direction: column;
      padding: 16px;
      border-radius: 12px;
    }

    .presets-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .presets-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--c-text);
      margin: 0;
    }

    .preset-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      overflow-y: auto;
      flex: 1;
    }

    .preset-card {
      padding: 14px;
      background: var(--c-surface-2);
      border: 1px solid var(--c-border);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .preset-card:hover {
      border-color: var(--c-brand);
      background: var(--c-surface-3);
      transform: translateY(-1px);
    }

    .preset-icon {
      font-size: 20px;
      margin-bottom: 6px;
    }

    .preset-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--c-text);
      margin-bottom: 2px;
    }

    .preset-desc {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
    }

    .preset-cols {
      font-size: var(--t-sm);
      color: var(--c-text-muted);
      margin-top: 4px;
      font-family: var(--font-mono, monospace);
    }

    /* ─── Preview ─── */
    .guard-warning {
      margin-top: 6px;
      padding: 6px 8px;
      font-size: var(--t-sm);
      line-height: 1.5;
      color: var(--c-warning);
      background: var(--c-warning-soft);
      border: 1px solid var(--c-warning);
      border-radius: 4px;
    }

    .preview {
      margin-top: 16px;
      overflow-x: auto;
    }

    .preview-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--t-sm);
    }

    .preview-table th {
      background: var(--c-surface-3);
      color: var(--c-text);
      padding: 5px 8px;
      text-align: left;
      border: 0.5px solid var(--c-border);
      font-weight: 600;
    }

    .preview-table td {
      padding: 4px 8px;
      border: 0.5px solid var(--c-border);
      color: var(--c-text-subtle);
    }

    /* ─── Footer buttons ─── */
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
      transition: all 0.15s;
      font-weight: 500;
    }

    .btn:hover {
      background: var(--c-surface-3);
    }

    .btn-primary {
      background: var(--c-brand);
      border-color: var(--c-brand);
      color: var(--c-brand-on);
    }

    .btn.btn-primary:hover {
      background: var(--c-brand-strong);
      color: var(--c-brand-on);
    }

    .btn-danger {
      color: var(--c-danger);
    }

    .btn-danger:hover {
      background: var(--c-danger-soft);
      border-color: var(--c-danger);
    }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  /** Load columns when modal opens */
  updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open && this.elementId) {
      const el = this.store.state.elements.find((e) => e.id === this.elementId) as TableElement | undefined;
      if (el) {
        this.columns = JSON.parse(JSON.stringify(el.columns));
        this.selectedColIdx = this.columns.length > 0 ? 0 : -1;
        this.showPresets = this.columns.length === 0;
      }
    }
  }

  /** Field choices for a column key — keys of the rows in the bound array (#78) */
  private _rowKeys(): string[] {
    const el = this.store.state.elements.find((e) => e.id === this.elementId) as TableElement | undefined;
    return listRowKeys(this.store.state.jsonData, el?.binding);
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="Table Column Configuration"
        size="lg"
        @close=${this._close}
      >
        <div slot="body" style="position: relative;">
          ${this.showPresets ? this._renderPresets() : this._renderEditor()}
        </div>
        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${() => (this.showPresets = !this.showPresets)}>
              ${icon(this.showPresets ? 'left' : 'file')} ${this.showPresets ? 'Back' : 'Presets'}
            </button>
            <button class="btn" @click=${this._close}>Cancel</button>
            <button class="btn btn-primary" @click=${this._apply}>${icon('check')} Apply</button>
          </div>
        </div>
      </pld-modal>
    `;
  }

  // ═══════════════════════════════════════
  // EDITOR VIEW
  // ═══════════════════════════════════════

  private _renderEditor() {
    const selCol = this.selectedColIdx >= 0 ? this.columns[this.selectedColIdx] : null;

    return html`
      <div class="layout">
        <!-- Column List -->
        <div class="col-list-area">
          <div class="col-list-header">
            <h3>Columns (${this.columns.length})</h3>
            <div class="col-list-actions">
              <button class="icon-btn" title="Add Column" aria-label="Add Column" @click=${this._addColumn}>${icon('plus')}</button>
            </div>
          </div>
          <div class="col-list">
            ${this.columns.map((col, i) => html`
              <button type="button" aria-pressed=${i === this.selectedColIdx}
                class="col-item ${i === this.selectedColIdx ? 'active' : ''} ${col.hidden ? 'hidden-col' : ''}"
                draggable="true"
                @click=${() => (this.selectedColIdx = i)}
                @dragstart=${(e: DragEvent) => this._onDragStart(e, i)}
                @dragover=${(e: DragEvent) => this._onDragOver(e, i)}
                @drop=${(e: DragEvent) => this._onDrop(e, i)}
                @dragleave=${(e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drag-over')}
              >
                <span class="drag-handle">${icon('drag')}</span>
                <span class="col-name">${col.label || col.key}</span>
                <span class="col-key">${col.key}</span>
                <span class="col-width-badge">${col.width}px</span>
              </button>
            `)}
            <button class="add-col-btn" @click=${this._addColumn}>${icon('plus')} เพิ่มคอลัมน์</button>
          </div>
        </div>

        <!-- Properties Panel -->
        <div class="props-area">
          ${selCol ? this._renderColumnProps(selCol, this.selectedColIdx) : html`
            <div class="props-empty">เลือกคอลัมน์เพื่อแก้ไขคุณสมบัติ</div>
          `}

          <!-- Live Preview -->
          ${this.columns.length > 0 ? this._renderPreview() : nothing}
        </div>
      </div>
    `;
  }

  private _renderColumnProps(col: TableColumn, idx: number) {
    return html`
      <div class="props-title">Column: ${col.label}</div>

      <!-- Basic -->
      <div class="prop-group">
        <div class="prop-group-title">Basic</div>
        <div class="prop-row">
          <div class="prop-field">
            <label for="column-config-modal-field-1">Key (field name)</label>
            <input id="column-config-modal-field-1" type="text" .value=${col.key} list="pld-row-keys"
              @change=${(e: Event) => this._updateCol(idx, 'key', (e.target as HTMLInputElement).value)} />
            <datalist id="pld-row-keys">
              ${this._rowKeys().map((k) => html`<option value=${k}></option>`)}
            </datalist>
          </div>
          <div class="prop-field">
            <label for="column-config-modal-field-2">Label (header text)</label>
            <input id="column-config-modal-field-2" type="text" .value=${col.label}
              @change=${(e: Event) => this._updateCol(idx, 'label', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="prop-row">
          <div class="prop-field">
            <label for="column-config-modal-field-3">Group — หัวตาราง 2 ชั้น (คอลัมน์ติดกันที่ตั้ง group เดียวกันถูกคร่อมด้วยหัวเดียว)</label>
            <input id="column-config-modal-field-3" type="text" .value=${col.group ?? ''} placeholder="เช่น จำนวนเงิน (เว้นว่าง = ไม่จัดกลุ่ม)"
              @change=${(e: Event) => this._updateCol(idx, 'group', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="prop-row">
          <div class="prop-field">
            <label for="column-config-modal-field-4">Width (px)</label>
            <input id="column-config-modal-field-4" type="number" .value=${String(col.width)} min="20" max="500"
              @change=${(e: Event) => this._updateCol(idx, 'width', Number((e.target as HTMLInputElement).value))} />
          </div>
          <div class="prop-field">
            <label for="column-config-modal-field-5">Align</label>
            <select id="column-config-modal-field-5" .value=${col.align}
              @change=${(e: Event) => this._updateCol(idx, 'align', (e.target as HTMLSelectElement).value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div class="prop-field">
            <label for="column-config-modal-field-6">Format</label>
            <select id="column-config-modal-field-6" .value=${col.format}
              @change=${(e: Event) => this._updateCol(idx, 'format', (e.target as HTMLSelectElement).value)}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="date">Date</option>
              <option value="percent">Percent</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Text Options -->
      <div class="prop-group">
        <div class="prop-group-title">Text Options</div>
        <div class="prop-row">
          <div class="prop-field">
            <label for="column-config-modal-field-7">Overflow</label>
            <select id="column-config-modal-field-7" .value=${col.overflow ?? 'ellipsis'}
              @change=${(e: Event) => this._updateCol(idx, 'overflow', (e.target as HTMLSelectElement).value)}>
              <option value="ellipsis">Ellipsis (…)</option>
              <option value="wrap">Word Wrap</option>
              <option value="clip">Clip (hidden)</option>
            </select>
          </div>
          ${(col.overflow ?? 'ellipsis') === 'wrap' ? html`
            <div class="prop-field">
              <label for="column-config-modal-field-8">Max Lines (0 = unlimited)</label>
              <input id="column-config-modal-field-8" type="number" .value=${String(col.maxLines)} min="0" max="20"
                @change=${(e: Event) => this._updateCol(idx, 'maxLines', Number((e.target as HTMLInputElement).value))} />
            </div>
          ` : ''}
        </div>
        ${(col.format === 'currency' || col.format === 'number') && (col.overflow ?? 'ellipsis') !== 'wrap' ? html`
          <div class="guard-warning">
            ⚠ ตัวเลขที่กว้างเกินคอลัมน์จะถูกตัดหลักท้ายแบบมองไม่เห็นใน PDF
            (BFO ไม่รองรับ ellipsis — overflow:hidden ตัดเงียบ) แนะนำใช้ Word Wrap
            หรือขยายความกว้างคอลัมน์
          </div>
        ` : ''}
        <div class="check-row">
          <label class="check-item">
            <input type="checkbox" .checked=${col.bold}
              @change=${(e: Event) => this._updateCol(idx, 'bold', (e.target as HTMLInputElement).checked)} />
            Bold
          </label>
          <label class="check-item">
            <input type="checkbox" .checked=${col.uppercase}
              @change=${(e: Event) => this._updateCol(idx, 'uppercase', (e.target as HTMLInputElement).checked)} />
            UPPERCASE
          </label>
          <label class="check-item">
            <input type="checkbox" .checked=${col.hidden}
              @change=${(e: Event) => this._updateCol(idx, 'hidden', (e.target as HTMLInputElement).checked)} />
            Hidden
          </label>
          <label class="check-item">
            <input type="checkbox" .checked=${col.isIndex ?? false}
              @change=${(e: Event) => this._updateCol(idx, 'isIndex', (e.target as HTMLInputElement).checked)} />
            Auto Index (#)
          </label>
          <label class="check-item">
            <input type="checkbox" .checked=${col.boldFirstLine ?? false}
              @change=${(e: Event) => this._updateCol(idx, 'boldFirstLine', (e.target as HTMLInputElement).checked)} />
            Bold first line
          </label>
          <label class="check-item"
            title="รวมยอดคอลัมน์นี้ในแถวรวมย่อยท้ายแต่ละ section — มีผลเมื่อเปิด Section Subtotal ใน Pagination panel (#106)">
            <input type="checkbox" .checked=${col.subtotal ?? false}
              @change=${(e: Event) => this._updateCol(idx, 'subtotal', (e.target as HTMLInputElement).checked)} />
            Section Subtotal (Σ)
          </label>
        </div>
      </div>

      <!-- Delete -->
      <div class="prop-group">
        <button class="btn btn-danger" @click=${() => this._removeColumn(idx)}>${icon('close')} Remove Column</button>
      </div>
    `;
  }

  private _renderPreview() {
    const visibleCols = this.columns.filter((c) => !c.hidden);
    if (visibleCols.length === 0) return nothing;

    return html`
      <div class="preview">
        <div class="prop-group-title">Preview</div>
        <table class="preview-table">
          <thead>
            <tr>
              ${visibleCols.map((c) => html`
                <th style="text-align: ${c.align}; width: ${c.width}px;${c.bold ? ' font-weight: 700;' : ''}${c.uppercase ? ' text-transform: uppercase;' : ''}">
                  ${c.label}
                </th>
              `)}
            </tr>
          </thead>
          <tbody>
            ${[1, 2, 3].map((row) => html`
              <tr>
                ${visibleCols.map((c) => html`
                  <td style="text-align: ${c.align};${c.bold ? ' font-weight: 600;' : ''}">
                    ${c.isIndex ? row : `Sample ${row}`}
                  </td>
                `)}
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // PRESETS VIEW
  // ═══════════════════════════════════════

  private _renderPresets() {
    return html`
      <div class="presets-overlay">
        <div class="presets-header">
          <h3>${icon('file')} Column Presets</h3>
          <button class="icon-btn" aria-label="กลับไปตั้งค่าคอลัมน์ (Back to columns)" title="Back to columns" @click=${() => (this.showPresets = false)}>${icon('left')}</button>
        </div>
        <div class="preset-grid">
          ${COLUMN_PRESETS.map((preset) => html`
            <div class="preset-card" @click=${() => this._applyPreset(preset)}>
              <div class="preset-icon">${icon('table', 'lg')}</div>
              <div class="preset-name">${preset.name}</div>
              <div class="preset-desc">${preset.description}</div>
              <div class="preset-cols">${preset.columns.length} columns: ${preset.columns.map((c) => c.key).join(', ')}</div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════

  private _updateCol(idx: number, key: keyof TableColumn, value: unknown) {
    const newCols = [...this.columns];
    newCols[idx] = { ...newCols[idx], [key]: value };
    this.columns = newCols;
  }

  private _addColumn() {
    const newCol: TableColumn = {
      key: `col_${this.columns.length + 1}`,
      label: `Column ${this.columns.length + 1}`,
      width: 100,
      align: 'left',
      format: 'text',
      overflow: 'ellipsis',
      maxLines: 1,
      hidden: false,
      bold: false,
      uppercase: false,
    };
    this.columns = [...this.columns, newCol];
    this.selectedColIdx = this.columns.length - 1;
  }

  private _removeColumn(idx: number) {
    this.columns = this.columns.filter((_, i) => i !== idx);
    if (this.selectedColIdx >= this.columns.length) {
      this.selectedColIdx = this.columns.length - 1;
    }
  }

  private _applyPreset(preset: ColumnPreset) {
    this.columns = JSON.parse(JSON.stringify(preset.columns));
    this.selectedColIdx = 0;
    this.showPresets = false;
    showToast(`Applied preset: ${preset.name}`, 'success');
  }

  // ─── Drag Reorder ───

  private _onDragStart(e: DragEvent, idx: number) {
    this._dragIdx = idx;
    e.dataTransfer?.setData('text/plain', String(idx));
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  private _onDragOver(e: DragEvent, _idx: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add('drag-over');
  }

  private _onDrop(e: DragEvent, dropIdx: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drag-over');

    if (this._dragIdx < 0 || this._dragIdx === dropIdx) return;

    const newCols = [...this.columns];
    const [moved] = newCols.splice(this._dragIdx, 1);
    newCols.splice(dropIdx, 0, moved);

    this.columns = newCols;
    this.selectedColIdx = dropIdx;
    this._dragIdx = -1;
  }

  // ─── Apply & Close ───

  private _apply() {
    if (!this.elementId) return;

    this.store.dispatch((draft) => {
      const el = draft.elements.find((e) => e.id === this.elementId) as TableElement | undefined;
      if (el) {
        el.columns = JSON.parse(JSON.stringify(this.columns));
      }
      draft.template.isDirty = true;
    });

    showToast(`Updated ${this.columns.length} columns`, 'success');
    this._close();
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-column-config-modal': PldColumnConfigModal;
  }
}

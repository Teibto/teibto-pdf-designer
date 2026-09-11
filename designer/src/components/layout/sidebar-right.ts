/**
 * <pld-sidebar-right>
 * Right sidebar showing properties of the selected element.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { updateElement, resizeElement, removeElement, duplicateElement, moveElementToBandByRole } from '../../state/actions';
import type { CanvasElement, TextElement, ImageElement, ShapeElement, LineElement, BarcodeElement, ListElement, TableElement, ElementRoleType } from '../../models/element';
import { ELEMENT_ROLES } from '../../constants/roles';
import { openImagePicker, clearElementImage } from '../../services/image.service';
import { autoDetectColumnsFromStore } from '../../services/column-detect.service';
import { listBindingPaths } from '../../services/binding.service';
import { showToast } from '../shared/toast-notification';

@customElement('pld-sidebar-right')
export class PldSidebarRight extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private selected: CanvasElement | null = null;

  static styles = css`
    :host {
      width: 100%;
      background: var(--c-surface);
      color: var(--c-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow-y: auto;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--c-text-muted);
      font-size: var(--t-sm);
      padding: var(--s-8);
      text-align: center;
      gap: 8px;
    }

    .empty-icon {
      font-size: 32px;
      opacity: 0.3;
    }

    .group {
      padding: var(--s-4);
      border-bottom: 1px solid var(--c-border);
    }

    .group-title {
      font-size: var(--t-sm);
      font-weight: var(--w-bold);
      color: var(--c-text-subtle);
      margin-bottom: var(--s-2);
    }

    .row {
      display: flex;
      gap: var(--s-2);
      margin-bottom: var(--s-2);
      align-items: center;
    }

    .field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--s-1);
    }

    .field label {
      font-size: var(--t-xs);
      color: var(--c-text-subtle);
    }

    input, select {
      box-sizing: border-box;
      min-height: var(--btn-h);
      padding: 0 var(--s-2);
      background: var(--c-surface);
      border: var(--bw-control) solid var(--c-border-control);
      border-radius: var(--r-md);
      color: var(--c-text);
      font-size: var(--t-sm);
      font-family: var(--font-mono);
      outline: none;
      width: 100%;
    }

    input:focus, select:focus {
      border-color: var(--c-brand);
      box-shadow: var(--focus-ring);
    }

    input[type="color"] {
      height: var(--btn-h);
      padding: 2px;
      cursor: pointer;
    }

    select {
      font-family: var(--font-sans);
      cursor: pointer;
    }

    textarea {
      box-sizing: border-box;
      padding: var(--s-2);
      background: var(--c-surface);
      border: var(--bw-control) solid var(--c-border-control);
      border-radius: var(--r-md);
      color: var(--c-text);
      font-size: var(--t-sm);
      font-family: inherit;
      outline: none;
      width: 100%;
      resize: vertical;
      min-height: 60px;
    }

    textarea:focus {
      border-color: var(--c-brand);
      box-shadow: var(--focus-ring);
    }

    /* ─── Role Selector ─── */
    .role-selector {
      display: flex;
      flex-wrap: wrap;
      gap: var(--s-1);
      margin-top: var(--s-2);
    }

    .role-option {
      min-height: var(--btn-h);
      padding: 0 var(--s-2);
      border: 1px solid var(--c-border);
      border-radius: var(--r-pill);
      font: inherit;
      font-size: var(--t-xs);
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--c-surface-2);
      color: var(--c-text-subtle);
    }

    .role-option:hover {
      border-color: var(--c-border-control);
      color: var(--c-text);
    }

    .role-option.active {
      border-color: var(--c-brand);
      background: var(--c-brand-soft);
      color: var(--c-brand);
    }

    .role-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    /* ─── Action Buttons ─── */
    .actions {
      display: flex;
      gap: var(--s-2);
    }

    .action-btn {
      flex: 1;
      min-height: var(--btn-h);
      padding: 0 var(--s-2);
      border: 1px solid var(--c-border-control);
      border-radius: var(--r-md);
      background: var(--c-surface);
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      cursor: pointer;
      font-family: inherit;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }

    .action-btn:hover {
      background: var(--c-surface-3);
      color: var(--c-text);
    }

    .action-btn.danger:hover {
      background: var(--c-danger-soft);
      color: var(--c-danger);
      border-color: var(--c-danger);
    }

    /* ─── Binding Tag ─── */
    .binding-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--c-brand-soft);
      border: 1px solid var(--c-brand);
      border-radius: var(--r-md);
      font-size: var(--t-xs);
      color: var(--c-brand);
      font-family: var(--font-mono);
    }

    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    button:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; }
    }
  `;

  private _stateHandler: ((e: Event) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately
    const s = this.store.state;
    this.selected = s.elements.find((el) => el.id === s.selectedId) ?? null;

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      const st = (e as StateChangedEvent).state;
      this.selected = st.elements.find((el) => el.id === st.selectedId) ?? null;
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
    if (!this.selected) {
      return html`
        <div class="empty">
          <div class="empty-icon">◇</div>
          <div>เลือก element<br />เพื่อแก้ไขคุณสมบัติ</div>
        </div>
      `;
    }

    const el = this.selected;

    return html`
      <!-- Element Info -->
      <div class="group">
        <div class="group-title">องค์ประกอบ (Element)</div>
        <div class="row">
          <div class="field">
            <label>ชื่อ (Name)</label>
            <input
              type="text"
              .value=${el.name}
              @change=${(e: Event) => this._update('name', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>ชนิด (Type)</label>
            <input type="text" .value=${el.type} disabled />
          </div>
        </div>
      </div>

      <!-- Size only (#107): x/y are legacy-import fields nothing renders from.
           W/H still size the element's content and the table's declared
           height; band row heights control header/footer macro height. -->
      <div class="group">
        <div class="group-title">ขนาด (Size)</div>
        <div class="row">
          <div class="field">
            <label>ความกว้าง (Width)</label>
            <input type="number" .value=${String(Math.round(el.w))}
              @change=${(e: Event) => this._resize(Number((e.target as HTMLInputElement).value), el.h)} />
          </div>
          <div class="field">
            <label>ความสูง (Height)</label>
            <input type="number" .value=${String(Math.round(el.h))}
              @change=${(e: Event) => this._resize(el.w, Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      </div>

      <!-- Data Binding -->
      <div class="group">
        <div class="group-title">ผูกข้อมูล (Data Binding)</div>
        <div class="row">
          <div class="field">
            <label>ฟิลด์ข้อมูล (JSON Path)</label>
            <input type="text" placeholder="e.g. company.name" list="pld-binding-paths"
              .value=${el.binding ?? ''}
              @change=${(e: Event) => this._update('binding', (e.target as HTMLInputElement).value)} />
            <datalist id="pld-binding-paths">
              ${listBindingPaths(this.store.state.jsonData).map(
                (p) => html`<option value=${p}></option>`,
              )}
            </datalist>
          </div>
        </div>
        ${el.binding ? html`<div class="binding-tag">📎 {{${el.binding}}}</div>` : nothing}
        <div class="row">
          <div class="field">
            <label title="แสดง element นี้เฉพาะเมื่อฟิลด์ที่ระบุมีค่า (#90)">แสดงเมื่อฟิลด์มีค่า</label>
            <input type="text" placeholder="e.g. totals.wht" list="pld-binding-paths"
              .value=${el.visibleIf ?? ''}
              @change=${(e: Event) => this._update('visibleIf', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
      </div>

      <!-- Role -->
      <div class="group">
        <div class="group-title">ส่วนของหน้า (Band)</div>
        <div class="role-selector">
          ${(Object.entries(ELEMENT_ROLES) as [ElementRoleType, typeof ELEMENT_ROLES[ElementRoleType]][]).map(
            ([key, role]) => html`
              <button type="button"
                class="role-option ${el.role === key ? 'active' : ''}"
                aria-pressed=${el.role === key}
                @click=${() => this._setRole(key)}
              >
                <span class="role-dot" style="background: ${role.color}"></span>
                ${role.label}
              </button>
            `,
          )}
        </div>
      </div>

      <!-- Type-specific Properties -->
      ${this._renderTypeProps(el)}

      <!-- Actions -->
      <div class="group">
        <div class="group-title">การจัดการ</div>
        <div class="actions">
          <button class="action-btn" @click=${this._duplicate}>⧉ ทำสำเนา</button>
          <button class="action-btn danger" @click=${this._delete}>✕ ลบ</button>
        </div>
      </div>
    `;
  }

  private _renderTypeProps(el: CanvasElement) {
    switch (el.type) {
      case 'text':
      case 'header':
        return this._renderTextProps(el as TextElement);
      case 'shape':
        return this._renderShapeProps(el as ShapeElement);
      case 'image':
        return this._renderImageProps(el as ImageElement);
      case 'line':
        return this._renderLineProps(el as LineElement);
      case 'table':
        return this._renderTableProps(el as TableElement);
      case 'barcode':
        return this._renderBarcodeProps(el as BarcodeElement);
      case 'list':
        return this._renderListProps(el as ListElement);
      default:
        return nothing;
    }
  }

  private _renderTextProps(el: TextElement) {
    return html`
      <div class="group">
        <div class="group-title">รูปแบบข้อความ (Text Style)</div>
        <div class="row">
          <div class="field">
            <label>เนื้อหา (Content)</label>
            <textarea
              .value=${el.content}
              @change=${(e: Event) => this._update('content', (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>ขนาดตัวอักษร (Font Size)</label>
            <input type="number" .value=${String(el.fontSize)} min="6" max="72"
              @change=${(e: Event) => this._update('fontSize', Number((e.target as HTMLInputElement).value))} />
          </div>
          <div class="field">
            <label>น้ำหนัก (Weight)</label>
            <select .value=${el.fontWeight}
              @change=${(e: Event) => this._update('fontWeight', (e.target as HTMLSelectElement).value)}>
              <option value="normal">ปกติ</option>
              <option value="bold">หนา</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>สี (Color)</label>
            <input type="color" .value=${el.color}
              @input=${(e: Event) => this._update('color', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label>จัดแนว (Align)</label>
            <select .value=${el.textAlign}
              @change=${(e: Event) => this._update('textAlign', (e.target as HTMLSelectElement).value)}>
              <option value="left">ซ้าย</option>
              <option value="center">กึ่งกลาง</option>
              <option value="right">ขวา</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  private _renderImageProps(el: ImageElement) {
    return html`
      <div class="group">
        <div class="group-title">รูปภาพ (Image)</div>
        <!-- Upload/Clear buttons -->
        <div class="row">
          <button class="action-btn primary" style="flex:1" @click=${() => openImagePicker(this.store, el.id)}>
            ${el.imageData ? '⟳ เปลี่ยนรูป' : '⬆ อัปโหลดรูป'}
          </button>
          ${el.imageData
            ? html`<button class="action-btn danger" @click=${() => clearElementImage(this.store, el.id)}>✕</button>`
            : nothing
          }
        </div>
        <!-- Image Preview -->
        ${el.imageData
          ? html`
            <div style="margin-top:8px; border:1px solid var(--color-border); border-radius:var(--radius-sm); overflow:hidden; max-height:120px;">
              <img src="${el.imageData}" style="width:100%; height:auto; display:block; object-fit:contain;" />
            </div>
          `
          : nothing
        }
        <!-- URL -->
        <label class="field-label">ที่อยู่รูปภาพ (Image URL)</label>
        <input class="field-input" type="text" .value=${el.src ?? ''} placeholder="https://..."
          @change=${(e: Event) => this._update('src', (e.target as HTMLInputElement).value)} />
        <!-- Object Fit — BFO ignores object-fit (truth table); screen-only (#50) -->
        <label class="field-label" title="มีผลเฉพาะบนจอออกแบบ — BFO/PDF ไม่รองรับ object-fit (ภาพใน PDF ยืดตามกรอบเสมอ)">โหมดจัดรูป (Fit Mode) — จอเท่านั้น</label>
        <select class="field-select"
          .value=${el.objectFit}
          @change=${(e: Event) => this._update('objectFit', (e.target as HTMLSelectElement).value)}>
          <option value="contain">พอดีกรอบ (Contain)</option>
          <option value="cover">เต็มกรอบ (Cover)</option>
          <option value="fill">ยืดเต็ม (Fill)</option>
        </select>
      </div>
    `;
  }

  private _renderShapeProps(el: ShapeElement) {
    return html`
      <div class="group">
        <div class="group-title">รูปแบบรูปทรง (Shape Style)</div>
        <div class="row">
          <div class="field">
            <label>พื้นหลัง (Background)</label>
            <input type="color" .value=${el.bgColor}
              @input=${(e: Event) => this._update('bgColor', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label>ความโค้งมุม (Radius)</label>
            <input type="number" .value=${String(el.borderRadius)} min="0" max="200"
              @change=${(e: Event) => this._update('borderRadius', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>ความทึบ (Opacity)</label>
            <input type="number" .value=${String(el.opacity)} min="0" max="1" step="0.1"
              @change=${(e: Event) => this._update('opacity', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      </div>
    `;
  }

  private _renderLineProps(el: LineElement) {
    return html`
      <div class="group">
        <div class="group-title">รูปแบบเส้น (Line Style)</div>
        <div class="row">
          <div class="field">
            <label>สี (Color)</label>
            <input type="color" .value=${el.lineColor}
              @input=${(e: Event) => this._update('lineColor', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label>ความหนา (Width)</label>
            <input type="number" .value=${String(el.lineWidth)} min="0.5" max="10" step="0.5"
              @change=${(e: Event) => this._update('lineWidth', Number((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      </div>
    `;
  }

  private _renderTableProps(el: TableElement) {
    return html`
      <div class="group">
        <div class="group-title">ตาราง (Table)</div>
        <div class="row">
          <div class="field">
            <label>คอลัมน์: ${el.columns.length}</label>
            <button class="action-btn"
              @click=${() => this.dispatchEvent(new CustomEvent('pld-open-column-config', {
                detail: { elementId: el.id }, bubbles: true, composed: true,
              }))}>
              ⚙ ตั้งค่าคอลัมน์
            </button>
          </div>
        </div>
        <div class="row">
          <button class="action-btn" style="flex:1" @click=${() => this._autoDetectColumns(el.id)}>
            🔍 ตรวจจับคอลัมน์จากข้อมูล
          </button>
        </div>
        <div class="row">
          <div class="field">
            <label>สีพื้นหัวตาราง (Header Bg)</label>
            <input type="color" .value=${el.headerBgColor}
              @input=${(e: Event) => this._update('headerBgColor', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label>สีข้อความหัว (Header Text)</label>
            <input type="color" .value=${el.headerTextColor}
              @input=${(e: Event) => this._update('headerTextColor', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label>เส้นขอบ (Border)</label>
            <input type="color" .value=${el.borderColor}
              @input=${(e: Event) => this._update('borderColor', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
      </div>
    `;
  }

  private _renderBarcodeProps(el: BarcodeElement) {
    return html`
      <div class="group">
        <div class="group-title">บาร์โค้ด (Barcode)</div>
        <div class="row">
          <div class="field">
            <label>ค่า (Value)</label>
            <input type="text" .value=${el.value}
              @change=${(e: Event) => this._update('value', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>ชนิด (Type)</label>
            <select .value=${el.barcodeType}
              @change=${(e: Event) => this._update('barcodeType', (e.target as HTMLSelectElement).value)}>
              <option value="code128">Code 128</option>
              <option value="code39">Code 39</option>
              <option value="ean13">EAN-13</option>
              <option value="qrcode">QR Code</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  private _renderListProps(el: ListElement) {
    return html`
      <div class="group">
        <div class="group-title">รายการ (List)</div>
        <div class="row">
          <div class="field">
            <label>รายการ (Items) — บรรทัดละหนึ่งรายการ</label>
            <textarea
              .value=${el.items.join('\n')}
              @change=${(e: Event) => this._update('items',
                (e.target as HTMLTextAreaElement).value.split('\n').filter(Boolean))}
            ></textarea>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>รูปแบบ (Style)</label>
            <select .value=${el.listStyle}
              @change=${(e: Event) => this._update('listStyle', (e.target as HTMLSelectElement).value)}>
              <option value="bullet">• จุด</option>
              <option value="number">1. ตัวเลข</option>
              <option value="dash">– ขีด</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Helpers ───
  private _update(key: string, value: unknown) {
    if (!this.selected) return;
    updateElement(this.store, this.selected.id, key as any, value as any);
  }

  /**
   * Change the selected element's role (#127). In the band model role == band, so
   * this physically moves the chip to the target band via moveElementToBandByRole
   * — never a bare el.role write (which desyncs role from placement). A role that
   * rejects the element type (acceptance matrix #49) is refused with a toast.
   */
  private _setRole(role: ElementRoleType) {
    if (!this.selected) return;
    const type = this.selected.type;
    const ok = moveElementToBandByRole(this.store, this.selected.id, role);
    if (!ok) {
      showToast(`ย้ายไปส่วน "${ELEMENT_ROLES[role].label}" ไม่ได้ — ไม่รับ element ชนิด ${type} (#49)`, 'warning');
    }
  }

  private _resize(w: number, h: number) {
    if (!this.selected) return;
    resizeElement(this.store, this.selected.id, w, h);
  }

  private _duplicate() {
    if (!this.selected) return;
    duplicateElement(this.store, this.selected.id);
  }

  private _delete() {
    if (!this.selected) return;
    removeElement(this.store, this.selected.id);
  }

  private _autoDetectColumns(elementId: string) {
    const columns = autoDetectColumnsFromStore(this.store, elementId);
    if (columns.length === 0) {
      showToast('No array data found in JSON. Load JSON data first.', 'warning');
      return;
    }
    updateElement(this.store, elementId, 'columns' as any, columns);
    showToast(`Detected ${columns.length} columns from JSON data`, 'success');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-sidebar-right': PldSidebarRight;
  }
}

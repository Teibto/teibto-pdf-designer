/**
 * <pld-save-ns-modal>
 * Save the current design to the NetSuite template custom record (#138).
 *
 * Split out of the BFO export modal so the primary "save to NetSuite" action —
 * including the record type it targets and whether it becomes that type's print
 * default — is reachable straight from the header, not buried under a dev-facing
 * XML export tool. The 💾 button still does a quick save (rectype from context);
 * this dialog is for choosing the record type and setting the print default.
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import { saveTemplateToNetSuite } from '../../services/template.service';
import { getNsContext } from '../../services/netsuite-adapter.service';
import { recordTypeOptions } from '../../constants/record-types';
import { showToast } from '../shared/toast-notification';
import '../shared/modal';

@customElement('pld-save-ns-modal')
export class PldSaveNsModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;

  @state() private recordType = 'transaction';
  // Default on: a template designed from a record is almost always the one Print
  // should use (#70). The Print button loads the rectype default (no tplid).
  @state() private setAsDefault = true;
  @state() private saving = false;

  connectedCallback() {
    super.connectedCallback();
    // Default to the record the designer was opened from (?rectype=… on the
    // Suitelet URL), so a save from an invoice is saved as an invoice template.
    const ctxRectype = getNsContext()?.recordType;
    if (ctxRectype) this.recordType = ctxRectype;
  }

  static styles = css`
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-size: 13px; font-weight: 600; color: var(--color-text, #e8e9f0); }
    select {
      padding: 8px 10px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 6px;
      color: var(--color-text, #e8e9f0);
      font-family: inherit;
      font-size: 13px;
    }
    .check-item { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
    .hint { font-size: 12px; color: var(--color-text-dim, #8a8ca0); line-height: 1.5; }
    .footer-btns { display: flex; gap: 8px; justify-content: flex-end; }
    .btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid var(--color-border, #2a2c3a);
      background: var(--color-bg-hover, #222430); color: var(--color-text, #e8e9f0);
      cursor: pointer; font-size: 13px; font-family: inherit;
    }
    .btn-primary { background: var(--color-accent, #4f6ef7); border-color: var(--color-accent, #4f6ef7); color: #fff; }
    .btn:disabled { opacity: .5; cursor: default; }
  `;

  render() {
    if (!this.open) return nothing;
    return html`
      <pld-modal .open=${this.open} modalTitle="💾 บันทึกเข้า NetSuite" size="md" @close=${this._close}>
        <div slot="body">
          <div class="field">
            <label>NetSuite Record Type</label>
            <select @change=${(e: Event) => { this.recordType = (e.target as HTMLSelectElement).value; }}>
              ${recordTypeOptions(this.recordType).map((rt) => html`
                <option value=${rt.value} ?selected=${rt.value === this.recordType}>${rt.label}</option>
              `)}
            </select>
          </div>
          <div class="field">
            <label class="check-item">
              <input type="checkbox" .checked=${this.setAsDefault}
                @change=${(e: Event) => { this.setAsDefault = (e.target as HTMLInputElement).checked; }} />
              ตั้งเป็น default template ของ record type นี้
            </label>
            <p class="hint">
              ปุ่ม Print PDF บน transaction โหลด default template ของ record type อัตโนมัติ (ไม่ระบุ tplid).
              ปิดถ้าต้องการเก็บเป็นทางเลือกโดยไม่แทนที่ตัวที่พิมพ์อยู่.
            </p>
          </div>
        </div>
        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${this._close} ?disabled=${this.saving}>ยกเลิก</button>
            <button class="btn btn-primary" @click=${this._save} ?disabled=${this.saving}>
              ${this.saving ? 'กำลังบันทึก…' : 'บันทึกเข้า NetSuite'}
            </button>
          </div>
        </div>
      </pld-modal>
    `;
  }

  private async _save() {
    this.saving = true;
    try {
      const { id } = await saveTemplateToNetSuite(this.store, {
        rectype: this.recordType,
        isDefault: this.setAsDefault,
      });
      const defNote = this.setAsDefault ? ` — default ของ ${this.recordType}` : '';
      showToast(`บันทึกเข้า NetSuite แล้ว (ID: ${id})${defNote}`, 'success');
      this._close();
    } catch (err) {
      // Surface the failure — never mask it with a silent local write (R4).
      showToast(`บันทึกเข้า NetSuite ไม่สำเร็จ: ${(err as Error).message}`, 'error');
    } finally {
      this.saving = false;
    }
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-save-ns-modal': PldSaveNsModal;
  }
}

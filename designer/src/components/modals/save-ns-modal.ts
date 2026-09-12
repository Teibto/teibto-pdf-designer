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
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import { saveTemplateToNetSuite } from '../../services/template.service';
import { getNsContext, canEditNsTemplates, READ_ONLY_REASON } from '../../services/netsuite-adapter.service';
import { recordTypeOptions, DEFAULT_RECORD_TYPE } from '../../constants/record-types';
import { showToast } from '../shared/toast-notification';
import '../shared/modal';

@customElement('pld-save-ns-modal')
export class PldSaveNsModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;

  @state() private recordType = DEFAULT_RECORD_TYPE;
  // New designs must opt in before replacing the record type's Print default.
  // Existing NetSuite metadata preserves the saved choice when editing.
  @state() private setAsDefault = false;
  @state() private saving = false;
  @state() private saveError = "";

  protected willUpdate(changed: PropertyValues) {
    if (changed.has('open') && this.open) {
      this.saveError = '';
      const metadata = this.store?.state.template.nsMetadata;
      this.recordType = metadata?.rectype || getNsContext()?.recordType || DEFAULT_RECORD_TYPE;
      this.setAsDefault = metadata?.isDefault ?? false;
    }
  }

  static styles = css`
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-size: 13px; font-weight: 600; color: var(--c-text); }
    select {
      padding: 8px 10px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 6px;
      color: var(--c-text);
      font-family: inherit;
      font-size: 13px;
    }
    .check-item { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
    .hint { font-size: 12px; color: var(--c-text-subtle); line-height: 1.5; }
    .no-default-hint {
      font-size: 12px;
      line-height: 1.5;
      color: var(--c-warning);
      background: var(--c-warning-soft);
      border: 1px solid var(--c-warning);
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 8px;
    }
    .denied-hint {
      font-size: 12px;
      line-height: 1.6;
      color: var(--c-warning);
      background: var(--c-warning-soft);
      border: 1px solid var(--c-warning);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 16px;
    }
    .footer-btns { display: flex; gap: 8px; justify-content: flex-end; }
    .btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid var(--c-border);
      background: var(--c-surface-3); color: var(--c-text);
      cursor: pointer; font-size: 13px; font-family: inherit;
    }
    .btn-primary { background: var(--c-brand); border-color: var(--c-brand); color: var(--c-brand-on); }
    .btn:disabled { opacity: .5; cursor: default; }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  render() {
    if (!this.open) return nothing;
    return html`
      <pld-modal .open=${this.open} modalTitle="บันทึกเข้า NetSuite" size="md" @close=${this._close}>
        <div slot="body">
          ${this.saveError ? html`<p class="denied-hint" role="alert">${this.saveError}</p>` : nothing}
          ${canEditNsTemplates() ? nothing : html`
            <div class="denied-hint">${icon('lock')} ${READ_ONLY_REASON}</div>
          `}
          <div class="field">
            <label for="save-ns-modal-field-1">ประเภทเอกสาร (NetSuite Record Type)</label>
            <select id="save-ns-modal-field-1" aria-label="ประเภทเอกสาร" ?disabled=${this.saving} @change=${(e: Event) => { this.recordType = (e.target as HTMLSelectElement).value; }}>
              ${recordTypeOptions(this.recordType).map((rt) => html`
                <option value=${rt.value} ?selected=${rt.value === this.recordType}>${rt.label}</option>
              `)}
            </select>
            <p class="hint">
              ต้องตรงกับ record type ที่จะกดปุ่ม Print PDF — engine หาเทมเพลตแบบตรงตัว
              เทมเพลตเดียวใช้ข้าม record type ไม่ได้ (#158)
            </p>
          </div>
          <div class="field">
            <label class="check-item">
              <input type="checkbox" ?disabled=${this.saving} .checked=${this.setAsDefault}
                @change=${(e: Event) => { this.setAsDefault = (e.target as HTMLInputElement).checked; }} />
              ตั้งเป็น default template ของ record type นี้
            </label>
            <p class="hint">
              ปุ่ม Print PDF บน transaction โหลด default template ของ record type อัตโนมัติ (ไม่ระบุ tplid).
              ปิดถ้าต้องการเก็บเป็นทางเลือกโดยไม่แทนที่ตัวที่พิมพ์อยู่.
            </p>
            ${!this.setAsDefault ? html`
              <p class="no-default-hint">
                ⚠ ไม่ตั้ง default → ปุ่ม Print จะไม่เลือกเทมเพลตนี้อัตโนมัติ
                (ถ้า record type นี้ยังไม่มี default เลย ปุ่ม Print จะขึ้น "No template found").
              </p>
            ` : nothing}
          </div>
        </div>
        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${this._close} ?disabled=${this.saving}>ยกเลิก</button>
            <button class="btn btn-primary" @click=${this._save}
              ?disabled=${this.saving || !canEditNsTemplates()}>
              ${this.saving ? 'กำลังบันทึก…' : 'บันทึกเข้า NetSuite'}
            </button>
          </div>
        </div>
      </pld-modal>
    `;
  }

  private async _save() {
    if (this.saving) return;
    this.saveError = "";
    this.saving = true;
    try {
      const { id, warning } = await saveTemplateToNetSuite(this.store, {
        rectype: this.recordType,
        isDefault: this.setAsDefault,
      });
      if (warning) {
        this.saveError = `บันทึกแล้ว (ID: ${id}) — ${warning}`;
        return;
      }
      const defNote = this.setAsDefault ? ` — default ของ ${this.recordType}` : '';
      showToast(`บันทึกเข้า NetSuite แล้ว (ID: ${id})${defNote}`, 'success');
      this.saving = false;
      this._close();
    } catch (err) {
      // Surface the failure — never mask it with a silent local write (R4).
      this.saveError = `บันทึกเข้า NetSuite ไม่สำเร็จ: ${(err as Error).message}`;
    } finally {
      this.saving = false;
    }
  }

  private _close() {
    if (this.saving) return;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-save-ns-modal': PldSaveNsModal;
  }
}

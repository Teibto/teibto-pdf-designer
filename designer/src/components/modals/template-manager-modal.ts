/**
 * <pld-template-manager-modal>
 * Template management interface for saving, loading, deleting,
 * importing, and exporting document templates.
 *
 * @author Wichit Wongta
 */
import { icon } from '../shared/icon';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import type { AppState } from '../../state/app-state';
import type { DocumentTemplate } from '../../models/template';
import {
  listTemplates,
  saveTemplate,
  loadTemplate,
  deleteTemplate,
  duplicateTemplate,
  exportTemplateJson,
  importTemplateJson,
} from '../../services/template.service';
import {
  isNetSuiteEnv,
  listNsTemplates,
  getNsTemplate,
  duplicateNsTemplate,
  deleteNsTemplate,
  getNsTemplateHistory,
  rollbackNsTemplate,
  canEditNsTemplates,
  READ_ONLY_REASON,
  type NsTemplate,
  type NsTemplateHistory,
} from '../../services/netsuite-adapter.service';
import { elementsToBands } from '../../services/band-layout.service';
import { getSampleTemplates } from '../../constants/sample-templates';
import { clearPaginationCache } from '../../services/pagination.service';
import { showToast } from '../shared/toast-notification';
import { confirmDiscardUnsaved } from '../../utils/unsaved-guard';
import '../shared/modal';

@customElement('pld-template-manager-modal')
export class PldTemplateManagerModal extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Boolean }) open = false;

  @state() private savedTemplates: DocumentTemplate[] = [];
  @state() private sampleTemplates: DocumentTemplate[] = [];
  @state() private nsTemplates: NsTemplate[] = [];
  @state() private activeTab: 'saved' | 'samples' | 'netsuite' | 'import' = 'saved';
  @state() private loading = false;
  @state() private nsLoading = false;
  @state() private importJson = '';
  @state() private importError = '';
  /** เทมเพลตที่กำลังกางประวัติอยู่ (#189) — กางได้ทีละใบ */
  @state() private historyFor: string | null = null;
  @state() private history: NsTemplateHistory | null = null;
  @state() private historyLoading = false;
  private _loadGeneration = 0;

  disconnectedCallback(): void {
    ++this._loadGeneration;
    super.disconnectedCallback();
  }

  static styles = css`
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      padding: 3px;
      background: var(--c-bg);
      border-radius: 8px;
      border: 1px solid var(--c-border);
    }

    .tab {
      flex: 1;
      padding: 8px 12px;
      text-align: center;
      border: none;
      background: transparent;
      color: var(--c-text-subtle);
      font-size: 12px;
      cursor: pointer;
      border-radius: 6px;
      font-family: inherit;
      font-weight: 500;
      transition: all 0.15s;
    }

    .tab.active {
      background: var(--c-brand);
      color: var(--c-brand-on);
    }

    .tab:hover:not(.active) {
      background: var(--c-surface-3);
      color: var(--c-text);
    }

    .template-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      max-height: 400px;
      overflow-y: auto;
    }

    .template-card {
      padding: 16px;
      background: var(--c-surface-2);
      border: 1px solid var(--c-border);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }

    .template-card:hover {
      border-color: var(--c-brand);
      transform: translateY(-1px);
      box-shadow: var(--sh-md);
    }

    .tpl-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--c-text);
      margin-bottom: 4px;
    }

    .tpl-meta {
      font-size: var(--t-sm);
      color: var(--c-text-muted);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tpl-elements {
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      margin-top: 6px;
    }

    .tpl-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }

    .tpl-btn {
      padding: 4px 10px;
      border: 1px solid var(--c-border);
      border-radius: 4px;
      background: var(--c-bg);
      color: var(--c-text-subtle);
      font-size: var(--t-sm);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .tpl-btn:hover {
      background: var(--c-surface-3);
      color: var(--c-text);
    }

    .tpl-btn.danger:hover {
      color: var(--c-danger);
      border-color: var(--c-danger);
    }

    .tpl-btn.primary {
      background: var(--c-brand);
      border-color: var(--c-brand);
      color: var(--c-brand-on);
    }

    /* ─── Import Panel ─── */
    .import-area {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .import-area textarea {
      box-sizing: border-box;
      max-width: 100%;
      width: 100%;
      min-height: 250px;
      background: var(--c-bg);
      border: 1px solid var(--c-border);
      border-radius: 8px;
      color: var(--c-success);
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      line-height: 1.6;
      padding: 12px;
      resize: vertical;
      outline: none;
      tab-size: 2;
    }

    .import-area textarea:focus {
      border-color: var(--c-brand);
    }

    .import-error { color: var(--c-danger); background: var(--c-danger-soft); border: 1px solid var(--c-danger); border-radius: var(--r-md); padding: var(--s-3); font-size: var(--t-sm); white-space: pre-wrap; overflow-wrap: anywhere; }

    .import-actions {
      flex-wrap: wrap;
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
      font-weight: 500;
      transition: all 0.15s;
    }

    .btn:hover {
      background: var(--c-surface-3);
    }

    .btn-primary {
      background: var(--c-brand);
      border-color: var(--c-brand);
      color: var(--c-brand-on);
    }

    .btn.btn-primary:hover { background: var(--c-brand-strong); color: var(--c-brand-on); }

    .empty-msg {
      text-align: center;
      padding: 40px;
      color: var(--c-text-muted);
      font-size: 12px;
    }

    .footer-btns {
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }

    .tpl-btn:disabled,
    .tpl-btn:disabled:hover {
      opacity: 0.4;
      cursor: not-allowed;
      background: var(--c-bg);
      color: var(--c-text-subtle);
      border-color: var(--c-border);
    }

    /* ─── Version history (#189) ─── */
    .ns-read-only {
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--c-warning-soft);
      border: 1px solid var(--c-warning);
      border-radius: 8px;
      color: var(--c-warning);
      font-size: var(--t-sm);
      line-height: 1.5;
    }

    .history {
      margin-top: 10px;
      border-top: 1px solid var(--c-border);
      padding-top: 8px;
    }

    .history-note {
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      margin-bottom: 6px;
      line-height: 1.5;
    }

    .history-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      border-bottom: 1px solid var(--c-bg);
    }

    .history-row .ver {
      font-weight: 600;
      color: var(--c-text);
      min-width: 34px;
    }

    .history-row .who { flex: 1; }
    .history-row .when { white-space: nowrap; }

    .ns-no-default-warning {
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--c-danger-soft);
      border: 1px solid var(--c-danger);
      border-radius: 8px;
      color: var(--c-danger);
      font-size: var(--t-sm);
      line-height: 1.5;
    }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  /** Load templates when modal opens */
  async updated(changed: Map<string, unknown>) {
    if (changed.has('open') && !this.open) {
      ++this._loadGeneration;
    }
    if (changed.has('open') && this.open) {
      this.importError = '';
      await this._refresh();
      this.sampleTemplates = getSampleTemplates();
      if (isNetSuiteEnv()) this._refreshNs();
    }
  }

  private async _refresh() {
    this.loading = true;
    this.savedTemplates = await listTemplates();
    this.loading = false;
  }

  private async _refreshNs() {
    this.nsLoading = true;
    try {
      this.nsTemplates = await listNsTemplates();
    } catch (err) {
      showToast(`โหลดรายชื่อเทมเพลต NetSuite ไม่สำเร็จ: ${(err as Error).message}`, 'error');
    } finally {
      this.nsLoading = false;
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="จัดการเทมเพลต (Template Manager)"
        size="lg"
        @close=${this._close}
      >
        <div slot="body">
          <!-- Tabs -->
          <div class="tabs" role="tablist" aria-label="แหล่งเทมเพลต (Template sources)">
            <button role="tab" id="manager-saved" aria-controls="manager-content" aria-selected=${this.activeTab === 'saved'} tabindex=${this.activeTab === 'saved' ? 0 : -1} @keydown=${this._onTabKeydown} class="tab ${this.activeTab === 'saved' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'saved')}>
              ${icon('save')} ที่บันทึกไว้ (Saved) (${this.savedTemplates.length})
            </button>
            <button role="tab" id="manager-samples" aria-controls="manager-content" aria-selected=${this.activeTab === 'samples'} tabindex=${this.activeTab === 'samples' ? 0 : -1} @keydown=${this._onTabKeydown} class="tab ${this.activeTab === 'samples' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'samples')}>
              ${icon('file')} ตัวอย่าง (Samples)
            </button>
            ${isNetSuiteEnv() ? html`
              <button role="tab" id="manager-netsuite" aria-controls="manager-content" aria-selected=${this.activeTab === 'netsuite'} tabindex=${this.activeTab === 'netsuite' ? 0 : -1} @keydown=${this._onTabKeydown} class="tab ${this.activeTab === 'netsuite' ? 'active' : ''}"
                @click=${() => (this.activeTab = 'netsuite')}>
                ${icon('database')} NetSuite (${this.nsTemplates.length})
              </button>
            ` : nothing}
            <button role="tab" id="manager-import" aria-controls="manager-content" aria-selected=${this.activeTab === 'import'} tabindex=${this.activeTab === 'import' ? 0 : -1} @keydown=${this._onTabKeydown} class="tab ${this.activeTab === 'import' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'import')}>
              ${icon('upload')} นำเข้า/ส่งออก (Import / Export)
            </button>
          </div>

          <div id="manager-content" role="tabpanel" aria-labelledby="manager-${this.activeTab}">
          ${this.activeTab === 'saved' ? (this.loading ? html`<p style="text-align:center;padding:24px;color:var(--color-text-muted)">กำลังโหลด…</p>` : this._renderSaved()) : nothing}
          ${this.activeTab === 'samples' ? this._renderSamples() : nothing}
          ${this.activeTab === 'netsuite' ? (this.nsLoading ? html`<p style="text-align:center;padding:24px;color:var(--color-text-muted)">กำลังโหลด…</p>` : this._renderNetsuite()) : nothing}
          ${this.activeTab === 'import' ? this._renderImportExport() : nothing}
          </div>
        </div>

        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${this._saveCurrentTemplate}>${icon('save')} บันทึกงานปัจจุบัน (Save Current)</button>
            <button class="btn" @click=${this._close}>ปิด (Close)</button>
          </div>
        </div>
      </pld-modal>
    `;
  }

  private _onTabKeydown(event: KeyboardEvent) {
    const tabs = ['saved', 'samples', ...(isNetSuiteEnv() ? ['netsuite'] : []), 'import'] as const;
    const current = tabs.indexOf(this.activeTab);
    let index: number;
    if (event.key === 'ArrowRight') index = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation();
    this.activeTab = tabs[index] as typeof this.activeTab;
    void this.updateComplete.then(() => this.shadowRoot?.getElementById(`manager-${this.activeTab}`)?.focus());
  }

  private _renderSaved() {
    if (this.savedTemplates.length === 0) {
      return html`<div class="empty-msg">ยังไม่มีเทมเพลตที่บันทึกไว้<br />บันทึกงานปัจจุบัน หรือโหลดเทมเพลตตัวอย่าง</div>`;
    }

    return html`
      <div class="template-grid">
        ${this.savedTemplates.map((tpl) => html`
          <div class="template-card">
            <div class="tpl-name">${tpl.name}</div>
            <div class="tpl-meta">
              <span>กระดาษ: ${tpl.page.size} ${tpl.page.orientation}</span>
              <span>แก้ไขล่าสุด: ${new Date(tpl.updatedAt).toLocaleDateString()}</span>
            </div>
            <div class="tpl-elements">${tpl.elements.length} องค์ประกอบ</div>
            <div class="tpl-actions">
              <button class="tpl-btn primary" @click=${() => this._loadTemplate(tpl.id)}>เปิด (Load)</button>
              <button class="tpl-btn" @click=${() => this._duplicateTemplate(tpl.id)}>ทำสำเนา (Duplicate)</button>
              <button class="tpl-btn" @click=${() => this._exportSingle(tpl)}>ส่งออก (Export)</button>
              <button class="tpl-btn danger" @click=${() => this._deleteTemplate(tpl.id, tpl.name)}>ลบ (Delete)</button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private _renderSamples() {
    return html`
      <div class="template-grid">
        ${this.sampleTemplates.map((tpl) => html`
          <div class="template-card" @click=${() => this._loadSample(tpl)}>
            <div class="tpl-name">${tpl.name}</div>
            <div class="tpl-meta">
              <span>กระดาษ: ${tpl.page.size} ${tpl.page.orientation}</span>
            </div>
            <div class="tpl-elements">${tpl.elements.length} องค์ประกอบ • มีข้อมูลตัวอย่าง (Includes sample data)</div>
            <div class="tpl-actions">
              <button class="tpl-btn primary">เปิด (Load)</button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  /**
   * Record types present in the loaded NS list that have NO row flagged as
   * default (#142 root cause — Print for that record type throws "No template
   * found"). Purely a client-side view of the currently loaded list; a rectype
   * with zero templates at all never shows here (nothing to warn about from
   * this modal) — only ones that HAVE templates but none marked default.
   */
  private _rectypesMissingDefault(): string[] {
    const byRectype = new Map<string, boolean>();
    for (const tpl of this.nsTemplates) {
      const rt = tpl.rectype || '';
      if (!rt) continue;
      byRectype.set(rt, byRectype.get(rt) || tpl.isDefault);
    }
    return [...byRectype.entries()].filter(([, hasDefault]) => !hasDefault).map(([rt]) => rt);
  }

  private _renderNetsuite() {
    if (this.nsTemplates.length === 0) {
      return html`<div class="empty-msg">ยังไม่มีเทมเพลตที่บันทึกใน NetSuite<br />ใช้ "บันทึกเข้า NetSuite" ในกล่อง BFO Export</div>`;
    }

    const missingDefault = this._rectypesMissingDefault();
    const readOnly = !canEditNsTemplates();

    return html`
      ${readOnly ? html`<div class="ns-read-only">${icon('lock')} ${READ_ONLY_REASON}</div>` : nothing}
      ${missingDefault.length > 0 ? html`
        <div class="ns-no-default-warning">
          ⚠ ไม่มีเทมเพลตค่าเริ่มต้น — ${missingDefault.join(', ')}. การพิมพ์${missingDefault.length > 1 ? 'ประเภทเอกสารเหล่านี้' : 'ประเภทเอกสารนี้'}จะล้มเหลวด้วย "No template found" จนกว่าจะตั้งค่าเริ่มต้น
        </div>
      ` : nothing}
      <div class="template-grid">
        ${this.nsTemplates.map((tpl) => html`
          <div class="template-card">
            <div class="tpl-name">${tpl.isDefault ? html`<span title="ค่าเริ่มต้น (Default)">${icon('check')}</span>` : nothing}${tpl.name}</div>
            <div class="tpl-meta">
              <span>ประเภทเอกสาร: ${tpl.rectype || '—'}${tpl.isDefault ? ' (ค่าเริ่มต้น)' : ''}</span>
              <span>แก้ไขล่าสุด: ${tpl.modified}</span>
            </div>
            <div class="tpl-elements">NetSuite ID: ${tpl.id}</div>
            <div class="tpl-actions">
              <button class="tpl-btn primary" @click=${() => this._loadNsTemplate(tpl.id)}>เปิด (Load)</button>
              <button class="tpl-btn" ?disabled=${readOnly}
                title=${readOnly ? READ_ONLY_REASON : 'สร้างสำเนาใน NetSuite'}
                @click=${() => this._duplicateNsTemplate(tpl.id)}>ทำสำเนา (Duplicate)</button>
              <button class="tpl-btn" @click=${() => this._toggleHistory(tpl.id)}>
                ${icon('clock')} ${this.historyFor === tpl.id ? 'ปิดประวัติ' : 'ประวัติ'}
              </button>
              <button class="tpl-btn danger" ?disabled=${readOnly}
                title=${readOnly ? READ_ONLY_REASON : 'ลบเทมเพลตนี้ออกจาก NetSuite'}
                @click=${() => this._deleteNsTemplate(tpl.id, tpl.name)}>ลบ (Delete)</button>
            </div>
            ${this.historyFor === tpl.id ? this._renderHistory(readOnly) : nothing}
          </div>
        `)}
      </div>
    `;
  }

  /** คำอธิบายไทยของ action ที่ engine บันทึกไว้ (#189) */
  private static readonly ACTION_LABELS: Record<string, string> = {
    create: 'สร้าง',
    update: 'แก้ไข',
    rollback: 'กู้คืน',
    'delete': 'ลบ',
    baseline: 'สถานะก่อนเริ่มเก็บประวัติ',
  };

  /**
   * ประวัติการแก้ของเทมเพลตหนึ่งใบ (#189) — ใคร role ไหน ทำอะไร เมื่อไหร่ พร้อมปุ่มกู้คืน
   * เวอร์ชันที่เนื้อไฟล์ถูกตัดตามโควตาแล้ว (`hasPayload: false`) ยังแสดงเป็นร่องรอย
   * แต่กดกู้คืนไม่ได้ — บอกตรง ๆ ดีกว่าปล่อยให้กดแล้วเจอ error
   */
  private _renderHistory(readOnly: boolean) {
    if (this.historyLoading) {
      return html`<div class="history"><div class="history-note">กำลังโหลดประวัติ…</div></div>`;
    }
    if (!this.history) return nothing;
    if (this.history.versions.length === 0) {
      return html`
        <div class="history">
          <div class="history-note">ยังไม่มีประวัติ — เวอร์ชันแรกจะถูกบันทึกตอนกดบันทึกครั้งถัดไป</div>
        </div>
      `;
    }

    return html`
      <div class="history">
        <div class="history-note">
          เก็บเนื้อไฟล์ไว้ ${this.history.keepPayload} เวอร์ชันล่าสุด — ที่เก่ากว่านั้นยังเห็นว่าใครแก้เมื่อไหร่ แต่กู้คืนไม่ได้
        </div>
        ${this.history.versions.map((v) => html`
          <div class="history-row">
            <span class="ver">v${v.version}</span>
            <span class="who">
              ${PldTemplateManagerModal.ACTION_LABELS[v.action] ?? v.action}
              · ${v.userName || `user ${v.userId}`} (role ${v.roleId})
              ${v.note ? html`· ${v.note}` : nothing}
            </span>
            <span class="when">${v.created}</span>
            <button class="tpl-btn" ?disabled=${readOnly || !v.hasPayload}
              title=${!v.hasPayload
                ? 'เนื้อไฟล์ของเวอร์ชันนี้ถูกตัดตามโควตาแล้ว กู้คืนไม่ได้'
                : readOnly ? READ_ONLY_REASON : 'เขียนเนื้อของเวอร์ชันนี้กลับเป็นเวอร์ชันใหม่'}
              @click=${() => this._rollbackNs(v.version)}>กู้คืน</button>
          </div>
        `)}
      </div>
    `;
  }

  private async _toggleHistory(id: string) {
    if (this.historyFor === id) {
      this.historyFor = null;
      this.history = null;
      return;
    }
    this.historyFor = id;
    this.history = null;
    this.historyLoading = true;
    try {
      this.history = await getNsTemplateHistory(id);
    } catch (err) {
      this.historyFor = null;
      showToast(`โหลดประวัติไม่สำเร็จ: ${(err as Error).message}`, 'error');
    } finally {
      this.historyLoading = false;
    }
  }

  /**
   * กู้เทมเพลตกลับไปเวอร์ชันที่เลือก (#189). Server เขียนเป็นเวอร์ชันใหม่เสมอ จึงย้อน
   * ของย้อนได้ · ถ้าเทมเพลตถูกลบไปแล้ว จะได้ record ใหม่ที่ **ไม่ใช่** default ของ
   * record type นั้น — ต้องบอกผู้ใช้ ไม่งั้นเขาจะคิดว่าปุ่ม Print กลับมาทำงานแล้ว
   */
  private async _rollbackNs(version: number) {
    const id = this.historyFor;
    if (!id) return;
    if (!confirm(`กู้เทมเพลตกลับไปเวอร์ชัน ${version}? ระบบจะบันทึกเป็นเวอร์ชันใหม่ ประวัติเดิมไม่หาย`)) return;

    try {
      const res = await rollbackNsTemplate(id, version);
      await this._refreshNs();
      this.history = await getNsTemplateHistory(res.recreated ? res.id : id);
      if (res.recreated) this.historyFor = res.id;
      showToast(`กู้คืนเวอร์ชัน ${version} แล้ว — บันทึกเป็นเวอร์ชัน ${res.version}`, 'success');
      if (res.recreated) {
        showToast(
          `เทมเพลตถูกลบไปก่อนหน้านี้ จึงถูกสร้างกลับมาเป็น ID ${res.id} และ **ยังไม่ใช่ default** — ตั้งค่าเริ่มต้นก่อนจึงจะกด Print ได้`,
          'warning',
        );
      }
    } catch (err) {
      showToast(`กู้คืนไม่สำเร็จ: ${(err as Error).message}`, 'error');
    }
  }

  private _renderImportExport() {
    return html`
      <div class="import-area">
        <label for="template-import-json" style="display:block; font-size: var(--t-sm); color: var(--c-text); margin-bottom: var(--s-1);">
          Template JSON / JSON เทมเพลต
        </label>
        <p id="template-import-help" style="font-size: var(--t-sm); color: var(--c-text-subtle); margin-bottom: var(--s-2);">
          วาง JSON เทมเพลตเพื่อนำเข้า หรือส่งออกเทมเพลตปัจจุบัน (Paste template JSON to import, or export current template)
        </p>
        <textarea id="template-import-json" aria-describedby=${this.importError ? 'template-import-help template-import-error' : 'template-import-help'}
          aria-invalid=${this.importError ? 'true' : 'false'}
          placeholder='{"id": "...", "name": "...", "elements": [...]}'
          .value=${this.importJson}
          @input=${(e: Event) => { this.importJson = (e.target as HTMLTextAreaElement).value; this.importError = ''; }}
        ></textarea>
        ${this.importError ? html`<p id="template-import-error" class="import-error" role="alert">${this.importError}</p>` : nothing}
        <div class="import-actions">
          <button class="btn" @click=${this._exportCurrent}>${icon('copy')} ส่งออกปัจจุบันไปคลิปบอร์ด (Export Current to Clipboard)</button>
          <button class="btn btn-primary" @click=${this._importFromJson}>${icon('upload')} นำเข้า JSON (Import JSON)</button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════

  private async _saveCurrentTemplate() {
    try {
      await saveTemplate(this.store);
      await this._refresh();
      showToast('บันทึกเทมเพลตแล้ว (Template saved)', 'success');
    } catch (err) {
      showToast(`บันทึกไม่สำเร็จ: ${err}`, 'error');
    }
  }

  private async _loadTemplate(id: string) {
    const generation = ++this._loadGeneration;
    if (!confirmDiscardUnsaved(this.store)) return;
    const intent = this._captureDocumentIntent(generation);
    try {
      // loadTemplate performs validation/migration and mutates its target store.
      // Stage that work away from the live document so a stale IndexedDB read
      // can be discarded without first overwriting the user's newer intent.
      const staged = new AppStore();
      const { warnings } = await loadTemplate(staged, id);
      if (!this._mayCommitLoad(intent)) return;
      this._commitLoadedState(staged.state);
      showToast('โหลดเทมเพลตแล้ว (Template loaded)', 'success');
      // Surface migration / validation / future-schema warnings instead of
      // discarding them (#145) — the user should know the template changed shape.
      warnings.forEach((w) => showToast(w, 'warning'));
      this._close();
    } catch (err) {
      if (generation !== this._loadGeneration || intent.documentSession !== this.store.documentSession) return;
      showToast(`โหลดไม่สำเร็จ: ${err}`, 'error');
    }
  }

  private _loadSample(tpl: DocumentTemplate) {
    ++this._loadGeneration;
    if (!confirmDiscardUnsaved(this.store)) return;
    this.store.beginDocumentSession();
    clearPaginationCache();
    this.store.dispatch((draft) => {
      draft.editorMode = 'visual';
      draft.rawXml = '';
      draft.elements = structuredClone(tpl.elements);
      // Bands must load with the elements (#113) — band-view does not
      // auto-regenerate, and a later "Save to NetSuite" with empty bands
      // exports an empty body (useBands renders state.bands as-is).
      draft.bands = tpl.bands ? structuredClone(tpl.bands) : elementsToBands(tpl.elements);
      // Same stale-state class: copies from a previously loaded template must
      // not survive into the sample (mirrors loadTemplate semantics).
      draft.copies = tpl.copies ? structuredClone(tpl.copies) : null;
      draft.page = { ...tpl.page };
      draft.pagination = { ...tpl.pagination };
      draft.jsonData = tpl.jsonData ? structuredClone(tpl.jsonData) : null;
      draft.jsonKeys = tpl.jsonData ? Object.keys(tpl.jsonData) : [];
      draft.template.id = null;
      draft.template.name = tpl.name;
      draft.template.isDirty = true;
      draft.selectedId = null;
      draft.multiSelect = [];
      draft.currentPage = 1;
    });
    showToast(`โหลดตัวอย่างแล้ว: ${tpl.name}`, 'success');
    this._close();
  }

  private async _duplicateTemplate(id: string) {
    try {
      const copy = await duplicateTemplate(id);
      await this._refresh();
      showToast(`ทำสำเนาเป็น "${copy.name}" (Duplicated as)`, 'success');
    } catch (err) {
      showToast(`ทำสำเนาไม่สำเร็จ: ${(err as Error).message}`, 'error');
    }
  }

  private async _duplicateNsTemplate(id: string) {
    try {
      const copy = await duplicateNsTemplate(id);
      await this._refreshNs();
      showToast(`ทำสำเนา NetSuite เป็น "${copy.name}" (ID: ${copy.id})`, 'success');
    } catch (err) {
      showToast(`ทำสำเนาไม่สำเร็จ: ${(err as Error).message}`, 'error');
    }
  }

  /**
   * Delete a NetSuite template record (#142). The record type is left with
   * NO default template when the deleted record was its default — the server
   * still deletes it (a user may be removing a broken default on purpose) but
   * flags wasDefault so we can warn: Print for that record type will now fail
   * with "No template found" until a new default is saved.
   */
  private async _deleteNsTemplate(id: string, name: string) {
    if (!confirm(`ลบ "${name}" ออกจาก NetSuite หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้`)) return;
    try {
      const { wasDefault } = await deleteNsTemplate(id);
      await this._refreshNs();
      showToast('ลบออกจาก NetSuite แล้ว (Deleted from NetSuite)', 'info');
      if (wasDefault) {
        showToast(
          `"${name}" เป็นเทมเพลตค่าเริ่มต้น — ประเภทเอกสารนี้ขาดเทมเพลตค่าเริ่มต้น จึงไม่สามารถพิมพ์ได้จนกว่าตั้งค่าเริ่มต้นใหม่`,
          'warning',
        );
      }
    } catch (err) {
      showToast(`ลบไม่สำเร็จ: ${(err as Error).message}`, 'error');
    }
  }

  /**
   * Load a NetSuite template record into the designer. Sets template.id to the
   * NS record id so "Save to NetSuite" overwrites this record instead of
   * creating a new one. Keeps the currently loaded record data (jsonData).
   */
  private async _loadNsTemplate(id: string) {
    const generation = ++this._loadGeneration;
    if (!confirmDiscardUnsaved(this.store)) return;
    const intent = this._captureDocumentIntent(generation);
    try {
      const src = await getNsTemplate(id);
      if (!this._mayCommitLoad(intent)) return;
      let data: Partial<DocumentTemplate> | null = null;
      try {
        data = src.data ? JSON.parse(src.data) : null;
      } catch {
        // Invalid/missing designer JSON is expected for canonical XML records.
      }
      const visual = Array.isArray(data?.elements);
      if (!visual && !src.xml.trim()) {
        throw new Error('Template has no designer data and its canonical XML is empty');
      }

      this.store.beginDocumentSession();
      clearPaginationCache();
      this.store.dispatch((draft) => {
        draft.editorMode = visual ? 'visual' : 'xml';
        draft.rawXml = visual ? '' : src.xml;
        draft.elements = visual ? data!.elements! : [];
        draft.bands = visual ? data!.bands ?? elementsToBands(data!.elements!) : [];
        draft.copies = visual ? data!.copies ?? null : null;
        if (visual && data!.page) draft.page = { ...data!.page };
        if (visual && data!.pagination) draft.pagination = { ...draft.pagination, ...data!.pagination };
        draft.template.nsMetadata = { rectype: src.rectype, isDefault: src.isDefault };
        draft.template.id = src.id;
        draft.template.name = src.name;
        draft.template.isDirty = false;
        draft.selectedId = null;
        draft.multiSelect = [];
        draft.currentPage = 1;
      });
      showToast(
        visual ? `โหลดจาก NetSuite: ${src.name}` : `เปิด canonical XML: ${src.name}`,
        'success',
      );
      this._close();
    } catch (err) {
      if (generation !== this._loadGeneration || intent.documentSession !== this.store.documentSession) return;
      showToast(`โหลดไม่สำเร็จ: ${(err as Error).message}`, 'error');
    }
  }

  private async _deleteTemplate(id: string, name: string) {
    if (!confirm(`ลบ "${name}" หรือไม่?`)) return;
    try {
      await deleteTemplate(id);
      await this._refresh();
      showToast('ลบเทมเพลตแล้ว (Template deleted)', 'info');
    } catch (err) {
      showToast(`ลบไม่สำเร็จ: ${err}`, 'error');
    }
  }

  private _exportCurrent() {
    const json = exportTemplateJson(this.store);
    this.importJson = json;
    this.importError = '';
    navigator.clipboard?.writeText(json);
    showToast('คัดลอก JSON เทมเพลตไปยังคลิปบอร์ดแล้ว (Template JSON copied to clipboard)', 'success');
  }

  private _exportSingle(tpl: DocumentTemplate) {
    const json = JSON.stringify(tpl, null, 2);
    this.importJson = json;
    this.importError = '';
    navigator.clipboard?.writeText(json);
    showToast(`ส่งออก: ${tpl.name}`, 'success');
  }

  private _importFromJson() {
    if (!this.importJson.trim()) {
      this.importError = 'Please paste template JSON first / กรุณาวาง JSON เทมเพลต';
      return;
    }
    if (!confirmDiscardUnsaved(this.store)) return;

    try {
      const { warnings } = importTemplateJson(this.store, this.importJson);
      this.importError = '';
      showToast('นำเข้าเทมเพลตแล้ว (Template imported)', 'success');
      warnings.forEach((w) => showToast(w, 'warning')); // #145 — don't discard
      this._close();
    } catch (err) {
      this.importError = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private _close() {
    ++this._loadGeneration;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private _captureDocumentIntent(generation: number) {
    const state = this.store.state;
    return {
      generation,
      documentSession: this.store.documentSession,
      editorMode: state.editorMode,
      rawXml: state.rawXml,
      elements: state.elements,
      bands: state.bands,
      page: state.page,
      pagination: state.pagination,
      copies: state.copies,
      jsonData: state.jsonData,
      template: state.template,
    };
  }

  private _mayCommitLoad(intent: ReturnType<PldTemplateManagerModal['_captureDocumentIntent']>): boolean {
    if (!this.open) return false;
    if (intent.generation !== this._loadGeneration) return false;
    if (intent.documentSession !== this.store.documentSession) return false;

    const state = this.store.state;
    const unchanged = intent.editorMode === state.editorMode
      && intent.rawXml === state.rawXml
      && intent.elements === state.elements
      && intent.bands === state.bands
      && intent.page === state.page
      && intent.pagination === state.pagination
      && intent.copies === state.copies
      && intent.jsonData === state.jsonData
      && intent.template === state.template;
    // Any newer document mutation is newer intent. Never let an older I/O
    // completion reopen a discard decision and overwrite it.
    return unchanged;
  }

  private _commitLoadedState(source: Readonly<AppState>): void {
    this.store.beginDocumentSession();
    clearPaginationCache();
    this.store.dispatch((draft) => {
      draft.editorMode = source.editorMode;
      draft.rawXml = source.rawXml;
      draft.elements = structuredClone(source.elements);
      draft.bands = structuredClone(source.bands);
      draft.copies = structuredClone(source.copies);
      draft.page = structuredClone(source.page);
      draft.pagination = structuredClone(source.pagination);
      draft.jsonData = structuredClone(source.jsonData);
      draft.jsonKeys = [...source.jsonKeys];
      draft.template = structuredClone(source.template);
      draft.selectedId = null;
      draft.multiSelect = [];
      draft.currentPage = 1;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-template-manager-modal': PldTemplateManagerModal;
  }
}

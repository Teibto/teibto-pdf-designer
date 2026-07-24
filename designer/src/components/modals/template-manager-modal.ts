/**
 * <pld-template-manager-modal>
 * Template management interface for saving, loading, deleting,
 * importing, and exporting document templates.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
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
  type NsTemplate,
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

  static styles = css`
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      padding: 3px;
      background: var(--color-bg-deep, #0a0b10);
      border-radius: 8px;
      border: 1px solid var(--color-border, #2a2c3a);
    }

    .tab {
      flex: 1;
      padding: 8px 12px;
      text-align: center;
      border: none;
      background: transparent;
      color: var(--color-text-dim, #8a8ca0);
      font-size: 12px;
      cursor: pointer;
      border-radius: 6px;
      font-family: inherit;
      font-weight: 500;
      transition: all 0.15s;
    }

    .tab.active {
      background: var(--color-accent, #4f6ef7);
      color: #fff;
    }

    .tab:hover:not(.active) {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
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
      background: var(--color-bg-card, #1a1b25);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }

    .template-card:hover {
      border-color: var(--color-accent, #4f6ef7);
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(79, 110, 247, 0.12);
    }

    .tpl-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text, #e8e9f0);
      margin-bottom: 4px;
    }

    .tpl-meta {
      font-size: 10px;
      color: var(--color-text-muted, #5c5e72);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tpl-elements {
      font-family: var(--font-mono, monospace);
      font-size: 9px;
      color: var(--color-text-dim, #8a8ca0);
      margin-top: 6px;
    }

    .tpl-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }

    .tpl-btn {
      padding: 4px 10px;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      background: var(--color-bg-deep, #0a0b10);
      color: var(--color-text-dim, #8a8ca0);
      font-size: 10px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .tpl-btn:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
    }

    .tpl-btn.danger:hover {
      color: var(--color-danger, #ef4444);
      border-color: var(--color-danger, #ef4444);
    }

    .tpl-btn.primary {
      background: var(--color-accent, #4f6ef7);
      border-color: var(--color-accent, #4f6ef7);
      color: #fff;
    }

    /* ─── Import Panel ─── */
    .import-area {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .import-area textarea {
      width: 100%;
      min-height: 250px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 8px;
      color: var(--color-accent2, #22d3a7);
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      line-height: 1.6;
      padding: 12px;
      resize: vertical;
      outline: none;
      tab-size: 2;
    }

    .import-area textarea:focus {
      border-color: var(--color-accent, #4f6ef7);
    }

    .import-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .btn {
      padding: 7px 16px;
      border-radius: 6px;
      border: 1px solid var(--color-border, #2a2c3a);
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text, #e8e9f0);
      font-size: 12.5px;
      font-family: inherit;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
    }

    .btn:hover {
      background: var(--color-bg-hover, #222430);
    }

    .btn-primary {
      background: var(--color-accent, #4f6ef7);
      border-color: var(--color-accent, #4f6ef7);
      color: #fff;
    }

    .empty-msg {
      text-align: center;
      padding: 40px;
      color: var(--color-text-muted, #5c5e72);
      font-size: 12px;
    }

    .footer-btns {
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }

    .ns-no-default-warning {
      padding: 10px 12px;
      margin-bottom: 10px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--color-danger, #ef4444);
      border-radius: 8px;
      color: var(--color-danger, #ef4444);
      font-size: 11.5px;
      line-height: 1.5;
    }
  `;

  /** Load templates when modal opens */
  async updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
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
      showToast(`Failed to list NetSuite templates: ${(err as Error).message}`, 'error');
    } finally {
      this.nsLoading = false;
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="📁 Template Manager"
        size="lg"
        @close=${this._close}
      >
        <div slot="body">
          <!-- Tabs -->
          <div class="tabs">
            <button class="tab ${this.activeTab === 'saved' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'saved')}>
              💾 Saved (${this.savedTemplates.length})
            </button>
            <button class="tab ${this.activeTab === 'samples' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'samples')}>
              ★ Samples
            </button>
            ${isNetSuiteEnv() ? html`
              <button class="tab ${this.activeTab === 'netsuite' ? 'active' : ''}"
                @click=${() => (this.activeTab = 'netsuite')}>
                🌐 NetSuite (${this.nsTemplates.length})
              </button>
            ` : nothing}
            <button class="tab ${this.activeTab === 'import' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'import')}>
              ⟨/⟩ Import / Export
            </button>
          </div>

          ${this.activeTab === 'saved' ? (this.loading ? html`<p style="text-align:center;padding:24px;color:var(--color-text-muted)">Loading...</p>` : this._renderSaved()) : nothing}
          ${this.activeTab === 'samples' ? this._renderSamples() : nothing}
          ${this.activeTab === 'netsuite' ? (this.nsLoading ? html`<p style="text-align:center;padding:24px;color:var(--color-text-muted)">Loading...</p>` : this._renderNetsuite()) : nothing}
          ${this.activeTab === 'import' ? this._renderImportExport() : nothing}
        </div>

        <div slot="footer">
          <div class="footer-btns">
            <button class="btn" @click=${this._saveCurrentTemplate}>💾 Save Current</button>
            <button class="btn" @click=${this._close}>Close</button>
          </div>
        </div>
      </pld-modal>
    `;
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
              <span>Page: ${tpl.page.size} ${tpl.page.orientation}</span>
              <span>Modified: ${new Date(tpl.updatedAt).toLocaleDateString()}</span>
            </div>
            <div class="tpl-elements">${tpl.elements.length} elements</div>
            <div class="tpl-actions">
              <button class="tpl-btn primary" @click=${() => this._loadTemplate(tpl.id)}>Load</button>
              <button class="tpl-btn" @click=${() => this._duplicateTemplate(tpl.id)}>Duplicate</button>
              <button class="tpl-btn" @click=${() => this._exportSingle(tpl)}>Export</button>
              <button class="tpl-btn danger" @click=${() => this._deleteTemplate(tpl.id, tpl.name)}>Delete</button>
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
              <span>Page: ${tpl.page.size} ${tpl.page.orientation}</span>
            </div>
            <div class="tpl-elements">${tpl.elements.length} elements • Includes sample data</div>
            <div class="tpl-actions">
              <button class="tpl-btn primary">Load Sample</button>
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

    return html`
      ${missingDefault.length > 0 ? html`
        <div class="ns-no-default-warning">
          ⚠ ไม่มีเทมเพลตค่าเริ่มต้น — ${missingDefault.join(', ')}. การพิมพ์${missingDefault.length > 1 ? 'ประเภทเอกสารเหล่านี้' : 'ประเภทเอกสารนี้'}จะล้มเหลวด้วย "No template found" จนกว่าจะตั้งค่าเริ่มต้น
        </div>
      ` : nothing}
      <div class="template-grid">
        ${this.nsTemplates.map((tpl) => html`
          <div class="template-card">
            <div class="tpl-name">${tpl.isDefault ? '★ ' : ''}${tpl.name}</div>
            <div class="tpl-meta">
              <span>ประเภทเอกสาร: ${tpl.rectype || '—'}${tpl.isDefault ? ' (ค่าเริ่มต้น)' : ''}</span>
              <span>แก้ไขล่าสุด: ${tpl.modified}</span>
            </div>
            <div class="tpl-elements">NetSuite ID: ${tpl.id}</div>
            <div class="tpl-actions">
              <button class="tpl-btn primary" @click=${() => this._loadNsTemplate(tpl.id)}>Load</button>
              <button class="tpl-btn" @click=${() => this._duplicateNsTemplate(tpl.id)}>Duplicate</button>
              <button class="tpl-btn danger" @click=${() => this._deleteNsTemplate(tpl.id, tpl.name)}>Delete</button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private _renderImportExport() {
    return html`
      <div class="import-area">
        <div style="font-size: 12px; color: var(--color-text-dim, #8a8ca0); margin-bottom: 4px;">
          Paste template JSON to import, or export current template:
        </div>
        <textarea
          placeholder='{"id": "...", "name": "...", "elements": [...]}'
          .value=${this.importJson}
          @input=${(e: Event) => (this.importJson = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
        <div class="import-actions">
          <button class="btn" @click=${this._exportCurrent}>📋 Export Current to Clipboard</button>
          <button class="btn btn-primary" @click=${this._importFromJson}>⟨/⟩ Import JSON</button>
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
      showToast('Template saved!', 'success');
    } catch (err) {
      showToast(`Save failed: ${err}`, 'error');
    }
  }

  private async _loadTemplate(id: string) {
    if (!confirmDiscardUnsaved(this.store)) return;
    try {
      const { warnings } = await loadTemplate(this.store, id);
      showToast('Template loaded!', 'success');
      // Surface migration / validation / future-schema warnings instead of
      // discarding them (#145) — the user should know the template changed shape.
      warnings.forEach((w) => showToast(w, 'warning'));
      this._close();
    } catch (err) {
      showToast(`Load failed: ${err}`, 'error');
    }
  }

  private _loadSample(tpl: DocumentTemplate) {
    if (!confirmDiscardUnsaved(this.store)) return;
    clearPaginationCache();
    this.store.dispatch((draft) => {
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
    showToast(`Loaded sample: ${tpl.name}`, 'success');
    this._close();
  }

  private async _duplicateTemplate(id: string) {
    try {
      const copy = await duplicateTemplate(id);
      await this._refresh();
      showToast(`Duplicated as "${copy.name}"`, 'success');
    } catch (err) {
      showToast(`Duplicate failed: ${(err as Error).message}`, 'error');
    }
  }

  private async _duplicateNsTemplate(id: string) {
    try {
      const copy = await duplicateNsTemplate(id);
      await this._refreshNs();
      showToast(`Duplicated in NetSuite as "${copy.name}" (ID: ${copy.id})`, 'success');
    } catch (err) {
      showToast(`Duplicate failed: ${(err as Error).message}`, 'error');
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
    if (!confirm(`Delete "${name}" from NetSuite? This cannot be undone.`)) return;
    try {
      const { wasDefault } = await deleteNsTemplate(id);
      await this._refreshNs();
      showToast('Deleted from NetSuite', 'info');
      if (wasDefault) {
        showToast(
          `"${name}" was the default template — this record type now has NO default. Print will fail until a new default is set.`,
          'warning',
        );
      }
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  }

  /**
   * Load a NetSuite template record into the designer. Sets template.id to the
   * NS record id so "Save to NetSuite" overwrites this record instead of
   * creating a new one. Keeps the currently loaded record data (jsonData).
   */
  private async _loadNsTemplate(id: string) {
    if (!confirmDiscardUnsaved(this.store)) return;
    try {
      const src = await getNsTemplate(id);
      let data: Partial<DocumentTemplate>;
      try {
        data = JSON.parse(src.data);
      } catch {
        throw new Error('Template has no designer data (XML-only record) — it cannot be edited here');
      }
      if (!data.elements) {
        throw new Error('Template has no designer data (XML-only record) — it cannot be edited here');
      }

      clearPaginationCache();
      this.store.dispatch((draft) => {
        draft.elements = data.elements!;
        draft.bands = data.bands ?? elementsToBands(data.elements!);
        draft.copies = data.copies ?? null;
        if (data.page) draft.page = { ...data.page };
        if (data.pagination) draft.pagination = { ...draft.pagination, ...data.pagination };
        draft.template.id = src.id;
        draft.template.name = src.name;
        draft.template.isDirty = false;
        draft.selectedId = null;
        draft.multiSelect = [];
        draft.currentPage = 1;
      });
      showToast(`Loaded from NetSuite: ${src.name}`, 'success');
      this._close();
    } catch (err) {
      showToast(`Load failed: ${(err as Error).message}`, 'error');
    }
  }

  private async _deleteTemplate(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteTemplate(id);
      await this._refresh();
      showToast('Template deleted', 'info');
    } catch (err) {
      showToast(`Delete failed: ${err}`, 'error');
    }
  }

  private _exportCurrent() {
    const json = exportTemplateJson(this.store);
    this.importJson = json;
    navigator.clipboard?.writeText(json);
    showToast('Template JSON copied to clipboard!', 'success');
  }

  private _exportSingle(tpl: DocumentTemplate) {
    const json = JSON.stringify(tpl, null, 2);
    this.importJson = json;
    navigator.clipboard?.writeText(json);
    showToast(`Exported: ${tpl.name}`, 'success');
  }

  private _importFromJson() {
    if (!this.importJson.trim()) {
      showToast('Please paste template JSON first', 'warning');
      return;
    }
    if (!confirmDiscardUnsaved(this.store)) return;

    try {
      const { warnings } = importTemplateJson(this.store, this.importJson);
      showToast('Template imported!', 'success');
      warnings.forEach((w) => showToast(w, 'warning')); // #145 — don't discard
      this._close();
    } catch (err) {
      showToast(`Import failed: ${err}`, 'error');
    }
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-template-manager-modal': PldTemplateManagerModal;
  }
}

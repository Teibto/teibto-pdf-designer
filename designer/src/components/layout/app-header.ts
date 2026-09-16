/**
 * <pld-header> — Oracle Redwood workspace top bar.
 * Keeps editor actions and events stable while presenting one primary action,
 * a compact view switcher and a disclosure menu for secondary tools.
 *
 * @author Wichit Wongta
 * @since 2026-09-11
 */
import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, eventOptions, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { icon } from '../shared/icon';
import { switchView } from '../../state/actions';
import { getTheme, toggleTheme, type Theme } from '../../services/theme.service';
import { isNetSuiteEnv, canEditNsTemplates, READ_ONLY_REASON } from '../../services/netsuite-adapter.service';

export const DRAWER_MAX_WIDTH = 1023;

@customElement('pld-header')
export class PldHeader extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private activeView: 'design' | 'flow' = 'design';
  @state() private editorMode: 'visual' | 'xml' = 'visual';
  @state() private theme: Theme = getTheme();

  private readonly _onStateChanged = (event: Event) => {
    const state = (event as StateChangedEvent).state;
    this.activeView = state.view;
    this.editorMode = state.editorMode;
  };

  /**
   * บทบาทนี้แก้เทมเพลตบน NetSuite ไม่ได้ (#189) — ปิดปุ่มที่จะถูกปฏิเสธอยู่ดี
   * แทนที่จะให้ผู้ใช้ออกแบบเสร็จแล้วค่อยเจอ error ตอนกดบันทึก
   */
  private get readOnly(): boolean {
    return isNetSuiteEnv() && !canEditNsTemplates();
  }

  static styles = css`
    :host {
      min-height: var(--layout-topbar);
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: 0 var(--s-4);
      background: var(--c-surface);
      color: var(--c-text);
      border-bottom: 1px solid var(--c-border);
      box-shadow: var(--sh-sm);
      flex-shrink: 0;
      /* The header owns its menu stacking context. Place that context above
         drawers, while keeping it below the modal layer/top-layer dialogs. */
      z-index: calc(var(--z-overlay) + var(--z-dropdown));
      font-family: var(--f-sans);
    }

    button, summary {
      font: inherit;
      color: inherit;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      min-width: 214px;
    }

    .mark {
      width: var(--s-8);
      height: var(--s-8);
      flex: none;
      display: grid;
      place-items: center;
      border-radius: var(--r-md);
      background: var(--c-brand);
      color: var(--c-brand-on);
      font-size: var(--t-sm);
      font-weight: var(--w-bold);
      letter-spacing: -0.02em;
    }

    .brand-copy {
      display: flex;
      flex-direction: column;
      line-height: var(--lh-tight);
      white-space: nowrap;
    }

    .brand-copy strong { font-size: var(--t-md); font-weight: var(--w-bold); }
    .brand-copy small { font-size: var(--t-xs); color: var(--c-text-muted); }

    .iconbtn {
      width: var(--tap-min);
      height: var(--tap-min);
      flex: none;
      display: inline-grid;
      place-items: center;
      border: 0;
      border-radius: var(--r-md);
      background: transparent;
      cursor: pointer;
      font-size: var(--t-lg);
    }

    .iconbtn:hover { background: var(--c-surface-3); }

    .view-tabs {
      display: inline-flex;
      align-self: stretch;
      gap: var(--s-1);
      margin-left: var(--s-2);
    }

    .tab {
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
      padding: 0 var(--s-3);
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--c-text-muted);
      font-size: var(--t-base);
      font-weight: var(--w-semibold);
      cursor: pointer;
      white-space: nowrap;
    }

    .tab:hover { color: var(--c-text); background: var(--c-surface-2); }
    .tab[aria-pressed="true"] { color: var(--c-brand); border-bottom-color: var(--c-brand); }

    .actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: var(--s-2);
      min-width: 0;
    }

    .btn {
      height: var(--btn-h);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--s-2);
      padding: 0 var(--btn-px);
      border: var(--bw-control) solid var(--c-border-control);
      border-radius: var(--r-md);
      background: var(--c-surface);
      color: var(--c-text);
      font-size: var(--t-sm);
      font-weight: var(--w-semibold);
      cursor: pointer;
      white-space: nowrap;
    }

    .btn:hover:not(:disabled) { background: var(--c-surface-3); }
    .btn.primary { background: var(--c-brand); border-color: var(--c-brand); color: var(--c-brand-on); }
    .btn.primary:hover:not(:disabled) { background: var(--c-brand-strong); border-color: var(--c-brand-strong); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .readonly {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 var(--s-2);
      border-radius: var(--r-pill);
      background: var(--c-surface-3);
      color: var(--c-text-muted);
      font-size: var(--t-xs);
      white-space: nowrap;
    }

    .xml-mode {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      margin-left: var(--s-2);
      padding: 0 var(--s-2);
      border-radius: var(--r-pill);
      background: var(--c-brand-soft);
      color: var(--c-brand);
      font-size: var(--t-xs);
      font-weight: var(--w-semibold);
      white-space: nowrap;
    }

    details { position: relative; }
    summary { list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .menu {
      position: absolute;
      z-index: var(--z-dropdown);
      top: calc(100% + var(--s-1));
      right: 0;
      width: 248px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--s-1);
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      background: var(--c-surface);
      box-shadow: var(--sh-md);
    }

    .menu button {
      min-height: var(--tap-min);
      display: flex;
      align-items: center;
      gap: var(--s-2);
      padding: 0 var(--s-3);
      border: 0;
      border-radius: var(--r-sm);
      background: transparent;
      text-align: left;
      cursor: pointer;
      font-size: var(--t-base);
    }

    .menu button:hover:not(:disabled) { background: var(--c-surface-3); }
    .menu button:disabled { opacity: 0.45; cursor: not-allowed; }
    .menu-separator { height: 1px; margin: var(--s-1); background: var(--c-border); }
    .mobile-only { display: none; }
    .preview-short { display: none; }

    button:focus-visible, summary:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }

    @media (max-width: 1180px) {
      .brand { min-width: auto; }
      .brand-copy small, .actions > .theme .label { display: none; }
      .actions > .theme { width: var(--btn-h); padding: 0; }
    }

    @media (max-width: ${unsafeCSS(DRAWER_MAX_WIDTH)}px) {
      :host { padding: 0 var(--s-2); gap: var(--s-1); }
      .mobile-only { display: inline-grid; }
      .brand-copy { display: none; }
      .view-tabs { margin-left: 0; }
      .tab { padding: 0 var(--s-2); }
      .actions > .templates, .actions > .save { display: none; }
      .actions { gap: var(--s-1); }
      .btn { padding-inline: var(--s-2); }
    }

    @media (max-width: 520px) {
      .tab small, .actions > .theme { display: none; }
      .tab { padding-inline: var(--s-2); font-size: var(--t-sm); }
      .actions > .primary { width: var(--tap-min); min-width: var(--tap-min); padding: 0; }
      .preview-full { display: none; }
      .preview-short { display: inline; font-size: var(--t-lg); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.activeView = this.store.state.view;
    this.editorMode = this.store.state.editorMode;
    this.store.addEventListener('state-changed', this._onStateChanged);
  }

  disconnectedCallback() {
    this.store.removeEventListener('state-changed', this._onStateChanged);
    super.disconnectedCallback();
  }

  render() {
    return html`
      <slot name="tools-toggle"></slot>

      <div class="brand" aria-label="PDF Layout Designer">
        <div class="mark" aria-hidden="true">PD</div>
        <span class="brand-copy"><strong>PDF Layout Designer</strong><small>ออกแบบเอกสาร PDF สำหรับ NetSuite</small></span>
      </div>

      ${this.editorMode === 'visual' ? html`<div class="view-tabs" role="group" aria-label="มุมมอง (Views)">
        <button class="tab" aria-pressed=${this.activeView === 'design'}
          @click=${() => switchView(this.store, 'design')}>ออกแบบ <small>Design</small></button>
        <button class="tab" aria-pressed=${this.activeView === 'flow'}
          @click=${() => switchView(this.store, 'flow')}>ผังข้อมูล <small>Flow</small></button>
      </div>` : html`<span class="xml-mode">XML หลัก (Canonical XML)</span>`}

      <div class="actions">
        ${this.readOnly ? html`<span class="readonly read-only-badge" title=${READ_ONLY_REASON}>อ่านอย่างเดียว · Read only</span>` : nothing}
        <button class="btn theme" type="button" @click=${this._onToggleTheme} title="สลับธีม (Toggle theme)">
          <span aria-hidden="true">${icon(this.theme === 'dark' ? 'sun' : 'moon')}</span>
          <span class="label">${this.theme === 'dark' ? 'โหมดสว่าง (Light)' : 'โหมดมืด (Dark)'}</span>
        </button>
        <button class="btn templates" type="button" @click=${this._onTemplates}>เทมเพลต</button>
        <button class="btn save" type="button" @click=${this._onSave} ?disabled=${this.readOnly}
          title=${this.readOnly ? READ_ONLY_REASON : 'บันทึกเทมเพลต'}>บันทึก</button>
        <button class="btn primary" type="button" aria-label="พรีวิว (Preview)" @click=${this._onPreview}>
          <span class="preview-full">พรีวิว · Preview</span><span class="preview-short" aria-hidden="true">${icon('play')}</span>
        </button>

        <details @keydown=${this._onMenuKeydown}>
          <summary class="iconbtn" title="การทำงานเพิ่มเติม (More actions)" aria-label="การทำงานเพิ่มเติม">${icon('more-horizontal')}</summary>
          <div class="menu" @click=${this._closeMenu}>
            <button type="button" @click=${this._onToggleTheme}>สลับเป็นโหมด${this.theme === 'dark' ? 'สว่าง (Light)' : 'มืด (Dark)'}</button>
            <div class="menu-separator"></div>
            <button type="button" @click=${this._onTemplates}>เทมเพลต · Templates</button>
            <button type="button" @click=${this._onSave} ?disabled=${this.readOnly}>บันทึก · Save</button>
            ${isNetSuiteEnv() ? html`<button class="btn" type="button" @click=${this._onSaveSettings}
              ?disabled=${this.readOnly}>ตั้งค่าการบันทึก · Save settings</button>` : nothing}
            <div class="menu-separator"></div>
            ${this.editorMode === 'visual' ? html`
              <button type="button" @click=${this._onSample}>โหลดตัวอย่าง · Sample</button>
              <button type="button" @click=${this._onExportJson}>ส่งออก JSON · Export JSON</button>
            ` : nothing}
            <button type="button" @click=${this._onExportBfo}>ส่งออก NetSuite BFO</button>
            <button type="button" @click=${this._onShortcuts}>คีย์ลัด · Shortcuts</button>
          </div>
        </details>

        <slot name="properties-toggle"></slot>
      </div>
    `;
  }

  private _onMenuKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const details = event.currentTarget as HTMLDetailsElement;
    if (!details.open) return;
    event.preventDefault();
    event.stopPropagation();
    details.open = false;
    details.querySelector('summary')?.focus();
  };

  private _emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  @eventOptions({ capture: true })
  private _closeMenu(event: Event) {
    if (!(event.target as HTMLElement).closest('button')) return;
    const details = (event.currentTarget as HTMLElement).closest('details');
    details?.removeAttribute('open');
    // Focus the visible disclosure before the button opens a modal. Capturing
    // avoids a Lit update opening the dialog before this parent listener runs.
    details?.querySelector('summary')?.focus();
  }

  private _onToggleTheme = () => { this.theme = toggleTheme(); };
  private _onTemplates = () => { this._emit('pld-show-templates'); };
  private _onSave = () => { this._emit('pld-save-template'); };
  private _onSaveSettings = () => { this._emit('pld-show-save-ns'); };
  private _onExportJson = () => { this._emit('pld-show-export-json'); };
  private _onSample = () => { this._emit('pld-load-sample'); };
  private _onExportBfo = () => { this._emit('pld-show-bfo-export'); };
  private _onPreview = () => { this._emit('pld-show-preview'); };
  private _onShortcuts = () => { this._emit('pld-show-shortcuts'); };
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-header': PldHeader;
  }
}

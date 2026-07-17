/**
 * <pld-header>
 * Application header toolbar with view switcher and action buttons.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { switchView } from '../../state/actions';

@customElement('pld-header')
export class PldHeader extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private activeView: 'design' | 'flow' = 'design';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      height: 54px;
      background: var(--color-bg-panel);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      z-index: var(--z-overlay);
    }

    .logo-area {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--color-accent), var(--color-accent2));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      color: #fff;
      letter-spacing: -0.5px;
    }

    .logo-text {
      font-family: var(--font-serif);
      font-size: 18px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--color-text), var(--color-accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    /* Tab Group */
    .tab-group {
      display: flex;
      background: var(--color-bg-card);
      border-radius: var(--radius-sm);
      border: 1px solid var(--color-border);
      overflow: hidden;
    }

    .tab-btn {
      padding: 7px 16px;
      background: transparent;
      border: none;
      color: var(--color-text-dim);
      font-size: 12.5px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 500;
    }

    .tab-btn.active {
      color: var(--color-text);
      background: var(--color-accent);
    }

    .tab-btn:hover:not(.active) {
      color: var(--color-text);
      background: var(--color-bg-hover);
    }

    /* Action Buttons */
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .btn {
      padding: 7px 16px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--color-border);
      background: var(--color-bg-card);
      color: var(--color-text);
      font-size: 12.5px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }

    .btn:hover {
      background: var(--color-bg-hover);
      border-color: var(--color-text-muted);
    }

    .btn-sm {
      padding: 5px 10px;
      font-size: 11.5px;
    }

    .btn-primary {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: #fff;
    }

    .btn-primary:hover {
      background: #3d5ce5;
    }

    .btn-success {
      background: var(--color-accent2);
      border-color: var(--color-accent2);
      color: #0a0b10;
    }

    .btn-success:hover {
      opacity: 0.9;
    }

    .btn-bfo {
      background: linear-gradient(135deg, #f59e42, #e74c8b);
      border: none;
      color: #fff;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('state-changed', (e: Event) => {
      const state = (e as StateChangedEvent).state;
      this.activeView = state.view;
    });
  }

  render() {
    return html`
      <!-- Logo -->
      <div class="logo-area">
        <div class="logo-icon">PD</div>
        <span class="logo-text">PDF Layout Designer</span>
      </div>

      <!-- View Tabs -->
      <div class="tab-group">
        <button
          class="tab-btn ${this.activeView === 'design' ? 'active' : ''}"
          @click=${() => switchView(this.store, 'design')}
        >
          ◇ Design
        </button>
        <button
          class="tab-btn ${this.activeView === 'flow' ? 'active' : ''}"
          @click=${() => switchView(this.store, 'flow')}
        >
          ⟁ Flow Map
        </button>
      </div>

      <!-- Actions -->
      <div class="actions">
        <button class="btn btn-sm" @click=${this._onTemplates}>📁 Templates</button>
        <button class="btn btn-sm" @click=${this._onSave}>💾 Save</button>
        <button class="btn btn-sm" @click=${this._onExportJson}>⟨/⟩ JSON</button>
        <button class="btn btn-sm" @click=${this._onSample}>★ Sample</button>
        <button class="btn btn-sm btn-bfo" @click=${this._onExportBfo}>🔶 NetSuite BFO</button>
        <button class="btn btn-sm btn-primary" @click=${this._onPreview}>▶ Preview</button>
      </div>
    `;
  }

  // ─── Event dispatchers (bubbled to app-shell for modal handling) ───
  private _emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  }

  private _onTemplates() { this._emit('pld-show-templates'); }
  private _onSave()      { this._emit('pld-save-template'); }
  private _onExportJson(){ this._emit('pld-show-export-json'); }
  private _onSample()    { this._emit('pld-load-sample'); }
  private _onExportBfo() { this._emit('pld-show-bfo-export'); }
  private _onPreview()   { this._emit('pld-show-preview'); }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-header': PldHeader;
  }
}

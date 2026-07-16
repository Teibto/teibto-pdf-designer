/**
 * <pld-modal>
 * Base modal overlay component.
 * Provides backdrop, centered card, close button, and slot-based content.
 *
 * @fires close - When the modal requests to be closed
 *
 * @example
 *   <pld-modal .open=${true} title="Settings" @close=${this._onClose}>
 *     <div slot="body">...</div>
 *     <div slot="footer">...</div>
 *   </pld-modal>
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('pld-modal')
export class PldModal extends LitElement {
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) modalTitle = '';
  @property({ type: String }) size: 'sm' | 'md' | 'lg' | 'xl' | 'full' = 'md';

  static styles = css`
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      z-index: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: backdropIn 0.2s ease;
      backdrop-filter: blur(4px);
    }

    @keyframes backdropIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .card {
      background: var(--color-bg-panel, #12131a);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: var(--radius-lg, 14px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      max-height: 90vh;
      animation: cardIn 0.25s ease;
      overflow: hidden;
    }

    @keyframes cardIn {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    .card.sm  { width: 400px; }
    .card.md  { width: 560px; }
    .card.lg  { width: 740px; }
    .card.xl  { width: 960px; }
    .card.full { width: 95vw; height: 90vh; }

    /* ─── Header ─── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-border, #2a2c3a);
      flex-shrink: 0;
    }

    .header h2 {
      font-size: 15px;
      font-weight: 600;
      color: var(--color-text, #e8e9f0);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .close-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--color-border, #2a2c3a);
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text-dim, #8a8ca0);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .close-btn:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
      border-color: var(--color-danger, #ef4444);
    }

    /* ─── Body ─── */
    .body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      min-height: 0;
    }

    /* ─── Footer ─── */
    .footer {
      padding: 14px 20px;
      border-top: 1px solid var(--color-border, #2a2c3a);
      flex-shrink: 0;
    }

    .footer ::slotted(*) {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
  `;

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}>
        <div class="card ${this.size}" @click=${(e: Event) => e.stopPropagation()}>
          <!-- Header -->
          <div class="header">
            <h2>${this.modalTitle}</h2>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>

          <!-- Body -->
          <div class="body">
            <slot name="body"></slot>
          </div>

          <!-- Footer (optional) -->
          <div class="footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    `;
  }

  private _onBackdropClick() {
    this._close();
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  /** Close on Escape key */
  connectedCallback() {
    super.connectedCallback();
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.open) {
        this._close();
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
  }

  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-modal': PldModal;
  }
}

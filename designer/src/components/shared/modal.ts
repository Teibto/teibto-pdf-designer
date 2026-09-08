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
 * @since 2026-09-09
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
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
      background: transparent;
      border: 0;
      padding: 16px;
      margin: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: backdropIn 0.2s ease;
    }

    .backdrop::backdrop {
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
    }

    .backdrop:not([open]) { display: none; }

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
      max-width: 100%;
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
      <dialog class="backdrop" aria-labelledby="modal-heading" aria-modal="true"
        @cancel=${this._onCancel} @keydown=${this._onKeydown} @click=${this._onBackdropClick}>
        <div class="card ${this.size}" @click=${(e: Event) => e.stopPropagation()}>
          <!-- Header -->
          <div class="header">
            <h2 id="modal-heading">${this.modalTitle || this.title || 'กล่องโต้ตอบ'}</h2>
            <button class="close-btn" type="button" aria-label="ปิด / Close" @click=${this._close}>✕</button>
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
      </dialog>
    `;
  }

  private _onBackdropClick() {
    this._close();
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  // Native modal dialogs make the rest of the document inert, including across
  // shadow roots. The browser also handles slotted focus order and nested dialogs.
  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has('open') && !this.open) this._dialog?.close();
  }

  protected updated() {
    if (this.open && this.isConnected && this._dialog && !this._dialog.open) {
      this._dialog.showModal();
    }
  }

  private get _dialog() {
    return this.shadowRoot?.querySelector('dialog');
  }

  private _onCancel(event: Event) {
    // Preserve the controlled .open API: a caller may refuse close while saving.
    event.preventDefault();
    event.stopPropagation();
    this._close();
  }

  private _onKeydown(event: KeyboardEvent) {
    // Modal input must not trigger editor shortcuts on window/document.
    event.stopPropagation();
  }

  connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }

  disconnectedCallback() {
    this._dialog?.close();
    super.disconnectedCallback();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-modal': PldModal;
  }
}

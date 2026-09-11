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
      padding: var(--s-4);
      margin: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: backdropIn var(--transition-base);
    }

    .backdrop::backdrop {
      background: var(--c-scrim);
    }

    .backdrop:not([open]) { display: none; }

    @keyframes backdropIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .card {
      background: var(--c-surface);
      color: var(--c-text);
      border: 1px solid var(--c-border);
      border-radius: var(--r-lg);
      box-shadow: var(--sh-lg);
      display: flex;
      flex-direction: column;
      max-height: 90vh;
      animation: cardIn var(--transition-base);
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
      min-height: 56px;
      padding: 0 var(--s-5);
      border-bottom: 1px solid var(--c-border);
      flex-shrink: 0;
    }

    .header h2 {
      font-size: var(--t-lg);
      font-weight: var(--w-bold);
      color: var(--c-text);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .close-btn {
      width: var(--tap-min);
      height: var(--tap-min);
      border-radius: var(--r-md);
      border: 0;
      background: transparent;
      color: var(--c-text-subtle);
      font-size: var(--t-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .close-btn:hover {
      background: var(--c-surface-3);
      color: var(--c-danger);
    }

    /* ─── Body ─── */
    .body {
      flex: 1;
      overflow-y: auto;
      padding: var(--s-5);
      min-height: 0;
    }

    /* ─── Footer ─── */
    .footer {
      padding: var(--s-3) var(--s-5);
      border-top: 1px solid var(--c-border);
      background: var(--c-surface-2);
      flex-shrink: 0;
    }

    .footer ::slotted(*) {
      display: flex;
      gap: var(--s-2);
      justify-content: flex-end;
    }

    .close-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

    @media (prefers-reduced-motion: reduce) {
      .backdrop, .card { animation: none; }
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

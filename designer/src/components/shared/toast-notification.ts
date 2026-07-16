/**
 * <pld-toast>
 * Lightweight toast notification system.
 * Listen for 'pld-toast' events on window to show notifications.
 *
 * @example
 *   window.dispatchEvent(new CustomEvent('pld-toast', {
 *     detail: { message: 'Saved!', type: 'success' }
 *   }));
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

let _nextId = 0;

@customElement('pld-toast')
export class PldToast extends LitElement {
  @state() private toasts: ToastItem[] = [];

  static styles = css`
    :host {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      padding: 10px 16px;
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      font-family: var(--font-sans);
      color: #fff;
      animation: slideUp 0.3s ease;
      pointer-events: auto;
      cursor: pointer;
      max-width: 320px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .toast.success { background: var(--color-success); color: #0a0b10; }
    .toast.error   { background: var(--color-danger); }
    .toast.warning { background: var(--color-warning); color: #0a0b10; }
    .toast.info    { background: var(--color-accent); }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('pld-toast', this._onToast as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('pld-toast', this._onToast as EventListener);
  }

  private _onToast = (e: CustomEvent<{ message: string; type?: string }>) => {
    const id = ++_nextId;
    const toast: ToastItem = {
      id,
      message: e.detail.message,
      type: (e.detail.type as ToastItem['type']) || 'info',
    };

    this.toasts = [...this.toasts, toast];

    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 3500);
  };

  render() {
    return html`
      ${this.toasts.map(
        (t) => html`
          <div
            class="toast ${t.type}"
            @click=${() => this._dismiss(t.id)}
          >
            ${t.message}
          </div>
        `,
      )}
    `;
  }

  private _dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

/** Helper to show a toast from anywhere */
export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' | 'warning' = 'info',
): void {
  window.dispatchEvent(
    new CustomEvent('pld-toast', { detail: { message, type } }),
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-toast': PldToast;
  }
}

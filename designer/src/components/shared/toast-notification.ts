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
      bottom: var(--s-5);
      right: var(--s-5);
      z-index: var(--z-toast);
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
      pointer-events: none;
    }

    .toast {
      appearance: none;
      padding: var(--s-3) var(--s-4);
      border: 1px solid var(--c-border);
      border-left-width: 4px;
      border-radius: var(--r-md);
      font-size: var(--t-sm);
      font-family: var(--f-sans);
      color: var(--c-text);
      background: var(--c-surface);
      animation: slideUp var(--transition-base);
      pointer-events: auto;
      cursor: pointer;
      max-width: 320px;
      box-shadow: var(--sh-md);
      text-align: left;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .toast.success { border-left-color: var(--c-success); }
    .toast.error   { border-left-color: var(--c-danger); }
    .toast.warning { border-left-color: var(--c-warning); }
    .toast.info    { border-left-color: var(--c-info); }
    .toast:focus-visible { outline: none; box-shadow: var(--focus-ring), var(--sh-md); }

    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
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
          <button type="button"
            class="toast ${t.type}"
            role="status"
            @click=${() => this._dismiss(t.id)}
          >
            ${t.message}
          </button>
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

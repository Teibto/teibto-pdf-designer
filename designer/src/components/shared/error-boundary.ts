/**
 * Error Boundary Component
 * Catches rendering errors in child components and shows fallback UI.
 * Prevents single broken element from crashing the entire designer.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('pld-error-boundary')
export class ErrorBoundary extends LitElement {
  static styles = css`
    :host { display: contents; }
    .error-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      background: #1a1a2e;
      border: 1px dashed #e74c3c;
      border-radius: 6px;
      color: #e74c3c;
      font-size: 11px;
      font-family: monospace;
      gap: 8px;
      min-height: 40px;
    }
    .error-fallback button {
      padding: 4px 8px;
      background: transparent;
      border: 1px solid #e74c3c;
      border-radius: 4px;
      color: #e74c3c;
      cursor: pointer;
      font-size: 11px;
    }
    .error-fallback button:hover {
      background: #e74c3c;
      color: white;
    }
  `;

  @property({ type: String }) label = 'Component';
  @state() private _hasError = false;
  @state() private _errorMessage = '';

  connectedCallback(): void {
    super.connectedCallback();
    // Catch unhandled errors from child components
    this.addEventListener('error', this._handleError as EventListener);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('error', this._handleError as EventListener);
  }

  private _handleError = (e: ErrorEvent): void => {
    e.stopPropagation();
    this._hasError = true;
    this._errorMessage = e.message || 'Unknown error';
    console.error(`[ErrorBoundary:${this.label}]`, e.error || e.message);
  };

  private _retry(): void {
    this._hasError = false;
    this._errorMessage = '';
    this.requestUpdate();
  }

  render(): TemplateResult {
    if (this._hasError) {
      return html`
        <div class="error-fallback">
          <span>⚠ ${this.label}: ${this._errorMessage}</span>
          <button @click=${this._retry}>Retry</button>
        </div>
      `;
    }
    return html`<slot></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-error-boundary': ErrorBoundary;
  }
}

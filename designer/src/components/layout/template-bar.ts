/**
 * <pld-template-bar>
 * Displays and edits the current template name with save status.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import { setTemplateName } from '../../state/actions';

@customElement('pld-template-bar')
export class PldTemplateBar extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private name = 'Untitled Template';
  @state() private isDirty = false;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--color-bg-card);
      border-bottom: 1px solid var(--color-border);
    }

    .label {
      font-size: 10px;
      color: var(--color-text-muted);
    }

    input {
      flex: 1;
      background: transparent;
      border: 1px solid transparent;
      color: var(--color-text);
      font-size: 13px;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      outline: none;
      font-family: inherit;
    }

    input:hover {
      border-color: var(--color-border);
    }

    input:focus {
      border-color: var(--color-accent);
      background: var(--color-bg-deep);
    }

    .badge {
      font-size: 10px;
      padding: 2px 8px;
      background: var(--color-bg-panel);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      color: var(--color-text-dim);
      font-family: var(--font-mono);
    }

    .badge.dirty {
      color: var(--color-accent3);
      border-color: var(--color-accent3);
      background: rgba(245, 158, 66, 0.08);
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('state-changed', (e: Event) => {
      const s = (e as StateChangedEvent).state;
      this.name = s.template.name;
      this.isDirty = s.template.isDirty;
    });
  }

  render() {
    return html`
      <span class="label">Template:</span>
      <input
        type="text"
        .value=${this.name}
        @change=${(e: Event) =>
          setTemplateName(this.store, (e.target as HTMLInputElement).value)}
      />
      <span class="badge ${this.isDirty ? 'dirty' : ''}">
        ${this.isDirty ? 'Unsaved' : 'Saved'}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-template-bar': PldTemplateBar;
  }
}

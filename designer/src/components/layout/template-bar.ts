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
      gap: var(--s-2);
      min-height: 40px;
      padding: 0 var(--s-4);
      background: var(--c-surface-2);
      border-bottom: 1px solid var(--c-border);
      color: var(--c-text);
    }

    .label {
      font-size: var(--t-xs);
      color: var(--c-text-muted);
      white-space: nowrap;
    }

    input {
      flex: 1;
      min-width: 80px;
      height: var(--btn-h);
      background: transparent;
      border: 1px solid transparent;
      color: var(--c-text);
      font-size: var(--t-sm);
      font-weight: var(--w-semibold);
      padding: 0 var(--s-2);
      border-radius: var(--r-md);
      outline: none;
      font-family: inherit;
    }

    input:hover {
      border-color: var(--c-border-control);
    }

    input:focus {
      border-color: var(--c-brand);
      background: var(--c-surface);
      box-shadow: var(--focus-ring);
    }

    .badge {
      font-size: var(--t-xs);
      padding: var(--s-1) var(--s-2);
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: var(--r-pill);
      color: var(--c-text-subtle);
    }

    .badge.dirty {
      color: var(--c-warning);
      border-color: var(--c-warning);
      background: var(--c-warning-soft);
    }

    @media (max-width: 520px) {
      :host { padding-inline: var(--s-2); }
      .label { display: none; }
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
      <span class="label">เทมเพลต · Template</span>
      <input
        type="text"
        aria-label="ชื่อเทมเพลต"
        .value=${this.name}
        @change=${(e: Event) =>
          setTemplateName(this.store, (e.target as HTMLInputElement).value)}
      />
      <span class="badge ${this.isDirty ? 'dirty' : ''}">
        ${this.isDirty ? 'ยังไม่บันทึก · Unsaved' : 'บันทึกแล้ว · Saved'}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-template-bar': PldTemplateBar;
  }
}

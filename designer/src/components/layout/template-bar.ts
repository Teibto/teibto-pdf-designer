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
  @state() private templateId: string | null = null;

  private readonly _onStateChanged = (event: Event) => {
    const state = (event as StateChangedEvent).state;
    this.name = state.template.name;
    this.isDirty = state.template.isDirty;
    this.templateId = state.template.id;
  };

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

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
`;

  connectedCallback() {
    super.connectedCallback();
    this.name = this.store.state.template.name;
    this.isDirty = this.store.state.template.isDirty;
    this.templateId = this.store.state.template.id;
    this.store.addEventListener('state-changed', this._onStateChanged);
  }

  disconnectedCallback() {
    this.store.removeEventListener('state-changed', this._onStateChanged);
    super.disconnectedCallback();
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
      <span class="badge ${this.isDirty || !this.templateId ? 'dirty' : ''}" role="status">
        ${this.isDirty ? 'ยังไม่บันทึก · Unsaved' : this.templateId ? 'บันทึกแล้ว · Saved' : 'ยังไม่เคยบันทึก · New'}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-template-bar': PldTemplateBar;
  }
}

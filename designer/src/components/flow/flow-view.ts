/**
 * <pld-flow-view>
 * Visual flow map showing how JSON data binds to canvas elements.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import type { CanvasElement } from '../../models/element';
import { ELEMENT_ROLES } from '../../constants/roles';


@customElement('pld-flow-view')
export class PldFlowView extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private elements: CanvasElement[] = [];
  @state() private jsonKeys: string[] = [];

  static styles = css`
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--color-bg-deep);
      overflow: auto;
      padding: 30px;
    }

    .flow-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .flow-title-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--color-accent), var(--color-accent2));
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 14px;
    }

    .flow-container {
      display: flex;
      gap: 80px;
      align-items: flex-start;
    }

    .flow-column {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 250px;
    }

    .column-header {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--color-text-muted);
      margin-bottom: 8px;
      padding-left: 10px;
    }

    .flow-node {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      transition: all 0.2s;
      cursor: default;
    }

    .flow-node:hover {
      border-color: var(--color-accent);
      background: var(--color-bg-hover);
    }

    .flow-node.connected {
      border-color: var(--c-brand);
    }

    .flow-node-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      flex-shrink: 0;
    }

    .flow-node-label {
      font-size: 12px;
      color: var(--color-text);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .flow-node-sub {
      font-size: 9px;
      font-family: var(--font-mono);
      color: var(--color-text-muted);
    }

    .no-bindings {
      padding: 40px;
      text-align: center;
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .arrow-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--color-accent);
      font-size: 18px;
      min-width: 40px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    // Seed from the CURRENT store on connect — flow-view mounts lazily on view
    // switch, so data loaded earlier must show without waiting for the next
    // state-changed (#130).
    this.elements = this.store.state.elements;
    this.jsonKeys = this.store.state.jsonKeys;
    this.store.addEventListener('state-changed', (e: Event) => {
      const s = (e as StateChangedEvent).state;
      this.elements = s.elements;
      this.jsonKeys = s.jsonKeys;
    });
  }

  render() {
    const boundElements = this.elements.filter((el) => el.binding);

    if (boundElements.length === 0 && this.jsonKeys.length === 0) {
      return html`
        <div class="flow-title">
          <div class="flow-title-icon">⟁</div>
          Flow Map
        </div>
        <div class="no-bindings">
          No data bindings yet.<br />
          Load JSON data and set element bindings to see the flow.
        </div>
      `;
    }

    const usedKeys = new Set(boundElements.map((el) => el.binding).filter(Boolean));

    return html`
      <div class="flow-title">
        <div class="flow-title-icon">⟁</div>
        Flow Map — Data Bindings
      </div>

      <div class="flow-container">
        <!-- JSON Keys Column -->
        <div class="flow-column">
          <div class="column-header">📋 JSON Data Keys</div>
          ${this.jsonKeys.map(
            (key) => html`
              <div class="flow-node ${usedKeys.has(key) ? 'connected' : ''}">
                <div class="flow-node-icon" style="background: var(--c-brand-soft); color: var(--c-brand);">
                  {}
                </div>
                <div>
                  <div class="flow-node-label">${key}</div>
                  <div class="flow-node-sub">${usedKeys.has(key) ? '✓ Bound' : 'Available'}</div>
                </div>
              </div>
            `,
          )}
        </div>

        <!-- Arrow Column -->
        <div class="arrow-col">
          ${boundElements.map(() => html`<span>→</span>`)}
        </div>

        <!-- Elements Column -->
        <div class="flow-column">
          <div class="column-header">◇ Bound Elements</div>
          ${boundElements.map((el) => {
            const role = ELEMENT_ROLES[el.role];
            return html`
              <div class="flow-node connected">
                <div class="flow-node-icon" style="background: ${role.color}22; color: ${role.color};">
                  ◇
                </div>
                <div>
                  <div class="flow-node-label">${el.name}</div>
                  <div class="flow-node-sub">{{${el.binding}}} → ${el.type}</div>
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-flow-view': PldFlowView;
  }
}

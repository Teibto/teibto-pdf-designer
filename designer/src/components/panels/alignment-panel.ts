/**
 * <pld-alignment-panel>
 * Alignment and distribution tools for multi-selected elements.
 * Shows in sidebar-right when 2+ elements are selected.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import { alignElements, distributeElements } from '../../state/actions';

@customElement('pld-alignment-panel')
export class PldAlignmentPanel extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @property({ type: Number }) selectedCount = 0;

  static styles = css`
    :host {
      display: block;
      padding: 14px;
      border-bottom: 1px solid var(--color-border, #2a2c3a);
    }

    .title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--color-text-muted, #5c5e72);
      margin-bottom: 10px;
    }

    .row {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }

    .row-label {
      font-size: 9px;
      color: var(--color-text-dim, #8a8ca0);
      margin-bottom: 4px;
    }

    .align-btn {
      flex: 1;
      padding: 6px;
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text-dim, #8a8ca0);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .align-btn:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-accent, #4f6ef7);
      border-color: var(--color-accent, #4f6ef7);
    }

    .align-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .align-btn:disabled:hover {
      background: var(--color-bg-card, #1a1b25);
      color: var(--color-text-dim, #8a8ca0);
      border-color: var(--color-border, #2a2c3a);
    }

    .info {
      font-size: 10px;
      color: var(--color-text-muted, #5c5e72);
      text-align: center;
      padding: 8px;
    }
  `;

  render() {
    const canAlign = this.selectedCount >= 2;
    const canDistribute = this.selectedCount >= 3;

    return html`
      <div class="title">🔲 Alignment (${this.selectedCount} selected)</div>

      ${this.selectedCount < 2 ? html`
        <div class="info">Select 2+ elements to align</div>
      ` : nothing}

      <!-- Horizontal Align -->
      <div class="row-label">Align</div>
      <div class="row">
        <button class="align-btn" ?disabled=${!canAlign} title="Align Left"
          @click=${() => alignElements(this.store, 'left')}>⫷</button>
        <button class="align-btn" ?disabled=${!canAlign} title="Align Center"
          @click=${() => alignElements(this.store, 'center')}>⫼</button>
        <button class="align-btn" ?disabled=${!canAlign} title="Align Right"
          @click=${() => alignElements(this.store, 'right')}>⫸</button>
        <button class="align-btn" ?disabled=${!canAlign} title="Align Top"
          @click=${() => alignElements(this.store, 'top')}>⊤</button>
        <button class="align-btn" ?disabled=${!canAlign} title="Align Middle"
          @click=${() => alignElements(this.store, 'middle')}>⊟</button>
        <button class="align-btn" ?disabled=${!canAlign} title="Align Bottom"
          @click=${() => alignElements(this.store, 'bottom')}>⊥</button>
      </div>

      <!-- Distribute -->
      <div class="row-label">Distribute</div>
      <div class="row">
        <button class="align-btn" ?disabled=${!canDistribute} title="Distribute Horizontal"
          @click=${() => distributeElements(this.store, 'horizontal')}>⫰ H</button>
        <button class="align-btn" ?disabled=${!canDistribute} title="Distribute Vertical"
          @click=${() => distributeElements(this.store, 'vertical')}>⫯ V</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-alignment-panel': PldAlignmentPanel;
  }
}

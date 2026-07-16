/**
 * <pld-grid-panel>
 * Grid, ruler, and snap configuration panel.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import {
  setGridEnabled,
  setGridSize,
  setSnapToGrid,
  setShowRulers,
  setShowGuides,
} from '../../state/actions';
import type { GridConfig } from '../../state/app-state';

@customElement('pld-grid-panel')
export class PldGridPanel extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private grid: GridConfig = {
    enabled: true, size: 10, snapToGrid: false, showRulers: true, showGuides: true,
  };

  static styles = css`
    :host {
      display: block;
    }

    .section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--color-text-muted, #5c5e72);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .check-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      color: var(--color-text-dim, #8a8ca0);
      cursor: pointer;
    }

    .check-item input[type="checkbox"] {
      accent-color: var(--color-accent, #4f6ef7);
      width: 13px;
      height: 13px;
      cursor: pointer;
    }

    .field-row {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      align-items: center;
    }

    .field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .field label {
      font-size: 9px;
      color: var(--color-text-dim, #8a8ca0);
    }

    .field input {
      padding: 4px 6px;
      background: var(--color-bg-deep, #0a0b10);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 4px;
      color: var(--color-text, #e8e9f0);
      font-size: 11px;
      font-family: var(--font-mono, monospace);
      outline: none;
      width: 100%;
    }

    .field input:focus {
      border-color: var(--color-accent, #4f6ef7);
    }
  `;

  private _stateHandler: ((e: Event) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Read current state immediately
    this.grid = { ...this.store.state.grid };

    // Listen for future changes
    this._stateHandler = (e: Event) => {
      this.grid = { ...(e as StateChangedEvent).state.grid };
    };
    this.store.addEventListener('state-changed', this._stateHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._stateHandler) {
      this.store.removeEventListener('state-changed', this._stateHandler);
      this._stateHandler = null;
    }
  }

  render() {
    return html`
      <div class="section-title">⊞ Grid & Guides</div>

      <div class="check-group">
        <label class="check-item">
          <input type="checkbox" .checked=${this.grid.enabled}
            @change=${(e: Event) => setGridEnabled(this.store, (e.target as HTMLInputElement).checked)} />
          Show Grid
        </label>
        <label class="check-item">
          <input type="checkbox" .checked=${this.grid.snapToGrid}
            @change=${(e: Event) => setSnapToGrid(this.store, (e.target as HTMLInputElement).checked)} />
          Snap to Grid
        </label>
        <label class="check-item">
          <input type="checkbox" .checked=${this.grid.showRulers}
            @change=${(e: Event) => setShowRulers(this.store, (e.target as HTMLInputElement).checked)} />
          Show Rulers
        </label>
        <label class="check-item">
          <input type="checkbox" .checked=${this.grid.showGuides}
            @change=${(e: Event) => setShowGuides(this.store, (e.target as HTMLInputElement).checked)} />
          Snap Alignment Guides
        </label>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Grid Size (px)</label>
          <input type="number" .value=${String(this.grid.size)} min="5" max="50"
            @change=${(e: Event) => setGridSize(this.store, Number((e.target as HTMLInputElement).value))} />
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-grid-panel': PldGridPanel;
  }
}

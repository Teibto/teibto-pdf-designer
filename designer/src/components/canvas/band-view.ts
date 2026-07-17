/**
 * <pld-band-view> — READ-ONLY band layout preview (#13/#47, strangler slice 1)
 *
 * Renders the current design through the band model (bands → rows → columns) so
 * we can see how the free-canvas layout maps to bands before building the real
 * band editor. Bands are DERIVED from `state.elements` on every render via #44's
 * `elementsToBands` — nothing is stored or mutated, and `elements` stays the sole
 * source of truth until cutover (big-bang, #13 §7 Q1). Dev-gated in app-shell so
 * it never reaches consultants on the live SB2 build until the editor is done.
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore } from '../../state/store';
import { regenerateBands, setColumnWidth } from '../../state/actions';
import { ELEMENT_ROLES } from '../../constants/roles';

@customElement('pld-band-view')
export class PldBandView extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private _tick = 0;
  private _onState = () => { this._tick++; };

  connectedCallback() {
    super.connectedCallback();
    // Entering band mode: regenerate bands from elements once (#47). Band edits
    // then live in state.bands; elements stay untouched until cutover.
    regenerateBands(this.store);
    this.store.addEventListener('state-changed', this._onState);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.store.removeEventListener('state-changed', this._onState);
  }

  static styles = css`
    :host { display: block; overflow: auto; height: 100%; padding: 20px; background: var(--color-bg-deep, #0a0b10); }
    .doc { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .band { border: 1px solid var(--band-color, #2a2c3a); border-radius: 8px; overflow: hidden; }
    .band-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: color-mix(in srgb, var(--band-color) 16%, transparent); font-size: 12px; font-weight: 600; color: var(--band-color); }
    .band-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--color-bg-card, #1a1b25); }
    .row { display: flex; gap: 8px; }
    .cell { border: 1px dashed var(--color-border, #2a2c3a); border-radius: 6px; padding: 8px; min-height: 34px; display: flex; flex-direction: column; gap: 4px; }
    .cell-w { display: flex; align-items: center; gap: 4px; font-size: 10px; font-family: var(--font-mono, monospace); color: var(--color-text-dim, #8a8ca0); }
    .cell-w button { width: 16px; height: 16px; line-height: 1; border: 1px solid var(--color-border, #2a2c3a); border-radius: 3px; background: var(--color-bg-hover, #222430); color: var(--color-text, #e8e9f0); cursor: pointer; padding: 0; font-size: 11px; }
    .cell-w button:disabled { opacity: .35; cursor: default; }
    .chip { font-size: 11px; color: var(--color-text, #e8e9f0); background: var(--color-bg-hover, #222430); border-radius: 4px; padding: 2px 6px; }
    .chip .t { color: var(--color-text-dim, #8a8ca0); font-family: var(--font-mono, monospace); font-size: 10px; }
    .empty { color: var(--color-text-dim, #8a8ca0); font-size: 13px; text-align: center; padding: 40px; }
  `;

  render() {
    void this._tick;
    const bands = this.store.state.bands;
    if (bands.length === 0) return html`<div class="empty">ยังไม่มี element — กด Sample หรือวางของบน canvas ก่อน</div>`;

    return html`
      <div class="doc">
        ${bands.map((band, bi) => {
          const role = ELEMENT_ROLES[band.role];
          return html`
            <div class="band" style="--band-color: ${role.color};">
              <div class="band-head">${role.label} <span style="opacity:.7;font-weight:400;">· ${band.rows.length} row</span></div>
              <div class="band-body">
                ${band.rows.map((row, ri) => html`
                  <div class="row">
                    ${row.columns.map((col, ci) => html`
                      <div class="cell" style="flex: ${col.widthPct} 1 0;">
                        <span class="cell-w">
                          ${row.columns.length > 1 ? html`
                            <button ?disabled=${col.widthPct <= 5} @click=${() => setColumnWidth(this.store, bi, ri, ci, col.widthPct - 5)}>−</button>
                            <span>${col.widthPct}%</span>
                            <button ?disabled=${col.widthPct >= 95} @click=${() => setColumnWidth(this.store, bi, ri, ci, col.widthPct + 5)}>+</button>
                          ` : html`<span>${col.widthPct}%</span>`}
                        </span>
                        ${col.elements.length
                          ? col.elements.map((el) => html`<span class="chip">${el.name || el.type} <span class="t">${el.type}</span></span>`)
                          : nothing}
                      </div>
                    `)}
                  </div>
                `)}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-band-view': PldBandView;
  }
}

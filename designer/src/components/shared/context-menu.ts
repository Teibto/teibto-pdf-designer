/**
 * <pld-context-menu>
 * Right-click context menu for canvas elements.
 * Shows element-specific actions: duplicate, delete, lock, z-order, copy, cut.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { storeContext, AppStore, StateChangedEvent } from '../../state/store';
import {
  duplicateElement,
  removeElement,
  toggleLock,
  toggleVisibility,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  copyElements,
  cutElements,
  pasteElements,
  hideContextMenu,
  groupElements,
  ungroupElements,
  getSelectedIds,
} from '../../state/actions';
import type { CanvasElement } from '../../models/element';

@customElement('pld-context-menu')
export class PldContextMenu extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private show = false;
  @state() private x = 0;
  @state() private y = 0;
  @state() private element: CanvasElement | null = null;

  static styles = css`
    :host {
      position: fixed;
      z-index: 1000;
      pointer-events: none;
    }

    .menu {
      position: fixed;
      background: var(--color-bg-panel, #12131a);
      border: 1px solid var(--color-border, #2a2c3a);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      min-width: 180px;
      padding: 4px;
      pointer-events: auto;
      animation: menuIn 0.12s ease;
    }

    @keyframes menuIn {
      from { opacity: 0; transform: scale(0.95); }
      to   { opacity: 1; transform: scale(1); }
    }

    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px;
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.1s;
      font-size: 12px;
      color: var(--color-text-dim, #8a8ca0);
    }

    .item:hover {
      background: var(--color-bg-hover, #222430);
      color: var(--color-text, #e8e9f0);
    }

    .item.danger:hover {
      background: rgba(239, 68, 68, 0.12);
      color: var(--color-danger, #ef4444);
    }

    .item-icon {
      width: 16px;
      text-align: center;
      font-size: 12px;
      flex-shrink: 0;
    }

    .item-label {
      flex: 1;
    }

    .item-shortcut {
      font-size: 10px;
      color: var(--color-text-muted, #5c5e72);
      font-family: var(--font-mono, monospace);
    }

    .divider {
      height: 1px;
      background: var(--color-border, #2a2c3a);
      margin: 4px 8px;
    }

    .group-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--color-text-muted, #5c5e72);
      padding: 6px 12px 2px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    this.store.addEventListener('state-changed', (e: Event) => {
      const s = (e as StateChangedEvent).state;
      this.show = s.contextMenu.show;
      this.x = s.contextMenu.x;
      this.y = s.contextMenu.y;
      this.element = s.elements.find((el) => el.id === s.contextMenu.elementId) ?? null;
    });

    // Close on any click elsewhere
    this._globalClick = () => {
      if (this.show) hideContextMenu(this.store);
    };
    window.addEventListener('click', this._globalClick);
    window.addEventListener('contextmenu', this._globalClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._globalClick) {
      window.removeEventListener('click', this._globalClick);
      window.removeEventListener('contextmenu', this._globalClick);
    }
  }

  private _globalClick: (() => void) | null = null;

  render() {
    if (!this.show) return nothing;

    const el = this.element;
    const hasElement = !!el;
    const isLocked = el?.locked ?? false;
    const isVisible = el?.visible ?? true;
    const hasClipboard = (this.store.state.clipboard?.length ?? 0) > 0;

    return html`
      <div class="menu" style="left: ${this.x}px; top: ${this.y}px;"
        @click=${(e: Event) => e.stopPropagation()}>

        ${hasElement ? html`
          <!-- Element Actions -->
          <div class="group-label">${el!.name}</div>

          <div class="item" @click=${() => this._action(() => duplicateElement(this.store, el!.id))}>
            <span class="item-icon">⧉</span>
            <span class="item-label">Duplicate</span>
            <span class="item-shortcut">⌘D</span>
          </div>

          <div class="item" @click=${() => this._action(() => copyElements(this.store))}>
            <span class="item-icon">❐</span>
            <span class="item-label">Copy</span>
            <span class="item-shortcut">⌘C</span>
          </div>

          <div class="item" @click=${() => this._action(() => cutElements(this.store))}>
            <span class="item-icon">✂</span>
            <span class="item-label">Cut</span>
            <span class="item-shortcut">⌘X</span>
          </div>

          <div class="divider"></div>

          <!-- Lock/Visibility -->
          <div class="item" @click=${() => this._action(() => toggleLock(this.store, el!.id))}>
            <span class="item-icon">${isLocked ? '🔒' : '🔓'}</span>
            <span class="item-label">${isLocked ? 'Unlock' : 'Lock Position'}</span>
          </div>

          <div class="item" @click=${() => this._action(() => toggleVisibility(this.store, el!.id))}>
            <span class="item-icon">${isVisible ? '👁' : '🚫'}</span>
            <span class="item-label">${isVisible ? 'Hide' : 'Show'}</span>
          </div>

          <div class="divider"></div>

          <!-- Z-Order -->
          <div class="group-label">Layer Order</div>

          <div class="item" @click=${() => this._action(() => bringToFront(this.store, el!.id))}>
            <span class="item-icon">⬆</span>
            <span class="item-label">Bring to Front</span>
          </div>

          <div class="item" @click=${() => this._action(() => bringForward(this.store, el!.id))}>
            <span class="item-icon">↑</span>
            <span class="item-label">Bring Forward</span>
          </div>

          <div class="item" @click=${() => this._action(() => sendBackward(this.store, el!.id))}>
            <span class="item-icon">↓</span>
            <span class="item-label">Send Backward</span>
          </div>

          <div class="item" @click=${() => this._action(() => sendToBack(this.store, el!.id))}>
            <span class="item-icon">⬇</span>
            <span class="item-label">Send to Back</span>
          </div>

          <div class="divider"></div>

          <!-- Grouping -->
          ${getSelectedIds(this.store).length >= 2 ? html`
            <div class="item" @click=${() => this._action(() => groupElements(this.store))}>
              <span class="item-icon">⊞</span>
              <span class="item-label">Group</span>
              <span class="item-shortcut">⌘G</span>
            </div>
          ` : nothing}

          ${el!.groupId ? html`
            <div class="item" @click=${() => this._action(() => ungroupElements(this.store))}>
              <span class="item-icon">⊟</span>
              <span class="item-label">Ungroup</span>
              <span class="item-shortcut">⇧⌘G</span>
            </div>
          ` : nothing}

          <div class="divider"></div>

          <!-- Delete -->
          <div class="item danger" @click=${() => this._action(() => removeElement(this.store, el!.id))}>
            <span class="item-icon">✕</span>
            <span class="item-label">Delete</span>
            <span class="item-shortcut">Del</span>
          </div>
        ` : html`
          <!-- Canvas Actions (no element selected) -->
          <div class="item" @click=${() => this._action(() => pasteElements(this.store))}
            style="${!hasClipboard ? 'opacity: 0.4; pointer-events: none;' : ''}">
            <span class="item-icon">📋</span>
            <span class="item-label">Paste</span>
            <span class="item-shortcut">⌘V</span>
          </div>
        `}
      </div>
    `;
  }

  private _action(fn: () => void) {
    fn();
    hideContextMenu(this.store);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-context-menu': PldContextMenu;
  }
}

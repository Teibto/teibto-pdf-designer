/**
 * <pld-shortcuts-modal>
 * Keyboard-shortcut cheatsheet (#124). Opened with `?` from anywhere in the
 * designer. Lists ONLY the shortcuts the app actually wires up — the source of
 * truth is keyboard.service.ts (edit/clipboard/zoom/order/group) plus app-shell's
 * own handler (undo/redo). Keep this list in sync when a shortcut is added there.
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import { LitElement, html, css } from 'lit';
import { customElement, eventOptions, property } from 'lit/decorators.js';
import '../shared/modal';

/** Modifier label per platform — the handlers accept metaKey||ctrlKey. */
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

interface Shortcut {
  keys: string[];
  label: string;
}
interface Group {
  title: string;
  items: Shortcut[];
}

const GROUPS: Group[] = [
  {
    title: 'แก้ไของค์ประกอบ',
    items: [
      { keys: ['Delete'], label: 'ลบองค์ประกอบที่เลือก' },
      { keys: [MOD, 'D'], label: 'ทำสำเนา' },
      { keys: [MOD, 'C'], label: 'คัดลอก' },
      { keys: [MOD, 'X'], label: 'ตัด' },
      { keys: [MOD, 'V'], label: 'วาง' },
      { keys: [MOD, 'A'], label: 'เลือกทั้งหมด' },
      { keys: ['Esc'], label: 'ยกเลิกการเลือก' },
    ],
  },
  {
    title: 'ประวัติการแก้ไข',
    items: [
      { keys: [MOD, 'Z'], label: 'ย้อนกลับ (Undo)' },
      { keys: [MOD, 'Shift', 'Z'], label: 'ทำซ้ำ (Redo)' },
    ],
  },
  {
    title: 'จัดกลุ่ม & ลำดับชั้น',
    items: [
      { keys: [MOD, 'G'], label: 'จัดกลุ่ม' },
      { keys: [MOD, 'Shift', 'G'], label: 'ยกเลิกกลุ่ม' },
      { keys: [MOD, ']'], label: 'เลื่อนขึ้นหนึ่งชั้น' },
      { keys: [MOD, 'Shift', ']'], label: 'ขึ้นบนสุด' },
      { keys: [MOD, '['], label: 'เลื่อนลงหนึ่งชั้น' },
      { keys: [MOD, 'Shift', '['], label: 'ลงล่างสุด' },
    ],
  },
  {
    title: 'มุมมอง',
    items: [
      { keys: [MOD, '+'], label: 'ซูมเข้า' },
      { keys: [MOD, '−'], label: 'ซูมออก' },
      { keys: [MOD, '0'], label: 'รีเซ็ตซูม' },
    ],
  },
  {
    title: 'ทั่วไป',
    items: [
      { keys: [MOD, 'S'], label: 'บันทึกเทมเพลต' },
      { keys: ['?'], label: 'เปิด/ปิดหน้าต่างคีย์ลัดนี้' },
    ],
  },
];

@customElement('pld-shortcuts-modal')
export class PldShortcutsModal extends LitElement {
  @property({ type: Boolean }) open = false;

  static styles = css`
    :host { display: contents; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 18px 28px;
    }
    .group-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--c-brand);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 8px;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
    }
    .label { font-size: 13px; color: var(--c-text); }
    .keys { display: inline-flex; gap: 4px; flex-shrink: 0; }
    kbd {
      font-family: var(--font-mono, monospace);
      font-size: var(--t-sm);
      line-height: 1;
      color: var(--c-text);
      background: var(--c-surface-3);
      border: 1px solid var(--c-border);
      border-bottom-width: 2px;
      border-radius: 4px;
      padding: 4px 6px;
      min-width: 16px;
      text-align: center;
    }
    .sep { color: var(--c-text-subtle); font-size: var(--t-sm); align-self: center; }
    .hint {
      margin-top: 16px;
      font-size: var(--t-sm);
      color: var(--c-text-subtle);
      text-align: center;
    }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px; }
    button { min-height: var(--btn-h); }
    input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--btn-h); box-sizing: border-box; }
    label.check-item { min-height: var(--btn-h); }
`;

  render() {
    return html`
      <pld-modal
        .open=${this.open}
        modalTitle="คีย์ลัด (Keyboard Shortcuts)"
        size="lg"
        @close=${this._close}
        @keydown=${this._onKeydown}
      >
        <div slot="body">
          <div class="grid">
            ${GROUPS.map(
              (g) => html`
                <div class="group">
                  <p class="group-title">${g.title}</p>
                  ${g.items.map(
                    (s) => html`
                      <div class="row">
                        <span class="label">${s.label}</span>
                        <span class="keys">
                          ${s.keys.map(
                            (k, i) => html`${i > 0
                              ? html`<span class="sep">+</span>`
                              : ''}<kbd>${k}</kbd>`,
                          )}
                        </span>
                      </div>
                    `,
                  )}
                </div>
              `,
            )}
          </div>
          <p class="hint">กด <kbd>?</kbd> เพื่อเปิด/ปิดหน้าต่างนี้ · <kbd>Esc</kbd> เพื่อปิด</p>
        </div>
      </pld-modal>
    `;
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  // Handle this dialog's own toggle before the shared dialog isolates keyboard
  // events from the editor. No global listener or exception for other modals.
  @eventOptions({ capture: true })
  private _onKeydown(event: KeyboardEvent) {
    if (this.open && event.key === '?' && !event.isComposing && !event.repeat
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      this._close();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-shortcuts-modal': PldShortcutsModal;
  }
}

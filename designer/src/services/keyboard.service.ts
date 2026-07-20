/**
 * Keyboard Shortcut Service — Phase 2
 * Full keyboard shortcuts for the PDF Layout Designer.
 *
 * Shortcuts:
 *   Delete/Backspace → Remove selected
 *   Ctrl/Cmd+D       → Duplicate
 *   Ctrl/Cmd+C       → Copy
 *   Ctrl/Cmd+X       → Cut
 *   Ctrl/Cmd+V       → Paste
 *   Ctrl/Cmd+A       → Select all
 *   Ctrl/Cmd+S       → Save template
 *   Ctrl/Cmd+Z       → Undo (handled by app-shell)
 *   Ctrl/Cmd+Shift+Z → Redo (handled by app-shell)
 *   Ctrl/Cmd+Plus    → Zoom in
 *   Ctrl/Cmd+Minus   → Zoom out
 *   Ctrl/Cmd+0       → Reset zoom
 *   Escape            → Deselect
 *   Arrow keys         → Nudge (1px, +Shift = 10px)
 *   Ctrl/Cmd+[       → Send backward
 *   Ctrl/Cmd+]       → Bring forward
 *
 * @author Wichit Wongta
 */
import type { AppStore } from '../state/store';
import {
  deleteSelected,
  duplicateElement,
  copyElements,
  cutElements,
  pasteElements,
  selectElement,
  bringForward,
  sendBackward,
  bringToFront,
  sendToBack,
  zoomIn,
  zoomOut,
  resetZoom,
  getSelectedIds,
  groupElements,
  ungroupElements,
} from '../state/actions';

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isInputFocused(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  if (INPUT_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  // Check shadow DOM
  const active = (target.shadowRoot?.activeElement ?? document.activeElement) as HTMLElement | null;
  if (active && INPUT_TAGS.has(active.tagName)) return true;
  return false;
}

export function registerKeyboardShortcuts(store: AppStore): () => void {
  const handler = (e: KeyboardEvent) => {
    if (isInputFocused(e)) return;

    const isMod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    // ─── Delete ───
    if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      deleteSelected(store);
      return;
    }

    // ─── Escape → Deselect ───
    if (key === 'escape') {
      selectElement(store, null);
      store.dispatch((d) => { d.multiSelect = []; });
      return;
    }

    // ─── Modifier Shortcuts ───
    if (!isMod) return;

    switch (key) {
      // Copy
      case 'c':
        e.preventDefault();
        copyElements(store);
        break;

      // Cut
      case 'x':
        e.preventDefault();
        cutElements(store);
        break;

      // Paste
      case 'v':
        e.preventDefault();
        pasteElements(store);
        break;

      // Duplicate
      case 'd': {
        e.preventDefault();
        const ids = getSelectedIds(store);
        if (ids.length > 0) duplicateElement(store, ids[ids.length - 1]);
        break;
      }

      // Select All
      case 'a':
        e.preventDefault();
        store.dispatch((d) => {
          d.multiSelect = d.elements.map((el) => el.id);
          if (d.elements.length > 0) {
            d.selectedId = d.elements[d.elements.length - 1].id;
          }
        });
        break;

      // Save
      case 's':
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('pld-save-template'));
        break;

      // Group / Ungroup
      case 'g':
        e.preventDefault();
        if (e.shiftKey) {
          ungroupElements(store);
        } else {
          groupElements(store);
        }
        break;

      // Zoom In
      case '=':
      case '+':
        e.preventDefault();
        zoomIn(store);
        break;

      // Zoom Out
      case '-':
        e.preventDefault();
        zoomOut(store);
        break;

      // Reset Zoom
      case '0':
        e.preventDefault();
        resetZoom(store);
        break;

      // Bring Forward / Send Backward
      case ']': {
        e.preventDefault();
        const ids = getSelectedIds(store);
        if (ids.length > 0) {
          if (e.shiftKey) {
            bringToFront(store, ids[ids.length - 1]);
          } else {
            bringForward(store, ids[ids.length - 1]);
          }
        }
        break;
      }

      case '[': {
        e.preventDefault();
        const ids = getSelectedIds(store);
        if (ids.length > 0) {
          if (e.shiftKey) {
            sendToBack(store, ids[ids.length - 1]);
          } else {
            sendBackward(store, ids[ids.length - 1]);
          }
        }
        break;
      }
    }
  };

  window.addEventListener('keydown', handler);

  // Return cleanup function
  return () => window.removeEventListener('keydown', handler);
}

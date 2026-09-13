// @vitest-environment jsdom
/**
 * Regression coverage for nested editors and IME keyboard safety.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AppStore } from '../../src/state/store';
import { addElement } from '../../src/state/actions';
import { registerKeyboardShortcuts } from '../../src/services/keyboard.service';

afterEach(() => { document.body.innerHTML = ''; });
describe('keyboard editor safety', () => {
  it.each(['input', 'textarea', 'select', 'div'])('preserves canvas while typing in nested %s', (tag) => {
    const store = new AppStore();
    addElement(store, 'text', 0, 0);
    const cleanup = registerKeyboardShortcuts(store);
    const outer = document.createElement('div');
    document.body.append(outer);
    const inner = document.createElement('div');
    outer.attachShadow({ mode: 'open' }).append(inner);
    const editor = document.createElement(tag);
    if (tag === 'div') editor.setAttribute('contenteditable', 'true');
    inner.attachShadow({ mode: 'open' }).append(editor);
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true, cancelable: true });
    editor.dispatchEvent(event);
    expect(store.state.elements).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });
  it('ignores composing deletion but handles ordinary canvas deletion', () => {
    const store = new AppStore();
    addElement(store, 'text', 0, 0);
    const cleanup = registerKeyboardShortcuts(store);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', isComposing: true }));
    expect(store.state.elements).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', keyCode: 229 }));
    expect(store.state.elements).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(store.state.elements).toHaveLength(0);
    cleanup();
  });
});

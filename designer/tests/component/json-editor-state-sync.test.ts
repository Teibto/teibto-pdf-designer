// @vitest-environment jsdom
/**
 * JSON editor state-sync and large-payload serialization regressions.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import { clearJsonData, loadJsonData } from '../../src/state/actions';
import '../../src/components/panels/json-editor';

async function mountEditor(data: Record<string, unknown>) {
  const store = new AppStore();
  store.dispatch((state) => {
    state.jsonData = data;
    state.jsonKeys = Object.keys(data);
  });
  const editor = document.createElement('pld-json-editor') as any;
  editor.store = store;
  // Keep large fixtures out of the eager visual-form DOM; this suite measures
  // state synchronization, not the separately tracked form-windowing risk.
  editor.viewMode = 'json';
  document.body.appendChild(editor);
  await editor.updateComplete;
  return { editor, store };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('json-editor state synchronization', () => {
  it('defers large-payload serialization while the visual form is active', async () => {
    const data = { items: Array.from({ length: 10_000 }, (_, index) => ({ index })) };
    const store = new AppStore();
    store.dispatch((state) => {
      state.jsonData = data;
      state.jsonKeys = ['items'];
    });
    const stringify = vi.spyOn(JSON, 'stringify');
    const editor = document.createElement('pld-json-editor') as any;
    editor.store = store;
    document.body.appendChild(editor);
    await editor.updateComplete;

    expect(stringify).not.toHaveBeenCalled();
    store.dispatch((state) => {
      state.jsonData = { items: [...data.items, { index: 10_000 }] };
      state.jsonKeys = ['items'];
    });
    await editor.updateComplete;
    expect(stringify).not.toHaveBeenCalled();

    editor._switchView('json');
    expect(stringify).toHaveBeenCalledTimes(1);
  });

  it('does not serialize unchanged data for unrelated global state updates', async () => {
    const data = { items: Array.from({ length: 10_000 }, (_, index) => ({ index })) };
    const { editor, store } = await mountEditor(data);
    const stringify = vi.spyOn(JSON, 'stringify');

    for (let index = 0; index < 100; index++) {
      store.dispatch((state) => { state.zoom = 100 + (index % 2); });
    }

    expect(stringify).not.toHaveBeenCalled();
    expect(editor.formData).toBe(store.state.jsonData);
  });

  it('preserves exact valid raw text and caret through its synchronous store update', async () => {
    const { editor, store } = await mountEditor({ initial: true });
    editor._switchView('json');
    await editor.updateComplete;
    const textarea = editor.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
    const raw = '{"items": [ {"name":"A"} ]}';
    textarea.value = raw;
    textarea.setSelectionRange(12, 12);
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await editor.updateComplete;

    expect(editor.jsonText).toBe(raw);
    expect(textarea.value).toBe(raw);
    expect(textarea.selectionStart).toBe(12);
    expect(store.state.jsonData).toEqual({ items: [{ name: 'A' }] });

    store.dispatch((state) => { state.selectedId = 'unrelated'; });
    await editor.updateComplete;
    expect(textarea.value).toBe(raw);
    expect(textarea.selectionStart).toBe(12);
  });

  it('does not overwrite an invalid raw draft on unrelated state changes', async () => {
    const { editor, store } = await mountEditor({ saved: true });
    editor._switchView('json');
    await editor.updateComplete;
    const textarea = editor.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{ invalid draft';
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await editor.updateComplete;

    store.dispatch((state) => { state.zoom = 125; });
    await editor.updateComplete;

    expect(editor.jsonText).toBe('{ invalid draft');
    expect(textarea.value).toBe('{ invalid draft');
    expect(editor.isValid).toBe(false);
  });

  it('clears store data when the raw editor is emptied', async () => {
    const { editor, store } = await mountEditor({ saved: true });
    const textarea = editor.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await editor.updateComplete;

    expect(editor.formData).toBeNull();
    expect(store.state.jsonData).toBeNull();
    expect(store.state.jsonKeys).toEqual([]);
  });

  it('accepts a genuine external replacement after valid raw JSON was committed', async () => {
    const { editor, store } = await mountEditor({ initial: true });
    const textarea = editor.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '{"local":true}';
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await editor.updateComplete;

    const external = { external: { version: 2 } };
    loadJsonData(store, external);
    await editor.updateComplete;

    expect(editor.formData).toBe(store.state.jsonData);
    expect(editor.jsonText).toBe(JSON.stringify(external, null, 2));
    expect(textarea.value).toBe(JSON.stringify(external, null, 2));
  });

  it('reseeds an externally cleared store when the same editor reconnects', async () => {
    const { editor, store } = await mountEditor({ stale: true });
    editor.remove();
    clearJsonData(store);
    document.body.appendChild(editor);
    await editor.updateComplete;

    expect(editor.formData).toBeNull();
    expect(editor.jsonText).toBe('');
    expect(editor.keyCount).toBe(0);
    expect(editor.isValid).toBe(true);
  });
});

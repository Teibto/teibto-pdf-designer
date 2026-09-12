// @vitest-environment jsdom
/**
 * JSON editor NetSuite record reload race regression.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import { loadJsonData } from '../../src/state/actions';

const mocks = vi.hoisted(() => ({
  autoLoadRecordIfAvailable: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../src/services/netsuite-adapter.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/netsuite-adapter.service')>(),
  autoLoadRecordIfAvailable: mocks.autoLoadRecordIfAvailable,
}));

vi.mock('../../src/components/shared/toast-notification', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/components/shared/toast-notification')>(),
  showToast: mocks.showToast,
}));

import '../../src/components/panels/json-editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function mountEditor() {
  const store = new AppStore();
  const editor = document.createElement('pld-json-editor') as any;
  editor.store = store;
  editor.viewMode = 'json';
  document.body.appendChild(editor);
  return { editor, store };
}

describe('json-editor record reload', () => {
  it('keeps the latest response when two reloads resolve out of order', async () => {
    const older = deferred<Record<string, unknown> | null>();
    const newer = deferred<Record<string, unknown> | null>();
    mocks.autoLoadRecordIfAvailable
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { editor, store } = mountEditor();

    const first = editor._loadFromRecord();
    const second = editor._loadFromRecord();
    newer.resolve({ marker: 'new' });
    await second;
    older.resolve({ marker: 'old' });
    await first;

    expect(store.state.jsonData).toEqual({ marker: 'new' });
    expect(editor.jsonText).toBe(JSON.stringify({ marker: 'new' }, null, 2));
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith('Record data loaded!', 'success');
  });

  it('does not overwrite a newer local raw edit with a pending reload', async () => {
    const pending = deferred<Record<string, unknown> | null>();
    mocks.autoLoadRecordIfAvailable.mockReturnValueOnce(pending.promise);
    const { editor, store } = mountEditor();

    const reload = editor._loadFromRecord();
    editor._onInput({ target: { value: '{"local":true}' } } as unknown as Event);
    pending.resolve({ marker: 'stale-record' });
    await reload;

    expect(store.state.jsonData).toEqual({ local: true });
    expect(editor.jsonText).toBe('{"local":true}');
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('does not restore pending record data after a newer clear', async () => {
    const pending = deferred<Record<string, unknown> | null>();
    mocks.autoLoadRecordIfAvailable.mockReturnValueOnce(pending.promise);
    const { editor, store } = mountEditor();

    loadJsonData(store, { initial: true });
    const reload = editor._loadFromRecord();
    editor._clear();
    pending.resolve({ marker: 'stale-record' });
    await reload;

    expect(store.state.jsonData).toBeNull();
    expect(editor.jsonText).toBe('');
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('does not overwrite a genuine external replacement with a pending reload', async () => {
    const pending = deferred<Record<string, unknown> | null>();
    mocks.autoLoadRecordIfAvailable.mockReturnValueOnce(pending.promise);
    const { editor, store } = mountEditor();

    const reload = editor._loadFromRecord();
    const external = { external: { version: 2 } };
    loadJsonData(store, external);
    pending.resolve({ marker: 'stale-record' });
    await reload;

    expect(store.state.jsonData).toEqual(external);
    expect(editor.jsonText).toBe(JSON.stringify(external, null, 2));
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

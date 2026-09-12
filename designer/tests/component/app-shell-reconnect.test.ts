// @vitest-environment jsdom
/**
 * App-shell reconnect lifecycle: host listeners, retained history, and async
 * connection guards.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDraft: vi.fn(),
  isNetSuiteEnv: vi.fn(),
  autoLoadRecordIfAvailable: vi.fn(),
  fetchNsSampleData: vi.fn(),
  getNsContext: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../src/services/template.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/template.service')>(),
  getDraft: mocks.getDraft,
}));

vi.mock('../../src/services/netsuite-adapter.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/netsuite-adapter.service')>(),
  isNetSuiteEnv: mocks.isNetSuiteEnv,
  autoLoadRecordIfAvailable: mocks.autoLoadRecordIfAvailable,
  fetchNsSampleData: mocks.fetchNsSampleData,
  getNsContext: mocks.getNsContext,
}));

vi.mock('../../src/components/shared/toast-notification', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/components/shared/toast-notification')>(),
  showToast: mocks.showToast,
}));

import '../../src/components/app-shell';
import { addElementToNewBand } from '../../src/state/actions';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(shell: any): Promise<void> {
  await Promise.resolve();
  await shell.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function reconnect(shell: HTMLElement & { updateComplete: Promise<unknown> }): Promise<void> {
  shell.remove();
  document.body.appendChild(shell);
  await settle(shell);
}

beforeEach(() => {
  mocks.getDraft.mockReset().mockResolvedValue(null);
  mocks.isNetSuiteEnv.mockReset().mockReturnValue(false);
  mocks.autoLoadRecordIfAvailable.mockReset().mockResolvedValue(null);
  mocks.fetchNsSampleData.mockReset().mockResolvedValue({ data: {} });
  mocks.getNsContext.mockReset().mockReturnValue(null);
  mocks.showToast.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('app-shell reconnect lifecycle', () => {
  it('runs host and window actions exactly once after 100 reconnects', async () => {
    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await settle(shell);
    for (let index = 0; index < 100; index++) await reconnect(shell);

    const exportJson = vi.spyOn(shell, '_exportJson').mockImplementation(() => undefined);
    const saveTemplate = vi.spyOn(shell, '_saveTemplate').mockResolvedValue(undefined);

    shell.dispatchEvent(new CustomEvent('pld-show-export-json'));
    window.dispatchEvent(new CustomEvent('pld-save-template'));

    expect(exportJson).toHaveBeenCalledTimes(1);
    expect(saveTemplate).toHaveBeenCalledTimes(1);
  });

  it('retains the undo stack and installs one undo listener across reconnect', async () => {
    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await settle(shell);

    const firstId = addElementToNewBand(shell.store, 'text', 'content');
    await reconnect(shell);
    const secondId = addElementToNewBand(shell.store, 'text', 'content');
    expect(shell.store.state.elements.map((element: { id: string }) => element.id)).toEqual([firstId, secondId]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(shell.store.state.elements.map((element: { id: string }) => element.id)).toEqual([firstId]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(shell.store.state.elements).toHaveLength(0);
  });

  it('ignores a draft read completed by an obsolete connection', async () => {
    const firstDraft = deferred<any>();
    mocks.getDraft.mockReturnValueOnce(firstDraft.promise).mockResolvedValueOnce(null);

    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await reconnect(shell);

    firstDraft.resolve({
      templateId: null,
      templateName: 'stale draft',
      page: structuredClone(shell.store.state.page),
      pagination: structuredClone(shell.store.state.pagination),
      elements: [],
      jsonData: { stale: true },
      savedAt: '2026-09-12T00:00:00.000Z',
    });
    await settle(shell);

    expect(shell.showDraftBanner).toBe(false);
    expect(shell._pendingDraft).toBeNull();
  });

  it('does not let stale NetSuite auto-load overwrite the reconnected state', async () => {
    const firstLoad = deferred<Record<string, unknown> | null>();
    const secondLoad = deferred<Record<string, unknown> | null>();
    mocks.isNetSuiteEnv.mockReturnValue(true);
    mocks.autoLoadRecordIfAvailable
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await reconnect(shell);

    secondLoad.resolve({ _recordType: 'invoice', _internalId: 'new', marker: 'new' });
    await settle(shell);
    firstLoad.resolve({ _recordType: 'invoice', _internalId: 'stale', marker: 'stale' });
    await settle(shell);

    expect(shell.store.state.jsonData).toMatchObject({ marker: 'new' });
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith('Loaded invoice #new', 'success');
  });

  it('does not let initial NetSuite auto-load overwrite a newer local data edit', async () => {
    const pending = deferred<Record<string, unknown> | null>();
    mocks.isNetSuiteEnv.mockReturnValue(true);
    mocks.autoLoadRecordIfAvailable.mockReturnValueOnce(pending.promise);

    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await settle(shell);
    shell.store.dispatch((draft: any) => { draft.jsonData = { marker: 'local-edit' }; });

    pending.resolve({ _recordType: 'invoice', _internalId: 'stale', marker: 'autoload' });
    await settle(shell);

    expect(shell.store.state.jsonData).toEqual({ marker: 'local-edit' });
    expect(mocks.showToast).not.toHaveBeenCalledWith('Loaded invoice #stale', 'success');
  });

  it('does not let initial NetSuite auto-load cross a document switch', async () => {
    const pending = deferred<Record<string, unknown> | null>();
    mocks.isNetSuiteEnv.mockReturnValue(true);
    mocks.autoLoadRecordIfAvailable.mockReturnValueOnce(pending.promise);

    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await settle(shell);
    shell.store.beginDocumentSession();
    shell.store.dispatch((draft: any) => {
      draft.template.name = 'New document';
      draft.jsonData = { marker: 'new-document' };
    });

    pending.resolve({ _recordType: 'invoice', _internalId: 'stale', marker: 'autoload' });
    await settle(shell);

    expect(shell.store.state.jsonData).toEqual({ marker: 'new-document' });
  });

  it('applies only the latest sample-data request when responses reverse', async () => {
    const first = deferred<{ data: Record<string, unknown> }>();
    const second = deferred<{ data: Record<string, unknown> }>();
    mocks.fetchNsSampleData
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await settle(shell);
    const firstLoad = shell._loadSampleData();
    const secondLoad = shell._loadSampleData();

    second.resolve({ data: { marker: 'newest' } });
    await secondLoad;
    first.resolve({ data: { marker: 'stale' } });
    await firstLoad;

    expect(shell.store.state.jsonData).toEqual({ marker: 'newest' });
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it('does not let pending sample data overwrite a newer local edit', async () => {
    const pending = deferred<{ data: Record<string, unknown> }>();
    mocks.fetchNsSampleData.mockReturnValueOnce(pending.promise);

    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await settle(shell);
    const load = shell._loadSampleData();
    shell.store.dispatch((draft: any) => { draft.jsonData = { marker: 'local-edit' }; });
    pending.resolve({ data: { marker: 'stale-sample' } });
    await load;

    expect(shell.store.state.jsonData).toEqual({ marker: 'local-edit' });
  });
});

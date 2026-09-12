/**
 * Tests: autosave draft persistence (#140)
 * saveDraft/getDraft round-trip the in-progress design; clearDraft removes it;
 * getDraft returns null when no draft has ever been saved.
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import { describe, it, expect, vi } from 'vitest';

// In-memory stand-in for idb-keyval (node env has no IndexedDB)
vi.mock('idb-keyval', () => {
  const mem = new Map<string, unknown>();
  return {
    get: async (k: string) => mem.get(k),
    update: async (k: string, fn: (v: unknown) => unknown) => { mem.set(k, fn(mem.get(k))); },
    set: async (k: string, v: unknown) => { mem.set(k, v); },
    del: async (k: string) => { mem.delete(k); },
    keys: async () => [...mem.keys()],
  };
});

import { AppStore } from '../../src/state/store';
import { addElement, regenerateBands, setColumnWidth } from '../../src/state/actions';
import { saveDraft, getDraft, clearDraft, claimDraft, dismissDraft, saveTemplate, DRAFT_KEY } from '../../src/services/template.service';

const NOW = '2026-07-24T09:00:00.000Z';

describe('getDraft (#140)', () => {
  it('returns null when nothing has been autosaved yet', async () => {
    await clearDraft(); // ensure clean slate — earlier tests may have written to the shared mock store
    expect(await getDraft()).toBeNull();
  });
});

describe('saveDraft / getDraft round-trip (#140)', () => {
  it('preserves canonical XML mode and exact source', async () => {
    const store = new AppStore();
    const xml = '<?xml version="1.0"?>\n<pdf>\n  <#if record.tranid?has_content>${record.tranid}</#if>\n</pdf>\n';
    store.dispatch((draft) => {
      draft.editorMode = 'xml';
      draft.rawXml = xml;
      draft.template.name = 'Canonical draft';
      draft.template.isDirty = true;
    });

    await saveDraft(store, NOW);

    expect(await getDraft()).toMatchObject({
      editorMode: 'xml',
      rawXml: xml,
      templateName: 'Canonical draft',
    });
  });

  it('persists the current design under a fixed key and reads it back', async () => {
    const store = new AppStore();
    addElement(store, 'header', 0, 0);
    addElement(store, 'header', 300, 0); // same row → 2 columns
    regenerateBands(store);
    setColumnWidth(store, 0, 0, 0, 25);
    store.dispatch((d) => {
      d.template.name = 'Tax Invoice (draft)';
      d.template.id = 'tpl-1';
    });

    await saveDraft(store, NOW);
    const draft = await getDraft();

    expect(draft).not.toBeNull();
    expect(draft!.templateId).toBe('tpl-1');
    expect(draft!.templateName).toBe('Tax Invoice (draft)');
    expect(draft!.elements).toEqual(store.state.elements);
    expect(draft!.bands![0].rows[0].columns[0].widthPct).toBe(25);
    expect(draft!.savedAt).toBe(NOW);
  });

  it('does not call Date.now()/new Date() internally — the timestamp is exactly what the caller passed', async () => {
    const store = new AppStore();
    const fixedTimestamp = '1999-01-01T00:00:00.000Z';
    await saveDraft(store, fixedTimestamp);
    const draft = await getDraft();
    expect(draft!.savedAt).toBe(fixedTimestamp);
  });

  it('overwrites the previous draft — only one draft slot is ever kept', async () => {
    const store = new AppStore();
    store.dispatch((d) => { d.template.name = 'First'; });
    await saveDraft(store, NOW);

    store.dispatch((d) => { d.template.name = 'Second'; });
    await saveDraft(store, NOW);

    const draft = await getDraft();
    expect(draft!.templateName).toBe('Second');
  });

  it('deep-copies content — mutating the store after saveDraft does not affect the stored draft', async () => {
    const store = new AppStore();
    addElement(store, 'header', 0, 0);
    await saveDraft(store, NOW);

    store.dispatch((d) => { d.elements[0].x = 999; });

    const draft = await getDraft();
    expect(draft!.elements[0].x).not.toBe(999);
  });
});

describe('clearDraft (#140)', () => {
  it('removes the stored draft so a subsequent getDraft returns null', async () => {
    const store = new AppStore();
    await saveDraft(store, NOW);
    expect(await getDraft()).not.toBeNull();

    await clearDraft();
    expect(await getDraft()).toBeNull();
  });

  it('is a no-op (does not throw) when there is nothing to clear', async () => {
    await clearDraft();
    await expect(clearDraft()).resolves.not.toThrow();
  });
});

describe('DRAFT_KEY (#140)', () => {
  it('is the fixed key documented in the issue', () => {
    expect(DRAFT_KEY).toBe('pld-draft-current');
  });
});


describe('recovery entry ownership', () => {
  it('immediate save after restoring clears the claimed draft without waiting for autosave', async () => {
    const previous = new AppStore();
    addElement(previous, 'text', 0, 0);
    await saveDraft(previous, NOW);
    const restored = (await getDraft())!;
    const current = new AppStore();
    current.dispatch((d) => { d.elements = restored.elements; d.template.isDirty = true; });
    await claimDraft(current, restored);
    await saveTemplate(current);
    expect(await getDraft()).toBeNull();
  });

  it('restoring or discarding an older banner preserves a different editor newer draft', async () => {
    const previous = new AppStore();
    await saveDraft(previous, NOW);
    const reviewed = (await getDraft())!;
    const other = new AppStore();
    other.dispatch((d) => { d.template.name = 'Newer recovery'; });
    await saveDraft(other, NOW);
    await claimDraft(previous, reviewed);
    await dismissDraft(reviewed);
    expect((await getDraft())?.templateName).toBe('Newer recovery');
  });
});

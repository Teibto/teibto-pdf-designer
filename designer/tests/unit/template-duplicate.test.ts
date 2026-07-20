/**
 * Tests: template duplication (#105)
 * IndexedDB duplicate — new id, " (copy)" name, deep copy.
 * NetSuite duplicate — server-side clone via get→save, never copies default.
 * @author Wichit Wongta
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for idb-keyval (node env has no IndexedDB)
vi.mock('idb-keyval', () => {
  const mem = new Map<string, unknown>();
  return {
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => { mem.set(k, v); },
    del: async (k: string) => { mem.delete(k); },
    keys: async () => [...mem.keys()],
  };
});

import { AppStore } from '../../src/state/store';
import { addElement, regenerateBands, setColumnWidth } from '../../src/state/actions';
import {
  saveTemplate,
  listTemplates,
  duplicateTemplate,
} from '../../src/services/template.service';
import { duplicateNsTemplate } from '../../src/services/netsuite-adapter.service';

/** Save a template with band edits and return it. */
async function savedTemplate() {
  const store = new AppStore();
  addElement(store, 'header', 0, 0);
  addElement(store, 'header', 300, 0); // same row → 2 columns
  regenerateBands(store);
  setColumnWidth(store, 0, 0, 0, 25);
  store.dispatch((d) => { d.template.name = 'Tax Invoice'; });
  return saveTemplate(store);
}

describe('duplicateTemplate (#105, IndexedDB)', () => {
  it('creates a copy under a new id named "<name> (copy)"', async () => {
    const src = await savedTemplate();
    const copy = await duplicateTemplate(src.id);

    expect(copy.id).not.toBe(src.id);
    expect(copy.name).toBe('Tax Invoice (copy)');

    const all = await listTemplates();
    expect(all.map((t) => t.id)).toContain(src.id);
    expect(all.map((t) => t.id)).toContain(copy.id);
  });

  it('deep-copies content — band edits carried over, source untouched', async () => {
    const src = await savedTemplate();
    const copy = await duplicateTemplate(src.id);

    expect(copy.elements).toEqual(src.elements);
    expect(copy.bands![0].rows[0].columns[0].widthPct).toBe(25);

    // mutate the copy; reload the source and check it is unchanged
    copy.bands![0].rows[0].columns[0].widthPct = 99;
    const all = await listTemplates();
    const srcAgain = all.find((t) => t.id === src.id)!;
    expect(srcAgain.bands![0].rows[0].columns[0].widthPct).toBe(25);
  });

  it('throws for an unknown template id', async () => {
    await expect(duplicateTemplate('missing-id')).rejects.toThrow('Template not found');
  });
});

describe('duplicateNsTemplate (#105, NetSuite)', () => {
  const saveBodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    saveBodies.length = 0;
    (globalThis as unknown as { window: unknown }).window = {
      __NS_CONTEXT__: { userId: 1 },
      __NS_RENDER_URL__: 'https://sb2.example.com/app/render.nl',
      location: { origin: 'https://sb2.example.com' },
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const action = url.searchParams.get('action');
      if (action === 'get') {
        return new Response(JSON.stringify({
          id: '21', name: 'Tax Invoice', data: '{"elements":[]}',
          xml: '<?xml version="1.0"?><pdf/>', rectype: 'invoice', isDefault: true,
        }), { status: 200 });
      }
      if (action === 'save') {
        saveBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: '99', success: true }), { status: 200 });
      }
      throw new Error(`unexpected action: ${action}`);
    }) as typeof fetch;
  });

  it('clones data + xml + rectype into a NEW record named " (copy)"', async () => {
    const result = await duplicateNsTemplate('21');

    expect(result).toEqual({ id: '99', name: 'Tax Invoice (copy)' });
    expect(saveBodies).toHaveLength(1);
    expect(saveBodies[0]).toMatchObject({
      id: null, // no id → suitelet creates a new record
      name: 'Tax Invoice (copy)',
      data: '{"elements":[]}',
      xml: '<?xml version="1.0"?><pdf/>',
      rectype: 'invoice',
    });
  });

  it('never copies the default flag — even when the source is default', async () => {
    await duplicateNsTemplate('21');
    expect(saveBodies[0].isDefault).toBe(false);
  });
});

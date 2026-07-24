/**
 * Tests: saveTemplateToNetSuite (#137)
 * The 💾 save path must persist to the NetSuite customrecord when in-account —
 * generating BFO XML from the authoritative band layout — and must THROW on
 * failure (no silent IndexedDB fallback, R4). rectype defaults to the record the
 * designer was opened from (nsContext).
 * @author Wichit Wongta
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { addElementToNewBand } from '../../src/state/actions';
import { saveTemplateToNetSuite } from '../../src/services/template.service';

const savedBodies: Record<string, unknown>[] = [];
const originalWindow = (globalThis as { window?: unknown }).window;

function mockNs(ctx: Record<string, unknown> = { userId: 1, recordType: 'invoice' }) {
  (globalThis as unknown as { window: unknown }).window = {
    __NS_CONTEXT__: ctx,
    __NS_RENDER_URL__: 'https://sb2.example.com/app/render.nl',
    location: { origin: 'https://sb2.example.com' },
  };
}

describe('saveTemplateToNetSuite (#137)', () => {
  beforeEach(() => {
    savedBodies.length = 0;
    mockNs();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get('action') === 'save') {
        savedBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: '42', success: true }), { status: 200 });
      }
      throw new Error(`unexpected action: ${url.searchParams.get('action')}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    vi.restoreAllMocks();
  });

  function storeWithContent(): AppStore {
    const store = new AppStore();
    addElementToNewBand(store, 'text', 'content');
    store.dispatch((d) => { d.template.name = 'My Template'; });
    return store;
  }

  it('POSTs designer JSON + generated BFO XML to the save action', async () => {
    const store = storeWithContent();
    const result = await saveTemplateToNetSuite(store);

    expect(result.id).toBe('42');
    expect(savedBodies).toHaveLength(1);
    const body = savedBodies[0] as { name: string; data: string; xml: string; rectype: string };
    expect(body.name).toBe('My Template');
    // xml is the real BFO export, not empty
    expect(body.xml).toContain('<pdf');
    // data carries the band structure so a re-edit restores it (#47 3b)
    const data = JSON.parse(body.data);
    expect(data.bands).toBeTruthy();
    expect(data.elements).toHaveLength(1);
  });

  it('defaults rectype to the record the designer was opened from', async () => {
    const store = storeWithContent();
    await saveTemplateToNetSuite(store);
    expect((savedBodies[0] as { rectype: string }).rectype).toBe('invoice');
  });

  it('opts.rectype + opts.isDefault override the context default (#138 save dialog)', async () => {
    const store = storeWithContent();
    await saveTemplateToNetSuite(store, { rectype: 'purchaseorder', isDefault: true });
    const body = savedBodies[0] as { rectype: string; isDefault: boolean };
    expect(body.rectype).toBe('purchaseorder');
    expect(body.isDefault).toBe(true);
  });

  it('opts.isDefault false is passed through (save without hijacking the print default)', async () => {
    const store = storeWithContent();
    await saveTemplateToNetSuite(store, { rectype: 'invoice', isDefault: false });
    expect((savedBodies[0] as { isDefault: boolean }).isDefault).toBe(false);
  });

  it('marks the template clean and records the returned id', async () => {
    const store = storeWithContent();
    expect(store.state.template.isDirty).toBe(true);
    await saveTemplateToNetSuite(store);
    expect(store.state.template.id).toBe('42');
    expect(store.state.template.isDirty).toBe(false);
  });

  it('surfaces a session-expired error when NetSuite returns 200 + HTML login (#139)', async () => {
    // Session expiry: NetSuite answers 200 with an HTML login page, not 401/JSON.
    globalThis.fetch = vi.fn(async () =>
      new Response('<!DOCTYPE html><html><body>Please log in</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ) as typeof fetch;

    const store = storeWithContent();
    await expect(saveTemplateToNetSuite(store)).rejects.toThrow(/เซสชัน NetSuite หมดอายุ|session/i);
    // must NOT be marked saved — the work is still unpersisted
    expect(store.state.template.isDirty).toBe(true);
    expect(store.state.template.id).toBeNull();
  });

  it('THROWS on a server error — no silent local fallback (R4)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'RECORD_SAVE_FAILED' }), { status: 200 }),
    ) as typeof fetch;

    const store = storeWithContent();
    await expect(saveTemplateToNetSuite(store)).rejects.toThrow('RECORD_SAVE_FAILED');
    // failure must stay dirty so the user knows it did NOT persist
    expect(store.state.template.isDirty).toBe(true);
  });
});

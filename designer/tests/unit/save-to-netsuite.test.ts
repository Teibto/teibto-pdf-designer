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
    update: async (k: string, fn: (v: unknown) => unknown) => { mem.set(k, fn(mem.get(k))); },
    set: vi.fn(async (k: string, v: unknown) => { mem.set(k, v); }),
    del: async (k: string) => { mem.delete(k); },
    keys: async () => [...mem.keys()],
  };
});

import { AppStore } from '../../src/state/store';
import { addElementToNewBand } from '../../src/state/actions';
import { set } from 'idb-keyval';
import { saveDraft, getDraft, saveTemplate, saveTemplateToNetSuite } from '../../src/services/template.service';

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

  it('does not mark a newer local edit clean when IndexedDB finishes', async () => {
    let complete!: () => void;
    vi.mocked(set).mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const store = storeWithContent();
    const pending = saveTemplate(store);
    store.dispatch((d) => { d.template.name = 'Newer draft'; });
    complete();
    await pending;
    expect(store.state.template).toMatchObject({ name: 'Newer draft', isDirty: true });
  });

  it('prevents concurrent create requests and releases the lock after failure', async () => {
    let reject!: (reason: Error) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((_, fail) => { reject = fail; }));
    const store = storeWithContent();
    const first = saveTemplateToNetSuite(store);
    await expect(saveTemplateToNetSuite(store)).rejects.toThrow('กำลังบันทึก');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    reject(new Error('failed'));
    await expect(first).rejects.toThrow('failed');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: '42', success: true })));
    await expect(saveTemplateToNetSuite(store)).resolves.toEqual({ id: '42' });
  });

  it.each(['edit', 'switch', 'reset'] as const)('preserves unsaved state after %s during save', async (change) => {
    const store = storeWithContent();
    let complete!: (value: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = saveTemplateToNetSuite(store);
    if (change === 'edit') store.dispatch((d) => { d.elements[0].x += 1; });
    if (change === 'switch') store.dispatch((d) => { d.template.id = 'other'; });
    if (change === 'reset') store.reset();
    const current = store.state;
    complete(new Response(JSON.stringify({ id: '42', success: true })));
    await pending;
    if (change === 'edit') {
      expect(store.state.template).toMatchObject({ id: '42', isDirty: true });
      expect(store.state.elements).toBe(current.elements);
    } else expect(store.state).toBe(current);
  });

  it('updates the created record on the next save after editing during creation', async () => {
    const store = storeWithContent();
    let complete!: (value: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = saveTemplateToNetSuite(store);
    store.dispatch((d) => { d.template.name = 'Edited while creating'; });
    complete(new Response(JSON.stringify({ id: '42', success: true })));
    await pending;
    expect(store.state.template).toMatchObject({ id: '42', isDirty: true });
    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ id: '42', name: 'Edited while creating' });
      return new Response(JSON.stringify({ id: '42', success: true }));
    });
    await saveTemplateToNetSuite(store);
    expect(store.state.template.isDirty).toBe(false);
  });

  it('does not acknowledge a reloaded session even with identical template ID and content', async () => {
    const store = storeWithContent();
    let complete!: (value: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = saveTemplateToNetSuite(store);
    store.beginDocumentSession();
    const current = store.state;
    complete(new Response(JSON.stringify({ id: '42', success: true })));
    await pending;
    expect(store.state).toBe(current);
  });

  it('still acknowledges a save when only selection or zoom changes', async () => {
    const store = storeWithContent();
    let complete!: (value: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = saveTemplateToNetSuite(store);
    store.dispatch((d) => { d.zoom = 150; d.selectedId = null; });
    complete(new Response(JSON.stringify({ id: '42', success: true })));
    await pending;
    expect(store.state.template).toMatchObject({ id: '42', isDirty: false });
  });

  it.each([503, 'network', 'timeout'] as const)('never retries ambiguous save failure %s', async (failure) => {
    globalThis.fetch = vi.fn(async () => {
      if (failure === 'network') throw new TypeError('connection lost');
      if (failure === 'timeout') throw new DOMException('aborted', 'AbortError');
      return new Response('', { status: failure });
    });
    await expect(saveTemplateToNetSuite(storeWithContent())).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

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

  it('retains the durable saved ID and propagates server warnings', async () => {
    const store = storeWithContent();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: '42', success: true, warning: 'Default conflict' }), { status: 200 }));
    const result = await saveTemplateToNetSuite(store, { isDefault: true });
    expect(result).toEqual({ id: '42', warning: 'Default conflict' });
    expect(store.state.template.id).toBe('42');
    expect(store.state.template.isDirty).toBe(false);
  });

  it('quick-save preserves existing server metadata even when launched from another record type', async () => {
    const store = storeWithContent();
    store.dispatch((d) => {
      d.template.id = '42';
      d.template.nsMetadata = { rectype: 'purchaseorder', isDefault: true };
    });
    await saveTemplateToNetSuite(store);
    expect(savedBodies[0]).not.toHaveProperty('rectype');
    expect(savedBodies[0]).not.toHaveProperty('isDefault');
  });

  it('dialog service save clears only its own saved-session draft', async () => {
    const store = storeWithContent();
    await saveDraft(store, '2026-09-09T00:00:00Z');
    await saveTemplateToNetSuite(store, { rectype: 'purchaseorder', isDefault: false });
    expect(await getDraft()).toBeNull();
    expect(store.state.template.nsMetadata).toEqual({ rectype: 'purchaseorder', isDefault: false });
  });

  it('preserves a newer draft while the NetSuite save request is in flight', async () => {
    const store = storeWithContent();
    await saveDraft(store, '2026-09-09T00:00:00Z');
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = saveTemplateToNetSuite(store, { isDefault: false });
    store.dispatch((d) => { d.template.name = 'Newer work'; d.template.isDirty = true; });
    await saveDraft(store, '2026-09-09T00:00:01Z');
    complete(new Response(JSON.stringify({ id: '42', success: true }), { status: 200 }));
    await pending;
    expect((await getDraft())?.templateName).toBe('Newer work');
    expect(store.state.template.isDirty).toBe(true);
  });

  it('saving one editor preserves another editor recovery draft', async () => {
    const store = storeWithContent();
    const other = storeWithContent();
    other.dispatch((d) => { d.template.name = 'Other editor'; });
    await saveDraft(other, '2026-09-09T00:00:00Z');
    await saveTemplateToNetSuite(store);
    expect((await getDraft())?.templateName).toBe('Other editor');
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

  it('rejects BEFORE POST when a huge embedded image overflows the CLOBTEXT cap (#143)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const store = storeWithContent();
    // inject an image element carrying ~1.1M chars of base64 (over the ~990K guard)
    store.dispatch((d) => {
      d.elements.push({
        id: 'imgbig', type: 'image', name: 'big', role: 'content',
        w: 100, h: 100, zIndex: 1, locked: false, visible: true,
        objectFit: 'contain', imageData: 'A'.repeat(1_100_000),
      } as never);
    });

    await expect(saveTemplateToNetSuite(store)).rejects.toThrow(/ใหญ่เกินไป|จำกัด/);
    expect(fetchSpy).not.toHaveBeenCalled();        // never hit the server
    expect(store.state.template.isDirty).toBe(true); // not marked saved
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

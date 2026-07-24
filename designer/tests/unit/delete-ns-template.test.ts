/**
 * Tests: deleteNsTemplate (#142 — default-template safety net)
 * The SPA previously had no way to delete a NetSuite template record at all
 * (only Load + Duplicate). deleteNsTemplate must:
 *   - POST to the render suitelet's 'delete' action with tplid
 *   - surface wasDefault so the caller can warn the record type is now left
 *     without a default (Print falls back to "No template found")
 *   - THROW on a server error response — no silent swallow (R4)
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteNsTemplate } from '../../src/services/netsuite-adapter.service';

const originalWindow = (globalThis as { window?: unknown }).window;

function mockNs() {
  (globalThis as unknown as { window: unknown }).window = {
    __NS_CONTEXT__: { userId: 1 },
    __NS_RENDER_URL__: 'https://sb2.example.com/app/render.nl',
    location: { origin: 'https://sb2.example.com' },
  };
}

describe('deleteNsTemplate (#142)', () => {
  beforeEach(() => {
    mockNs();
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('POSTs to the delete action with tplid and returns success', async () => {
    let seenUrl: URL | null = null;
    let seenMethod: string | undefined;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = new URL(String(input));
      seenMethod = init?.method;
      return new Response(JSON.stringify({ success: true, wasDefault: false }), { status: 200 });
    }) as typeof fetch;

    const result = await deleteNsTemplate('21');

    expect(result).toEqual({ success: true, wasDefault: false });
    expect(seenUrl!.searchParams.get('action')).toBe('delete');
    expect(seenUrl!.searchParams.get('tplid')).toBe('21');
    expect(seenMethod).toBe('POST');
  });

  it('surfaces wasDefault:true so the caller can warn about a missing default', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, wasDefault: true }), { status: 200 }),
    ) as typeof fetch;

    const result = await deleteNsTemplate('21');
    expect(result.wasDefault).toBe(true);
  });

  it('THROWS on a server error response — no silent swallow (R4)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'RECORD_DOES_NOT_EXIST' }), { status: 200 }),
    ) as typeof fetch;

    await expect(deleteNsTemplate('missing')).rejects.toThrow('RECORD_DOES_NOT_EXIST');
  });

  it('surfaces a session-expired error when NetSuite returns 200 + HTML login (#139)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('<!DOCTYPE html><html><body>Please log in</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ) as typeof fetch;

    await expect(deleteNsTemplate('21')).rejects.toThrow(/เซสชัน NetSuite หมดอายุ|session/i);
  });
});

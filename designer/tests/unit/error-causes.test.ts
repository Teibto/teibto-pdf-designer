/**
 * Preserve original failures while presenting actionable import/preview errors.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { afterEach, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import { importTemplateJson } from '../../src/services/template.service';
import { renderLivePreview } from '../../src/services/netsuite-adapter.service';

afterEach(() => vi.unstubAllGlobals());

it('keeps the JSON parser error and leaves the template unchanged', () => {
  const store = new AppStore();
  const before = store.state;
  let failure: unknown;
  try { importTemplateJson(store, '{invalid'); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('Invalid JSON:');
  expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
  expect(store.state).toBe(before);
});

it('keeps the abort cause when the live preview times out', async () => {
  vi.stubGlobal('window', {
    __NS_RENDER_URL__: 'https://sandbox.example.com/render',
    location: { origin: 'https://sandbox.example.com' },
  });
  const cause = new DOMException('The operation was aborted', 'AbortError');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  await expect(renderLivePreview({ xml: '<pdf/>', rectype: 'invoice', sample: true }))
    .rejects.toMatchObject({ message: expect.stringContaining('Preview render timeout'), cause });
});

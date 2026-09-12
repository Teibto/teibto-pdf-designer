// @vitest-environment jsdom
/** @author Wichit Wongta
 * @since 2026-09-13
 */
import { afterEach, expect, it, vi } from 'vitest';
import { loadRecordData, renderLivePreview } from '../../src/services/netsuite-adapter.service';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('aborts a pending GET without retrying or reporting timeout', async () => {
  (window as any).__NS_SUITELET_URL__ = '/designer';
  const fetch = vi.fn((_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const result = loadRecordData('invoice', '213', controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('cancels retry backoff before another GET', async () => {
  vi.useFakeTimers();
  (window as any).__NS_SUITELET_URL__ = '/designer';
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const result = loadRecordData('invoice', '213', controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not start an already-cancelled preview request', async () => {
  (window as any).__NS_RENDER_URL__ = '/render';
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController(); controller.abort();
  await expect(renderLivePreview({ xml: '<pdf/>', rectype: 'invoice', signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();
});

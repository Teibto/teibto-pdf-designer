/**
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { afterEach, expect, it, vi } from 'vitest';
import { yieldTask } from '../../src/utils/yield-task';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('aborts a pending scheduler yield immediately and ignores its late completion', async () => {
  let resume!: () => void;
  vi.stubGlobal('scheduler', { yield: () => new Promise<void>((resolve) => { resume = resolve; }) });
  const controller = new AbortController();
  const pending = yieldTask(controller.signal);
  controller.abort();
  await expect(pending).rejects.toBe(controller.signal.reason);
  resume();
  await Promise.resolve();
});

it.each([false, true])('closes both fallback message ports after completion/abort (abort=%s)', async (abort) => {
  vi.stubGlobal('scheduler', undefined);
  const port1 = { onmessage: null as null | (() => void), close: vi.fn() };
  const port2 = { postMessage: vi.fn(), close: vi.fn() };
  vi.stubGlobal('MessageChannel', class { port1 = port1; port2 = port2; });
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = yieldTask(controller.signal);
  expect(port2.postMessage).toHaveBeenCalledOnce();
  if (abort) {
    controller.abort();
    await expect(pending).rejects.toBe(controller.signal.reason);
  } else {
    port1.onmessage!();
    await pending;
  }
  expect(port1.close).toHaveBeenCalledOnce();
  expect(port2.close).toHaveBeenCalledOnce();
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('does not schedule work when already aborted', async () => {
  const schedule = vi.fn();
  vi.stubGlobal('scheduler', { yield: schedule });
  const controller = new AbortController();
  controller.abort();
  await expect(yieldTask(controller.signal)).rejects.toBe(controller.signal.reason);
  expect(schedule).not.toHaveBeenCalled();
});

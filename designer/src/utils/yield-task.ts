/**
 * Yield a browser task without depending on a visible animation frame.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
export function yieldTask(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let channel: MessageChannel | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (failed = false, reason?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      channel?.port1.close();
      channel?.port2.close();
      if (timer !== undefined) clearTimeout(timer);
      if (failed) reject(reason);
      else resolve();
    };
    const abort = () => finish(true, signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    const scheduler = (globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }).scheduler;
    try {
      if (typeof scheduler?.yield === 'function') {
        scheduler.yield().then(() => finish(), (error: unknown) => finish(true, error));
      } else if (typeof MessageChannel !== 'undefined') {
        channel = new MessageChannel();
        channel.port1.onmessage = () => finish();
        channel.port2.postMessage(null);
      } else {
        timer = setTimeout(() => finish(), 0);
      }
    } catch (error) {
      finish(true, error);
    }
  });
}

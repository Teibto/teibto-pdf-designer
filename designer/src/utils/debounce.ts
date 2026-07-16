/**
 * Timing Utilities
 * @author Wichit Wongta
 */

/** Debounce a function — only execute after `delay` ms of inactivity */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay = 16,
): T & { cancel(): void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  } as T & { cancel(): void };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

/** Throttle a function — execute at most once per `limit` ms */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  limit = 16,
): T {
  let inThrottle = false;

  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  } as T;
}

/** Schedule a function on the next animation frame (deduplicated) */
export function scheduleRender(fn: () => void): number {
  return requestAnimationFrame(fn);
}

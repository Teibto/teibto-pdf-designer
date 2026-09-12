// @vitest-environment jsdom
/**
 * Column-resize animation-frame scheduling regressions.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import { HistoryService } from '../../src/services/history.service';
import { applyMiddleware, tagAction } from '../../src/state/middleware';
import '../../src/components/canvas/band-view';

interface FrameHarness {
  callbacks: Map<number, FrameRequestCallback>;
  request: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  runNext(): void;
}

function installFrameHarness(): FrameHarness {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => { callbacks.delete(id); });
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    callbacks,
    request,
    cancel,
    runNext() {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error('No animation frame is pending');
      callbacks.delete(entry[0]);
      entry[1](0);
    },
  };
}

function createStore(): AppStore {
  const store = new AppStore();
  store.dispatch((state) => {
    state.bands = [{
      role: 'content',
      rows: [{
        id: 'row',
        columns: [
          { id: 'left', widthPct: 50, elementIds: [] },
          { id: 'right', widthPct: 50, elementIds: [] },
        ],
      }],
    }];
  });
  return store;
}

function pointerTarget(rowWidth = 100) {
  return {
    closest: vi.fn(() => ({ offsetWidth: rowWidth })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}

function pointerEvent(target: ReturnType<typeof pointerTarget>, clientX: number) {
  return {
    currentTarget: target,
    clientX,
    pointerId: 1,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

describe('band column resize scheduling', () => {
  let frames: FrameHarness;
  let store: AppStore;
  let component: HTMLElement & Record<string, unknown>;
  let target: ReturnType<typeof pointerTarget>;
  let stateChanged: ReturnType<typeof vi.fn>;
  let history: HistoryService;
  let cleanupHistory: () => void;

  beforeEach(() => {
    frames = installFrameHarness();
    store = createStore();
    history = new HistoryService(store);
    cleanupHistory = applyMiddleware(store, [history.createMiddleware()]);
    component = document.createElement('pld-band-view') as HTMLElement & Record<string, unknown>;
    component.store = store;
    document.body.appendChild(component);
    target = pointerTarget();
    stateChanged = vi.fn();
    store.addEventListener('state-changed', stateChanged);
    (component._onResizeStart as Function)(pointerEvent(target, 0), 0, 0, 0, 50, 50);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    cleanupHistory();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const move = (clientX: number) => {
    (component._onResizeMove as Function)(pointerEvent(target, clientX));
  };

  const end = (clientX: number) => {
    (component._onResizeEnd as Function)(pointerEvent(target, clientX));
  };

  const widths = () => store.state.bands[0].rows[0].columns.map((column) => column.widthPct);

  it('coalesces multiple pointer moves into the latest update in one frame', () => {
    move(10);
    move(20);
    move(30);

    expect(frames.request).toHaveBeenCalledTimes(1);
    expect(stateChanged).not.toHaveBeenCalled();
    expect(widths()).toEqual([50, 50]);

    frames.runNext();
    expect(stateChanged).toHaveBeenCalledTimes(1);
    expect(widths()).toEqual([80, 20]);
  });

  it('schedules and dispatches another update in the next frame', () => {
    move(10);
    frames.runNext();
    move(20);

    expect(frames.request).toHaveBeenCalledTimes(2);
    expect(stateChanged).toHaveBeenCalledTimes(1);
    frames.runNext();
    expect(stateChanged).toHaveBeenCalledTimes(2);
    expect(widths()).toEqual([70, 30]);
  });

  it('flushes the exact final pending size when resize ends before the frame', () => {
    move(17);
    end(17);

    expect(frames.cancel).toHaveBeenCalledTimes(1);
    expect(frames.callbacks.size).toBe(0);
    expect(stateChanged).toHaveBeenCalledTimes(1);
    expect(widths()).toEqual([67, 33]);
  });

  it('cancels pending work and does not dispatch after disconnect', () => {
    move(25);
    component.remove();

    expect(frames.cancel).toHaveBeenCalledTimes(1);
    expect(frames.callbacks.size).toBe(0);
    expect(stateChanged).not.toHaveBeenCalled();
    expect(widths()).toEqual([50, 50]);
    expect(component._resizing).toBeNull();
    expect(component._pendingResize).toBeNull();
    expect(component._resizeFrame).toBeNull();
  });

  it('records one undo snapshot for a slow multi-frame gesture', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    move(10);
    frames.runNext();

    now.mockReturnValue(1_000);
    move(20);
    frames.runNext();

    expect(history.stats.undoCount).toBe(1);
    expect(widths()).toEqual([70, 30]);
    expect(history.undo()).toBe(true);
    expect(widths()).toEqual([50, 50]);
  });

  it('keeps separate resize gestures as separate undo entries', () => {
    move(10);
    frames.runNext();
    end(10);

    (component._onResizeStart as Function)(pointerEvent(target, 10), 0, 0, 0, 60, 40);
    move(20);
    frames.runNext();
    end(20);

    expect(history.stats.undoCount).toBe(2);
    expect(widths()).toEqual([70, 30]);
    expect(history.undo()).toBe(true);
    expect(widths()).toEqual([60, 40]);
  });

  it('does not record a no-op gesture at the clamped boundary', () => {
    end(0);
    store.dispatch(tagAction((state) => {
      state.bands[0].rows[0].columns[0].widthPct = 5;
      state.bands[0].rows[0].columns[1].widthPct = 95;
    }, { name: 'seedClamp', undoable: false }));
    stateChanged.mockClear();

    (component._onResizeStart as Function)(pointerEvent(target, 0), 0, 0, 0, 5, 95);
    move(-25);
    frames.runNext();

    expect(widths()).toEqual([5, 95]);
    expect(stateChanged).not.toHaveBeenCalled();
    expect(history.stats.undoCount).toBe(0);

    move(10);
    frames.runNext();
    expect(widths()).toEqual([15, 85]);
    expect(history.stats.undoCount).toBe(1);
  });
});

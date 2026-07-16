/**
 * Tests: state/store.ts & state/middleware.ts
 * @author Wichit Wongta
 */
import { describe, it, expect, vi } from 'vitest';
import { AppStore, StateChangedEvent } from '../../src/state/store';
import {
  applyMiddleware,
  tagAction,
  getActionTag,
  NON_UNDOABLE_ACTIONS,
  type Middleware,
} from '../../src/state/middleware';

// ═══════════════════════════════════════
// STORE
// ═══════════════════════════════════════

describe('AppStore', () => {
  it('creates with default state', () => {
    const store = new AppStore();
    expect(store.state.elements).toEqual([]);
    expect(store.state.zoom).toBe(100);
    expect(store.state.view).toBe('design');
  });

  it('dispatches mutations immutably', () => {
    const store = new AppStore();
    const prevState = store.state;

    store.dispatch((d) => { d.zoom = 150; });

    expect(store.state.zoom).toBe(150);
    expect(store.state).not.toBe(prevState);
  });

  it('fires state-changed event on mutation', () => {
    const store = new AppStore();
    const handler = vi.fn();
    store.addEventListener('state-changed', handler);

    store.dispatch((d) => { d.zoom = 200; });

    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0][0] as StateChangedEvent).state.zoom).toBe(200);
  });

  it('does not fire event if state unchanged', () => {
    const store = new AppStore();
    const handler = vi.fn();
    store.addEventListener('state-changed', handler);

    store.dispatch((_d) => { /* no-op */ });

    expect(handler).not.toHaveBeenCalled();
  });

  it('select reads state slice', () => {
    const store = new AppStore();
    store.dispatch((d) => { d.zoom = 175; });

    expect(store.select((s) => s.zoom)).toBe(175);
  });

  it('reset restores initial state', () => {
    const store = new AppStore();
    store.dispatch((d) => {
      d.zoom = 200;
      d.view = 'flow';
    });

    store.reset();

    expect(store.state.zoom).toBe(100);
    expect(store.state.view).toBe('design');
  });
});

// ═══════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════

describe('applyMiddleware', () => {
  it('intercepts dispatches', () => {
    const store = new AppStore();
    const log: string[] = [];

    const loggingMiddleware: Middleware = (_api) => (next) => (recipe) => {
      log.push('before');
      next(recipe);
      log.push('after');
    };

    applyMiddleware(store, [loggingMiddleware]);
    store.dispatch((d) => { d.zoom = 150; });

    expect(log).toEqual(['before', 'after']);
    expect(store.state.zoom).toBe(150);
  });

  it('chains multiple middlewares', () => {
    const store = new AppStore();
    const log: string[] = [];

    const mw1: Middleware = (_api) => (next) => (recipe) => {
      log.push('mw1-before');
      next(recipe);
      log.push('mw1-after');
    };

    const mw2: Middleware = (_api) => (next) => (recipe) => {
      log.push('mw2-before');
      next(recipe);
      log.push('mw2-after');
    };

    applyMiddleware(store, [mw1, mw2]);
    store.dispatch((d) => { d.zoom = 200; });

    expect(log).toEqual(['mw1-before', 'mw2-before', 'mw2-after', 'mw1-after']);
  });

  it('cleanup restores original dispatch', () => {
    const store = new AppStore();
    const log: string[] = [];

    const mw: Middleware = (_api) => (next) => (recipe) => {
      log.push('intercepted');
      next(recipe);
    };

    const cleanup = applyMiddleware(store, [mw]);
    store.dispatch((d) => { d.zoom = 150; });
    expect(log).toEqual(['intercepted']);

    cleanup();
    store.dispatch((d) => { d.zoom = 200; });
    expect(log).toEqual(['intercepted']); // Not called again
    expect(store.state.zoom).toBe(200);
  });
});

// ═══════════════════════════════════════
// ACTION TAGGING
// ═══════════════════════════════════════

describe('tagAction', () => {
  it('attaches tag to recipe', () => {
    const recipe = tagAction(
      (d) => { d.zoom = 100; },
      { name: 'resetZoom', undoable: false },
    );

    const tag = getActionTag(recipe);
    expect(tag).toBeDefined();
    expect(tag!.name).toBe('resetZoom');
    expect(tag!.undoable).toBe(false);
  });

  it('returns undefined for untagged recipe', () => {
    const recipe = (d: any) => { d.zoom = 100; };
    expect(getActionTag(recipe)).toBeUndefined();
  });
});

describe('NON_UNDOABLE_ACTIONS', () => {
  it('includes zoom actions', () => {
    expect(NON_UNDOABLE_ACTIONS.has('setZoom')).toBe(true);
    expect(NON_UNDOABLE_ACTIONS.has('zoomIn')).toBe(true);
    expect(NON_UNDOABLE_ACTIONS.has('zoomOut')).toBe(true);
  });

  it('includes view/select actions', () => {
    expect(NON_UNDOABLE_ACTIONS.has('switchView')).toBe(true);
    expect(NON_UNDOABLE_ACTIONS.has('selectElement')).toBe(true);
    expect(NON_UNDOABLE_ACTIONS.has('showContextMenu')).toBe(true);
  });

  it('does NOT include element mutations', () => {
    expect(NON_UNDOABLE_ACTIONS.has('addElement')).toBe(false);
    expect(NON_UNDOABLE_ACTIONS.has('removeElement')).toBe(false);
    expect(NON_UNDOABLE_ACTIONS.has('moveElement')).toBe(false);
  });
});

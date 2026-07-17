/**
 * Tests: history.service.ts (v2 — middleware-based)
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { AppStore } from '../../src/state/store';
import { HistoryService } from '../../src/services/history.service';
import { applyMiddleware, tagAction } from '../../src/state/middleware';
import { addElement, removeElement, selectElement, setZoom, regenerateBands, splitColumn, setColumnWidth } from '../../src/state/actions';

function createStoreWithHistory() {
  const store = new AppStore();
  const history = new HistoryService(store);
  const cleanup = applyMiddleware(store, [history.createMiddleware()]);
  return { store, history, cleanup };
}

// ═══════════════════════════════════════
// BASIC UNDO / REDO
// ═══════════════════════════════════════

describe('HistoryService', () => {
  it('starts with empty stacks', () => {
    const { history } = createStoreWithHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('records undoable actions', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 10, 20);

    expect(history.canUndo).toBe(true);
    expect(store.state.elements).toHaveLength(1);
  });

  it('undo restores previous state', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 10, 20);
    const afterAdd = store.state.elements.length;

    history.undo();

    expect(store.state.elements).toHaveLength(afterAdd - 1);
    expect(store.state.elements).toHaveLength(0);
  });

  it('redo restores undone action', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 10, 20);
    history.undo();

    expect(store.state.elements).toHaveLength(0);

    history.redo();

    expect(store.state.elements).toHaveLength(1);
  });

  it('multiple undo/redo', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);
    addElement(store, 'shape', 50, 50);
    addElement(store, 'line', 100, 100);

    expect(store.state.elements).toHaveLength(3);

    history.undo();
    expect(store.state.elements).toHaveLength(2);

    history.undo();
    expect(store.state.elements).toHaveLength(1);

    history.redo();
    expect(store.state.elements).toHaveLength(2);
  });

  it('new action clears redo stack', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);
    addElement(store, 'shape', 50, 50);

    history.undo();
    expect(history.canRedo).toBe(true);

    // New action should clear redo
    addElement(store, 'line', 100, 100);
    expect(history.canRedo).toBe(false);
  });

  it('undo returns false when empty', () => {
    const { history } = createStoreWithHistory();
    expect(history.undo()).toBe(false);
  });

  it('redo returns false when empty', () => {
    const { history } = createStoreWithHistory();
    expect(history.redo()).toBe(false);
  });
});

// ═══════════════════════════════════════
// NON-UNDOABLE ACTIONS
// ═══════════════════════════════════════

describe('non-undoable actions', () => {
  it('zoom does not record history', () => {
    const { store, history } = createStoreWithHistory();

    setZoom(store, 150);
    setZoom(store, 200);
    setZoom(store, 250);

    expect(history.canUndo).toBe(false);
    expect(store.state.zoom).toBe(250);
  });

  it('selectElement does not record history', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);
    const undoCountAfterAdd = history.stats.undoCount;

    selectElement(store, null);
    selectElement(store, store.state.elements[0].id);
    selectElement(store, null);

    // Should not have added any history entries for selections
    expect(history.stats.undoCount).toBe(undoCountAfterAdd);
  });
});

// ═══════════════════════════════════════
// CLEAR
// ═══════════════════════════════════════

describe('clear', () => {
  it('clears all history', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);
    addElement(store, 'text', 0, 0);

    history.clear();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.stats.undoCount).toBe(0);
    expect(history.stats.redoCount).toBe(0);
  });
});

// ═══════════════════════════════════════
// MEMORY STATS
// ═══════════════════════════════════════

describe('stats', () => {
  it('tracks undo/redo counts', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);
    addElement(store, 'text', 50, 50);

    expect(history.stats.undoCount).toBe(2);
    expect(history.stats.redoCount).toBe(0);

    history.undo();

    expect(history.stats.undoCount).toBe(1);
    expect(history.stats.redoCount).toBe(1);
  });

  it('reports memory usage', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);

    expect(parseFloat(history.stats.memoryUsedMB)).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════

describe('middleware cleanup', () => {
  it('cleanup restores original dispatch', () => {
    const { store, history, cleanup } = createStoreWithHistory();

    addElement(store, 'text', 0, 0);
    expect(history.canUndo).toBe(true);

    cleanup();
    history.clear();

    // After cleanup, actions should NOT record history
    addElement(store, 'text', 50, 50);
    expect(history.canUndo).toBe(false);
  });
});

// ═══════════════════════════════════════
// BAND EDITS ARE UNDOABLE (#47 cutover)
// ═══════════════════════════════════════

describe('HistoryService — band edits', () => {
  function seed() {
    const { store, history } = createStoreWithHistory();
    addElement(store, 'header', 0, 0);
    addElement(store, 'header', 300, 0); // same row → 2 columns
    regenerateBands(store);
    return { store, history };
  }

  it('undo restores band structure after splitColumn', () => {
    const { store, history } = seed();
    const before = structuredClone(store.state.bands);
    const colsBefore = store.state.bands[0].rows[0].columns.length;

    splitColumn(store, 0, 0, 0);
    expect(store.state.bands[0].rows[0].columns.length).toBe(colsBefore + 1);

    history.undo();
    expect(store.state.bands).toEqual(before);
    expect(store.state.bands[0].rows[0].columns.length).toBe(colsBefore);
  });

  it('redo re-applies a band width edit', () => {
    const { store, history } = seed();
    setColumnWidth(store, 0, 0, 0, 25);
    expect(store.state.bands[0].rows[0].columns[0].widthPct).toBe(25);

    history.undo();
    expect(store.state.bands[0].rows[0].columns[0].widthPct).not.toBe(25);

    history.redo();
    expect(store.state.bands[0].rows[0].columns[0].widthPct).toBe(25);
  });
});

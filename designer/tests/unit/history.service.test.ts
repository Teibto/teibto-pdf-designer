/**
 * Tests: history.service.ts (v2 — middleware-based)
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { AppStore } from '../../src/state/store';
import { HistoryService } from '../../src/services/history.service';
import { applyPagination } from '../../src/services/pagination.service';
import { applyMiddleware, tagAction } from '../../src/state/middleware';
import { addElement, clearJsonData, loadJsonData, removeElement, selectElement, setZoom, regenerateBands, splitColumn, setColumnWidth, setDragType, addElementToNewBand, setPageSize, setOrientation, updateElement } from '../../src/state/actions';

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

  it('does not let derived pagination create a no-op undo boundary', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 10, 20);
    applyPagination(store);

    expect(history.stats.undoCount).toBe(1);
    expect(history.undo()).toBe(true);
    expect(store.state.elements).toHaveLength(0);
  });

  it('does not create layout undo boundaries for preview JSON load or clear', () => {
    const { store, history } = createStoreWithHistory();

    loadJsonData(store, { items: [{ name: 'A' }] });
    clearJsonData(store);

    expect(history.canUndo).toBe(false);
  });

  it('redo restores undone action', () => {
    const { store, history } = createStoreWithHistory();

    addElement(store, 'text', 10, 20);
    history.undo();

    expect(store.state.elements).toHaveLength(0);

    history.redo();

    expect(store.state.elements).toHaveLength(1);
  });

  it('undo and redo restore page settings that affect PDF output', () => {
    const { store, history } = createStoreWithHistory();
    const before = structuredClone(store.state.page);

    setPageSize(store, 'A3');
    setOrientation(store, 'landscape');
    const after = structuredClone(store.state.page);

    expect(history.undo()).toBe(true);
    expect(store.state.page.orientation).toBe('portrait');
    expect(store.state.page.size).toBe('A3');
    expect(history.undo()).toBe(true);
    expect(store.state.page).toEqual(before);

    expect(history.redo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(store.state.page).toEqual(after);
  });

  it('undo and redo restore pagination and copy labels together', () => {
    const { store, history } = createStoreWithHistory();
    const beforePagination = structuredClone(store.state.pagination);

    store.dispatch((draft) => {
      draft.pagination.rowsPerPage = 25;
      draft.pagination.headerMode = 'firstOnly';
      draft.copies = [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }];
      draft.template.isDirty = true;
    });

    expect(history.undo()).toBe(true);
    expect(store.state.pagination).toEqual(beforePagination);
    expect(store.state.copies).toBeNull();

    expect(history.redo()).toBe(true);
    expect(store.state.pagination.rowsPerPage).toBe(25);
    expect(store.state.pagination.headerMode).toBe('firstOnly');
    expect(store.state.copies).toEqual([
      { th: 'ต้นฉบับ', en: 'Original' },
      { th: 'สำเนา', en: 'Copy' },
    ]);
  });

  it('restores uploaded image data when deletion is undone', () => {
    const { store, history } = createStoreWithHistory();
    const id = addElement(store, 'image', 10, 20);
    const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA==';
    updateElement(store, id, 'imageData', imageData);
    history.clear();

    removeElement(store, id);
    expect(store.state.elements).toHaveLength(0);

    expect(history.undo()).toBe(true);
    expect(store.state.elements).toHaveLength(1);
    expect(store.state.elements[0]).toMatchObject({ id, type: 'image', imageData });
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

describe('document-session fencing', () => {
  it.each(['template', 'sample', 'draft'])('never crosses a %s document switch', () => {
    const { store, history } = createStoreWithHistory();
    addElement(store, 'shape', 0, 0);
    expect(history.canUndo).toBe(true);

    store.beginDocumentSession();
    expect(history.canUndo).toBe(false);
    store.dispatch((draft) => {
      draft.elements = [];
      draft.bands = [];
      draft.template.id = 'loaded-document';
      draft.template.name = 'Loaded document';
      draft.template.isDirty = false;
    });
    expect(history.canUndo).toBe(false);

    addElement(store, 'text', 15, 25);
    expect(history.undo()).toBe(true);
    expect(store.state.elements).toEqual([]);
    expect(store.state.template.id).toBe('loaded-document');
    expect(history.undo()).toBe(false);
  });

  it('keeps the first edit after reset undoable', () => {
    const { store, history } = createStoreWithHistory();
    addElement(store, 'shape', 0, 0);

    store.reset();
    expect(history.canUndo).toBe(false);
    addElement(store, 'text', 15, 25);

    expect(history.undo()).toBe(true);
    expect(store.state.elements).toEqual([]);
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

  // #129: dragType is a transient UI flag. When it was written untagged, each
  // dragstart/drop-clear pushed a spurious snapshot, making the first Ctrl+Z a
  // no-op. setDragType() must never touch the history stack.
  it('setDragType does not record history (#129)', () => {
    const { store, history } = createStoreWithHistory();

    setDragType(store, 'text');
    setDragType(store, null);

    expect(history.canUndo).toBe(false);
    expect(store.state.dragType).toBe(null);
  });

  // #129 end-to-end: a drop (dragstart → add → drop-clear) must leave exactly one
  // undo point, so a single undo removes the freshly dropped element.
  it('one undo removes a freshly dropped element (#129)', () => {
    const { store, history } = createStoreWithHistory();

    setDragType(store, 'text');            // palette dragstart (non-undoable)
    addElementToNewBand(store, 'text', 'header'); // the drop's single undo point
    setDragType(store, null);              // band-view drop clear (non-undoable)

    expect(store.state.elements).toHaveLength(1);
    expect(history.stats.undoCount).toBe(1);

    history.undo();
    expect(store.state.elements).toHaveLength(0);
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

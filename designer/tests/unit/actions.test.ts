/**
 * Tests: state/actions.ts
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { AppStore } from '../../src/state/store';
import { exportTemplateJson } from '../../src/services/template.service';
import { validateTemplate } from '../../src/services/validation.service';
import {
  addElement,
  removeElement,
  selectElement,
  resizeElement,
  updateElement,
  duplicateElement,
  setPageSize,
  setOrientation,
  setZoom,
  zoomIn,
  zoomOut,
  resetZoom,
  switchView,
  loadJsonData,
  setTemplateName,
  markTemplateClean,
  toggleMultiSelect,
  selectAll,
  clearMultiSelect,
  getSelectedIds,
  toggleLock,
  toggleVisibility,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  copyElements,
  pasteElements,
  cutElements,
  deleteSelected,
  snapToGrid,
  regenerateBands,
  addBandRow,
  removeBandRow,
  moveBandRow,
  splitColumn,
  mergeColumn,
  moveElementToCell,
  addElementToCell,
  addElementToNewBand,
  removeBandElement,
} from '../../src/state/actions';

function createStoreWithElements(count = 3): AppStore {
  const store = new AppStore();
  for (let i = 0; i < count; i++) {
    addElement(store, 'text', 50 * i, 50 * i);
  }
  return store;
}

// ─── Band ↔ pool invariants (#125/#126/#135) ───
// Bands hold only id references (#49 model B), so the two structures can drift
// apart in either direction. These helpers assert both directions, which is what
// the original #125/#126 regression tests were missing.

/** Every element id referenced anywhere in the band structure. */
function bandIds(store: AppStore): string[] {
  return store.state.bands.flatMap((b) =>
    b.rows.flatMap((r) => r.columns.flatMap((c) => c.elementIds)),
  );
}

/** Ids bands still point at that no longer exist in the pool (#126). */
function danglingIds(store: AppStore): string[] {
  const pool = new Set(store.state.elements.map((e) => e.id));
  return bandIds(store).filter((id) => !pool.has(id));
}

/** Pool elements that no band cell references — invisible in editor/export (#125). */
function orphanIds(store: AppStore): string[] {
  const inBands = new Set(bandIds(store));
  return store.state.elements.filter((e) => !inBands.has(e.id)).map((e) => e.id);
}

/** Two text elements stacked in ONE cell of the content band. */
function createBandStore(): { store: AppStore; a: string; b: string } {
  const store = new AppStore();
  const a = addElementToNewBand(store, 'text', 'content') as string;
  const bandIdx = store.state.bands.findIndex((x) => x.role === 'content');
  const b = addElementToCell(store, 'text', bandIdx, 0, 0) as string;
  return { store, a, b };
}

// ═══════════════════════════════════════
// ELEMENT CRUD
// ═══════════════════════════════════════

describe('addElement', () => {
  it('band-native element carries no legacy x/y and passes validation (#107)', () => {
    const store = new AppStore();
    addElement(store, 'text');
    const el = store.state.elements[0];
    expect(el.x).toBeUndefined();
    expect(el.y).toBeUndefined();
    const json = JSON.parse(exportTemplateJson(store));
    const v = validateTemplate(json);
    expect(v.valid).toBe(true);
  });

  it('adds a text element', () => {
    const store = new AppStore();
    const id = addElement(store, 'text', 10, 20);

    expect(store.state.elements).toHaveLength(1);
    expect(store.state.elements[0].id).toBe(id);
    expect(store.state.elements[0].type).toBe('text');
    expect(store.state.elements[0].x).toBe(10);
    expect(store.state.elements[0].y).toBe(20);
    expect(store.state.selectedId).toBe(id);
    expect(store.state.template.isDirty).toBe(true);
  });

  it('adds elements of all types', () => {
    const store = new AppStore();
    const types = ['header', 'text', 'image', 'table', 'shape', 'line', 'barcode', 'list'] as const;

    for (const type of types) {
      addElement(store, type, 0, 0);
    }

    expect(store.state.elements).toHaveLength(8);
    types.forEach((type, i) => {
      expect(store.state.elements[i].type).toBe(type);
    });
  });

  it('auto-generates unique IDs', () => {
    const store = new AppStore();
    const id1 = addElement(store, 'text', 0, 0);
    const id2 = addElement(store, 'text', 0, 0);

    expect(id1).not.toBe(id2);
  });

  it('sets proper zIndex order', () => {
    const store = new AppStore();
    addElement(store, 'text', 0, 0);
    addElement(store, 'text', 0, 0);
    addElement(store, 'text', 0, 0);

    expect(store.state.elements[0].zIndex).toBe(0);
    expect(store.state.elements[1].zIndex).toBe(1);
    expect(store.state.elements[2].zIndex).toBe(2);
  });
});

describe('removeElement', () => {
  it('removes an element by id', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[1].id;

    removeElement(store, id);

    expect(store.state.elements).toHaveLength(2);
    expect(store.state.elements.find((e) => e.id === id)).toBeUndefined();
  });

  it('clears selection if removed element was selected', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[0].id;
    selectElement(store, id);

    removeElement(store, id);

    expect(store.state.selectedId).toBeNull();
  });

  it('preserves selection if different element removed', () => {
    const store = createStoreWithElements();
    selectElement(store, store.state.elements[0].id);

    removeElement(store, store.state.elements[1].id);

    expect(store.state.selectedId).toBe(store.state.elements[0].id);
  });
});

describe('selectElement', () => {
  it('selects an element', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[0].id;

    selectElement(store, id);

    expect(store.state.selectedId).toBe(id);
  });

  it('deselects with null', () => {
    const store = createStoreWithElements();
    selectElement(store, store.state.elements[0].id);
    selectElement(store, null);

    expect(store.state.selectedId).toBeNull();
  });
});

describe('resizeElement', () => {
  it('resizes with minimum constraints', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[0].id;

    resizeElement(store, id, 5, 3);

    const el = store.state.elements.find((e) => e.id === id)!;
    expect(el.w).toBe(20); // Min width
    expect(el.h).toBe(10); // Min height
  });

  it('allows valid sizes', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[0].id;

    resizeElement(store, id, 500, 300);

    const el = store.state.elements.find((e) => e.id === id)!;
    expect(el.w).toBe(500);
    expect(el.h).toBe(300);
  });
});

describe('updateElement', () => {
  it('updates valid property', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[0].id;

    updateElement(store, id, 'name', 'Custom Name');

    expect(store.state.elements[0].name).toBe('Custom Name');
  });

  it('ignores update for non-existent element', () => {
    const store = createStoreWithElements();
    const before = structuredClone(store.state.elements);

    updateElement(store, 'non-existent-id', 'name', 'Test');

    expect(store.state.elements).toEqual(before);
  });
});

describe('duplicateElement', () => {
  it('creates a copy with offset', () => {
    const store = createStoreWithElements(1);
    const origId = store.state.elements[0].id;
    const origX = store.state.elements[0].x;

    duplicateElement(store, origId);

    expect(store.state.elements).toHaveLength(2);
    const dup = store.state.elements[1];
    expect(dup.id).not.toBe(origId);
    expect(dup.x).toBe(origX + 20);
    expect(dup.y).toBe(store.state.elements[0].y + 20);
    expect(store.state.selectedId).toBe(dup.id);
  });
});

// ═══════════════════════════════════════
// ZOOM
// ═══════════════════════════════════════

describe('zoom actions', () => {
  it('setZoom clamps to range', () => {
    const store = new AppStore();

    setZoom(store, 500);
    expect(store.state.zoom).toBe(300);

    setZoom(store, 10);
    expect(store.state.zoom).toBe(25);
  });

  it('zoomIn increments by 10', () => {
    const store = new AppStore();
    zoomIn(store);
    expect(store.state.zoom).toBe(110);
  });

  it('zoomOut decrements by 10', () => {
    const store = new AppStore();
    zoomOut(store);
    expect(store.state.zoom).toBe(90);
  });

  it('resetZoom returns to 100', () => {
    const store = new AppStore();
    setZoom(store, 200);
    resetZoom(store);
    expect(store.state.zoom).toBe(100);
  });
});

// ═══════════════════════════════════════
// VIEW
// ═══════════════════════════════════════

describe('switchView', () => {
  it('switches to flow view', () => {
    const store = new AppStore();
    switchView(store, 'flow');
    expect(store.state.view).toBe('flow');
  });
});

// ═══════════════════════════════════════
// MULTI-SELECT
// ═══════════════════════════════════════

describe('multi-select', () => {
  it('toggleMultiSelect adds and removes', () => {
    const store = createStoreWithElements();
    const id = store.state.elements[0].id;

    toggleMultiSelect(store, id);
    expect(store.state.multiSelect).toContain(id);

    toggleMultiSelect(store, id);
    expect(store.state.multiSelect).not.toContain(id);
  });

  it('selectAll selects everything', () => {
    const store = createStoreWithElements(5);
    selectAll(store);

    expect(store.state.multiSelect).toHaveLength(5);
  });

  it('clearMultiSelect empties selection', () => {
    const store = createStoreWithElements(3);
    selectAll(store);
    clearMultiSelect(store);

    expect(store.state.multiSelect).toHaveLength(0);
  });

  it('getSelectedIds returns single select', () => {
    const store = createStoreWithElements();
    selectElement(store, store.state.elements[0].id);

    const ids = getSelectedIds(store);
    expect(ids).toEqual([store.state.elements[0].id]);
  });

  it('getSelectedIds returns multi-select', () => {
    const store = createStoreWithElements(3);
    toggleMultiSelect(store, store.state.elements[0].id);
    toggleMultiSelect(store, store.state.elements[1].id);

    const ids = getSelectedIds(store);
    expect(ids).toHaveLength(2);
  });
});

// ═══════════════════════════════════════
// Z-INDEX
// ═══════════════════════════════════════

describe('z-index actions', () => {
  it('bringToFront sets highest zIndex', () => {
    const store = createStoreWithElements(3);
    const id = store.state.elements[0].id;

    bringToFront(store, id);

    const el = store.state.elements.find((e) => e.id === id)!;
    const maxZ = Math.max(...store.state.elements.map((e) => e.zIndex));
    expect(el.zIndex).toBe(maxZ);
  });

  it('sendToBack sets lowest zIndex', () => {
    const store = createStoreWithElements(3);
    const id = store.state.elements[2].id;

    sendToBack(store, id);

    const el = store.state.elements.find((e) => e.id === id)!;
    const minZ = Math.min(...store.state.elements.map((e) => e.zIndex));
    expect(el.zIndex).toBe(minZ);
  });
});

// ═══════════════════════════════════════
// CLIPBOARD
// ═══════════════════════════════════════

describe('clipboard actions', () => {
  it('copy → paste creates new elements', () => {
    const store = createStoreWithElements(1);
    selectElement(store, store.state.elements[0].id);
    copyElements(store);
    pasteElements(store);

    expect(store.state.elements).toHaveLength(2);
    expect(store.state.elements[0].id).not.toBe(store.state.elements[1].id);
  });

  it('cut removes original', () => {
    const store = createStoreWithElements(2);
    selectElement(store, store.state.elements[0].id);
    cutElements(store);

    expect(store.state.elements).toHaveLength(1);
    expect(store.state.clipboard).toHaveLength(1);
  });

  it('paste from empty clipboard does nothing', () => {
    const store = createStoreWithElements(1);
    pasteElements(store);

    expect(store.state.elements).toHaveLength(1);
  });
});

// ═══════════════════════════════════════
// BAND ↔ POOL SYNC (#135)
// ═══════════════════════════════════════
// The keyboard/clipboard paths mutate the element pool, so each one must mirror
// into state.bands. #125/#126 fixed only the inspector buttons; these lock down
// Delete / Ctrl+X / Ctrl+V so the gap cannot come back.

describe('band sync — deleteSelected (Delete key)', () => {
  it('clears the band reference, leaving no dangling id (#135)', () => {
    const { store, a } = createBandStore();
    selectElement(store, a);
    deleteSelected(store);

    expect(store.state.elements.map((e) => e.id)).not.toContain(a);
    expect(bandIds(store)).not.toContain(a);
    expect(danglingIds(store)).toEqual([]);
  });

  it('clears band references for a multi-select delete (#135)', () => {
    const { store, a, b } = createBandStore();
    toggleMultiSelect(store, a);
    toggleMultiSelect(store, b);
    deleteSelected(store);

    expect(store.state.elements).toHaveLength(0);
    expect(bandIds(store)).toEqual([]);
    expect(danglingIds(store)).toEqual([]);
  });

  it('keeps the band reference of a locked element it refused to delete', () => {
    const { store, a, b } = createBandStore();
    toggleLock(store, a);
    selectAll(store);
    deleteSelected(store);

    expect(store.state.elements.map((e) => e.id)).toEqual([a]);
    expect(bandIds(store)).toEqual([a]);
    expect(danglingIds(store)).toEqual([]);
    expect(orphanIds(store)).toEqual([]);
    expect(bandIds(store)).not.toContain(b);
  });
});

describe('band sync — cutElements (Ctrl+X)', () => {
  it('clears the band reference, leaving no dangling id (#135)', () => {
    const { store, a } = createBandStore();
    selectElement(store, a);
    cutElements(store);

    expect(store.state.elements.map((e) => e.id)).not.toContain(a);
    expect(bandIds(store)).not.toContain(a);
    expect(danglingIds(store)).toEqual([]);
  });

  it('keeps the band reference of a locked element that survives the cut', () => {
    const { store, a } = createBandStore();
    toggleLock(store, a);
    selectElement(store, a);
    cutElements(store);

    expect(store.state.elements.map((e) => e.id)).toContain(a);
    expect(bandIds(store)).toContain(a);
    expect(danglingIds(store)).toEqual([]);
  });
});

describe('band sync — pasteElements (Ctrl+V)', () => {
  it('places the clone in the source cell, right after the source (#135)', () => {
    const { store, a, b } = createBandStore();
    selectElement(store, a);
    copyElements(store);
    pasteElements(store);

    const clone = store.state.selectedId as string;
    expect(store.state.elements).toHaveLength(3);
    expect(orphanIds(store)).toEqual([]);
    // a, clone, b — the clone sits directly after the element it came from
    expect(bandIds(store)).toEqual([a, clone, b]);
  });

  it('cut → paste puts the element back in its original cell (round-trip move)', () => {
    const { store, a, b } = createBandStore();
    selectElement(store, a);
    cutElements(store);
    expect(bandIds(store)).toEqual([b]);

    pasteElements(store);
    const clone = store.state.selectedId as string;
    expect(store.state.elements).toHaveLength(2);
    expect(orphanIds(store)).toEqual([]);
    expect(danglingIds(store)).toEqual([]);
    // reuses the slot the cut element vacated, ahead of b
    expect(bandIds(store)).toEqual([clone, b]);
  });

  it('falls back to the role band when the source cell is gone (#135)', () => {
    const { store, a } = createBandStore();
    selectElement(store, a);
    copyElements(store);

    // drop the row holding the source cell, then paste
    const bandIdx = store.state.bands.findIndex((x) => x.role === 'content');
    removeBandRow(store, bandIdx, 0);
    pasteElements(store);

    // The clone still lands in a cell of its role band (a fresh row, since
    // removeBandRow cleared the original), not in the pool alone.
    const clone = store.state.selectedId as string;
    expect(bandIds(store)).toContain(clone);
    expect(orphanIds(store)).toEqual([]);
    expect(danglingIds(store)).toEqual([]);
  });

  it('skips an element no band accepts instead of pasting an orphan (#49/#135)', () => {
    // watermark accepts nothing (BAND_ACCEPTS), and there is no band to fall
    // back into — the paste must add nothing rather than a pool-only element.
    const store = new AppStore();
    const id = addElement(store, 'text');
    updateElement(store, id, 'role', 'watermark');
    selectElement(store, id);
    copyElements(store);
    pasteElements(store);

    expect(store.state.elements).toHaveLength(1);
    expect(store.state.elements[0].id).toBe(id);
  });

  it('multi-element paste keeps every clone reachable from a band', () => {
    const { store, a, b } = createBandStore();
    toggleMultiSelect(store, a);
    toggleMultiSelect(store, b);
    copyElements(store);
    pasteElements(store);

    expect(store.state.elements).toHaveLength(4);
    expect(orphanIds(store)).toEqual([]);
    expect(danglingIds(store)).toEqual([]);
    expect(store.state.multiSelect).toHaveLength(2);
  });
});

describe('band sync — removeBandRow (#136)', () => {
  it('deletes the elements the row held, leaving no orphan in the pool', () => {
    const { store, a, b } = createBandStore(); // a, b stacked in content row 0 col 0
    const bandIdx = store.state.bands.findIndex((x) => x.role === 'content');
    removeBandRow(store, bandIdx, 0);

    expect(store.state.elements).toHaveLength(0);
    expect(orphanIds(store)).toEqual([]);
    expect(danglingIds(store)).toEqual([]);
    expect(store.state.bands[bandIdx]?.rows ?? []).toHaveLength(0);
    expect([a, b].every((id) => !store.state.elements.some((e) => e.id === id))).toBe(true);
  });

  it('clears selection/multiSelect for elements removed with the row', () => {
    const { store, a, b } = createBandStore();
    toggleMultiSelect(store, a);
    toggleMultiSelect(store, b);
    const bandIdx = store.state.bands.findIndex((x) => x.role === 'content');
    removeBandRow(store, bandIdx, 0);

    expect(store.state.selectedId).toBeNull();
    expect(store.state.multiSelect).toEqual([]);
  });

  it('leaves other rows and their elements untouched', () => {
    const { store, a } = createBandStore();
    const bandIdx = store.state.bands.findIndex((x) => x.role === 'content');
    // add a second row with its own element
    addBandRow(store, bandIdx);
    const c = addElementToCell(store, 'text', bandIdx, 1, 0) as string;

    removeBandRow(store, bandIdx, 0); // drop the first row (holds a, b)

    expect(store.state.elements.map((e) => e.id)).toContain(c);
    expect(store.state.elements.map((e) => e.id)).not.toContain(a);
    expect(bandIds(store)).toEqual([c]);
    expect(orphanIds(store)).toEqual([]);
  });
});

// ═══════════════════════════════════════
// DELETE
// ═══════════════════════════════════════

describe('deleteSelected', () => {
  it('deletes selected elements', () => {
    const store = createStoreWithElements(3);
    selectAll(store);
    deleteSelected(store);

    expect(store.state.elements).toHaveLength(0);
    expect(store.state.selectedId).toBeNull();
    expect(store.state.multiSelect).toHaveLength(0);
  });

  it('does nothing with no selection', () => {
    const store = createStoreWithElements(3);
    selectElement(store, null);
    clearMultiSelect(store);
    deleteSelected(store);

    expect(store.state.elements).toHaveLength(3);
  });
});

// ═══════════════════════════════════════
// NUDGE
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// PAGE
// ═══════════════════════════════════════

describe('page actions', () => {
  it('setPageSize updates dimensions', () => {
    const store = new AppStore();
    setPageSize(store, 'Letter');

    expect(store.state.page.size).toBe('Letter');
    expect(store.state.page.width).toBe(612);
    expect(store.state.page.height).toBe(792);
  });

  it('setOrientation swaps dimensions', () => {
    const store = new AppStore();
    setOrientation(store, 'landscape');

    expect(store.state.page.orientation).toBe('landscape');
    expect(store.state.page.width).toBe(842);
    expect(store.state.page.height).toBe(595);
  });
});

// ═══════════════════════════════════════
// JSON DATA
// ═══════════════════════════════════════

describe('loadJsonData', () => {
  it('loads data and extracts keys', () => {
    const store = new AppStore();
    const data = {
      company: { name: 'Test', address: { city: 'BKK' } },
      total: 100,
    };

    loadJsonData(store, data);

    expect(store.state.jsonData).toEqual(data);
    expect(store.state.jsonKeys).toContain('company');
    expect(store.state.jsonKeys).toContain('company.name');
    expect(store.state.jsonKeys).toContain('company.address.city');
    expect(store.state.jsonKeys).toContain('total');
  });
});

// ═══════════════════════════════════════
// ALIGNMENT
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// SNAP TO GRID
// ═══════════════════════════════════════

describe('snapToGrid', () => {
  it('snaps to nearest grid point', () => {
    expect(snapToGrid(13, 10)).toBe(10);
    expect(snapToGrid(17, 10)).toBe(20);
    expect(snapToGrid(25, 10)).toBe(30);
  });

  it('handles exact grid point', () => {
    expect(snapToGrid(20, 10)).toBe(20);
  });

  it('handles different grid sizes', () => {
    expect(snapToGrid(12, 5)).toBe(10);
    expect(snapToGrid(13, 5)).toBe(15);
  });
});

// ═══════════════════════════════════════
// LOCK & VISIBILITY
// ═══════════════════════════════════════

describe('lock & visibility', () => {
  it('toggleLock flips lock state', () => {
    const store = createStoreWithElements(1);
    const id = store.state.elements[0].id;
    expect(store.state.elements[0].locked).toBe(false);

    toggleLock(store, id);
    expect(store.state.elements[0].locked).toBe(true);

    toggleLock(store, id);
    expect(store.state.elements[0].locked).toBe(false);
  });

  it('toggleVisibility flips visible state', () => {
    const store = createStoreWithElements(1);
    const id = store.state.elements[0].id;
    expect(store.state.elements[0].visible).toBe(true);

    toggleVisibility(store, id);
    expect(store.state.elements[0].visible).toBe(false);
  });
});

// ═══════════════════════════════════════
// BAND STRUCTURAL ACTIONS (#47 slice 2b)
// ═══════════════════════════════════════

/**
 * Store with bands: a header band whose first row has TWO columns (two header
 * elements side by side) and a content band with a single-column row.
 */
function createStoreWithBands(): AppStore {
  const store = new AppStore();
  addElement(store, 'header', 0, 0);   // header row, left column
  addElement(store, 'header', 420, 0); // header row, right column (same y → same row)
  addElement(store, 'text', 0, 200);   // content band, own row
  regenerateBands(store);
  return store;
}

function sumWidths(store: AppStore, bandIdx: number, rowIdx: number): number {
  return store.state.bands[bandIdx].rows[rowIdx].columns.reduce((s, c) => s + c.widthPct, 0);
}

describe('addBandRow', () => {
  it('appends an empty single-column row by default', () => {
    const store = createStoreWithBands();
    const before = store.state.bands[0].rows.length;
    addBandRow(store, 0);
    const rows = store.state.bands[0].rows;
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1].columns).toHaveLength(1);
    expect(rows[rows.length - 1].columns[0].widthPct).toBe(100);
    expect(rows[rows.length - 1].columns[0].elementIds).toHaveLength(0);
  });

  it('inserts at the given index', () => {
    const store = createStoreWithBands();
    addBandRow(store, 1, 0); // content band, before its only row
    expect(store.state.bands[1].rows[0].columns[0].elementIds).toHaveLength(0);
    expect(store.state.bands[1].rows[1].columns[0].elementIds).toHaveLength(1);
  });

  it('no-op for a nonexistent band', () => {
    const store = createStoreWithBands();
    addBandRow(store, 99);
    expect(store.state.bands).toHaveLength(2);
  });
});

describe('removeBandRow', () => {
  it('removes the row at the index', () => {
    const store = createStoreWithBands();
    addBandRow(store, 0); // now 2 rows
    removeBandRow(store, 0, 0);
    expect(store.state.bands[0].rows).toHaveLength(1);
  });

  it('no-op for a missing row', () => {
    const store = createStoreWithBands();
    removeBandRow(store, 0, 5);
    expect(store.state.bands[0].rows).toHaveLength(1);
  });
});

describe('moveBandRow', () => {
  it('moves a row down and back up', () => {
    const store = createStoreWithBands();
    addBandRow(store, 0); // row1 = empty, appended after original row0
    const origFirstId = store.state.bands[0].rows[0].id;
    moveBandRow(store, 0, 0, 1);
    expect(store.state.bands[0].rows[1].id).toBe(origFirstId);
    moveBandRow(store, 0, 1, -1);
    expect(store.state.bands[0].rows[0].id).toBe(origFirstId);
  });

  it('no-op past the edges', () => {
    const store = createStoreWithBands();
    moveBandRow(store, 0, 0, -1); // already at top
    expect(store.state.bands[0].rows[0].columns).toHaveLength(2);
  });
});

describe('splitColumn', () => {
  it('splits a column into two, preserving the row width sum', () => {
    const store = createStoreWithBands();
    // content band: single 100% column
    splitColumn(store, 1, 0, 0);
    const cols = store.state.bands[1].rows[0].columns;
    expect(cols).toHaveLength(2);
    expect(sumWidths(store, 1, 0)).toBe(100);
    expect(cols[1].elementIds).toHaveLength(0); // new column is empty
    expect(cols[0].elementIds).toHaveLength(1); // elements stay in the left column
  });

  it('no-op for a missing column', () => {
    const store = createStoreWithBands();
    splitColumn(store, 1, 0, 9);
    expect(store.state.bands[1].rows[0].columns).toHaveLength(1);
  });
});

describe('mergeColumn', () => {
  it('merges a column into the previous one — widths add, elements concat', () => {
    const store = createStoreWithBands();
    // header row starts with 2 columns (one element each)
    mergeColumn(store, 0, 0, 1);
    const cols = store.state.bands[0].rows[0].columns;
    expect(cols).toHaveLength(1);
    expect(cols[0].widthPct).toBe(100);
    expect(cols[0].elementIds).toHaveLength(2);
  });

  it('no-op when merging the first column', () => {
    const store = createStoreWithBands();
    mergeColumn(store, 0, 0, 0);
    expect(store.state.bands[0].rows[0].columns).toHaveLength(2);
  });
});

describe('moveElementToCell', () => {
  it('re-parents an element to another cell within the band', () => {
    const store = createStoreWithBands();
    const rightId = store.state.bands[0].rows[0].columns[1].elementIds[0];
    moveElementToCell(store, rightId, 0, 0, 0); // move right → left cell
    const cols = store.state.bands[0].rows[0].columns;
    expect(cols[0].elementIds).toContain(rightId);
    expect(cols[1].elementIds).toHaveLength(0);
  });

  it('never touches element geometry (bands hold ids; state.elements unchanged)', () => {
    const store = createStoreWithBands();
    const id = store.state.bands[0].rows[0].columns[1].elementIds[0];
    const before = structuredClone(store.state.elements.find((e) => e.id === id)!);
    moveElementToCell(store, id, 0, 0, 0);
    const after = store.state.elements.find((e) => e.id === id)!;
    expect([after.x, after.y, after.w, after.h]).toEqual([before.x, before.y, before.w, before.h]);
  });

  it('is a no-op for an element in a different band (no cross-band moves)', () => {
    const store = createStoreWithBands();
    const contentId = store.state.bands[1].rows[0].columns[0].elementIds[0];
    // Try to move the content element into a header cell → rejected
    moveElementToCell(store, contentId, 0, 0, 0);
    expect(store.state.bands[1].rows[0].columns[0].elementIds).toContain(contentId);
    expect(store.state.bands[0].rows[0].columns[0].elementIds).not.toContain(contentId);
  });
});

describe('addElementToCell', () => {
  it('adds an element with the BAND role into the target cell and selects it', () => {
    const store = createStoreWithBands();
    const before = store.state.elements.length;
    addElementToCell(store, 'text', 0, 0, 0); // header band, row0, col0
    expect(store.state.elements).toHaveLength(before + 1);
    const newId = store.state.selectedId!;
    const newEl = store.state.elements.find((e) => e.id === newId)!;
    // text defaults to role 'content' — must be re-roled to the band ('header')
    expect(newEl.role).toBe('header');
    expect(store.state.bands[0].rows[0].columns[0].elementIds).toContain(newId);
  });

  it('the added element survives re-sync (stays in the header band)', () => {
    const store = createStoreWithBands();
    addElementToCell(store, 'text', 0, 0, 0);
    const newId = store.state.selectedId!;
    regenerateBands(store); // rebuild bands from elements by role
    const headerBand = store.state.bands.find((b) => b.role === 'header')!;
    const ids = headerBand.rows.flatMap((r) => r.columns.flatMap((c) => c.elementIds));
    expect(ids).toContain(newId);
  });

  it('no-op for a missing cell', () => {
    const store = createStoreWithBands();
    const before = store.state.elements.length;
    addElementToCell(store, 'text', 9, 0, 0);
    expect(store.state.elements).toHaveLength(before);
  });
});

describe('removeBandElement', () => {
  it('removes the element from both the pool and its band cell', () => {
    const store = createStoreWithBands();
    const id = store.state.bands[0].rows[0].columns[0].elementIds[0];
    removeBandElement(store, id);
    expect(store.state.elements.find((e) => e.id === id)).toBeUndefined();
    expect(store.state.bands[0].rows[0].columns[0].elementIds).not.toContain(id);
  });

  it('clears the selection if the removed element was selected', () => {
    const store = createStoreWithBands();
    const id = store.state.bands[0].rows[0].columns[0].elementIds[0];
    selectElement(store, id);
    removeBandElement(store, id);
    expect(store.state.selectedId).toBeNull();
  });

  it('skips a locked element (mirrors removeElement)', () => {
    const store = createStoreWithBands();
    const id = store.state.bands[0].rows[0].columns[0].elementIds[0];
    toggleLock(store, id);
    removeBandElement(store, id);
    expect(store.state.elements.find((e) => e.id === id)).toBeDefined();
  });
});

describe('addElementToNewBand (empty-state, #47 cutover)', () => {
  it('creates a role band from a blank template and adds the element', () => {
    const store = new AppStore(); // no elements, no bands
    addElementToNewBand(store, 'text', 'content');
    expect(store.state.bands).toHaveLength(1);
    expect(store.state.bands[0].role).toBe('content');
    const id = store.state.selectedId!;
    expect(store.state.bands[0].rows[0].columns[0].elementIds).toEqual([id]);
    expect(store.state.elements.find((e) => e.id === id)!.role).toBe('content');
  });

  it('inserts new bands in BAND_ORDER position', () => {
    const store = new AppStore();
    addElementToNewBand(store, 'text', 'footer');
    addElementToNewBand(store, 'header', 'header'); // header precedes footer
    expect(store.state.bands.map((b) => b.role)).toEqual(['header', 'footer']);
  });

  it('appends a row to an existing band instead of duplicating it', () => {
    const store = new AppStore();
    addElementToNewBand(store, 'text', 'content');
    addElementToNewBand(store, 'text', 'content');
    expect(store.state.bands).toHaveLength(1);
    expect(store.state.bands[0].rows).toHaveLength(2);
  });
});

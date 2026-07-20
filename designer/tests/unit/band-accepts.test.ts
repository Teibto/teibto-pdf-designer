/**
 * Tests: band acceptance matrix (#49)
 * Which element types each band accepts for NEW additions — approved matrix
 * 2026-07-20. Guards live in addElementToCell / addElementToNewBand.
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { BAND_ACCEPTS, bandAccepts, BAND_ORDER } from '../../src/models/bands';
import { ELEMENT_DEFAULTS } from '../../src/models/element';
import type { ElementType } from '../../src/models/element';
import { AppStore } from '../../src/state/store';
import { addElementToCell, addElementToNewBand } from '../../src/state/actions';

describe('BAND_ACCEPTS matrix (#49)', () => {
  it('covers every band role', () => {
    for (const role of BAND_ORDER) {
      expect(BAND_ACCEPTS[role]).toBeDefined();
    }
  });

  it('table band accepts only the item table', () => {
    expect(BAND_ACCEPTS.table).toEqual(['table']);
  });

  it('watermark band accepts nothing (print watermark = #100 page.watermarkText)', () => {
    expect(BAND_ACCEPTS.watermark).toEqual([]);
  });

  it('list is content-only', () => {
    for (const role of BAND_ORDER) {
      expect(bandAccepts(role, 'list')).toBe(role === 'content');
    }
  });

  it("every element type's DEFAULT role accepts that type (palette baseline)", () => {
    for (const [type, def] of Object.entries(ELEMENT_DEFAULTS)) {
      expect(bandAccepts(def.role, type as ElementType)).toBe(true);
    }
  });
});

describe('add-action guards (#49)', () => {
  it('addElementToNewBand rejects a disallowed combo (list → header) as a no-op', () => {
    const store = new AppStore();
    const id = addElementToNewBand(store, 'list', 'header');
    expect(id).toBeNull();
    expect(store.state.elements).toHaveLength(0);
    expect(store.state.bands).toHaveLength(0);
  });

  it('addElementToNewBand accepts an allowed combo and returns the id', () => {
    const store = new AppStore();
    const id = addElementToNewBand(store, 'text', 'header');
    expect(id).not.toBeNull();
    expect(store.state.elements[0].role).toBe('header');
  });

  it('addElementToCell rejects a disallowed combo without touching state', () => {
    const store = new AppStore();
    addElementToNewBand(store, 'text', 'summary'); // summary band, 1 row/col
    const before = store.state.elements.length;
    const id = addElementToCell(store, 'barcode', 0, 0, 0); // barcode ∉ summary
    expect(id).toBeNull();
    expect(store.state.elements).toHaveLength(before);
    expect(store.state.bands[0].rows[0].columns[0].elementIds).toHaveLength(1);
  });

  it('addElementToCell accepts an allowed combo (text → summary cell)', () => {
    const store = new AppStore();
    addElementToNewBand(store, 'text', 'summary');
    const id = addElementToCell(store, 'text', 0, 0, 0);
    expect(id).not.toBeNull();
    expect(store.state.bands[0].rows[0].columns[0].elementIds).toHaveLength(2);
  });
});

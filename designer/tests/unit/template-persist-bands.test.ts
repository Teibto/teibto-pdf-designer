/**
 * Tests: band persistence through export/import JSON (#47 3b)
 * Band edits survive a save→load round-trip; legacy element-only templates
 * regenerate their bands on load.
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { AppStore } from '../../src/state/store';
import { exportTemplateJson, importTemplateJson } from '../../src/services/template.service';
import { addElement, regenerateBands, setColumnWidth, dragColumnBoundary } from '../../src/state/actions';
import { elementsToBands } from '../../src/services/band-layout.service';

/** Store with a 2-column header row whose widths have been edited. */
function editedStore(): AppStore {
  const store = new AppStore();
  addElement(store, 'header', 0, 0);
  addElement(store, 'header', 300, 0); // same row → 2 columns
  regenerateBands(store);
  setColumnWidth(store, 0, 0, 0, 25); // edit → 25/75, diverges from migration
  return store;
}

describe('band persistence via export/import JSON (#47 3b)', () => {
  it('exportTemplateJson includes bands when band edits exist', () => {
    const json = JSON.parse(exportTemplateJson(editedStore()));
    expect(json.bands).toBeDefined();
    expect(json.bands[0].rows[0].columns[0].widthPct).toBe(25);
  });

  it('round-trips edited bands through import (edit survives reload)', () => {
    const src = editedStore();
    const json = exportTemplateJson(src);
    const dst = new AppStore();
    importTemplateJson(dst, json);
    expect(dst.state.bands).toEqual(src.state.bands);
    expect(dst.state.bands[0].rows[0].columns[0].widthPct).toBe(25);
  });

  it('omits bands when no band edits (element-only template)', () => {
    const store = new AppStore();
    addElement(store, 'text', 0, 0); // state.bands stays []
    const json = JSON.parse(exportTemplateJson(store));
    expect(json.bands).toBeUndefined();
  });

  it('a legacy template without bands regenerates them on import', () => {
    // build a valid template JSON, then strip bands to simulate a legacy save
    const store = editedStore();
    const obj = JSON.parse(exportTemplateJson(store));
    delete obj.bands;
    const dst = new AppStore();
    importTemplateJson(dst, JSON.stringify(obj));
    expect(dst.state.bands.length).toBeGreaterThan(0);
    expect(dst.state.bands).toEqual(elementsToBands(dst.state.elements));
  });
});

describe('copy-set persistence (#92)', () => {
  it('round-trips copies through export/import', () => {
    const src = new AppStore();
    addElement(src, 'text', 0, 0);
    src.dispatch((d) => { d.copies = [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }, { th: 'สำเนากรมสรรพากร', en: 'Tax Copy' }]; });
    const json = exportTemplateJson(src);
    expect(JSON.parse(json).copies).toHaveLength(3);

    const dst = new AppStore();
    importTemplateJson(dst, json);
    expect(dst.state.copies).toEqual(src.state.copies);
  });

  it('omits copies when unset; import without copies restores null', () => {
    const store = new AppStore();
    addElement(store, 'text', 0, 0);
    const json = exportTemplateJson(store);
    expect(JSON.parse(json).copies).toBeUndefined();

    const dst = new AppStore();
    importTemplateJson(dst, json);
    expect(dst.state.copies).toBeNull();
  });
});

describe('dragColumnBoundary (#98)', () => {
  it('moves the boundary — pair sum preserved, others untouched', () => {
    const store = editedStore(); // 2 columns, widths 25/75
    dragColumnBoundary(store, 0, 0, 0, 40);
    const cols = store.state.bands[0].rows[0].columns;
    expect(cols[0].widthPct).toBe(40);
    expect(cols[1].widthPct).toBe(60);
    expect(cols[0].widthPct + cols[1].widthPct).toBe(100);
  });

  it('clamps both sides to >=5%', () => {
    const store = editedStore();
    dragColumnBoundary(store, 0, 0, 0, 99);
    const cols = store.state.bands[0].rows[0].columns;
    expect(cols[0].widthPct).toBe(95);
    expect(cols[1].widthPct).toBe(5);
    dragColumnBoundary(store, 0, 0, 0, -10);
    expect(store.state.bands[0].rows[0].columns[0].widthPct).toBe(5);
  });

  it('no-op on missing column / last boundary', () => {
    const store = editedStore();
    const before = JSON.stringify(store.state.bands);
    dragColumnBoundary(store, 0, 0, 1, 50); // leftIdx 1 has no right neighbour
    expect(JSON.stringify(store.state.bands)).toBe(before);
  });
});


describe('barcode import validation preserves the open document', () => {
  it.each([undefined, null, 'pdf417', 128, ['code128']])('rejects barcodeType %j before replacing existing content', barcodeType => {
    const source = new AppStore();
    addElement(source, 'barcode', 0, 0);
    const imported = JSON.parse(exportTemplateJson(source));
    imported.elements[0].barcodeType = barcodeType;
    const destination = editedStore();
    const before = destination.state;
    const session = destination.documentSession;
    expect(() => importTemplateJson(destination, JSON.stringify(imported))).toThrow('elements[0].barcodeType');
    expect(destination.state).toBe(before);
    expect(destination.documentSession).toBe(session);
  });

  it.each(['code128', 'code39', 'ean13', 'qrcode'])('preserves supported %s without coercion during import', barcodeType => {
    const source = new AppStore();
    addElement(source, 'barcode', 0, 0);
    const imported = JSON.parse(exportTemplateJson(source));
    imported.elements[0].barcodeType = barcodeType;
    const destination = editedStore();
    importTemplateJson(destination, JSON.stringify(imported));
    expect(destination.state.elements[0]).toMatchObject({ type: 'barcode', barcodeType });
  });
});

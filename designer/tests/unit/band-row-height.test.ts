/**
 * Tests: BandRow.height — bands own vertical geometry (#107)
 * elementsToBands assigns telescoping y-slice heights (Σ == legacy bbox), the
 * exporter derives header/footer macro heights from them (3-tier fallback),
 * and setRowHeight edits reach the exported header-height attribute.
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { elementsToBands } from '../../src/services/band-layout.service';
import { exportBfoXml } from '../../src/services/bfo-export.service';
import { AppStore } from '../../src/state/store';
import { addElement, regenerateBands, setRowHeight } from '../../src/state/actions';
import type { CanvasElement, TextElement } from '../../src/models/element';

function text(id: string, y: number, h: number, x = 0, w = 100): TextElement {
  return {
    id, type: 'text', name: id, role: 'header',
    x, y, w, h, zIndex: 0, locked: false, visible: true,
    content: id, fontSize: 12, fontWeight: 'normal', color: '#333', textAlign: 'left',
  };
}

describe('elementsToBands y-slice heights (#107)', () => {
  it('heights telescope: Σ row heights === role bbox (gaps included)', () => {
    // rows at y=0 (h20), y=30 (h20), y=70 (h10) → bbox = 80
    const els: CanvasElement[] = [text('a', 0, 20), text('b', 30, 20), text('c', 70, 10)];
    const bands = elementsToBands(els);
    const rows = bands[0].rows;
    expect(rows.map((r) => r.height)).toEqual([30, 40, 10]); // 0→30, 30→70, 70→80
    expect(rows.reduce((s, r) => s + (r.height ?? 0), 0)).toBe(80);
  });

  it('single row height equals its own bbox', () => {
    const els: CanvasElement[] = [text('a', 10, 24), text('b', 12, 20, 200)];
    const bands = elementsToBands(els);
    expect(bands[0].rows[0].height).toBe(24); // min y 10 → max bottom 34
  });
});

describe('roleHeight from bands (#107)', () => {
  function storeWithHeader(): AppStore {
    const store = new AppStore();
    addElement(store, 'header', 0, 0);   // default size element
    addElement(store, 'text', 0, 200);   // body content so export has a body
    regenerateBands(store);
    return store;
  }

  function headerHeight(xml: string): number {
    const m = xml.match(/header-height="(\d+)pt"/);
    return m ? Number(m[1]) : -1;
  }

  it('unedited bands → header-height identical between band and element paths', () => {
    const store = storeWithHeader();
    const elemXml = exportBfoXml(store.state, { useFreeMarker: true });
    const bandXml = exportBfoXml(store.state, { useFreeMarker: true, useBands: true });
    expect(headerHeight(bandXml)).toBe(headerHeight(elemXml));
    expect(headerHeight(bandXml)).toBeGreaterThan(0);
  });

  it('setRowHeight reaches the exported header-height (+8 margin)', () => {
    const store = storeWithHeader();
    setRowHeight(store, 0, 0, 100);
    const xml = exportBfoXml(store.state, { useFreeMarker: true, useBands: true });
    expect(headerHeight(xml)).toBe(108);
  });

  it('clearing back to auto (height<=0) restores the bbox-parity value', () => {
    const store = storeWithHeader();
    const before = headerHeight(exportBfoXml(store.state, { useFreeMarker: true, useBands: true }));
    setRowHeight(store, 0, 0, 100);
    setRowHeight(store, 0, 0, 0); // clear — single heightless row → bbox fallback
    const after = headerHeight(exportBfoXml(store.state, { useFreeMarker: true, useBands: true }));
    expect(after).toBe(before);
  });

  it('legacy bands (no heights at all) fall back to the element bbox', () => {
    const store = storeWithHeader();
    store.dispatch((d) => {
      d.bands.forEach((b) => b.rows.forEach((r) => { delete r.height; }));
    });
    const elemXml = exportBfoXml(store.state, { useFreeMarker: true });
    const bandXml = exportBfoXml(store.state, { useFreeMarker: true, useBands: true });
    expect(headerHeight(bandXml)).toBe(headerHeight(elemXml));
  });

  it('mixed rows: heightless row uses the stacked-content estimate', () => {
    const store = storeWithHeader();
    setRowHeight(store, 0, 0, 40);
    // add a second header row with no height, holding one element of h=30
    store.dispatch((d) => {
      const el = { ...d.elements[0], id: 'extra', name: 'extra', y: 999 };
      d.elements.push(el);
      d.bands[0].rows.push({ id: 'r2', columns: [{ id: 'c1', widthPct: 100, elementIds: ['extra'] }] });
    });
    const h0 = store.state.elements[0].h; // estimate for the new row = el.h
    const xml = exportBfoXml(store.state, { useFreeMarker: true, useBands: true });
    const m = xml.match(/header-height="(\d+)pt"/);
    expect(Number(m![1])).toBe(Math.ceil(40 + h0) + 8);
  });
});

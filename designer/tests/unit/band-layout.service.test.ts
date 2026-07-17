/**
 * Tests: band-layout.service.ts (#44)
 * Migration free-canvas → bands and the inverse flattener.
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { elementsToBands, bandsToElements, normalizeWidths, redistributeRowWidths } from '../../src/services/band-layout.service';
import { BAND_ORDER } from '../../src/models/bands';
import type { CanvasElement, ElementRoleType } from '../../src/models/element';

function el(
  id: string,
  role: ElementRoleType,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasElement {
  return {
    id, type: 'text', name: id, role,
    x, y, w, h, zIndex: 0, locked: false, visible: true,
    content: id, fontSize: 12, fontWeight: 'normal', color: '#000', textAlign: 'left',
  } as CanvasElement;
}

describe('elementsToBands', () => {
  it('groups elements by role into bands, in BAND_ORDER', () => {
    const els = [
      el('f1', 'footer', 0, 700, 400, 20),
      el('h1', 'header', 0, 0, 400, 40),
      el('c1', 'content', 0, 100, 200, 30),
    ];
    const bands = elementsToBands(els);
    expect(bands.map((b) => b.role)).toEqual(['header', 'content', 'footer']);
  });

  it('skips roles with no elements (no empty bands)', () => {
    const bands = elementsToBands([el('h1', 'header', 0, 0, 400, 40)]);
    expect(bands).toHaveLength(1);
    expect(bands[0].role).toBe('header');
  });

  it('puts vertically-overlapping elements in the SAME row, left-to-right by x', () => {
    // two elements on the same visual line (overlapping y-range)
    const bands = elementsToBands([
      el('right', 'header', 300, 10, 100, 30),
      el('left', 'header', 0, 12, 200, 30),
    ]);
    const row = bands[0].rows[0];
    expect(bands[0].rows).toHaveLength(1);
    expect(row.columns.map((c) => c.elements[0].id)).toEqual(['left', 'right']);
  });

  it('starts a NEW row when there is a clear vertical gap', () => {
    const bands = elementsToBands([
      el('top', 'content', 0, 0, 200, 30),
      el('bottom', 'content', 0, 100, 200, 30),
    ]);
    expect(bands[0].rows).toHaveLength(2);
    expect(bands[0].rows[0].columns[0].elements[0].id).toBe('top');
    expect(bands[0].rows[1].columns[0].elements[0].id).toBe('bottom');
  });

  it('column widthPct in a row sums to exactly 100', () => {
    const bands = elementsToBands([
      el('a', 'header', 0, 0, 120, 30),
      el('b', 'header', 130, 0, 280, 30),
    ]);
    const cols = bands[0].rows[0].columns;
    expect(cols.reduce((s, c) => s + c.widthPct, 0)).toBe(100);
    // proportional: 120:280 ≈ 30:70
    expect(cols[0].widthPct).toBe(30);
    expect(cols[1].widthPct).toBe(70);
  });

  it('gives deterministic row/column ids', () => {
    const bands = elementsToBands([
      el('a', 'content', 0, 0, 100, 30),
      el('b', 'content', 120, 0, 100, 30),
    ]);
    expect(bands[0].rows[0].id).toBe('content-r0');
    expect(bands[0].rows[0].columns[1].id).toBe('content-r0-c1');
  });
});

describe('round-trip elementsToBands → bandsToElements', () => {
  it('drops no element and keeps every role→band correct', () => {
    const els = [
      el('h1', 'header', 0, 0, 200, 40),
      el('h2', 'header', 220, 5, 180, 40),
      el('c1', 'content', 0, 100, 400, 30),
      el('t1', 'table', 0, 200, 500, 200),
      el('s1', 'summary', 300, 450, 200, 30),
      el('f1', 'footer', 0, 720, 400, 20),
      el('w1', 'watermark', 100, 300, 300, 300),
    ];
    const flat = bandsToElements(elementsToBands(els));
    // no element lost
    expect(new Set(flat.map((e) => e.id))).toEqual(new Set(els.map((e) => e.id)));
    expect(flat).toHaveLength(els.length);
    // flattened order follows BAND_ORDER
    const roleSeq = flat.map((e) => e.role);
    const firstIdx = (r: ElementRoleType) => roleSeq.indexOf(r);
    for (let i = 1; i < BAND_ORDER.length; i++) {
      const prev = firstIdx(BAND_ORDER[i - 1]);
      const cur = firstIdx(BAND_ORDER[i]);
      if (prev !== -1 && cur !== -1) expect(prev).toBeLessThan(cur);
    }
  });

  it('empty input → empty bands → empty elements', () => {
    expect(elementsToBands([])).toEqual([]);
    expect(bandsToElements([])).toEqual([]);
  });
});

describe('normalizeWidths', () => {
  it('single column is 100', () => {
    expect(normalizeWidths([250])).toEqual([100]);
  });
  it('equal widths split evenly and sum to 100', () => {
    const w = normalizeWidths([100, 100, 100]);
    expect(w.reduce((s, v) => s + v, 0)).toBe(100);
    expect(w).toEqual([34, 33, 33]);
  });
  it('zero total splits evenly', () => {
    const w = normalizeWidths([0, 0]);
    expect(w.reduce((s, v) => s + v, 0)).toBe(100);
  });
  it('empty → empty', () => {
    expect(normalizeWidths([])).toEqual([]);
  });
});

describe('redistributeRowWidths (#47)', () => {
  it('sets target column and keeps row sum at 100', () => {
    const w = redistributeRowWidths([30, 70], 0, 50);
    expect(w[0]).toBe(50);
    expect(w.reduce((s, v) => s + v, 0)).toBe(100);
  });
  it('clamps target to [5, 95]', () => {
    expect(redistributeRowWidths([50, 50], 0, 200)[0]).toBe(95);
    expect(redistributeRowWidths([50, 50], 0, -5)[0]).toBe(5);
  });
  it('distributes remainder across the other columns proportionally', () => {
    const w = redistributeRowWidths([20, 30, 50], 0, 40); // others 30:50 share 60 → 22:38 (approx)
    expect(w[0]).toBe(40);
    expect(w.reduce((s, v) => s + v, 0)).toBe(100);
    expect(w[2]).toBeGreaterThan(w[1]);
  });
  it('single column stays 100', () => {
    expect(redistributeRowWidths([100], 0, 40)).toEqual([100]);
  });
});

/**
 * Tests: snap-guide.service.ts
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { computeSnap, type SnapResult } from '../../src/services/snap-guide.service';
import type { CanvasElement, TextElement } from '../../src/models/element';

function makeElement(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-1', type: 'text', name: 'Text', role: 'content',
    x: 100, y: 100, w: 200, h: 30, zIndex: 0,
    locked: false, visible: true,
    content: 'test', fontSize: 12, fontWeight: 'normal', color: '#333', textAlign: 'left',
    ...overrides,
  };
}

describe('computeSnap', () => {
  const PAGE_W = 595;
  const PAGE_H = 842;

  it('snaps to page center horizontally', () => {
    const el = makeElement({ w: 100 });
    // Place near center: page center = 297.5, element center would be at targetX + 50
    const targetX = 297.5 - 50 + 2; // 2px off center
    const result = computeSnap('el-1', targetX, 100, 100, 30, [], PAGE_W, PAGE_H);

    expect(result.x).toBeCloseTo(247.5, 0);
    expect(result.guides.some((g) => g.type === 'vertical' && g.label === 'Page Center')).toBe(true);
  });

  it('snaps to left edge', () => {
    const result = computeSnap('el-1', 3, 100, 200, 30, [], PAGE_W, PAGE_H);
    expect(result.x).toBe(0);
    expect(result.guides.some((g) => g.label === 'Left Edge')).toBe(true);
  });

  it('snaps to right edge', () => {
    const result = computeSnap('el-1', PAGE_W - 200 - 3, 100, 200, 30, [], PAGE_W, PAGE_H);
    expect(result.x).toBe(PAGE_W - 200);
    expect(result.guides.some((g) => g.label === 'Right Edge')).toBe(true);
  });

  it('snaps to top edge', () => {
    const result = computeSnap('el-1', 100, 2, 200, 30, [], PAGE_W, PAGE_H);
    expect(result.y).toBe(0);
    expect(result.guides.some((g) => g.label === 'Top Edge')).toBe(true);
  });

  it('snaps to element left-to-left alignment', () => {
    const other = makeElement({ id: 'el-2', x: 50, y: 200, w: 100, h: 30 });
    const result = computeSnap('el-1', 52, 100, 200, 30, [other], PAGE_W, PAGE_H);
    expect(result.x).toBe(50); // Should snap to other element's left
    expect(result.guides.some((g) => g.type === 'vertical')).toBe(true);
  });

  it('does not snap to self', () => {
    const self = makeElement({ id: 'el-1', x: 100, y: 100, w: 200, h: 30 });
    const result = computeSnap('el-1', 150, 150, 200, 30, [self], PAGE_W, PAGE_H);
    // Should not snap to self's position
    expect(result.guides.length).toBe(0);
  });

  it('returns no guides when far from any edge', () => {
    const result = computeSnap('el-1', 200, 300, 100, 30, [], PAGE_W, PAGE_H);
    expect(result.guides).toHaveLength(0);
    expect(result.x).toBe(200);
    expect(result.y).toBe(300);
  });

  it('deduplicates guides at same position', () => {
    const el1 = makeElement({ id: 'a', x: 50, y: 200, w: 100, h: 30 });
    const el2 = makeElement({ id: 'b', x: 50, y: 300, w: 100, h: 30 });
    // Both at x=50, should produce only one vertical guide
    const result = computeSnap('el-1', 52, 100, 200, 30, [el1, el2], PAGE_W, PAGE_H);
    const verticals = result.guides.filter((g) => g.type === 'vertical' && Math.round(g.position) === 50);
    expect(verticals.length).toBe(1);
  });
});

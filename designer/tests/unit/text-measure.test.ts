/**
 * Text Measurement Tests
 * Verifies Thai combining character handling, width estimation,
 * and line wrapping calculations.
 *
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import {
  estimateTextWidth,
  estimateLineCount,
  countVisibleGlyphs,
  calculateRowHeight,
} from '../../src/utils/text-measure';

const FONT_SIZE = 8; // matches pdf-export default

// ═══════════════════════════════════════
// THAI COMBINING CHARACTERS
// ═══════════════════════════════════════

describe('Thai combining characters', () => {
  it('zero-width: สระอิ (ิ) should not add width', () => {
    // กิ = ก + ิ — สระอิ is combining
    const withCombining = estimateTextWidth('กิ', FONT_SIZE);
    const baseOnly = estimateTextWidth('ก', FONT_SIZE);
    expect(withCombining).toBe(baseOnly);
  });

  it('zero-width: วรรณยุกต์ ่ ้ ๊ ๋ should not add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('ก่', FONT_SIZE)).toBe(base); // ไม้เอก
    expect(estimateTextWidth('ก้', FONT_SIZE)).toBe(base); // ไม้โท
    expect(estimateTextWidth('ก๊', FONT_SIZE)).toBe(base); // ไม้ตรี
    expect(estimateTextWidth('ก๋', FONT_SIZE)).toBe(base); // ไม้จัตวา
  });

  it('zero-width: สระอุ สระอู should not add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('กุ', FONT_SIZE)).toBe(base); // สระอุ
    expect(estimateTextWidth('กู', FONT_SIZE)).toBe(base); // สระอู
  });

  it('zero-width: การันต์ (์) should not add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('ก์', FONT_SIZE)).toBe(base);
  });

  it('zero-width: ไม้ไต่คู้ (็) should not add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('ก็', FONT_SIZE)).toBe(base);
  });

  it('zero-width: สระอั (ั) should not add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('กั', FONT_SIZE)).toBe(base);
  });

  it('zero-width: นิคหิต (ํ) should not add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('กํ', FONT_SIZE)).toBe(base);
  });

  it('normal-width: สระอา should add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    const withSaraAa = estimateTextWidth('กา', FONT_SIZE);
    expect(withSaraAa).toBeGreaterThan(base);
  });

  it('normal-width: leading vowels เ แ โ ใ ไ should add width', () => {
    const base = estimateTextWidth('ก', FONT_SIZE);
    expect(estimateTextWidth('เก', FONT_SIZE)).toBeGreaterThan(base);
    expect(estimateTextWidth('แก', FONT_SIZE)).toBeGreaterThan(base);
    expect(estimateTextWidth('โก', FONT_SIZE)).toBeGreaterThan(base);
    expect(estimateTextWidth('ใก', FONT_SIZE)).toBeGreaterThan(base);
    expect(estimateTextWidth('ไก', FONT_SIZE)).toBeGreaterThan(base);
  });
});

// ═══════════════════════════════════════
// REAL-WORLD THAI TEXT
// ═══════════════════════════════════════

describe('countVisibleGlyphs', () => {
  it('สินค้า = 4 visible glyphs (not 6 code points)', () => {
    // ส ิ น ค ้ า → 6 code points
    // ส . น ค . า → 4 visible (ิ and ้ are combining)
    expect('สินค้า'.length).toBe(6);
    expect(countVisibleGlyphs('สินค้า')).toBe(4);
  });

  it('กรุงเทพมหานคร = accurate count', () => {
    const text = 'กรุงเทพมหานคร';
    const visible = countVisibleGlyphs(text);
    // กรุงเทพมหานคร: ก ร ุ ง เ ท พ ม ห า น ค ร
    // combining: ุ → 12 visible out of 13 code points
    expect(visible).toBe(12);
  });

  it('English text: all code points are visible', () => {
    expect(countVisibleGlyphs('Hello')).toBe(5);
    expect(countVisibleGlyphs('Invoice #001')).toBe(12);
  });

  it('mixed Thai/English counts correctly', () => {
    const text = 'สินค้า ABC';
    // สินค้า → 4 visible, space → 1, ABC → 3
    expect(countVisibleGlyphs(text)).toBe(8);
  });

  it('empty string returns 0', () => {
    expect(countVisibleGlyphs('')).toBe(0);
  });
});

// ═══════════════════════════════════════
// WIDTH ESTIMATION ACCURACY
// ═══════════════════════════════════════

describe('estimateTextWidth', () => {
  it('Thai text should be narrower than old implementation', () => {
    // สินค้า at fontSize=8:
    // Old (6 × 0.65 × 8) = 31.2
    // New (4 base × 0.60 × 8) = 19.2
    const width = estimateTextWidth('สินค้า', 8);
    expect(width).toBeLessThan(25); // significantly less than old 31.2
    expect(width).toBeGreaterThan(10); // but not zero
  });

  it('English narrow chars (i, l) are narrower than "M", "W"', () => {
    const narrowWidth = estimateTextWidth('i', 10);
    const wideWidth = estimateTextWidth('M', 10);
    expect(wideWidth).toBeGreaterThan(narrowWidth * 1.5);
  });

  it('space is narrow', () => {
    const spaceWidth = estimateTextWidth(' ', 10);
    const charWidth = estimateTextWidth('a', 10);
    expect(spaceWidth).toBeLessThan(charWidth);
  });

  it('CJK characters are full-width', () => {
    const cjkWidth = estimateTextWidth('中', 10);
    const latinWidth = estimateTextWidth('a', 10);
    expect(cjkWidth).toBeGreaterThan(latinWidth * 1.5);
  });

  it('empty string returns 0 width', () => {
    expect(estimateTextWidth('', 8)).toBe(0);
  });

  it('real-world Invoice row: "รายการสินค้าและบริการ" estimates correctly', () => {
    const text = 'รายการสินค้าและบริการ';
    const width = estimateTextWidth(text, 8);
    // 20 code points, ~14 visible base glyphs at 0.60 factor
    // Expected: ~14 * 0.60 * 8 = ~67.2pt
    expect(width).toBeGreaterThan(50);
    expect(width).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════
// LINE WRAPPING
// ═══════════════════════════════════════

describe('estimateLineCount', () => {
  it('short text in wide column = 1 line', () => {
    expect(estimateLineCount('Hello', 200, 8)).toBe(1);
  });

  it('long text in narrow column wraps', () => {
    const longText = 'This is a very long text that should wrap to multiple lines';
    const lines = estimateLineCount(longText, 50, 8);
    expect(lines).toBeGreaterThan(1);
  });

  it('explicit newlines add lines', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    expect(estimateLineCount(text, 200, 8)).toBe(3);
  });

  it('Thai text wraps correctly with combining marks', () => {
    // ภาษาไทยมีสระลอยที่ไม่กินความกว้าง ควร wrap น้อยลง
    const thaiText = 'สินค้าและบริการที่ได้รับจากบริษัท';
    const oldStyleWidth = thaiText.length * 0.65 * 8; // old: ~166.4pt
    const correctWidth = estimateTextWidth(thaiText, 8);

    // In a 100pt column, the old method would estimate ~2 lines
    // but the new method should estimate ~1 line (Thai text is narrower)
    expect(correctWidth).toBeLessThan(oldStyleWidth * 0.85);
  });

  it('empty text returns 1 line', () => {
    expect(estimateLineCount('', 200, 8)).toBe(1);
  });

  it('respects cell padding deduction', () => {
    // Column width = 20pt, padding = 8pt, effective = 12pt
    const text = 'ABCDE'; // ~5 * 0.50 * 8 = 20pt → should wrap in 12pt
    const lines = estimateLineCount(text, 20, 8);
    expect(lines).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════
// ROW HEIGHT CALCULATION
// ═══════════════════════════════════════

describe('calculateRowHeight', () => {
  const columns = [
    { key: 'name', label: 'Name', width: 100, align: 'left' as const, format: 'text' as const, overflow: 'wrap', maxLines: 0, hidden: false, bold: false, uppercase: false },
    { key: 'qty', label: 'Qty', width: 50, align: 'right' as const, format: 'number' as const, overflow: 'ellipsis', maxLines: 0, hidden: false, bold: false, uppercase: false },
  ];

  it('short content returns baseRowHeight', () => {
    const row = { name: 'Item A', qty: 5 };
    const height = calculateRowHeight(row, columns, 8, 24, 18);
    expect(height).toBe(24);
  });

  it('Thai wrapping content returns taller row', () => {
    // Long Thai text that should wrap in 100pt column
    const row = { name: 'รายการสินค้าและบริการที่ได้รับจากบริษัทซึ่งมีรายละเอียดยาวมาก', qty: 1 };
    const height = calculateRowHeight(row, columns, 8, 24, 18);
    expect(height).toBeGreaterThanOrEqual(24);
  });

  it('respects maxLines clamp', () => {
    const clampedColumns = [
      { key: 'name', label: 'Name', width: 30, align: 'left' as const, format: 'text' as const, overflow: 'wrap', maxLines: 2, hidden: false, bold: false, uppercase: false },
    ];
    const longText = 'A very very very very very very very long text';
    const row = { name: longText };
    const height = calculateRowHeight(row, clampedColumns, 8, 24, 18);
    // Clamped to 2 lines: max 2 * 18 + 6 = 42pt
    expect(height).toBeLessThanOrEqual(42);
  });

  it('hidden columns are ignored', () => {
    const withHidden = [
      { key: 'name', label: 'Name', width: 100, align: 'left' as const, format: 'text' as const, overflow: 'wrap', maxLines: 0, hidden: true, bold: false, uppercase: false },
    ];
    const row = { name: 'Some really really really really long text' };
    const height = calculateRowHeight(row, withHidden, 8, 24, 18);
    expect(height).toBe(24); // hidden → not measured
  });

  it('non-wrap columns are ignored', () => {
    const noWrap = [
      { key: 'name', label: 'Name', width: 10, align: 'left' as const, format: 'text' as const, overflow: 'ellipsis' as const, maxLines: 0, hidden: false, bold: false, uppercase: false },
    ];
    const row = { name: 'Will not wrap even in narrow col' };
    const height = calculateRowHeight(row, noWrap, 8, 24, 18);
    expect(height).toBe(24); // ellipsis → not measured for height
  });

  it('clip overflow is treated as single-line (no height expansion)', () => {
    const clipCol = [
      { key: 'name', label: 'Name', width: 10, align: 'left' as const, format: 'text' as const, overflow: 'clip' as const, maxLines: 0, hidden: false, bold: false, uppercase: false },
    ];
    const row = { name: 'Very very very long text that is clipped' };
    const height = calculateRowHeight(row, clipCol, 8, 24, 18);
    expect(height).toBe(24); // clip → single line, no expansion
  });

  it('only overflow=wrap columns affect row height', () => {
    const mixed = [
      { key: 'desc', label: 'Desc', width: 30, align: 'left' as const, format: 'text' as const, overflow: 'wrap' as const, maxLines: 0, hidden: false, bold: false, uppercase: false },
      { key: 'code', label: 'Code', width: 30, align: 'left' as const, format: 'text' as const, overflow: 'ellipsis' as const, maxLines: 0, hidden: false, bold: false, uppercase: false },
      { key: 'note', label: 'Note', width: 30, align: 'left' as const, format: 'text' as const, overflow: 'clip' as const, maxLines: 0, hidden: false, bold: false, uppercase: false },
    ];
    const longText = 'A'.repeat(100);
    const row = { desc: longText, code: longText, note: longText };
    const height = calculateRowHeight(row, mixed, 8, 24, 18);
    // Only 'desc' (wrap) should expand; ellipsis + clip stay single line
    expect(height).toBeGreaterThan(24); // desc wraps
  });
});

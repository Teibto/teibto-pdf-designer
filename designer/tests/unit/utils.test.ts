/**
 * Tests: utils/format.ts & utils/color.ts
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { formatCellValue, formatNumber, formatCurrency, formatDate, formatPercent } from '../../src/utils/format';
import { hexToRgb, rgbToHex, contrastText } from '../../src/utils/color';

// ═══════════════════════════════════════
// FORMAT UTILS
// ═══════════════════════════════════════

describe('formatCellValue', () => {
  it('formats text as-is', () => {
    expect(formatCellValue('hello', 'text')).toBe('hello');
  });

  it('returns empty for null', () => {
    expect(formatCellValue(null, 'text')).toBe('');
  });

  it('returns empty for undefined', () => {
    expect(formatCellValue(undefined, 'number')).toBe('');
  });

  it('formats number', () => {
    expect(formatCellValue(1500, 'number')).toBe('1,500');
  });

  it('formats currency (Thai Baht style)', () => {
    const result = formatCellValue(1234.5, 'currency');
    expect(result).toContain('1,234.50');
  });

  it('formats percent', () => {
    expect(formatCellValue(0.85, 'percent')).toBe('85.0%');
  });
});

describe('formatNumber', () => {
  it('formats integer', () => {
    expect(formatNumber(1000)).toBe('1,000');
  });

  it('formats decimal', () => {
    expect(formatNumber(1234.56)).toBe('1,234.56');
  });

  it('formats string number', () => {
    expect(formatNumber('9999')).toBe('9,999');
  });

  it('returns original for NaN', () => {
    expect(formatNumber('not-a-number')).toBe('not-a-number');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('handles negative', () => {
    const result = formatNumber(-500);
    expect(result).toContain('500');
  });
});

describe('formatPercent', () => {
  it('formats 0.5 as 50.0%', () => {
    expect(formatPercent(0.5)).toBe('50.0%');
  });

  it('formats 1 as 100.0%', () => {
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('formats 0 as 0.0%', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('handles string input', () => {
    expect(formatPercent('0.75')).toBe('75.0%');
  });
});

// ═══════════════════════════════════════
// COLOR UTILS
// ═══════════════════════════════════════

describe('hexToRgb', () => {
  it('converts 6-digit hex', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('converts 3-digit hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('handles without hash', () => {
    expect(hexToRgb('4f6ef7')).toEqual({ r: 79, g: 110, b: 247 });
  });

  it('returns black for empty', () => {
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('converts black', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('rgbToHex', () => {
  it('converts red', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
  });

  it('converts white', () => {
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
  });

  it('converts black', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('converts brand color', () => {
    expect(rgbToHex(79, 110, 247)).toBe('#4f6ef7');
  });
});

describe('contrastText', () => {
  it('returns white for dark backgrounds', () => {
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('#333333')).toBe('#ffffff');
    expect(contrastText('#4f6ef7')).toBe('#ffffff');
  });

  it('returns black for light backgrounds', () => {
    expect(contrastText('#ffffff')).toBe('#000000');
    expect(contrastText('#f0f0f0')).toBe('#000000');
    expect(contrastText('#e8eaf0')).toBe('#000000');
  });
});

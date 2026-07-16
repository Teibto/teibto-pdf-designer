/**
 * Tests: validation.service.ts
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import {
  validateElement,
  validateTemplate,
  validatePageConfig,
  validatePaginationConfig,
  validatePropertyUpdate,
  escapeXml,
  sanitizeColor,
} from '../../src/services/validation.service';

// ─── Element Validation ───

describe('validateElement', () => {
  const validElement = {
    id: 'el-1', type: 'text', name: 'Text 1', role: 'content',
    x: 10, y: 20, w: 200, h: 30, zIndex: 0, locked: false, visible: true,
    content: 'Hello', fontSize: 12, fontWeight: 'normal', color: '#333', textAlign: 'left',
  };

  it('validates a correct element', () => {
    const result = validateElement(validElement, 0);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null element', () => {
    const result = validateElement(null, 0);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_TYPE');
  });

  it('rejects missing id', () => {
    const result = validateElement({ ...validElement, id: '' }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_ID')).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = validateElement({ ...validElement, type: 'bogus' }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_ELEMENT_TYPE')).toBe(true);
  });

  it('rejects negative width', () => {
    const result = validateElement({ ...validElement, w: -10 }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_DIMENSION')).toBe(true);
  });

  it('rejects non-finite x', () => {
    const result = validateElement({ ...validElement, x: Infinity }, 0);
    expect(result.valid).toBe(false);
  });

  it('warns on unusually large dimensions', () => {
    const result = validateElement({ ...validElement, w: 6000 }, 0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects invalid fontSize for text', () => {
    const result = validateElement({ ...validElement, fontSize: 500 }, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'OUT_OF_RANGE')).toBe(true);
  });

  it('rejects invalid textAlign', () => {
    const result = validateElement({ ...validElement, textAlign: 'justify' }, 0);
    expect(result.valid).toBe(false);
  });
});

// ─── Template Validation ───

describe('validateTemplate', () => {
  const validTemplate = {
    id: 't-1', name: 'Test', version: '2.0.0',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, customWidth: 595, customHeight: 842 },
    pagination: { mode: 'rows', rowsPerPage: 10, baseRowHeight: 24, lineHeightPx: 18, showContinuationHeader: true },
    elements: [],
  };

  it('validates a correct template', () => {
    const result = validateTemplate(validTemplate);
    expect(result.valid).toBe(true);
  });

  it('rejects null', () => {
    const result = validateTemplate(null);
    expect(result.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const result = validateTemplate({ ...validTemplate, name: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-array elements', () => {
    const result = validateTemplate({ ...validTemplate, elements: 'not-array' });
    expect(result.valid).toBe(false);
  });

  it('detects duplicate element IDs', () => {
    const el = { id: 'dup', type: 'text', role: 'content', x: 0, y: 0, w: 100, h: 30, zIndex: 0, locked: false, visible: true };
    const result = validateTemplate({ ...validTemplate, elements: [el, el] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('warns on old version', () => {
    const result = validateTemplate({ ...validTemplate, version: '1.0.0' });
    expect(result.warnings.some((w) => w.message.includes('migration'))).toBe(true);
  });
});

// ─── Page Config Validation ───

describe('validatePageConfig', () => {
  it('accepts valid config', () => {
    const result = validatePageConfig({ size: 'A4', orientation: 'portrait', width: 595, height: 842 });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid page size', () => {
    const result = validatePageConfig({ size: 'Tabloid' });
    expect(result.valid).toBe(false);
  });

  it('rejects out-of-range width', () => {
    const result = validatePageConfig({ width: 50 });
    expect(result.valid).toBe(false);
  });
});

// ─── Pagination Config Validation ───

describe('validatePaginationConfig', () => {
  it('accepts valid config', () => {
    const result = validatePaginationConfig({ mode: 'rows', rowsPerPage: 10 });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid mode', () => {
    const result = validatePaginationConfig({ mode: 'auto' });
    expect(result.valid).toBe(false);
  });

  it('rejects out-of-range rowsPerPage', () => {
    const result = validatePaginationConfig({ rowsPerPage: 5000 });
    expect(result.valid).toBe(false);
  });
});

// ─── Property Update Validation ───

describe('validatePropertyUpdate', () => {
  it('accepts valid text property', () => {
    const result = validatePropertyUpdate('text', 'fontSize', 14);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid property for type', () => {
    const result = validatePropertyUpdate('text', 'bgColor', '#fff');
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_PROPERTY');
  });

  it('rejects out-of-range fontSize', () => {
    const result = validatePropertyUpdate('text', 'fontSize', 999);
    expect(result.valid).toBe(false);
  });

  it('rejects out-of-range opacity', () => {
    const result = validatePropertyUpdate('shape', 'opacity', 2);
    expect(result.valid).toBe(false);
  });

  it('accepts base properties on any type', () => {
    const result = validatePropertyUpdate('shape', 'name', 'My Shape');
    expect(result.valid).toBe(true);
  });

  it('accepts image-specific properties', () => {
    const result = validatePropertyUpdate('image', 'objectFit', 'cover');
    expect(result.valid).toBe(true);
  });
});

// ─── XML Sanitization ───

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeXml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeXml('He said "hello"')).toBe('He said &quot;hello&quot;');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });

  it('handles safe text unchanged', () => {
    expect(escapeXml('Hello World 123')).toBe('Hello World 123');
  });
});

describe('sanitizeColor', () => {
  it('accepts hex 3-digit', () => expect(sanitizeColor('#fff')).toBe('#fff'));
  it('accepts hex 6-digit', () => expect(sanitizeColor('#4f6ef7')).toBe('#4f6ef7'));
  it('accepts named color', () => expect(sanitizeColor('red')).toBe('red'));
  it('rejects invalid input', () => expect(sanitizeColor('url(evil)')).toBe('#000000'));
  it('rejects empty string', () => expect(sanitizeColor('')).toBe('#000000'));
});

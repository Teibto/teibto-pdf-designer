/**
 * Tests: utils/element-label.ts — readable chip labels for first-time users
 * (#217): Thai type name + a short preview of what the element prints.
 *
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { describe, it, expect } from 'vitest';
import { ELEMENT_ROLE_LABEL, ELEMENT_TYPE_LABEL_TH, elementPreview } from '../../src/utils/element-label';
import type { CanvasElement } from '../../src/models/element';

function element(partial: Partial<CanvasElement> & Pick<CanvasElement, 'type'>): CanvasElement {
  return {
    id: 'el-1',
    name: 'element_1',
    role: 'content',
    w: 100,
    h: 20,
    zIndex: 0,
    locked: false,
    visible: true,
    ...partial,
  } as CanvasElement;
}

describe('ELEMENT_TYPE_LABEL_TH', () => {
  it('names every element type in Thai', () => {
    expect(Object.keys(ELEMENT_TYPE_LABEL_TH).sort()).toEqual(
      ['barcode', 'header', 'image', 'line', 'list', 'shape', 'table', 'text'].sort(),
    );
    for (const label of Object.values(ELEMENT_TYPE_LABEL_TH)) {
      expect(label).toMatch(/[ก-๙]/);
    }
  });
});

describe('ELEMENT_ROLE_LABEL', () => {
  it('keeps the English term available for the ไทย (English) pattern', () => {
    expect(ELEMENT_ROLE_LABEL.header.th).toBe('ส่วนหัว');
    expect(ELEMENT_ROLE_LABEL.header.bilingual).toBe('ส่วนหัว (Header)');
    expect(ELEMENT_ROLE_LABEL.footer.bilingual).toContain('Footer');
  });
});

describe('elementPreview', () => {
  it('shows the binding when present', () => {
    expect(elementPreview(element({ type: 'text', content: 'ignored', binding: 'customer.companyName' })))
      .toBe('customer.companyName');
  });

  it('falls back to static text content when there is no binding', () => {
    expect(elementPreview(element({ type: 'text', content: 'ยอดรวมทั้งสิ้น', fontSize: 12, fontWeight: 'normal', color: '#000', textAlign: 'left' })))
      .toBe('ยอดรวมทั้งสิ้น');
  });

  it('uses the barcode value and the first list item', () => {
    expect(elementPreview(element({ type: 'barcode', value: 'INV-1001', barcodeType: 'code128' })))
      .toBe('INV-1001');
    expect(elementPreview(element({ type: 'list', items: ['รายการแรก', 'รายการที่สอง'], fontSize: 12, color: '#000', listStyle: 'bullet' })))
      .toBe('รายการแรก');
  });

  it('falls back to the element name so structural types still read', () => {
    expect(elementPreview(element({ type: 'shape', name: 'กล่องหัวเรื่อง', bgColor: '#fff', borderRadius: 0, opacity: 1 })))
      .toBe('กล่องหัวเรื่อง');
  });

  it('collapses whitespace and truncates long previews with an ellipsis', () => {
    const preview = elementPreview(element({ type: 'text', binding: 'a  b\n c', content: '', fontSize: 12, fontWeight: 'normal', color: '#000', textAlign: 'left' }));
    expect(preview).toBe('a b c');

    const long = elementPreview(element({ type: 'text', binding: 'x'.repeat(60), content: '', fontSize: 12, fontWeight: 'normal', color: '#000', textAlign: 'left' }));
    expect(long).toHaveLength(24);
    expect(long.endsWith('…')).toBe(true);
  });
});

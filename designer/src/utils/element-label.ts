/**
 * Human-readable chip label for a band element (#217): Thai type name plus a
 * short preview of what the element prints (binding, static text, value).
 *
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import type { CanvasElement, ElementRoleType, ElementType } from '../models/element';

export const ELEMENT_TYPE_LABEL_TH: Record<ElementType, string> = {
  header: 'หัวเรื่อง',
  text: 'ข้อความ',
  image: 'รูปภาพ',
  table: 'ตาราง',
  shape: 'รูปทรง',
  line: 'เส้น',
  barcode: 'บาร์โค้ด',
  list: 'รายการ',
};

/**
 * Thai (+ English) names for the six band roles, shared by the insertion
 * Destination select (#217) and the band rejection toasts so both agree.
 */
export const ELEMENT_ROLE_LABEL: Record<ElementRoleType, { th: string; bilingual: string }> = {
  header:    { th: 'ส่วนหัว',    bilingual: 'ส่วนหัว (Header)' },
  content:   { th: 'เนื้อหา',    bilingual: 'เนื้อหา (Content)' },
  table:     { th: 'ตาราง',      bilingual: 'ตาราง (Table)' },
  summary:   { th: 'สรุปยอด',    bilingual: 'สรุปยอด (Summary)' },
  footer:    { th: 'ท้ายกระดาษ', bilingual: 'ท้ายกระดาษ (Footer)' },
  watermark: { th: 'ลายน้ำ',     bilingual: 'ลายน้ำ (Watermark)' },
};

const PREVIEW_MAX = 24;

/** What the element prints, truncated to ~24 chars; falls back to its name. */
export function elementPreview(el: CanvasElement): string {
  let raw = el.binding || '';
  if (!raw) {
    if (el.type === 'text' || el.type === 'header') raw = el.content;
    else if (el.type === 'barcode') raw = el.value;
    else if (el.type === 'list') raw = el.items[0] ?? '';
  }
  const text = (raw || el.name || '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

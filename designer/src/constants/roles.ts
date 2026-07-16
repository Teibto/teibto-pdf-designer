/**
 * Element Role Configuration
 * Determines how elements behave across multi-page documents.
 *
 * @author Wichit Wongta
 */
import type { ElementRole, ElementRoleType } from '../models/element';

export const ELEMENT_ROLES: Record<ElementRoleType, ElementRole> = {
  header: {
    label: 'Header',
    color: '#4f6ef7',
    repeatOnAllPages: true,
    showOnPages: 'all',
    description: 'แสดงทุกหน้า (ด้านบน)',
  },
  content: {
    label: 'Content',
    color: '#8a8ca0',
    repeatOnAllPages: false,
    showOnPages: 'first',
    description: 'แสดงเฉพาะหน้าแรก',
  },
  table: {
    label: 'Table',
    color: '#f59e42',
    repeatOnAllPages: true,
    showOnPages: 'all',
    paginate: true,
    description: 'ตารางข้อมูล (แบ่งหน้าอัตโนมัติ)',
  },
  summary: {
    label: 'Summary',
    color: '#22d3a7',
    repeatOnAllPages: false,
    showOnPages: 'last',
    description: 'แสดงเฉพาะหน้าสุดท้าย',
  },
  footer: {
    label: 'Footer',
    color: '#e74c8b',
    repeatOnAllPages: true,
    showOnPages: 'all',
    description: 'แสดงทุกหน้า (ด้านล่าง)',
  },
  watermark: {
    label: 'Watermark',
    color: '#6b7280',
    repeatOnAllPages: true,
    showOnPages: 'all',
    opacity: 0.15,
    description: 'ลายน้ำ แสดงทุกหน้า',
  },
};

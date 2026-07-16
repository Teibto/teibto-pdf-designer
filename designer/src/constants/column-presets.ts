/**
 * Table Column Presets
 * Quick-apply column configurations for common document types.
 *
 * @author Wichit Wongta
 */
import type { TableColumn } from '../models/element';

export interface ColumnPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  columns: TableColumn[];
}

function col(
  key: string,
  label: string,
  width: number,
  align: 'left' | 'center' | 'right' = 'left',
  format: TableColumn['format'] = 'text',
  options: Partial<TableColumn> = {},
): TableColumn {
  return {
    key,
    label,
    width,
    align,
    format,
    overflow: 'ellipsis',
    maxLines: 1,
    hidden: false,
    bold: false,
    uppercase: false,
    ...options,
  };
}

export const COLUMN_PRESETS: ColumnPreset[] = [
  {
    id: 'invoice',
    name: 'Invoice / Tax Invoice',
    description: 'ใบแจ้งหนี้ / ใบกำกับภาษี',
    icon: '📄',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('description', 'รายการ / Description', 220, 'left', 'text', { overflow: 'wrap', maxLines: 3 }),
      col('quantity', 'จำนวน / Qty', 60, 'center', 'number'),
      col('unit', 'หน่วย / Unit', 50, 'center'),
      col('unit_price', 'ราคาต่อหน่วย / Unit Price', 100, 'right', 'currency'),
      col('discount', 'ส่วนลด / Disc.', 70, 'right', 'currency'),
      col('amount', 'จำนวนเงิน / Amount', 100, 'right', 'currency', { bold: true }),
    ],
  },
  {
    id: 'purchase-order',
    name: 'Purchase Order',
    description: 'ใบสั่งซื้อ',
    icon: '🛒',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('item_code', 'รหัสสินค้า / Item Code', 90, 'left'),
      col('description', 'รายละเอียด / Description', 200, 'left', 'text', { overflow: 'wrap', maxLines: 2 }),
      col('quantity', 'จำนวน / Qty', 60, 'center', 'number'),
      col('unit', 'หน่วย / Unit', 50, 'center'),
      col('unit_price', 'ราคา / Price', 90, 'right', 'currency'),
      col('amount', 'รวม / Total', 90, 'right', 'currency', { bold: true }),
    ],
  },
  {
    id: 'sales-order',
    name: 'Sales Order',
    description: 'ใบสั่งขาย',
    icon: '📦',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('item_code', 'รหัส / Code', 80, 'left'),
      col('description', 'รายการ / Description', 200, 'left', 'text', { overflow: 'wrap', maxLines: 2 }),
      col('quantity', 'จำนวน / Qty', 60, 'center', 'number'),
      col('unit', 'หน่วย / Unit', 50, 'center'),
      col('price', 'ราคา / Price', 90, 'right', 'currency'),
      col('discount_pct', 'ส่วนลด %', 60, 'center', 'percent'),
      col('amount', 'รวม / Amount', 90, 'right', 'currency', { bold: true }),
    ],
  },
  {
    id: 'quotation',
    name: 'Quotation',
    description: 'ใบเสนอราคา',
    icon: '💰',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('description', 'รายละเอียด / Description', 240, 'left', 'text', { overflow: 'wrap', maxLines: 3 }),
      col('quantity', 'จำนวน / Qty', 60, 'center', 'number'),
      col('unit', 'หน่วย / Unit', 50, 'center'),
      col('unit_price', 'ราคา/หน่วย / Unit Price', 100, 'right', 'currency'),
      col('amount', 'จำนวนเงิน / Amount', 100, 'right', 'currency', { bold: true }),
    ],
  },
  {
    id: 'receipt',
    name: 'Receipt / ใบเสร็จ',
    description: 'ใบเสร็จรับเงิน',
    icon: '🧾',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('description', 'รายการ', 250, 'left', 'text', { overflow: 'wrap' }),
      col('amount', 'จำนวนเงิน', 120, 'right', 'currency', { bold: true }),
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory List',
    description: 'รายการสินค้าคงคลัง',
    icon: '📋',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('item_code', 'รหัส / Code', 80, 'left'),
      col('name', 'ชื่อสินค้า / Name', 180, 'left', 'text', { overflow: 'wrap' }),
      col('lot_number', 'Lot No.', 80, 'center'),
      col('location', 'คลัง / Loc', 70, 'center'),
      col('quantity', 'คงเหลือ / On Hand', 70, 'right', 'number'),
      col('unit', 'หน่วย', 50, 'center'),
    ],
  },
  {
    id: 'delivery',
    name: 'Delivery Note',
    description: 'ใบส่งสินค้า',
    icon: '🚚',
    columns: [
      col('index', '#', 30, 'center', 'text', { isIndex: true }),
      col('item_code', 'รหัส / Code', 80, 'left'),
      col('description', 'รายการ / Description', 220, 'left', 'text', { overflow: 'wrap' }),
      col('quantity', 'จำนวน / Qty', 70, 'center', 'number'),
      col('unit', 'หน่วย / Unit', 60, 'center'),
      col('remarks', 'หมายเหตุ / Remarks', 120, 'left'),
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal (3 Columns)',
    description: 'เรียบง่าย 3 คอลัมน์',
    icon: '▤',
    columns: [
      col('index', '#', 40, 'center', 'text', { isIndex: true }),
      col('description', 'Description', 350, 'left', 'text', { overflow: 'wrap' }),
      col('amount', 'Amount', 120, 'right', 'currency', { bold: true }),
    ],
  },
];

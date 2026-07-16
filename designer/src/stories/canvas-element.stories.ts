/**
 * Stories for <pld-canvas-element>
 * Demonstrates all 8 element types with various configurations.
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '../components/elements/canvas-element';
import type { CanvasElement } from '../models/element';

const meta: Meta = {
  title: 'Components/CanvasElement',
  component: 'pld-canvas-element',
  argTypes: {
    selected: { control: 'boolean' },
    zoom: { control: { type: 'range', min: 25, max: 300, step: 5 } },
  },
  args: {
    selected: false,
    zoom: 100,
    jsonData: null,
  },
};

export default meta;

function renderElement(element: CanvasElement, args: any) {
  return html`
    <div style="position: relative; width: 600px; height: 400px; background: #fff; border: 1px solid #ccc;">
      <pld-canvas-element
        .element=${element}
        .selected=${args.selected ?? false}
        .zoom=${args.zoom ?? 100}
        .jsonData=${args.jsonData ?? null}
      ></pld-canvas-element>
    </div>
  `;
}

export const TextElement: StoryObj = {
  args: { selected: true },
  render: (args) => renderElement({
    id: 'text-1', type: 'text', name: 'text_1', role: 'content',
    x: 20, y: 20, w: 250, h: 40, zIndex: 0, locked: false, visible: true,
    content: 'Hello World — ทดสอบภาษาไทย', fontSize: 16,
    fontWeight: 'normal', color: '#333333', textAlign: 'left',
  } as any, args),
};

export const HeaderElement: StoryObj = {
  render: (args) => renderElement({
    id: 'hdr-1', type: 'header', name: 'header_1', role: 'header',
    x: 20, y: 20, w: 400, h: 50, zIndex: 0, locked: false, visible: true,
    content: 'Invoice #{{id}}', fontSize: 22,
    fontWeight: 'bold', color: '#111111', textAlign: 'left',
  } as any, args),
};

export const TableElement: StoryObj = {
  render: (args) => renderElement({
    id: 'tbl-1', type: 'table', name: 'table_1', role: 'table',
    x: 20, y: 20, w: 500, h: 200, zIndex: 0, locked: false, visible: true,
    columns: [
      { key: '#', label: '#', width: 40, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
      { key: 'item', label: 'Item', width: 200, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      { key: 'qty', label: 'Qty', width: 60, align: 'right', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      { key: 'price', label: 'Price', width: 100, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
    ],
    headerBgColor: '#e8eaf0', headerTextColor: '#333333',
    borderColor: '#d0d2da', alternateRowColor: '#f9fafb',
  } as any, args),
};

export const ImageElement: StoryObj = {
  render: (args) => renderElement({
    id: 'img-1', type: 'image', name: 'logo', role: 'content',
    x: 20, y: 20, w: 150, h: 100, zIndex: 0, locked: false, visible: true,
    objectFit: 'contain',
  } as any, args),
};

export const ShapeElement: StoryObj = {
  render: (args) => renderElement({
    id: 'shp-1', type: 'shape', name: 'shape_1', role: 'content',
    x: 20, y: 20, w: 120, h: 120, zIndex: 0, locked: false, visible: true,
    bgColor: '#4f6ef7', borderRadius: 12, opacity: 0.8,
  } as any, args),
};

export const LineElement: StoryObj = {
  render: (args) => renderElement({
    id: 'line-1', type: 'line', name: 'line_1', role: 'content',
    x: 20, y: 40, w: 400, h: 10, zIndex: 0, locked: false, visible: true,
    lineColor: '#cccccc', lineWidth: 2, lineStyle: 'dashed',
  } as any, args),
};

export const BarcodeElement: StoryObj = {
  render: (args) => renderElement({
    id: 'bc-1', type: 'barcode', name: 'barcode_1', role: 'content',
    x: 20, y: 20, w: 200, h: 80, zIndex: 0, locked: false, visible: true,
    value: '1234567890', barcodeType: 'code128',
  } as any, args),
};

export const QRCodeElement: StoryObj = {
  render: (args) => renderElement({
    id: 'bc-2', type: 'barcode', name: 'qr_1', role: 'content',
    x: 20, y: 20, w: 120, h: 120, zIndex: 0, locked: false, visible: true,
    value: 'https://example.com', barcodeType: 'qrcode',
  } as any, args),
};

export const ListElement: StoryObj = {
  render: (args) => renderElement({
    id: 'list-1', type: 'list', name: 'list_1', role: 'content',
    x: 20, y: 20, w: 250, h: 100, zIndex: 0, locked: false, visible: true,
    items: ['First Item', 'Second Item', 'Third Item'],
    fontSize: 12, color: '#333333', listStyle: 'bullet',
  } as any, args),
};

export const NumberedList: StoryObj = {
  render: (args) => renderElement({
    id: 'list-2', type: 'list', name: 'list_2', role: 'content',
    x: 20, y: 20, w: 250, h: 100, zIndex: 0, locked: false, visible: true,
    items: ['Payment Terms', 'Net 30 Days', 'Bank Transfer'],
    fontSize: 12, color: '#333333', listStyle: 'number',
  } as any, args),
};

export const LockedElement: StoryObj = {
  args: { selected: true },
  render: (args) => renderElement({
    id: 'text-2', type: 'text', name: 'locked_text', role: 'content',
    x: 20, y: 20, w: 200, h: 30, zIndex: 0, locked: true, visible: true,
    content: 'Locked Element', fontSize: 14,
    fontWeight: 'normal', color: '#999999', textAlign: 'left',
  } as any, args),
};

export const WithDataBinding: StoryObj = {
  args: {
    jsonData: { company: { name: 'ACME Corp', address: '123 Main St' } },
    selected: true,
  },
  render: (args) => renderElement({
    id: 'text-3', type: 'text', name: 'company_name', role: 'content',
    x: 20, y: 20, w: 300, h: 30, zIndex: 0, locked: false, visible: true,
    content: 'Company: {{company.name}}', fontSize: 14,
    fontWeight: 'normal', color: '#333333', textAlign: 'left',
    binding: 'company.name',
  } as any, args),
};

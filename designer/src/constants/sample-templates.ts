/**
 * Built-in Sample Templates
 * Provides 6 standard business document templates.
 *
 * @author Wichit Wongta
 */
import { nanoid } from 'nanoid';
import type { DocumentTemplate } from '../models/template';
import type { CanvasElement, TextElement, LineElement, TableElement, ShapeElement } from '../models/element';
import { createDefaultPage } from '../models/page';
import { createDefaultPagination } from '../models/template';
import { elementsToBands } from '../services/band-layout.service';

function makeId(): string {
  return nanoid(10);
}

/** Create Invoice template — multi-page with word-counting pagination */
function createInvoiceTemplate(): DocumentTemplate {
  const elements: CanvasElement[] = [
    // Company Logo Placeholder
    {
      id: makeId(), type: 'shape', name: 'logo_bg', role: 'header',
      x: 30, y: 30, w: 120, h: 60, zIndex: 0,
      bgColor: '#4f6ef7', borderRadius: 8, opacity: 1,
      locked: false, visible: true,
    } as ShapeElement,
    {
      id: makeId(), type: 'header', name: 'company_name', role: 'header',
      x: 160, y: 30, w: 180, h: 28, zIndex: 1,
      content: '{{company.name}}', fontSize: 14, fontWeight: 'bold',
      color: '#111111', textAlign: 'left',
      binding: 'company.name',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'company_address', role: 'header',
      x: 160, y: 55, w: 180, h: 36, zIndex: 2,
      content: '{{company.address}}', fontSize: 9, fontWeight: 'normal',
      color: '#666666', textAlign: 'left',
      binding: 'company.address',
      locked: false, visible: true,
    } as TextElement,
    // Document Title
    {
      id: makeId(), type: 'header', name: 'doc_title', role: 'header',
      x: 350, y: 30, w: 215, h: 32, zIndex: 3,
      content: 'INVOICE', fontSize: 24, fontWeight: 'bold',
      color: '#4f6ef7', textAlign: 'right',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'doc_number', role: 'header',
      x: 350, y: 62, w: 215, h: 18, zIndex: 4,
      content: '#{{document.number}}', fontSize: 12, fontWeight: 'normal',
      color: '#333333', textAlign: 'right',
      binding: 'document.number',
      locked: false, visible: true,
    } as TextElement,
    // Separator
    {
      id: makeId(), type: 'line', name: 'header_line', role: 'header',
      x: 30, y: 105, w: 535, h: 4, zIndex: 5,
      lineColor: '#e0e0e0', lineWidth: 1, lineStyle: 'solid',
      locked: false, visible: true,
    } as LineElement,
    // Customer Info
    {
      id: makeId(), type: 'text', name: 'bill_to_label', role: 'content',
      x: 30, y: 125, w: 100, h: 16, zIndex: 6,
      content: 'Bill To:', fontSize: 10, fontWeight: 'bold',
      color: '#666666', textAlign: 'left',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'customer_name', role: 'content',
      x: 30, y: 142, w: 250, h: 18, zIndex: 7,
      content: '{{customer.name}}', fontSize: 12, fontWeight: 'bold',
      color: '#111111', textAlign: 'left',
      binding: 'customer.name',
      locked: false, visible: true,
    } as TextElement,
    // Date Info
    {
      id: makeId(), type: 'text', name: 'date_label', role: 'content',
      x: 380, y: 125, w: 80, h: 16, zIndex: 8,
      content: 'Date:', fontSize: 10, fontWeight: 'normal',
      color: '#666666', textAlign: 'right',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'date_value', role: 'content',
      x: 465, y: 125, w: 100, h: 16, zIndex: 9,
      content: '{{document.date}}', fontSize: 10, fontWeight: 'normal',
      color: '#333333', textAlign: 'right',
      binding: 'document.date',
      locked: false, visible: true,
    } as TextElement,
    // Items Table
    {
      id: makeId(), type: 'table', name: 'items_table', role: 'table',
      x: 30, y: 190, w: 535, h: 250, zIndex: 10,
      binding: 'items',
      columns: [
        { key: 'index', label: '#', width: 30, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
        { key: 'description', label: 'Description', width: 220, align: 'left', format: 'text', overflow: 'wrap', maxLines: 4, hidden: false, bold: false, uppercase: false },
        { key: 'quantity', label: 'Qty', width: 60, align: 'center', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'unit_price', label: 'Unit Price', width: 100, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'amount', label: 'Amount', width: 100, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: true, uppercase: false },
      ],
      headerBgColor: '#4f6ef7',
      headerTextColor: '#ffffff',
      borderColor: '#e0e0e0',
      alternateRowColor: '#f8f9fc',
      locked: false, visible: true,
    } as TableElement,
    // Summary
    {
      id: makeId(), type: 'text', name: 'subtotal', role: 'summary',
      x: 380, y: 460, w: 185, h: 18, zIndex: 11,
      content: 'Subtotal: {{totals.subtotal}}', fontSize: 11, fontWeight: 'normal',
      color: '#333333', textAlign: 'right',
      binding: 'totals.subtotal',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'tax', role: 'summary',
      x: 380, y: 480, w: 185, h: 18, zIndex: 12,
      content: 'VAT 7%: {{totals.tax}}', fontSize: 11, fontWeight: 'normal',
      color: '#333333', textAlign: 'right',
      binding: 'totals.tax',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'line', name: 'total_line', role: 'summary',
      x: 380, y: 500, w: 185, h: 4, zIndex: 13,
      lineColor: '#4f6ef7', lineWidth: 2, lineStyle: 'solid',
      locked: false, visible: true,
    } as LineElement,
    {
      id: makeId(), type: 'text', name: 'total', role: 'summary',
      x: 380, y: 510, w: 185, h: 24, zIndex: 14,
      content: 'Total: {{totals.total}}', fontSize: 14, fontWeight: 'bold',
      color: '#4f6ef7', textAlign: 'right',
      binding: 'totals.total',
      locked: false, visible: true,
    } as TextElement,
    // Footer
    {
      id: makeId(), type: 'line', name: 'footer_line', role: 'footer',
      x: 30, y: 780, w: 535, h: 4, zIndex: 15,
      lineColor: '#e0e0e0', lineWidth: 0.5, lineStyle: 'solid',
      locked: false, visible: true,
    } as LineElement,
    {
      id: makeId(), type: 'text', name: 'footer_text', role: 'footer',
      x: 30, y: 790, w: 535, h: 16, zIndex: 16,
      content: 'Thank you for your business', fontSize: 9, fontWeight: 'normal',
      color: '#999999', textAlign: 'center',
      locked: false, visible: true,
    } as TextElement,
  ];

  return {
    id: 'tpl-invoice',
    name: 'Invoice',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: {
      mode: 'height',
      rowsPerPage: 10,
      baseRowHeight: 24,
      lineHeightPx: 14,
      showContinuationHeader: true,
      orphanWidowMinRows: 2,
      summaryBreak: 'auto',
      dynamicFooter: true,
      dynamicFooterGap: 16,
      forceBreakBeforeRows: [],
      keepTogetherField: '',
      headerMode: 'all',
      columnSpanField: '',
    },
    elements,
    jsonData: {
      company: {
        name: 'ACME Corporation Co., Ltd.',
        address: '123 Business Road, Suite 456, Bangkok 10110, Thailand',
      },
      customer: {
        name: 'John Doe',
        address: '789 Customer Avenue, Chiang Mai 50000',
      },
      document: { number: 'INV-2025-0001', date: '2025-01-15' },
      items: [
        { description: 'Web Application Development - Full-stack development including React frontend, Node.js backend, PostgreSQL database setup, and deployment configuration for production environment', quantity: 1, unit_price: 85000, amount: 85000 },
        { description: 'UI/UX Design', quantity: 1, unit_price: 25000, amount: 25000 },
        { description: 'Logo Design & Brand Identity Package - Including primary logo, secondary marks, color palette, typography guidelines, and brand usage manual', quantity: 1, unit_price: 35000, amount: 35000 },
        { description: 'SSL Certificate (1 Year)', quantity: 1, unit_price: 2500, amount: 2500 },
        { description: 'Cloud Server Hosting - AWS EC2 instance with auto-scaling, load balancer, CloudFront CDN, and 24/7 monitoring with automated failover support', quantity: 12, unit_price: 3500, amount: 42000 },
        { description: 'Database Administration', quantity: 6, unit_price: 5000, amount: 30000 },
        { description: 'API Integration with Third-Party Payment Gateway - Stripe and PayPal integration including webhook handlers, retry logic, reconciliation reporting, and PCI compliance review', quantity: 1, unit_price: 45000, amount: 45000 },
        { description: 'Mobile Responsive Optimization', quantity: 1, unit_price: 15000, amount: 15000 },
        { description: 'Search Engine Optimization (SEO) - Technical audit, on-page optimization, meta tag configuration, sitemap generation, structured data markup, and Google Search Console setup', quantity: 1, unit_price: 20000, amount: 20000 },
        { description: 'Content Management System Training', quantity: 2, unit_price: 8000, amount: 16000 },
        { description: 'Email Server Configuration', quantity: 1, unit_price: 12000, amount: 12000 },
        { description: 'Automated Testing Suite - Unit tests, integration tests, and end-to-end testing with Cypress, including CI/CD pipeline configuration and test coverage reporting', quantity: 1, unit_price: 38000, amount: 38000 },
        { description: 'Performance Optimization & Caching', quantity: 1, unit_price: 18000, amount: 18000 },
        { description: 'Security Audit and Penetration Testing - Comprehensive vulnerability assessment covering OWASP Top 10, SQL injection testing, XSS prevention, CSRF protection, and detailed remediation report', quantity: 1, unit_price: 55000, amount: 55000 },
        { description: 'Domain Registration (2 Years)', quantity: 1, unit_price: 1200, amount: 1200 },
        { description: 'Analytics Dashboard Development - Custom reporting dashboard with real-time data visualization, export capabilities, user behavior tracking, and conversion funnel analysis', quantity: 1, unit_price: 42000, amount: 42000 },
        { description: 'Technical Documentation', quantity: 1, unit_price: 15000, amount: 15000 },
        { description: 'Post-Launch Support & Maintenance - 3-month support package including bug fixes, minor feature updates, server monitoring, backup management, and priority response SLA', quantity: 3, unit_price: 12000, amount: 36000 },
      ],
      totals: {
        subtotal: '531,700.00',
        tax: '37,219.00',
        total: '568,919.00',
      },
    },
  };
}

/** Get all built-in sample templates */
export function getSampleTemplates(): DocumentTemplate[] {
  // Each sample is authored as a band structure (#47 3b): the band layout is
  // derived once from the element positions via the proven migration, so a sample
  // renders identically through either path but now carries an explicit `bands`
  // the band editor loads directly (no regenerate-on-entry bridge). Element ids
  // are random (nanoid), so bands must be computed from these very elements — not
  // hardcoded — to keep the id references valid.
  return [
    createInvoiceTemplate(),
    createTaxInvoiceTemplate(),
    createPurchaseOrderTemplate(),
    createQuotationTemplate(),
    createDeliveryNoteTemplate(),
    createReceiptTemplate(),
  ].map((tpl) => ({ ...tpl, bands: elementsToBands(tpl.elements) }));
}

/** Get a single sample template by ID */
export function getSampleTemplate(id: string): DocumentTemplate | null {
  return getSampleTemplates().find((t) => t.id === id) || null;
}

// ═══════════════════════════════════════
// TAX INVOICE TEMPLATE
// ═══════════════════════════════════════

function createTaxInvoiceTemplate(): DocumentTemplate {
  const elements: CanvasElement[] = [
    {
      id: makeId(), type: 'shape', name: 'accent_bar', role: 'header',
      x: 0, y: 0, w: 595, h: 6, zIndex: 0,
      bgColor: '#22d3a7', borderRadius: 0, opacity: 1,
      locked: false, visible: true,
    } as ShapeElement,
    {
      id: makeId(), type: 'header', name: 'doc_title', role: 'header',
      x: 30, y: 20, w: 300, h: 28, zIndex: 1,
      content: 'ใบกำกับภาษี / TAX INVOICE', fontSize: 18, fontWeight: 'bold',
      color: '#111111', textAlign: 'left',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'company_name', role: 'header',
      x: 30, y: 50, w: 300, h: 20, zIndex: 2,
      content: '{{company.name}}', fontSize: 12, fontWeight: 'bold',
      color: '#333333', textAlign: 'left', binding: 'company.name',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'tax_id', role: 'header',
      x: 30, y: 70, w: 300, h: 16, zIndex: 3,
      content: 'เลขประจำตัวผู้เสียภาษี: {{company.taxId}}', fontSize: 10, fontWeight: 'normal',
      color: '#666666', textAlign: 'left', binding: 'company.taxId',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'doc_number', role: 'header',
      x: 380, y: 20, w: 185, h: 18, zIndex: 4,
      content: 'เลขที่: {{document.number}}', fontSize: 12, fontWeight: 'bold',
      color: '#333333', textAlign: 'right', binding: 'document.number',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'doc_date', role: 'header',
      x: 380, y: 40, w: 185, h: 16, zIndex: 5,
      content: 'วันที่: {{document.date}}', fontSize: 10, fontWeight: 'normal',
      color: '#666666', textAlign: 'right', binding: 'document.date',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'line', name: 'header_line', role: 'header',
      x: 30, y: 100, w: 535, h: 4, zIndex: 6,
      lineColor: '#22d3a7', lineWidth: 2, lineStyle: 'solid',
      locked: false, visible: true,
    } as LineElement,
    {
      id: makeId(), type: 'table', name: 'items_table', role: 'table',
      x: 30, y: 150, w: 535, h: 300, zIndex: 7,
      binding: 'items',
      columns: [
        { key: 'index', label: 'ลำดับ', width: 35, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
        { key: 'description', label: 'รายการ', width: 210, align: 'left', format: 'text', overflow: 'wrap', maxLines: 3, hidden: false, bold: false, uppercase: false },
        { key: 'quantity', label: 'จำนวน', width: 55, align: 'center', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'unit', label: 'หน่วย', width: 45, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'unit_price', label: 'ราคา/หน่วย', width: 80, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'amount', label: 'จำนวนเงิน', width: 90, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: true, uppercase: false },
      ],
      headerBgColor: '#22d3a7',
      headerTextColor: '#ffffff',
      borderColor: '#d0d2da',
      alternateRowColor: '#f0fdf8',
      locked: false, visible: true,
    } as TableElement,
    {
      id: makeId(), type: 'text', name: 'total_text', role: 'summary',
      x: 30, y: 490, w: 300, h: 16, zIndex: 8,
      content: '({{totals.totalText}})', fontSize: 10, fontWeight: 'normal',
      color: '#666666', textAlign: 'left', binding: 'totals.totalText',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'total_amount', role: 'summary',
      x: 380, y: 480, w: 185, h: 24, zIndex: 9,
      content: 'รวมทั้งสิ้น: ฿{{totals.total}}', fontSize: 14, fontWeight: 'bold',
      color: '#22d3a7', textAlign: 'right', binding: 'totals.total',
      locked: false, visible: true,
    } as TextElement,
  ];

  return {
    id: 'tpl-tax-invoice',
    name: 'Tax Invoice (ใบกำกับภาษี)',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: createDefaultPagination(),
    elements,
    jsonData: {
      company: { name: 'บริษัท แอดวานซ์ เทค จำกัด', taxId: '0105548123456', address: '88/8 อาคารสาทร กรุงเทพฯ 10120' },
      document: { number: 'TIV-2025-0201', date: '2025-02-18' },
      customer: { name: 'บริษัท ไทย มานูแฟคเจอริ่ง จำกัด', taxId: '0105561789012' },
      items: [
        { description: 'ค่าระบบ ERP License — NetSuite SuiteCloud', quantity: 1, unit: 'ระบบ', unit_price: 350000, amount: 350000 },
        { description: 'ค่าติดตั้งและ Configuration', quantity: 1, unit: 'งาน', unit_price: 180000, amount: 180000 },
        { description: 'ค่าฝึกอบรมผู้ใช้งาน', quantity: 3, unit: 'วัน', unit_price: 25000, amount: 75000 },
      ],
      totals: { subtotal: '605,000.00', tax: '42,350.00', total: '647,350.00', totalText: 'หกแสนสี่หมื่นเจ็ดพันสามร้อยห้าสิบบาทถ้วน' },
    },
  };
}

// ═══════════════════════════════════════
// PURCHASE ORDER TEMPLATE
// ═══════════════════════════════════════

function createPurchaseOrderTemplate(): DocumentTemplate {
  const elements: CanvasElement[] = [
    {
      id: makeId(), type: 'shape', name: 'header_bg', role: 'header',
      x: 0, y: 0, w: 595, h: 80, zIndex: 0,
      bgColor: '#1e3a5f', borderRadius: 0, opacity: 1,
      locked: false, visible: true,
    } as ShapeElement,
    {
      id: makeId(), type: 'header', name: 'doc_title', role: 'header',
      x: 30, y: 25, w: 300, h: 30, zIndex: 1,
      content: 'PURCHASE ORDER', fontSize: 22, fontWeight: 'bold',
      color: '#ffffff', textAlign: 'left',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'po_number', role: 'header',
      x: 380, y: 30, w: 185, h: 20, zIndex: 2,
      content: 'PO# {{document.number}}', fontSize: 14, fontWeight: 'bold',
      color: '#ffffff', textAlign: 'right', binding: 'document.number',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'vendor_info', role: 'content',
      x: 30, y: 100, w: 250, h: 50, zIndex: 3,
      content: 'To: {{vendor.name}}\n{{vendor.address}}', fontSize: 11, fontWeight: 'normal',
      color: '#333333', textAlign: 'left', binding: 'vendor.name',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'table', name: 'items_table', role: 'table',
      x: 30, y: 180, w: 535, h: 280, zIndex: 4,
      binding: 'items',
      columns: [
        { key: 'index', label: '#', width: 30, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
        { key: 'item_code', label: 'Item Code', width: 80, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'description', label: 'Description', width: 200, align: 'left', format: 'text', overflow: 'wrap', maxLines: 2, hidden: false, bold: false, uppercase: false },
        { key: 'quantity', label: 'Qty', width: 55, align: 'center', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'unit_price', label: 'Price', width: 80, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'amount', label: 'Total', width: 80, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: true, uppercase: false },
      ],
      headerBgColor: '#1e3a5f',
      headerTextColor: '#ffffff',
      borderColor: '#d0d2da',
      alternateRowColor: '#f1f5f9',
      locked: false, visible: true,
    } as TableElement,
  ];

  return {
    id: 'tpl-purchase-order',
    name: 'Purchase Order',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: createDefaultPagination(),
    elements,
    jsonData: {
      document: { number: 'PO-2025-0033', date: '2025-02-10' },
      vendor: { name: 'Siam Steel Supply Co., Ltd.', address: '456 Industrial Rd., Samut Prakan 10560' },
      items: [
        { item_code: 'RAW-101', description: 'Hot Rolled Steel Coil SS400 2.0mm', quantity: 10, unit_price: 28000, amount: 280000 },
        { item_code: 'RAW-205', description: 'Galvanized Steel Sheet 1.2mm x 4ft x 8ft', quantity: 50, unit_price: 3200, amount: 160000 },
        { item_code: 'RAW-310', description: 'Stainless Steel Bar SUS304 Ø25mm', quantity: 30, unit_price: 4500, amount: 135000 },
      ],
      totals: { subtotal: '575,000.00', tax: '40,250.00', total: '615,250.00' },
    },
  };
}

// ═══════════════════════════════════════
// QUOTATION TEMPLATE
// ═══════════════════════════════════════

function createQuotationTemplate(): DocumentTemplate {
  const elements: CanvasElement[] = [
    {
      id: makeId(), type: 'header', name: 'doc_title', role: 'header',
      x: 30, y: 30, w: 535, h: 32, zIndex: 0,
      content: 'QUOTATION / ใบเสนอราคา', fontSize: 20, fontWeight: 'bold',
      color: '#f59e42', textAlign: 'center',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'line', name: 'accent_line', role: 'header',
      x: 200, y: 65, w: 195, h: 4, zIndex: 1,
      lineColor: '#f59e42', lineWidth: 3, lineStyle: 'solid',
      locked: false, visible: true,
    } as LineElement,
    {
      id: makeId(), type: 'text', name: 'company_info', role: 'header',
      x: 30, y: 80, w: 250, h: 40, zIndex: 2,
      content: '{{company.name}}\n{{company.address}}', fontSize: 10, fontWeight: 'normal',
      color: '#555555', textAlign: 'left', binding: 'company.name',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'quote_number', role: 'header',
      x: 380, y: 80, w: 185, h: 16, zIndex: 3,
      content: 'QT# {{document.number}}', fontSize: 11, fontWeight: 'bold',
      color: '#333333', textAlign: 'right', binding: 'document.number',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'table', name: 'items_table', role: 'table',
      x: 30, y: 160, w: 535, h: 300, zIndex: 4,
      binding: 'items',
      columns: [
        { key: 'index', label: '#', width: 30, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
        { key: 'description', label: 'รายละเอียด / Description', width: 240, align: 'left', format: 'text', overflow: 'wrap', maxLines: 3, hidden: false, bold: false, uppercase: false },
        { key: 'quantity', label: 'จำนวน', width: 60, align: 'center', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'unit_price', label: 'ราคา/หน่วย', width: 90, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'amount', label: 'จำนวนเงิน', width: 90, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: true, uppercase: false },
      ],
      headerBgColor: '#f59e42',
      headerTextColor: '#ffffff',
      borderColor: '#e0d0b0',
      alternateRowColor: '#fffbf3',
      locked: false, visible: true,
    } as TableElement,
    {
      id: makeId(), type: 'text', name: 'validity', role: 'summary',
      x: 30, y: 500, w: 300, h: 16, zIndex: 5,
      content: 'ใบเสนอราคามีอายุ 30 วัน นับจากวันที่ออก', fontSize: 10, fontWeight: 'normal',
      color: '#999999', textAlign: 'left',
      locked: false, visible: true,
    } as TextElement,
  ];

  return {
    id: 'tpl-quotation',
    name: 'Quotation (ใบเสนอราคา)',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: createDefaultPagination(),
    elements,
    jsonData: {
      company: { name: 'บริษัท เอบีซี จำกัด', address: '99/1 ถนนสุขุมวิท กรุงเทพฯ 10110' },
      document: { number: 'QT-2025-0042', date: '2025-02-15' },
      items: [
        { description: 'ระบบจัดการคลังสินค้า (WMS)', quantity: 1, unit_price: 450000, amount: 450000 },
        { description: 'อบรมการใช้งาน 2 วัน', quantity: 2, unit_price: 15000, amount: 30000 },
        { description: 'บำรุงรักษาระบบรายปี', quantity: 1, unit_price: 85000, amount: 85000 },
      ],
      totals: { subtotal: '565,000.00', tax: '39,550.00', total: '604,550.00' },
    },
  };
}

// ═══════════════════════════════════════
// DELIVERY NOTE TEMPLATE
// ═══════════════════════════════════════

function createDeliveryNoteTemplate(): DocumentTemplate {
  const elements: CanvasElement[] = [
    {
      id: makeId(), type: 'header', name: 'doc_title', role: 'header',
      x: 30, y: 30, w: 300, h: 26, zIndex: 0,
      content: '🚚 DELIVERY NOTE / ใบส่งสินค้า', fontSize: 16, fontWeight: 'bold',
      color: '#333333', textAlign: 'left',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'dn_number', role: 'header',
      x: 380, y: 30, w: 185, h: 18, zIndex: 1,
      content: 'DN# {{document.number}}', fontSize: 12, fontWeight: 'bold',
      color: '#333333', textAlign: 'right', binding: 'document.number',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'line', name: 'header_line', role: 'header',
      x: 30, y: 65, w: 535, h: 4, zIndex: 2,
      lineColor: '#333333', lineWidth: 1.5, lineStyle: 'solid',
      locked: false, visible: true,
    } as LineElement,
    {
      id: makeId(), type: 'table', name: 'items_table', role: 'table',
      x: 30, y: 120, w: 535, h: 350, zIndex: 3,
      binding: 'items',
      columns: [
        { key: 'index', label: '#', width: 30, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
        { key: 'item_code', label: 'รหัส', width: 70, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'description', label: 'รายการ', width: 220, align: 'left', format: 'text', overflow: 'wrap', maxLines: 2, hidden: false, bold: false, uppercase: false },
        { key: 'quantity', label: 'จำนวน', width: 60, align: 'center', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'unit', label: 'หน่วย', width: 50, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'remarks', label: 'หมายเหตุ', width: 100, align: 'left', format: 'text', overflow: 'wrap', maxLines: 2, hidden: false, bold: false, uppercase: false },
      ],
      headerBgColor: '#555555',
      headerTextColor: '#ffffff',
      borderColor: '#d0d0d0',
      alternateRowColor: '#f5f5f5',
      locked: false, visible: true,
    } as TableElement,
    {
      id: makeId(), type: 'text', name: 'sign_receiver', role: 'footer',
      x: 30, y: 740, w: 200, h: 40, zIndex: 4,
      content: '______________________\nผู้รับสินค้า / Received By', fontSize: 10, fontWeight: 'normal',
      color: '#666666', textAlign: 'center',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'sign_delivery', role: 'footer',
      x: 350, y: 740, w: 200, h: 40, zIndex: 5,
      content: '______________________\nผู้ส่งสินค้า / Delivered By', fontSize: 10, fontWeight: 'normal',
      color: '#666666', textAlign: 'center',
      locked: false, visible: true,
    } as TextElement,
  ];

  return {
    id: 'tpl-delivery-note',
    name: 'Delivery Note (ใบส่งสินค้า)',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: createDefaultPagination(),
    elements,
    jsonData: {
      document: { number: 'DN-2025-0088', date: '2025-03-01' },
      customer: { name: 'บริษัท XYZ อินเตอร์เนชันแนล จำกัด', address: '123 นิคมอุตสาหกรรม อมตะนคร ชลบุรี' },
      items: [
        { item_code: 'STL-001', description: 'เหล็กแผ่นรีดร้อน SS400 6mm', quantity: 50, unit: 'แผ่น', remarks: 'Lot# A2025-03' },
        { item_code: 'STL-002', description: 'เหล็กเส้นกลม SR24 12mm', quantity: 200, unit: 'เส้น', remarks: '' },
        { item_code: 'BLT-010', description: 'น็อตสแตนเลส M10x30', quantity: 500, unit: 'ตัว', remarks: 'Grade A4-80' },
      ],
    },
  };
}

// ═══════════════════════════════════════
// RECEIPT TEMPLATE
// ═══════════════════════════════════════

function createReceiptTemplate(): DocumentTemplate {
  const elements: CanvasElement[] = [
    {
      id: makeId(), type: 'shape', name: 'accent_top', role: 'header',
      x: 0, y: 0, w: 595, h: 4, zIndex: 0,
      bgColor: '#e74c8b', borderRadius: 0, opacity: 1,
      locked: false, visible: true,
    } as ShapeElement,
    {
      id: makeId(), type: 'header', name: 'doc_title', role: 'header',
      x: 30, y: 25, w: 535, h: 28, zIndex: 1,
      content: 'ใบเสร็จรับเงิน / RECEIPT', fontSize: 18, fontWeight: 'bold',
      color: '#e74c8b', textAlign: 'center',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'receipt_no', role: 'header',
      x: 380, y: 60, w: 185, h: 16, zIndex: 2,
      content: 'เลขที่: {{document.number}}', fontSize: 10, fontWeight: 'bold',
      color: '#333333', textAlign: 'right', binding: 'document.number',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'text', name: 'received_from', role: 'content',
      x: 30, y: 100, w: 300, h: 18, zIndex: 3,
      content: 'ได้รับเงินจาก: {{customer.name}}', fontSize: 11, fontWeight: 'normal',
      color: '#333333', textAlign: 'left', binding: 'customer.name',
      locked: false, visible: true,
    } as TextElement,
    {
      id: makeId(), type: 'table', name: 'items_table', role: 'table',
      x: 30, y: 150, w: 535, h: 200, zIndex: 4,
      binding: 'items',
      columns: [
        { key: 'index', label: '#', width: 35, align: 'center', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false, isIndex: true },
        { key: 'description', label: 'รายการ', width: 350, align: 'left', format: 'text', overflow: 'wrap', maxLines: 2, hidden: false, bold: false, uppercase: false },
        { key: 'amount', label: 'จำนวนเงิน', width: 120, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: true, uppercase: false },
      ],
      headerBgColor: '#e74c8b',
      headerTextColor: '#ffffff',
      borderColor: '#e0d0d5',
      alternateRowColor: '#fff5f8',
      locked: false, visible: true,
    } as TableElement,
    {
      id: makeId(), type: 'text', name: 'total', role: 'summary',
      x: 380, y: 380, w: 185, h: 24, zIndex: 5,
      content: 'รวม: ฿{{totals.total}}', fontSize: 14, fontWeight: 'bold',
      color: '#e74c8b', textAlign: 'right', binding: 'totals.total',
      locked: false, visible: true,
    } as TextElement,
  ];

  return {
    id: 'tpl-receipt',
    name: 'Receipt (ใบเสร็จรับเงิน)',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: createDefaultPagination(),
    elements,
    jsonData: {
      document: { number: 'RC-2025-0156', date: '2025-02-20' },
      customer: { name: 'นายสมชาย ใจดี' },
      items: [
        { description: 'ค่าบริการที่ปรึกษา NetSuite — เดือนกุมภาพันธ์ 2025', amount: 150000 },
        { description: 'ค่าพัฒนาระบบเพิ่มเติม (Change Request #CR-042)', amount: 45000 },
      ],
      totals: { total: '195,000.00' },
    },
  };
}

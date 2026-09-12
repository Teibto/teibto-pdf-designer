/**
 * Built-in Sample Templates
 * Provides 6 standard business document templates.
 *
 * @author Wichit Wongta
 */
import { nanoid } from 'nanoid';
import type { DocumentTemplate } from '../models/template';
import type { Band } from '../models/bands';
import type { CanvasElement, TextElement, LineElement, TableElement, ShapeElement, ImageElement, TableColumn, ElementRoleType } from '../models/element';
import { createDefaultPage } from '../models/page';
import { createDefaultPagination } from '../models/template';
import { elementsToBands } from '../services/band-layout.service';

function makeId(): string {
  return nanoid(10);
}

/**
 * Create Invoice template — Thai statutory tax invoice (ใบแจ้งหนี้/ใบกำกับภาษี),
 * modelled on the Teibto Thai Localization reference (PFTS_Invoice). Binds the full
 * curated schema from pld_lib_invoice_data (#73). Bordered key/value grids (doc-info,
 * summary) are TableElements bound to arrays because ShapeElement has no border.
 */
function createInvoiceTemplate(): DocumentTemplate {
  const DISCLAIMER =
    'เอกสารฉบับนี้ออกโดยผู้มีอำนาจซึ่งได้รับการอนุมัติผ่านระบบงานของบริษัทฯ ไม่จำเป็นต้องมีลายเซ็นผู้อนุมัติลงนาม / ' +
    'ห้ามโอนสิทธิเรียกร้อง / โปรดระบุเลขที่งานในเอกสารที่เกี่ยวข้อง เพื่อความสะดวกในการตรวจรับและชำระเงิน / ' +
    'This document is issued and approved electronically by authorized person via internal system. ' +
    'Authorized signature is not required. / No assignment of rights and obligations. / Please refer PO number in related documents.';

  // ── typed element factories (keep 35+ elements readable) ──
  const T = (
    name: string, role: ElementRoleType, x: number, y: number, w: number, h: number,
    content: string,
    o: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'center' | 'right'; binding?: string; header?: boolean } = {},
  ): TextElement => ({
    id: makeId(), type: o.header ? 'header' : 'text', name, role, x, y, w, h, zIndex: 0,
    content, fontSize: o.size ?? 8, fontWeight: o.bold ? 'bold' : 'normal',
    color: o.color ?? '#222222', textAlign: o.align ?? 'left',
    ...(o.binding ? { binding: o.binding } : {}), locked: false, visible: true,
  });

  const LN = (name: string, role: ElementRoleType, x: number, y: number, w: number, color = '#999999', lw = 0.5): LineElement => ({
    id: makeId(), type: 'line', name, role, x, y, w, h: 2, zIndex: 0,
    lineColor: color, lineWidth: lw, lineStyle: 'solid', locked: false, visible: true,
  });

  const col = (key: string, label: string, width: number, align: 'left' | 'center' | 'right',
    o: { wrap?: boolean; bold?: boolean; boldFirst?: boolean; maxLines?: number } = {}): TableColumn => ({
    key, label, width, align, format: 'text',
    overflow: o.wrap ? 'wrap' : 'ellipsis', maxLines: o.maxLines ?? (o.wrap ? 3 : 1),
    hidden: false, bold: !!o.bold, uppercase: false,
    ...(o.boldFirst ? { boldFirstLine: true } : {}),
  });

  const TBL = (
    name: string, role: ElementRoleType, x: number, y: number, w: number, h: number,
    binding: string, columns: TableColumn[],
    o: { headBg?: string; headFg?: string; border?: string } = {},
  ): TableElement => ({
    id: makeId(), type: 'table', name, role, x, y, w, h, zIndex: 0, binding, columns,
    headerBgColor: o.headBg ?? '#e9eaee', headerTextColor: o.headFg ?? '#111111',
    borderColor: o.border ?? '#999999', alternateRowColor: '#ffffff',
    locked: false, visible: true,
  });

  const elements: CanvasElement[] = [
    // ═══ HEADER (repeats every page): logo + company + title + doc-info ═══
    {
      id: makeId(), type: 'image', name: 'logo', role: 'header',
      x: 24, y: 22, w: 58, h: 44, zIndex: 0,
      binding: 'company.logo', objectFit: 'contain', locked: false, visible: true,
    } as ImageElement,
    T('company_name', 'header', 90, 22, 240, 15, '{{company.name}}', { size: 12, bold: true, color: '#111111', binding: 'company.name', header: true }),
    T('company_addr', 'header', 90, 39, 240, 20, '{{company.address}}', { size: 7, color: '#555555', binding: 'company.address' }),
    // Labeled lines keep {{...}} in content WITHOUT a binding prop — an element
    // with BOTH exports as bare ${...} and the label is silently lost (#73;
    // "binding drops the literal", see teibto-pld-render-verify).
    T('company_tel', 'header', 90, 59, 240, 10, 'Tel. / โทร : {{company.phone}}', { size: 7, color: '#555555' }),
    T('company_taxid', 'header', 90, 69, 240, 10, 'Tax ID / เลขประจำตัวผู้เสียภาษี : {{company.taxId}}', { size: 7, color: '#555555' }),
    T('company_branch', 'header', 90, 79, 240, 10, 'Branch / สาขา : {{company.branchCode}}', { size: 7, color: '#555555' }),
    T('title_th', 'header', 338, 20, 233, 16, '{{document.titleTH}}', { size: 12, bold: true, align: 'center', color: '#111111', binding: 'document.titleTH', header: true }),
    T('title_en', 'header', 338, 37, 233, 11, '{{document.titleEN}}', { size: 9, align: 'center', color: '#333333', binding: 'document.titleEN' }),
    // h=100 matches the RENDERED height (5 rows × ~18pt with the global th/td
    // padding), not a design h — roleHeight derives header-height from this bbox,
    // and an under-declared h makes the body start on top of the table (#73).
    TBL('docinfo_table', 'header', 338, 54, 233, 100, 'document.docInfoRows',
      [col('label', '', 143, 'left'), col('value', '', 90, 'left')],
      { headBg: '#ffffff', headFg: '#ffffff', border: '#999999' }),

    // ═══ CONTENT: customer / ship-to / disclaimer ═══
    T('cust_label', 'content', 24, 146, 300, 11, 'Customer / ชื่อ - ที่อยู่ลูกค้า', { size: 8, bold: true, color: '#111111' }),
    LN('cust_ul', 'content', 24, 158, 280),
    T('cust_name', 'content', 24, 162, 300, 12, '{{customer.name}}', { size: 9, bold: true, color: '#111111', binding: 'customer.name' }),
    T('cust_addr', 'content', 24, 175, 300, 34, '{{customer.address}}', { size: 8, color: '#444444', binding: 'customer.address' }),
    T('cust_taxid', 'content', 24, 209, 300, 10, 'Tax ID / เลขประจำตัวผู้เสียภาษี : {{customer.taxId}}', { size: 8, color: '#444444' }),
    T('cust_branch', 'content', 24, 219, 300, 10, 'Branch / สาขา : {{customer.branch}}', { size: 8, color: '#444444' }),
    T('ship_label', 'content', 338, 146, 233, 11, 'Ship To / ที่อยู่จัดส่งสินค้า', { size: 8, bold: true, color: '#111111' }),
    LN('ship_ul', 'content', 338, 158, 233),
    T('ship_addr', 'content', 338, 162, 233, 48, '{{shipTo.address}}', { size: 8, color: '#444444', binding: 'shipTo.address' }),
    T('disclaimer', 'content', 24, 236, 547, 30, DISCLAIMER, { size: 6.5, align: 'center', color: '#777777' }),

    // ═══ TABLE: line items (7 columns, bilingual headers) ═══
    // Numeric columns: wrap + maxLines 0 → NO overflow:hidden. BFO ignores both
    // text-overflow AND word-wrap:break-word (an unbroken number never wraps),
    // but honors overflow:hidden — so ellipsis/clip (and wrap's maxLines box)
    // silently LOSES trailing digits (999,999,999,999.99 printed truncated,
    // #75). Without the hidden box an over-wide value overflows VISIBLY —
    // wrong but detectable, never silently wrong. Amount widened for headroom
    // (fits ≈17 chars ≈ tens of billions with satang).
    TBL('items_table', 'table', 24, 272, 547, 300, 'items', [
      col('no', 'No. / ลำดับ', 34, 'center'),
      col('description', 'Description / รายละเอียด', 200, 'left', { wrap: true, boldFirst: true }),
      col('quantity', 'Quantity / จำนวน', 55, 'center', { wrap: true, maxLines: 0 }),
      col('unit', 'Unit / หน่วย', 45, 'center', { wrap: true, maxLines: 0 }),
      col('unit_price', 'Unit Price / ราคาต่อหน่วย', 68, 'right', { wrap: true, maxLines: 0 }),
      col('discount', 'Total Discount / ส่วนลด', 62, 'right', { wrap: true, maxLines: 0 }),
      col('amount', 'Amount / จำนวนเงิน (บาท)', 83, 'right', { bold: true, wrap: true, maxLines: 0 }),
    ]),

    // ═══ SUMMARY (last page): remark + totals grid + baht text + signatures ═══
    T('remark_label', 'summary', 24, 592, 260, 12, 'Remark / หมายเหตุ :', { size: 8, color: '#444444' }),
    TBL('summary_table', 'summary', 300, 588, 271, 152, 'totals.summaryRows',
      [col('label', '', 181, 'right'), col('value', '', 90, 'right')],
      { headBg: '#ffffff', headFg: '#ffffff', border: '#999999' }),
    T('baht_text', 'summary', 300, 744, 271, 14, '( {{totals.bahtText}} )', { size: 9, align: 'right', color: '#111111' }),
    LN('sign_sep', 'summary', 24, 772, 547, '#cccccc'),
    T('sign_created', 'summary', 60, 800, 200, 14, 'Created by / ผู้ออกเอกสาร', { size: 8, align: 'center', color: '#555555' }),
    T('sign_created_date', 'summary', 40, 786, 240, 12, 'ลงวันที่ {{document.date}}', { size: 8, align: 'center', color: '#555555' }),
    T('sign_approved', 'summary', 330, 800, 200, 14, 'Approved by / ผู้อนุมัติ', { size: 8, align: 'center', color: '#555555' }),
    T('sign_approved_date', 'summary', 310, 786, 240, 12, 'ลงวันที่', { size: 8, align: 'center', color: '#555555' }),

    // ═══ FOOTER (repeats every page) ═══
    LN('footer_line', 'footer', 24, 806, 547, '#cccccc'),
    T('footer_disclaimer', 'footer', 24, 810, 547, 20, DISCLAIMER, { size: 6, align: 'center', color: '#999999' }),
    T('footer_created', 'footer', 24, 830, 340, 10, 'ผู้ออกเอกสาร / Created By : {{issuer.createdBy}}', { size: 7, color: '#777777' }),
    // No page element here — the export appends its own "Page X of Y" line to
    // the footer macro; a second static one printed a bare "Page" (#73).
    T('footer_printed', 'footer', 400, 830, 171, 10, 'Printed Date : {{document.printedDate}}', { size: 7, align: 'right', color: '#777777' }),
  ];

  // The header and customer blocks are vertical stacks beside each other, which
  // the migration cannot express: a tall element (logo h44, docinfo_table h82)
  // bridges the stacked lines into ONE row of many side-by-side columns
  // (groupIntoRows rowBottom is a running max), splitting each block across
  // columns. So these two bands are hand-authored — one column per visual block,
  // elements stacked top-to-bottom in elementIds (#73). Ids are nanoid-random,
  // so columns resolve them by element name. Other roles derive correctly.
  const eid = (name: string): string => {
    const el = elements.find((e) => e.name === name);
    if (!el) throw new Error(`invoice template: no element named "${name}"`);
    return el.id;
  };
  const bands: Band[] = elementsToBands(elements).map((band) => {
    if (band.role === 'header') {
      return {
        role: band.role,
        rows: [{
          id: 'header-r0',
          columns: [
            { id: 'header-r0-c0', widthPct: 12, elementIds: [eid('logo')] },
            { id: 'header-r0-c1', widthPct: 45, elementIds: ['company_name', 'company_addr', 'company_tel', 'company_taxid', 'company_branch'].map(eid) },
            { id: 'header-r0-c2', widthPct: 43, elementIds: ['title_th', 'title_en', 'docinfo_table'].map(eid) },
          ],
        }],
      };
    }
    if (band.role === 'content') {
      return {
        role: band.role,
        rows: [
          {
            id: 'content-r0',
            columns: [
              { id: 'content-r0-c0', widthPct: 57, elementIds: ['cust_label', 'cust_ul', 'cust_name', 'cust_addr', 'cust_taxid', 'cust_branch'].map(eid) },
              { id: 'content-r0-c1', widthPct: 43, elementIds: ['ship_label', 'ship_ul', 'ship_addr'].map(eid) },
            ],
          },
          {
            id: 'content-r1',
            columns: [{ id: 'content-r1-c0', widthPct: 100, elementIds: [eid('disclaimer')] }],
          },
        ],
      };
    }
    return band;
  });

  return {
    id: 'tpl-invoice',
    name: 'Invoice',
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: createDefaultPage(),
    pagination: {
      mode: 'height',
      // Conservative padding leaves room for the nine-row totals and signatures
      // with multiline item descriptions. Native BFO QA: six fits per copy;
      // eight or more pushes the totals onto another page (2026-09-12).
      rowsPerPage: 6,
      baseRowHeight: 22,
      lineHeightPx: 12,
      showContinuationHeader: true,
      orphanWidowMinRows: 2,
      summaryBreak: 'auto',
      dynamicFooter: true,
      dynamicFooterGap: 16,
      forceBreakBeforeRows: [],
      keepTogetherField: '',
      headerMode: 'all',
      columnSpanField: '',
      // Pad short tables using the configured rowsPerPage; height mode still
      // lets the renderer paginate longer or wrapped item content naturally.
      fillLastPage: true,
    },
    elements,
    bands,
    jsonData: {
      company: {
        name: 'Teibto Thai Localization', address: 'ห้องเลขที่ 11 แขวงหนองจอก เขตหนองแขม กรุงเทพมหานคร 10600',
        phone: '0901234567', taxId: '0987654321000', branchCode: '00002',
      },
      document: {
        titleTH: 'ใบแจ้งหนี้/ใบกำกับภาษี (ต้นฉบับ)', titleEN: 'INVOICE/TAX INVOICE (Original)',
        printedDate: '17/7/2026 10:59 pm',
        docInfoRows: [
          { label: 'Doc No. / เลขที่เอกสาร', value: 'INT-TTL-260700001' },
          { label: 'Date / วันที่', value: '15/07/2026' },
          { label: 'Due Date / วันครบกำหนดชำระ', value: '30/07/2026' },
          { label: 'Ref.SO / เลขที่การขาย', value: '' },
          { label: 'Ref.No / เลขที่อ้างอิง', value: '' },
        ],
      },
      customer: { name: 'บริษัททดสอบระบบซื้อ-ขาย 1', address: '1234 ถนนทดสอบ กรุงเทพมหานคร 10600', taxId: '12345678901234567890', branch: 'สำนักงานใหญ่' },
      shipTo: { address: '150 อาคารอัมรินทร์พลาซ่า ชั้น 18 ถนนเพลินจิต กรุงเทพมหานคร 10600' },
      issuer: { createdBy: 'Rakop Teibto' },
      items: [
        { no: 1, description: 'PD000002 Product B\ntest B', quantity: 234, unit: 'PCS', unit_price: '616.06', discount: '', amount: '144,158.04' },
        { no: 2, description: 'PD000001 Product A\ntest a', quantity: 10, unit: 'Pack12', unit_price: '10.20', discount: '', amount: '1,224.00' },
        { no: 3, description: 'NonDA-F', quantity: 10, unit: 'PCS', unit_price: '10.00', discount: '', amount: '100.00' },
      ],
      totals: {
        summaryRows: [
          { label: 'Total / มูลค่ารวม', value: '147,819.29' },
          { label: 'Special Discount / ส่วนลดพิเศษ', value: '36,968.99' },
          { label: 'Advance Receive / หักเงินรับล่วงหน้า', value: '0.00' },
          { label: 'Base Amount / มูลค่าก่อนภาษีมูลค่าเพิ่ม', value: '110,850.30' },
          { label: 'VAT / ภาษีมูลค่าเพิ่ม 7.00%', value: '7,759.52' },
          { label: 'Grand Total / มูลค่าสุทธิ', value: '118,609.82' },
          { label: 'Withholding Tax / ภาษีหัก ณ ที่จ่าย', value: '0.00' },
          { label: 'Cash Coupon / คูปองส่วนลดเงินสด', value: '0.00' },
          { label: 'Customer Paid / ยอดชำระ (บาท)', value: '118,609.82' },
        ],
        bahtText: 'หนึ่งแสนหนึ่งหมื่นแปดพันหกร้อยเก้าบาทแปดสิบสองสตางค์',
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
  // hardcoded — to keep the id references valid. A template that hand-authors its
  // own bands (invoice, #73 — stacks the migration cannot derive) keeps them.
  return [
    createInvoiceTemplate(),
    createTaxInvoiceTemplate(),
    createPurchaseOrderTemplate(),
    createQuotationTemplate(),
    createDeliveryNoteTemplate(),
    createReceiptTemplate(),
  ].map((tpl) => ({ ...tpl, bands: tpl.bands ?? elementsToBands(tpl.elements) }));
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

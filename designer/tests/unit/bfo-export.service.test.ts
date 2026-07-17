/**
 * Tests: bfo-export.service.ts
 * Verifies XML output, sanitization, and element rendering.
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { exportBfoXml, renderBandsBody, type BfoExportOptions } from '../../src/services/bfo-export.service';
import type { AppState } from '../../src/state/app-state';
import { createDefaultPage } from '../../src/models/page';
import { createDefaultPagination } from '../../src/models/template';
import type { TextElement, TableElement, ShapeElement, LineElement, ImageElement } from '../../src/models/element';

function createMockState(elements: any[]): AppState {
  return {
    elements,
    selectedId: null,
    multiSelect: [],
    zoom: 100,
    clipboard: [],
    page: createDefaultPage(),
    jsonData: null,
    jsonKeys: [],
    pagination: createDefaultPagination(),
    currentPage: 1,
    totalPages: 1,
    template: { id: null, name: 'Test', isDirty: false },
    view: 'design' as const,
    dragType: null,
    isExporting: false,
    grid: { enabled: true, size: 10, snapToGrid: false, showRulers: true, showGuides: true },
    contextMenu: { show: false, x: 0, y: 0, elementId: null },
  };
}

function makeText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'txt-1', type: 'text', name: 'Text 1', role: 'content',
    x: 10, y: 20, w: 200, h: 30, zIndex: 0, locked: false, visible: true,
    content: 'Hello World', fontSize: 12, fontWeight: 'normal', color: '#333333', textAlign: 'left',
    ...overrides,
  };
}

function makeTable(overrides: Partial<TableElement> = {}): TableElement {
  return {
    id: 'tbl-1', type: 'table', name: 'Table 1', role: 'table',
    x: 10, y: 100, w: 500, h: 200, zIndex: 1, locked: false, visible: true,
    columns: [
      { key: 'item', label: 'Item', width: 200, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      { key: 'qty', label: 'Qty', width: 100, align: 'right', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
    ],
    headerBgColor: '#e8eaf0', headerTextColor: '#333333', borderColor: '#d0d2da', alternateRowColor: '#f9fafb',
    binding: 'order.lines',
    ...overrides,
  };
}

// ═══════════════════════════════════════
// BASIC OUTPUT
// ═══════════════════════════════════════

describe('exportBfoXml', () => {
  it('produces valid XML structure', () => {
    const state = createMockState([]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<?xml version="1.0"?>');
    expect(xml).toContain('<!DOCTYPE pdf');
    expect(xml).toContain('<pdf>');
    expect(xml).toContain('</pdf>');
    expect(xml).toContain('<head>');
    expect(xml).toContain('<body');
  });

  it('sets page size as body attribute (BFO), not @page CSS', () => {
    const state = createMockState([]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('size="A4"');
    expect(xml).not.toContain('@page');
  });

  it('uses landscape when configured', () => {
    const state = createMockState([]);
    state.page.orientation = 'landscape';
    const xml = exportBfoXml(state);

    expect(xml).toContain('size="A4-LANDSCAPE"');
  });
});

// ═══════════════════════════════════════
// THAI FONT EMBEDDING
// ═══════════════════════════════════════

describe('thai font embedding', () => {
  it('emits <link type="font"> with bytes="2" when thaiFontUrls provided', () => {
    const state = createMockState([makeText()]);
    const xml = exportBfoXml(state, {
      thaiFontUrls: { regular: '/core/media/media.nl?id=101', bold: '/core/media/media.nl?id=102' },
    });

    expect(xml).toContain('<link name="THSarabunNew" type="font" subtype="truetype"');
    expect(xml).toContain('src="/core/media/media.nl?id=101"');
    expect(xml).toContain('src-bold="/core/media/media.nl?id=102"');
    expect(xml).toContain('bytes="2"');
    expect(xml).toContain('font-family: THSarabunNew, sans-serif');
  });

  it('regular-only: no src-bold attribute', () => {
    const state = createMockState([makeText()]);
    const xml = exportBfoXml(state, { thaiFontUrls: { regular: '/core/media/media.nl?id=101' } });

    expect(xml).toContain('src="/core/media/media.nl?id=101"');
    expect(xml).not.toContain('src-bold');
  });

  it('without thaiFontUrls: no link, falls back to built-in NotoSansThai', () => {
    const state = createMockState([makeText()]);
    const xml = exportBfoXml(state);

    expect(xml).not.toContain('type="font"');
    expect(xml).toContain('font-family: NotoSansThai, sans-serif');
  });

  it('escapes XML-sensitive characters in font URLs', () => {
    const state = createMockState([makeText()]);
    const xml = exportBfoXml(state, {
      thaiFontUrls: { regular: '/core/media/media.nl?id=101&e=T' },
    });

    expect(xml).toContain('id=101&amp;e=T');
  });
});

// ═══════════════════════════════════════
// HEADER/FOOTER MACROS
// ═══════════════════════════════════════

describe('header/footer macros', () => {
  it('emits macrolist with nlheader for header-role elements', () => {
    const state = createMockState([makeText({ type: 'header', role: 'header', content: 'Company' })]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<macrolist>');
    expect(xml).toContain('<macro id="nlheader">');
    expect(xml).toContain('header="nlheader"');
    expect(xml).toMatch(/header-height="\d+pt"/);
  });

  it('emits nlfooter with pagenumber/totalpages for footer-role elements', () => {
    const state = createMockState([makeText({ role: 'footer', content: 'Thank you' })]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<macro id="nlfooter">');
    expect(xml).toContain('footer="nlfooter"');
    expect(xml).toContain('<pagenumber/>');
    expect(xml).toContain('<totalpages/>');
    expect(xml).not.toContain('counter(page');
  });

  it('header/footer elements are not duplicated in body when in macros', () => {
    const state = createMockState([makeText({ type: 'header', role: 'header', content: 'OnlyOnceHeader' })]);
    const xml = exportBfoXml(state);

    expect(xml.indexOf('OnlyOnceHeader')).toBe(xml.lastIndexOf('OnlyOnceHeader'));
    expect(xml).not.toContain('<div id="header"');
  });

  it('no macrolist when no header/footer roles', () => {
    const state = createMockState([makeText({ role: 'content' })]);
    const xml = exportBfoXml(state);

    expect(xml).not.toContain('<macrolist>');
    expect(xml).not.toContain('header="nlheader"');
  });

  it('includePageHeaders=false keeps header elements inline in body', () => {
    const state = createMockState([makeText({ type: 'header', role: 'header', content: 'InlineHeader' })]);
    const xml = exportBfoXml(state, { includePageHeaders: false });

    expect(xml).not.toContain('<macrolist>');
    expect(xml).toContain('InlineHeader');
    expect(xml).toContain('<div id="header"');
  });
});

// ═══════════════════════════════════════
// TEXT RENDERING
// ═══════════════════════════════════════

describe('text rendering', () => {
  it('renders text element as paragraph', () => {
    const state = createMockState([makeText()]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<p');
    expect(xml).toContain('Hello World');
  });

  it('renders header as h2', () => {
    const state = createMockState([makeText({ type: 'header', role: 'header' })]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<h2');
  });

  it('sanitizes special characters in text content', () => {
    const state = createMockState([makeText({ content: 'Price < 100 & VAT > 7%' })]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('&lt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&gt;');
    expect(xml).not.toContain('< 100');
  });

  it('escapes XSS in text content', () => {
    const state = createMockState([makeText({ content: '<script>alert("xss")</script>' })]);
    const xml = exportBfoXml(state);

    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
  });

  it('sanitizes color values', () => {
    const state = createMockState([makeText({ color: 'url(javascript:alert(1))' })]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('#000000');
    expect(xml).not.toContain('javascript');
  });
});

// ═══════════════════════════════════════
// TABLE RENDERING
// ═══════════════════════════════════════

describe('table rendering', () => {
  it('renders table with columns', () => {
    const state = createMockState([makeTable()]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<table');
    expect(xml).toContain('<thead>');
    expect(xml).toContain('<tbody>');
    expect(xml).toContain('Item');
    expect(xml).toContain('Qty');
  });

  it('uses FreeMarker loop for data binding', () => {
    const state = createMockState([makeTable()]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain('<#list');
    expect(xml).toContain('</#list>');
  });

  it('skips hidden columns', () => {
    const table = makeTable();
    table.columns[1].hidden = true;
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('Item');
    expect(xml).not.toContain('>Qty<');
  });

  it('skips table with no columns', () => {
    const table = makeTable({ columns: [] });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('no columns configured');
  });

  it('sanitizes column labels', () => {
    const table = makeTable();
    table.columns[0].label = '<b>Dangerous & "Label"</b>';
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('&lt;b&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<b>Dangerous');
  });
});

// ═══════════════════════════════════════
// SECTION GROUPING
// ═══════════════════════════════════════

describe('section grouping', () => {
  it('groups elements by role in correct order', () => {
    const state = createMockState([
      makeText({ id: 'c', role: 'content', content: 'Content' }),
      makeText({ id: 'h', type: 'header', role: 'header', content: 'Header' }),
      makeText({ id: 's', role: 'summary', content: 'Summary' }),
    ]);
    const xml = exportBfoXml(state);

    // header role lives in the macrolist (head), before the body sections
    const headerPos = xml.indexOf('<macro id="nlheader">');
    const contentPos = xml.indexOf('CONTENT');
    const summaryPos = xml.indexOf('SUMMARY');

    expect(headerPos).toBeGreaterThan(-1);
    expect(headerPos).toBeLessThan(contentPos);
    expect(contentPos).toBeLessThan(summaryPos);
  });
});

// ═══════════════════════════════════════
// SHAPE & LINE
// ═══════════════════════════════════════

describe('shape rendering', () => {
  it('renders shape as div with background color', () => {
    const shape: ShapeElement = {
      id: 's-1', type: 'shape', name: 'Shape', role: 'content',
      x: 10, y: 10, w: 100, h: 50, zIndex: 0, locked: false, visible: true,
      bgColor: '#4f6ef7', borderRadius: 8, opacity: 0.8,
    };
    const state = createMockState([shape]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('background-color');
    expect(xml).toContain('#4f6ef7');
    expect(xml).toContain('border-radius: 8pt');
  });
});

describe('line rendering', () => {
  it('renders line as hr', () => {
    const line: LineElement = {
      id: 'l-1', type: 'line', name: 'Line', role: 'content',
      x: 10, y: 10, w: 400, h: 10, zIndex: 0, locked: false, visible: true,
      lineColor: '#cccccc', lineWidth: 1.5, lineStyle: 'solid',
    };
    const state = createMockState([line]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<hr');
    expect(xml).toContain('#cccccc');
  });
});

// ═══════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════

describe('edge cases', () => {
  it('handles empty elements array', () => {
    const state = createMockState([]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<body size="A4" padding="0.5in">');
    expect(xml).toContain('</body>');
  });

  it('alias is fixed to "record" — options.recordType no longer changes it (#12)', () => {
    const state = createMockState([makeText({ binding: 'custbody_field' })]);
    // recordType is deprecated: the alias is a fixed contract with the render
    // engine (addRecord templateName:'record'), so it stays ${record.*}.
    const xml = exportBfoXml(state, { recordType: 'invoice' });

    expect(xml).toContain('record.custbody_field');
    expect(xml).not.toContain('invoice.custbody_field');
  });
});

// ═══════════════════════════════════════
// COLUMN OVERFLOW CSS
// ═══════════════════════════════════════

describe('column overflow in BFO table', () => {
  it('ellipsis mode: generates text-overflow:ellipsis CSS', () => {
    const table = makeTable({
      columns: [
        { key: 'desc', label: 'Desc', width: 200, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('text-overflow: ellipsis');
    expect(xml).toContain('white-space: nowrap');
    expect(xml).toContain('overflow: hidden');
  });

  it('wrap mode: generates word-wrap CSS', () => {
    const table = makeTable({
      columns: [
        { key: 'desc', label: 'Desc', width: 200, align: 'left', format: 'text', overflow: 'wrap', maxLines: 0, hidden: false, bold: false, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('word-wrap: break-word');
    expect(xml).not.toContain('text-overflow: ellipsis');
  });

  it('wrap mode with maxLines: generates max-height', () => {
    const table = makeTable({
      columns: [
        { key: 'desc', label: 'Desc', width: 200, align: 'left', format: 'text', overflow: 'wrap', maxLines: 3, hidden: false, bold: false, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('word-wrap: break-word');
    expect(xml).toContain('max-height: 36pt'); // 3 × 12pt
    expect(xml).toContain('overflow: hidden');
  });

  it('clip mode: generates overflow:hidden without ellipsis', () => {
    const table = makeTable({
      columns: [
        { key: 'desc', label: 'Desc', width: 200, align: 'left', format: 'text', overflow: 'clip', maxLines: 1, hidden: false, bold: false, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('overflow: hidden');
    expect(xml).toContain('white-space: nowrap');
    expect(xml).not.toContain('text-overflow');
  });

  it('bold column: generates font-weight in cell', () => {
    const table = makeTable({
      columns: [
        { key: 'amt', label: 'Amount', width: 100, align: 'right', format: 'currency', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: true, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('font-weight: bold');
  });

  it('column width: generates width in th and td', () => {
    const table = makeTable({
      columns: [
        { key: 'desc', label: 'Desc', width: 250, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('width: 250pt');
  });

  it('columnSpanField: generates FreeMarker if/else for span rows', () => {
    const table = makeTable({
      columns: [
        { key: 'name', label: 'Name', width: 200, align: 'left', format: 'text', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
        { key: 'qty', label: 'Qty', width: 100, align: 'right', format: 'number', overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
      ],
    });
    const state = createMockState([table]);
    state.pagination = { ...createDefaultPagination(), columnSpanField: 'isSection' };
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain('<#if');
    expect(xml).toContain('.isSection');
    expect(xml).toContain('colspan="2"');
    expect(xml).toContain('<#else>');
    expect(xml).toContain('</#if>');
  });

  it('columnSpanField empty: no FreeMarker conditional in output', () => {
    const table = makeTable();
    const state = createMockState([table]);
    state.pagination = { ...createDefaultPagination(), columnSpanField: '' };
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).not.toContain('<#if');
    expect(xml).not.toContain('colspan');
  });
});

// ═══════════════════════════════════════
// NULL-SAFETY (#4) — ทุก FreeMarker binding ต้องมี default
// field ว่าง 1 ตัวห้ามทำ PDF พังทั้งใบ (N/render fail ทั้ง render ถ้า expression resolve ไม่ได้)
// ใช้ !'' (single quote) เพราะอยู่ใน XML attribute ได้และรอด escapeXml (double quote โดน escape เป็น &quot;)
// ═══════════════════════════════════════

describe('null-safe bindings (#4)', () => {
  it('text binding gets null-safe default', () => {
    const state = createMockState([makeText({ binding: 'custbody_note' })]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain("${record.custbody_note!''}");
  });

  it('inline {{path}} content gets null-safe default', () => {
    const state = createMockState([makeText({ content: 'Ref: {{otherrefnum}}' })]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain("${record.otherrefnum!''}");
  });

  it('table loop is null-safe: (record.list)![]', () => {
    const state = createMockState([makeTable()]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain('<#list (record.order.lines)![] as lines>');
  });

  it('table cells get null-safe default', () => {
    const state = createMockState([makeTable()]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain("${lines.item!''}");
    expect(xml).toContain("${lines.qty!''}");
  });

  it('column-span row label gets null-safe default', () => {
    const state = createMockState([makeTable()]);
    const stateWithSpan = { ...state, pagination: { ...createDefaultPagination(), columnSpanField: 'isSection' } };
    const xml = exportBfoXml(stateWithSpan, { useFreeMarker: true });

    expect(xml).toContain("${lines.item!''}</td></tr>");
  });

  it('image src binding gets null-safe default that survives escapeXml', () => {
    const img = {
      id: 'img-1', type: 'image', name: 'Logo', role: 'content',
      x: 0, y: 0, w: 100, h: 50, zIndex: 0, locked: false, visible: true,
      src: '', objectFit: 'contain', binding: 'custbody_logo_url',
    } as ImageElement;
    const state = createMockState([img]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain("${record.custbody_logo_url!''}");
    expect(xml).not.toContain('&quot;}');
  });

  it('no unsafe interpolation remains for bound elements', () => {
    const state = createMockState([
      makeText({ binding: 'custbody_a' }),
      makeTable(),
    ]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    const all = xml.match(/\$\{(?:record|lines)\.[^}]*\}/g) ?? [];
    const unsafe = all.filter((m) => !m.includes("!''"));
    expect(unsafe).toEqual([]);
  });
});

describe('barcode null-safety (#4)', () => {
  const makeBarcode = (overrides: any = {}) => ({
    id: 'bc-1', type: 'barcode', name: 'BC', role: 'content',
    x: 0, y: 0, w: 120, h: 40, zIndex: 0, locked: false, visible: true,
    value: 'STATIC123', barcodeType: 'code128',
    ...overrides,
  });

  it('bound barcode is wrapped in has_content guard (empty value = hard BFO error)', () => {
    const state = createMockState([makeBarcode({ binding: 'tranid' })]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain("<#if (record.tranid!'')?has_content>");
    expect(xml).toContain("value=\"${record.tranid!''}\"");
    expect(xml).toContain('</#if>');
  });

  it('static barcode has no guard', () => {
    const state = createMockState([makeBarcode()]);
    const xml = exportBfoXml(state, { useFreeMarker: true });

    expect(xml).toContain('value="STATIC123"');
    expect(xml).not.toContain('<#if');
  });
});

// ═══════════════════════════════════════
// BAND LAYOUT (#45) — row/column → <table>
// ═══════════════════════════════════════

describe('band layout export (#45)', () => {
  it('two elements on the same visual row → <table> with <td width%>', () => {
    const state = createMockState([
      makeText({ content: 'Left', x: 0, y: 10, w: 120, h: 30 }),
      makeText({ content: 'Right', x: 200, y: 10, w: 280, h: 30 }),
    ]);
    const xml = exportBfoXml(state);

    expect(xml).toContain('<table style="width: 100%; border-collapse: collapse;"><tr>');
    expect(xml).toMatch(/<td style="width: \d+%; vertical-align: top;">/);
    // widths proportional 120:280 ≈ 30:70
    expect(xml).toContain('width: 30%');
    expect(xml).toContain('width: 70%');
  });

  it('single element → no band table wrapper (flow passthrough, output unchanged)', () => {
    const xml = exportBfoXml(createMockState([makeText({ content: 'solo' })]));
    expect(xml).not.toContain('<table style="width: 100%; border-collapse: collapse;">');
  });

  it('two vertically-separated elements → two rows, neither wrapped in a band table', () => {
    const state = createMockState([
      makeText({ content: 'top', x: 0, y: 0, w: 200, h: 30 }),
      makeText({ content: 'bottom', x: 0, y: 100, w: 200, h: 30 }),
    ]);
    const xml = exportBfoXml(state);
    expect(xml).not.toContain('<table style="width: 100%; border-collapse: collapse;">');
  });

  it('a table placed beside text (multi-column row) nests inside a <td> (BFO nested table)', () => {
    // table forced into content role so it shares a row with the text
    const tbl = makeTable({ role: 'content', x: 250, y: 10, w: 250, h: 100 });
    const state = createMockState([
      makeText({ content: 'note', x: 0, y: 10, w: 200, h: 100 }),
      tbl,
    ]);
    const xml = exportBfoXml(state);
    // outer band table wraps, inner data table (<#list>) sits inside a <td>
    expect(xml).toContain('<table style="width: 100%; border-collapse: collapse;"><tr>');
    expect(xml).toMatch(/<td[^>]*>[\s\S]*<#list \(record\.order\.lines\)/);
  });
});

// ═══════════════════════════════════════
// BAND-MODE EXPORT (#47) — renderBandsBody reads state.bands directly
// ═══════════════════════════════════════

describe('renderBandsBody (#47 band-mode export path)', () => {
  // Model B (#49): columns hold element ids; properties come from state.elements.
  const elements = [makeText({ id: 'A', content: 'A' }), makeText({ id: 'B', content: 'B' })];
  const twoColBand = (w0: number, w1: number) => ([{
    role: 'content' as const,
    rows: [{
      id: 'content-r0',
      columns: [
        { id: 'c0', widthPct: w0, elementIds: ['A'] },
        { id: 'c1', widthPct: w1, elementIds: ['B'] },
      ],
    }],
  }]);

  it('emits <td width%> straight from the band column widths', () => {
    const html = renderBandsBody(twoColBand(30, 70), elements);
    expect(html).toContain('width: 30%');
    expect(html).toContain('width: 70%');
  });

  it('a widthPct edit changes the BFO output (edit reaches print via band path)', () => {
    const before = renderBandsBody(twoColBand(30, 70), elements);
    const after = renderBandsBody(twoColBand(55, 45), elements);
    expect(before).toContain('width: 30%');
    expect(after).toContain('width: 55%');
    expect(after).not.toContain('width: 30%');
  });

  it('resolves ids from state.elements — a property edit reaches print', () => {
    const edited = [makeText({ id: 'A', content: 'EDITED-CONTENT' }), elements[1]];
    const html = renderBandsBody(twoColBand(50, 50), edited);
    expect(html).toContain('EDITED-CONTENT');
  });

  it('skips a stale id without crashing', () => {
    const html = renderBandsBody(twoColBand(50, 50), [elements[1]]); // 'A' missing
    expect(html).toContain('width: 50%'); // structure still renders
    expect(html).not.toContain('>A<');
  });
});

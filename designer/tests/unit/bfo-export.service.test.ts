/**
 * Tests: bfo-export.service.ts
 * Verifies XML output, sanitization, and element rendering.
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { exportBfoXml, type BfoExportOptions } from '../../src/services/bfo-export.service';
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

  it('custom recordType in options', () => {
    const state = createMockState([makeText({ binding: 'custbody_field' })]);
    const xml = exportBfoXml(state, { recordType: 'invoice' });

    expect(xml).toContain('invoice.custbody_field');
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

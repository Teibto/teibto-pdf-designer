/**
 * Tests: section subtotal rows (#106)
 * FreeMarker-side accumulate per section (columnSpanField delimited), emitted
 * before the next section header and after the last data row. Values are
 * comma-stripped + regex-gated before ?number (JSON data source = strings,
 * curated data pre-formatted "1,234.50") — never #attempt (value leak, #77).
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { exportBfoXml } from '../../src/services/bfo-export.service';
import type { AppState } from '../../src/state/app-state';
import { createDefaultPage } from '../../src/models/page';
import { createDefaultPagination } from '../../src/models/template';
import type { TableElement, TableColumn } from '../../src/models/element';
import type { PaginationConfig as TplPaginationConfig } from '../../src/models/template';

function mockState(elements: TableElement[], pagination: Partial<TplPaginationConfig> = {}): AppState {
  return {
    elements,
    bands: [],
    selectedId: null,
    multiSelect: [],
    zoom: 100,
    clipboard: [],
    page: createDefaultPage(),
    jsonData: null,
    jsonKeys: [],
    pagination: { ...createDefaultPagination(), ...pagination },
    currentPage: 1,
    totalPages: 1,
    template: { id: null, name: 'Test', isDirty: false },
    view: 'design' as const,
    dragType: null,
    isExporting: false,
    grid: { enabled: true, size: 10, snapToGrid: false, showRulers: true, showGuides: true },
    contextMenu: { show: false, x: 0, y: 0, elementId: null },
  } as AppState;
}

function col(key: string, overrides: Partial<TableColumn> = {}): TableColumn {
  return {
    key, label: key.toUpperCase(), width: 100, align: 'left', format: 'text',
    overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false,
    ...overrides,
  };
}

function makeTable(columns: TableColumn[]): TableElement {
  return {
    id: 'tbl-1', type: 'table', name: 'Items', role: 'table',
    x: 10, y: 100, w: 500, h: 200, zIndex: 1, locked: false, visible: true,
    columns,
    headerBgColor: '#e8eaf0', headerTextColor: '#333333', borderColor: '#d0d2da', alternateRowColor: '#f9fafb',
    binding: 'record.item',
  };
}

const SUBTOTAL_PAGINATION: Partial<TplPaginationConfig> = {
  columnSpanField: 'section',
  sectionSubtotal: true,
};

const COLS = () => [
  col('item'),
  col('qty', { format: 'number' as const, subtotal: true }),
  col('amount', { format: 'currency' as const, subtotal: true }),
];

describe('section subtotal (#106)', () => {
  it('initializes an accumulator per flagged column + a section row counter', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], SUBTOTAL_PAGINATION));
    expect(xml).toContain('<#assign _sec = 0>');
    expect(xml).toContain('<#assign _st_qty = 0>');
    expect(xml).toContain('<#assign _st_amount = 0>');
  });

  it('accumulates with comma-strip + regex gate before ?number — no #attempt', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], SUBTOTAL_PAGINATION));
    expect(xml).toContain(`?trim?replace(',','')?matches(`);
    expect(xml).toContain(`_st_amount = _st_amount + _sv?trim?replace(',','')?number`);
    // number fast path for real numeric models (addRecord)
    expect(xml).toContain('<#if _sv?is_number><#assign _st_amount = _st_amount + _sv>');
    expect(xml).not.toContain('<#attempt>');
  });

  it('emits the subtotal row guarded by _sec != 0, formatted #,##0.00, with default label', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], SUBTOTAL_PAGINATION));
    expect(xml).toContain('<#if _sec != 0>');
    expect(xml).toContain('${_st_qty?string("#,##0.00")}');
    expect(xml).toContain('${_st_amount?string("#,##0.00")}');
    expect(xml).toContain('รวม');
  });

  it('resets accumulators after each subtotal row', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], SUBTOTAL_PAGINATION));
    // reset appears after the formatted output (before-next-header + final emit)
    const firstOut = xml.indexOf('${_st_qty?string');
    const resetAfter = xml.indexOf('<#assign _st_qty = 0>', firstOut);
    expect(firstOut).toBeGreaterThan(-1);
    expect(resetAfter).toBeGreaterThan(firstOut);
  });

  it('emits a final subtotal after </#list> to close the last section', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], SUBTOTAL_PAGINATION));
    const listEnd = xml.indexOf('</#list>');
    const finalEmit = xml.indexOf('<#if _sec != 0>', listEnd);
    expect(finalEmit).toBeGreaterThan(listEnd);
  });

  it('uses a custom label when sectionSubtotalLabel is set (XML-escaped)', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], {
      ...SUBTOTAL_PAGINATION,
      sectionSubtotalLabel: 'Total <Q1 & Q2>',
    }));
    expect(xml).toContain('Total &lt;Q1 &amp; Q2&gt;');
  });

  it('counts subtotal rows into the fill total when fillLastPage is on (#84)', () => {
    const xml = exportBfoXml(mockState([makeTable(COLS())], {
      ...SUBTOTAL_PAGINATION,
      fillLastPage: true,
      rowsPerPage: 10,
    }));
    // one _rc bump per rendered subtotal row (2 emit sites) + one per list item
    const bumps = (xml.match(/<#assign _rc = _rc \+ 1>/g) || []).length;
    expect(bumps).toBe(3);
  });

  it('no subtotal markup when the toggle is off, no columns are flagged, or span field unset', () => {
    const offToggle = exportBfoXml(mockState([makeTable(COLS())], { columnSpanField: 'section' }));
    expect(offToggle).not.toContain('_st_');

    const noCols = exportBfoXml(mockState([makeTable([col('item'), col('qty', { format: 'number' })])], SUBTOTAL_PAGINATION));
    expect(noCols).not.toContain('_st_');

    const noSpan = exportBfoXml(mockState([makeTable(COLS())], { sectionSubtotal: true }));
    expect(noSpan).not.toContain('_st_');
  });

  it('index columns are never summed even when flagged', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('no', { isIndex: true, subtotal: true }),
      col('amount', { format: 'currency' as const, subtotal: true }),
      col('section'),
    ])], SUBTOTAL_PAGINATION));
    expect(xml).not.toContain('_st_no');
    expect(xml).toContain('_st_amount');
  });

  it('sanitizes accumulator names for keys with non-identifier characters', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('item'),
      col('custcol_pld-amt.thb', { format: 'currency' as const, subtotal: true }),
    ])], SUBTOTAL_PAGINATION));
    expect(xml).toContain('_st_custcol_pld_amt_thb');
  });
});

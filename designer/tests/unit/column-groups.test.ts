/**
 * Tests: column groups — two-level table header (#104)
 * Adjacent columns sharing a non-empty group merge into one colspan cell in a
 * leading thead row; ungrouped columns get an empty cell there (no rowspan —
 * unverified on BFO).
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { exportBfoXml } from '../../src/services/bfo-export.service';
import type { AppState } from '../../src/state/app-state';
import { createDefaultPage } from '../../src/models/page';
import { createDefaultPagination } from '../../src/models/template';
import type { TableElement, TableColumn } from '../../src/models/element';

function mockState(elements: TableElement[]): AppState {
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
    pagination: createDefaultPagination(),
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
    binding: 'order.lines',
  };
}

/** thead ... /thead slice of the export */
function theadOf(xml: string): string {
  const m = xml.match(/<thead>[\s\S]*?<\/thead>/);
  return m ? m[0] : '';
}

describe('column groups (#104)', () => {
  it('no groups → single header row, no colspan (unchanged output)', () => {
    const xml = exportBfoXml(mockState([makeTable([col('item'), col('qty')])]));
    const thead = theadOf(xml);
    expect((thead.match(/<tr>/g) || []).length).toBe(1);
    expect(thead).not.toContain('colspan');
  });

  it('adjacent columns sharing a group merge into one colspan cell', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('item'),
      col('rate', { group: 'จำนวนเงิน' }),
      col('amount', { group: 'จำนวนเงิน' }),
    ])]));
    const thead = theadOf(xml);
    expect((thead.match(/<tr>/g) || []).length).toBe(2);
    expect(thead).toContain('colspan="2"');
    expect(thead).toContain('จำนวนเงิน');
    // ungrouped column gets an empty placeholder cell in the group row
    expect(thead).toContain('&#160;');
    // column labels still present in the second row
    expect(thead).toContain('RATE');
    expect(thead).toContain('AMOUNT');
  });

  it('non-adjacent same group stays as separate cells (adjacency rule)', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('a', { group: 'G' }),
      col('b'),
      col('c', { group: 'G' }),
    ])]));
    const thead = theadOf(xml);
    expect(thead).not.toContain('colspan="2"');
    // group label appears once per run
    expect((thead.match(/>G</g) || []).length).toBe(2);
  });

  it('hidden columns are excluded from the span count', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('rate', { group: 'จำนวนเงิน' }),
      col('tax', { group: 'จำนวนเงิน', hidden: true }),
      col('amount', { group: 'จำนวนเงิน' }),
    ])]));
    expect(theadOf(xml)).toContain('colspan="2"');
    expect(theadOf(xml)).not.toContain('colspan="3"');
  });

  it('escapes XML-special characters in group labels', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('a', { group: 'Q1 & Q2' }),
      col('b', { group: 'Q1 & Q2' }),
    ])]));
    expect(theadOf(xml)).toContain('Q1 &amp; Q2');
    expect(theadOf(xml)).not.toContain('Q1 & Q2</');
  });

  it('whitespace-only group counts as ungrouped', () => {
    const xml = exportBfoXml(mockState([makeTable([
      col('a', { group: '  ' }),
      col('b'),
    ])]));
    const thead = theadOf(xml);
    expect((thead.match(/<tr>/g) || []).length).toBe(1);
  });
});

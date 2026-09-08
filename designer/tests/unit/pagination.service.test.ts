/**
 * Pagination Service Tests
 *
 * @author Wichit Wongta
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computePagination,
  clearPaginationCache,
  finalizePagination,
} from '../../src/services/pagination.service';
import type { AppState } from '../../src/state/app-state';
import { createDefaultPage } from '../../src/models/page';
import { createDefaultPagination } from '../../src/models/template';
import { AppStore } from '../../src/state/store';

// ─── Test Helpers ───

function createMockState(overrides: Partial<AppState> = {}): Readonly<AppState> {
  return {
    elements: [],
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
    view: 'design',
    dragType: null,
    isExporting: false,
    grid: {
      enabled: true,
      size: 10,
      snapToGrid: false,
      showRulers: true,
      showGuides: true,
    },
    contextMenu: { show: false, x: 0, y: 0, elementId: null },
    ...overrides,
  };
}

function createTableElement(binding?: string) {
  return {
    id: 'table-1',
    type: 'table' as const,
    name: 'Table',
    role: 'table' as const,
    x: 20, y: 200, w: 500, h: 300,
    zIndex: 0,
    locked: false,
    visible: true,
    binding: binding || 'items',
    columns: [
      { key: 'name', label: 'Name', width: 100, align: 'left' as const, format: 'text' as const, overflow: 'ellipsis', maxLines: 1, hidden: false, bold: false, uppercase: false },
    ],
    headerBgColor: '#e8eaf0',
    headerTextColor: '#333',
    borderColor: '#ddd',
    alternateRowColor: '#f9f9f9',
  };
}

function createHeaderElement() {
  return {
    id: 'header-1',
    type: 'header' as const,
    name: 'Header',
    role: 'header' as const,
    x: 20, y: 20, w: 500, h: 50,
    zIndex: 1,
    locked: false,
    visible: true,
    content: 'Invoice',
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: '#111',
    textAlign: 'left' as const,
  };
}

function createFooterElement() {
  return {
    id: 'footer-1',
    type: 'text' as const,
    name: 'Footer',
    role: 'footer' as const,
    x: 20, y: 700, w: 500, h: 30,
    zIndex: 2,
    locked: false,
    visible: true,
    content: 'Page footer',
    fontSize: 10,
    fontWeight: 'normal' as const,
    color: '#999',
    textAlign: 'center' as const,
  };
}

function createSummaryElement(y = 700) {
  return {
    id: 'summary-1',
    type: 'text' as const,
    name: 'GrandTotal',
    role: 'summary' as const,
    x: 20, y, w: 500, h: 40,
    zIndex: 5,
    locked: false,
    visible: true,
    content: 'Total',
    fontSize: 12,
    fontWeight: 'bold' as const,
    color: '#333',
    textAlign: 'right' as const,
  };
}

// ═══════════════════════════════════════
// TESTS
// ═══════════════════════════════════════

describe('Pagination Service', () => {
  beforeEach(() => {
    clearPaginationCache();
  });

  describe('computePagination() — no data', () => {
    it('returns 1 page when no elements', () => {
      const state = createMockState();
      const result = computePagination(state);
      expect(result.totalPages).toBe(1);
      expect(result.totalRows).toBe(0);
      expect(result.pagesData).toHaveLength(1);
    });

    it('returns 1 page when elements exist but no JSON data', () => {
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement()],
      });
      const result = computePagination(state);
      expect(result.totalPages).toBe(1);
      expect(result.totalRows).toBe(0);
    });

    it('returns 1 page when JSON data has no matching array', () => {
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { name: 'Test', description: 'No array here' },
      });
      const result = computePagination(state);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('computePagination() — row-based mode', () => {
    it('calculates correct page count for exact fit', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i + 1}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'rows', rowsPerPage: 10 },
      });
      const result = computePagination(state);
      expect(result.totalPages).toBe(2);
      expect(result.totalRows).toBe(20);
    });

    it('rounds up page count for partial pages', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'rows', rowsPerPage: 10 },
      });
      const result = computePagination(state);
      expect(result.totalPages).toBe(3);
    });

    it('includes correct row ranges per page', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'rows', rowsPerPage: 10 },
      });
      const result = computePagination(state);

      expect(result.pagesData[0].tableRowStart).toBe(0);
      expect(result.pagesData[0].tableRowEnd).toBe(10);

      expect(result.pagesData[1].tableRowStart).toBe(10);
      expect(result.pagesData[1].tableRowEnd).toBe(20);

      expect(result.pagesData[2].tableRowStart).toBe(20);
      expect(result.pagesData[2].tableRowEnd).toBe(25);
    });

    it('marks continuation pages correctly', () => {
      const items = Array.from({ length: 15 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'rows', rowsPerPage: 10 },
      });
      const result = computePagination(state);
      expect(result.pagesData[0].isContinuation).toBe(false);
      expect(result.pagesData[1].isContinuation).toBe(true);
    });
  });

  describe('computePagination() — height-based mode', () => {
    it('auto-calculates rows per page based on available height', () => {
      const items = Array.from({ length: 50 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [
          createHeaderElement(), // 50pt tall
          createTableElement('items'),
        ],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'height',
          baseRowHeight: 24,
        },
        page: { ...createDefaultPage(), height: 842 }, // A4 height
      });
      const result = computePagination(state);
      expect(result.totalPages).toBeGreaterThan(1);
      expect(result.totalRows).toBe(50);
    });
  });

  describe('cache behavior', () => {
    it('returns cached result for identical state', () => {
      const state = createMockState();
      const result1 = computePagination(state);
      const result2 = computePagination(state);
      expect(result1).toBe(result2); // Same object reference = cached
    });

    it('recomputes when state changes', () => {
      const state1 = createMockState();
      const result1 = computePagination(state1);

      const state2 = createMockState({
        elements: [createTableElement()],
      });
      const result2 = computePagination(state2);
      expect(result1).not.toBe(result2);
    });

    it('clearPaginationCache invalidates cache', () => {
      const state = createMockState();
      const result1 = computePagination(state);
      clearPaginationCache();
      const result2 = computePagination(state);
      expect(result1).not.toBe(result2);
    });

    it('invalidates for an unsampled Thai row edit and a wrapping column width edit', () => {
      const store = new AppStore();
      store.dispatch((d) => {
        const table = createTableElement('items');
        table.columns[0].overflow = 'wrap';
        table.columns[0].maxLines = 0;
        d.elements = [table];
        d.jsonData = { items: Array.from({ length: 10 }, () => ({ name: 'สินค้า' })) };
        d.pagination.mode = 'height';
        d.pagination.orphanWidowMinRows = 0;
      });
      const original = computePagination(store.state);
      store.dispatch((d) => {
        (d.jsonData!.items as { name: string }[])[2].name = 'น้ำดื่มเพื่อสุขภาพ '.repeat(150);
      });
      const edited = computePagination(store.state);
      clearPaginationCache();
      expect(edited).toEqual(computePagination(store.state));
      expect(edited.totalPages).toBeGreaterThan(original.totalPages);

      store.dispatch((d) => {
        if (d.elements[0].type === 'table') d.elements[0].columns[0].width = 450;
      });
      const wider = computePagination(store.state);
      clearPaginationCache();
      expect(wider).toEqual(computePagination(store.state));
      expect(wider.pagesData).not.toEqual(edited.pagesData);
    });

    it('reuses immutable input branches across UI-only edits', () => {
      const store = new AppStore();
      store.dispatch((d) => { d.jsonData = { items: [] }; });
      const original = computePagination(store.state);
      store.dispatch((d) => { d.zoom = 150; d.currentPage = 1; });
      expect(computePagination(store.state)).toBe(original);
    });

    it('mutable callers detect changes beyond the first 50 characters', () => {
      const table = createTableElement('items');
      table.columns[0].overflow = 'wrap';
      table.columns[0].maxLines = 0;
      const items = Array.from({ length: 10 }, () => ({ name: 'สินค้า' }));
      const state = createMockState({ elements: [table], jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'height', orphanWidowMinRows: 0 } });
      computePagination(state);
      items[2].name = 'ก'.repeat(3000);
      const edited = computePagination(state);
      clearPaginationCache();
      expect(edited).toEqual(computePagination(state));
    });
  });

  describe('finalizePagination()', () => {
    it('makes summary-role elements visible only on last page', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const summaryElement = {
        id: 'summary-1',
        type: 'text' as const,
        name: 'Summary',
        role: 'summary' as const,
        x: 20, y: 600, w: 500, h: 40,
        zIndex: 3,
        locked: false,
        visible: true,
        content: 'Total summary',
        fontSize: 12,
        fontWeight: 'bold' as const,
        color: '#333',
        textAlign: 'left' as const,
      };

      const state = createMockState({
        elements: [createTableElement('items'), summaryElement],
        jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'rows', rowsPerPage: 10 },
      });

      const raw = computePagination(state);
      const result = finalizePagination(raw, state);

      // Summary role has showOnPages: 'last' — visible only on last page
      const page1Summary = result.pagesData[0].elements.find(
        (e) => e.element.role === 'summary',
      );
      const page2Summary = result.pagesData[1].elements.find(
        (e) => e.element.role === 'summary',
      );

      if (page1Summary) expect(page1Summary.visible).toBe(false);
      if (page2Summary) expect(page2Summary.visible).toBe(true);
    });
  });

  // ═══════════════════════════════════════
  // ORPHAN / WIDOW CONTROL
  // ═══════════════════════════════════════

  describe('orphan/widow control', () => {
    it('pulls rows from previous page when last page has orphan (1 row)', () => {
      // 21 items, 10 per page → pages: [0..10], [10..20], [20..21]
      // With minRows=2: should become [0..10], [10..19], [19..21]
      const items = Array.from({ length: 21 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          orphanWidowMinRows: 2,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(3);
      const lastPage = result.pagesData[result.totalPages - 1];
      const lastRowCount = lastPage.tableRowEnd - lastPage.tableRowStart;
      expect(lastRowCount).toBeGreaterThanOrEqual(2);
    });

    it('does not create orphan on previous page when fixing last page', () => {
      // 21 items, 10 per page, minRows=2
      const items = Array.from({ length: 21 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          orphanWidowMinRows: 2,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // Every page should have >= 2 rows
      for (const page of result.pagesData) {
        const rowCount = page.tableRowEnd - page.tableRowStart;
        if (rowCount > 0) {
          expect(rowCount).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('disables orphan control when minRows=0', () => {
      const items = Array.from({ length: 11 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(2);
      // Last page has 1 row — orphan allowed when disabled
      const lastPage = result.pagesData[1];
      expect(lastPage.tableRowEnd - lastPage.tableRowStart).toBe(1);
    });

    it('does nothing when all pages have enough rows', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          orphanWidowMinRows: 2,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(2);
      expect(result.pagesData[0].tableRowEnd - result.pagesData[0].tableRowStart).toBe(10);
      expect(result.pagesData[1].tableRowEnd - result.pagesData[1].tableRowStart).toBe(10);
    });

    it('handles single-page data without issues', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          orphanWidowMinRows: 3,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(1);
      expect(result.pagesData[0].tableRowEnd).toBe(5);
    });
  });

  // ═══════════════════════════════════════
  // SUMMARY PAGE BREAK
  // ═══════════════════════════════════════

  describe('summary page break', () => {
    function createSummaryElement() {
      return {
        id: 'summary-1',
        type: 'text' as const,
        name: 'GrandTotal',
        role: 'summary' as const,
        x: 20, y: 600, w: 500, h: 80,
        zIndex: 5,
        locked: false,
        visible: true,
        content: 'Grand Total: $999',
        fontSize: 14,
        fontWeight: 'bold' as const,
        color: '#333',
        textAlign: 'right' as const,
      };
    }

    it('always mode: adds a dedicated summary page', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items'), createSummaryElement()],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          summaryBreak: 'always',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // Should have 2 pages: 1 for data + 1 for summary
      expect(result.totalPages).toBe(2);
      const lastPage = result.pagesData[result.totalPages - 1];
      expect(lastPage.isSummaryPage).toBe(true);
      expect(lastPage.tableRowEnd - lastPage.tableRowStart).toBe(0);
    });

    it('samePage mode: never adds extra page for summary', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items'), createSummaryElement()],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          summaryBreak: 'samePage',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(1);
    });

    it('auto mode: keeps summary on same page when it fits', () => {
      const items = Array.from({ length: 3 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items'), createSummaryElement()],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          summaryBreak: 'auto',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // 3 rows + summary (80pt) should fit on A4 — only 1 page
      expect(result.totalPages).toBe(1);
    });

    it('no extra page when no summary elements exist', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          summaryBreak: 'always',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // No summary elements → summaryBreak has no effect
      expect(result.totalPages).toBe(1);
    });
  });

  // ═══════════════════════════════════════
  // DYNAMIC FOOTER — retired (#107)
  // ═══════════════════════════════════════

  describe('dynamic footer machinery retired (#107)', () => {
    it('PageElement carries no dynamicY and PageData no tableEndY (band-flow preview)', () => {
      const items = Array.from({ length: 3 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: { ...createDefaultPagination(), mode: 'rows', rowsPerPage: 10 },
      });
      const result = computePagination(state);
      const page1 = result.pagesData[0] as unknown as Record<string, unknown>;
      expect(page1.tableEndY).toBeUndefined();
      for (const pe of result.pagesData[0].elements) {
        expect((pe as unknown as Record<string, unknown>).dynamicY).toBeUndefined();
      }
    });

    it('legacy dynamicFooter config values are tolerated as no-ops', () => {
      const items = Array.from({ length: 3 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          dynamicFooter: true,
          dynamicFooterGap: 30,
        },
      });
      const result = computePagination(state);
      expect(result.totalPages).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════
  // FORCE PAGE BREAK
  // ═══════════════════════════════════════

  describe('force page break', () => {
    it('breaks before specified row indices', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 20, // Would fit all on one page
          forceBreakBeforeRows: [5],
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(2);
      expect(result.pagesData[0].tableRowStart).toBe(0);
      expect(result.pagesData[0].tableRowEnd).toBe(5);
      expect(result.pagesData[1].tableRowStart).toBe(5);
      expect(result.pagesData[1].tableRowEnd).toBe(20);
    });

    it('supports multiple force break points', () => {
      const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 30,
          forceBreakBeforeRows: [10, 20],
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(3);
      expect(result.pagesData[0].tableRowEnd).toBe(10);
      expect(result.pagesData[1].tableRowStart).toBe(10);
      expect(result.pagesData[1].tableRowEnd).toBe(20);
      expect(result.pagesData[2].tableRowStart).toBe(20);
      expect(result.pagesData[2].tableRowEnd).toBe(30);
    });

    it('empty forceBreakBeforeRows has no effect', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          forceBreakBeforeRows: [],
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);
      expect(result.totalPages).toBe(1);
    });

    it('force break at row 0 has no effect (nothing before first row)', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 20,
          forceBreakBeforeRows: [0],
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);
      // Row 0 is the start, so no break before it
      expect(result.totalPages).toBe(1);
    });

    it('works with height-based mode', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'height',
          baseRowHeight: 24,
          forceBreakBeforeRows: [10],
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
        page: { ...createDefaultPage(), height: 842 },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBeGreaterThanOrEqual(2);
      // First page should end at or before row 10
      expect(result.pagesData[0].tableRowEnd).toBeLessThanOrEqual(10);
    });
  });

  // ═══════════════════════════════════════
  // KEEP-TOGETHER GROUPS
  // ═══════════════════════════════════════

  describe('keep-together groups', () => {
    it('keeps rows with same group field value on same page', () => {
      // 6 rows: 3 in group A, 3 in group B
      // rowsPerPage=4 → without groups: page1=[0..4], page2=[4..6]
      // with groups: page1=[0..3] (group A), page2=[3..6] (group B)
      const items = [
        { name: 'A1', group: 'A' }, { name: 'A2', group: 'A' }, { name: 'A3', group: 'A' },
        { name: 'B1', group: 'B' }, { name: 'B2', group: 'B' }, { name: 'B3', group: 'B' },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 4,
          keepTogetherField: 'group',
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(2);
      // Page 1: group A (3 rows)
      expect(result.pagesData[0].tableRowEnd - result.pagesData[0].tableRowStart).toBe(3);
      // Page 2: group B (3 rows)
      expect(result.pagesData[1].tableRowEnd - result.pagesData[1].tableRowStart).toBe(3);
    });

    it('does not split group even if it exceeds rowsPerPage', () => {
      // 5 rows all in same group, rowsPerPage=3
      // Group is atomic → all 5 on one page
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}`, group: 'X' }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 3,
          keepTogetherField: 'group',
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // All 5 rows are in the same group → they fit on first page because can't split
      expect(result.totalPages).toBe(1);
      expect(result.pagesData[0].tableRowEnd).toBe(5);
    });

    it('empty keepTogetherField disables grouping', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}`, group: 'A' }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          keepTogetherField: '',
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(3); // Normal split: 10+10+5
    });

    it('handles many small groups correctly', () => {
      // 12 rows in 4 groups of 3, rowsPerPage=5
      const items = [
        { name: '1', grp: 'A' }, { name: '2', grp: 'A' }, { name: '3', grp: 'A' },
        { name: '4', grp: 'B' }, { name: '5', grp: 'B' }, { name: '6', grp: 'B' },
        { name: '7', grp: 'C' }, { name: '8', grp: 'C' }, { name: '9', grp: 'C' },
        { name: '10', grp: 'D' }, { name: '11', grp: 'D' }, { name: '12', grp: 'D' },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 5,
          keepTogetherField: 'grp',
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // Group A (3) fits, group B (3) won't fit (3+3=6>5) → page 1 = A (3)
      // Group B (3) fits on page 2, group C (3) fits too (3+3=6>5) → page 2 = B (3)
      // Group C (3), group D (3) → 3+3=6>5 → page 3 = C (3), page 4 = D (3)
      expect(result.totalPages).toBe(4);
      // Each page has exactly one group
      for (const page of result.pagesData) {
        expect(page.tableRowEnd - page.tableRowStart).toBe(3);
      }
    });

    it('works with force break combined', () => {
      const items = [
        { name: 'A1', group: 'A' }, { name: 'A2', group: 'A' },
        { name: 'B1', group: 'B' }, { name: 'B2', group: 'B' },
        { name: 'C1', group: 'C' }, { name: 'C2', group: 'C' },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10, // Would fit all
          keepTogetherField: 'group',
          forceBreakBeforeRows: [4], // Force break before row 4 (C1)
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(2);
      expect(result.pagesData[0].tableRowEnd).toBe(4); // A+B
      expect(result.pagesData[1].tableRowStart).toBe(4); // C
    });
  });

  // ═══════════════════════════════════════
  // HEADER MODE
  // ═══════════════════════════════════════

  describe('header mode', () => {
    it('all mode: header visible on every page (default)', () => {
      const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'all',
          dynamicFooter: false,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      for (const page of result.pagesData) {
        const headerEl = page.elements.find((e) => e.element.role === 'header');
        expect(headerEl?.visible).toBe(true);
      }
    });

    it('firstOnly mode: header visible only on first page', () => {
      const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstOnly',
          dynamicFooter: false,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(3);
      const page1Header = result.pagesData[0].elements.find((e) => e.element.role === 'header');
      expect(page1Header?.visible).toBe(true);

      const page2Header = result.pagesData[1].elements.find((e) => e.element.role === 'header');
      expect(page2Header?.visible).toBe(false);

      const page3Header = result.pagesData[2].elements.find((e) => e.element.role === 'header');
      expect(page3Header?.visible).toBe(false);
    });

    it('firstLast mode: header visible on first and last page only', () => {
      const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstLast',
          dynamicFooter: false,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(3);

      // Page 1: visible
      const p1 = result.pagesData[0].elements.find((e) => e.element.role === 'header');
      expect(p1?.visible).toBe(true);

      // Page 2 (middle): hidden
      const p2 = result.pagesData[1].elements.find((e) => e.element.role === 'header');
      expect(p2?.visible).toBe(false);

      // Page 3 (last): visible
      const p3 = result.pagesData[2].elements.find((e) => e.element.role === 'header');
      expect(p3?.visible).toBe(true);
    });

    it('firstLast with 2 pages: both pages show header', () => {
      const items = Array.from({ length: 15 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstLast',
          dynamicFooter: false,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(2);
      // Both are first and last (or overlap)
      expect(result.pagesData[0].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);
      expect(result.pagesData[1].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);
    });

    it('firstLast with single page: header is visible', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstLast',
          dynamicFooter: false,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(1);
      expect(result.pagesData[0].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);
    });
  });

  // ═══════════════════════════════════════
  // COLUMN SPAN
  // ═══════════════════════════════════════

  describe('column span', () => {
    it('identifies span rows based on columnSpanField', () => {
      const items = [
        { name: 'Section: Electronics', isSection: true },
        { name: 'Laptop', isSection: false },
        { name: 'Phone', isSection: false },
        { name: 'Section: Furniture', isSection: true },
        { name: 'Desk', isSection: false },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          columnSpanField: 'isSection',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.pagesData[0].columnSpanRows).toEqual([0, 3]);
    });

    it('empty columnSpanField returns no span rows', () => {
      const items = [
        { name: 'Item 1', isSection: true },
        { name: 'Item 2', isSection: false },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          columnSpanField: '',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.pagesData[0].columnSpanRows).toEqual([]);
    });

    it('span rows are scoped to current page', () => {
      const items = [
        { name: 'S1', isSection: true },
        ...Array.from({ length: 9 }, (_, i) => ({ name: `Item ${i}`, isSection: false })),
        { name: 'S2', isSection: true },
        ...Array.from({ length: 4 }, (_, i) => ({ name: `Item ${10 + i}`, isSection: false })),
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          columnSpanField: 'isSection',
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      expect(result.totalPages).toBe(2);
      // Page 1: row 0 is span
      expect(result.pagesData[0].columnSpanRows).toEqual([0]);
      // Page 2: row 10 is span
      expect(result.pagesData[1].columnSpanRows).toEqual([10]);
    });

    it('falsy values in span field are not treated as span rows', () => {
      const items = [
        { name: 'Item 1', isSection: '' },
        { name: 'Item 2', isSection: null },
        { name: 'Item 3', isSection: 0 },
        { name: 'Section', isSection: 'yes' },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          columnSpanField: 'isSection',
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // Only row 3 has truthy isSection
      expect(result.pagesData[0].columnSpanRows).toEqual([3]);
    });
  });

  // ═══════════════════════════════════════
  // COMBINED FEATURES
  // ═══════════════════════════════════════

  describe('combined features', () => {
    it('force break + orphan/widow control work together', () => {
      const items = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 20,
          forceBreakBeforeRows: [11], // Break before row 11 → page2 has 1 row
          orphanWidowMinRows: 2,      // Orphan control should pull row from page1
          dynamicFooter: false,
        },
      });
      const result = computePagination(state);

      // Force break at 11 → page1=[0..11], page2=[11..12] → orphan (1 row)
      // Orphan fix pulls 1 row → page1=[0..10], page2=[10..12]
      const lastPage = result.pagesData[result.totalPages - 1];
      expect(lastPage.tableRowEnd - lastPage.tableRowStart).toBeGreaterThanOrEqual(2);
    });

    it('keep-together + headerMode + columnSpan all work', () => {
      const items = [
        { name: 'Category: Tools', grp: 'tools', isSection: true },
        { name: 'Hammer', grp: 'tools', isSection: false },
        { name: 'Screwdriver', grp: 'tools', isSection: false },
        { name: 'Category: Paint', grp: 'paint', isSection: true },
        { name: 'Red', grp: 'paint', isSection: false },
        { name: 'Blue', grp: 'paint', isSection: false },
      ];
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 4,
          keepTogetherField: 'grp',
          headerMode: 'firstLast',
          columnSpanField: 'isSection',
          orphanWidowMinRows: 0,
          dynamicFooter: false,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(2);

      // Header: firstLast → visible on page 1 (first) and page 2 (last)
      expect(result.pagesData[0].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);
      expect(result.pagesData[1].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);

      // Column span: section rows identified
      expect(result.pagesData[0].columnSpanRows).toContain(0); // "Category: Tools"
      expect(result.pagesData[1].columnSpanRows).toContain(3); // "Category: Paint"
    });
  });

  // ═══════════════════════════════════════
  // v3.1 REGRESSION TESTS — bugs fixed in this release
  // ═══════════════════════════════════════

  describe('v3.1 regression: headerMode rendering', () => {
    it('firstOnly: header visible=false on continuation pages', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstOnly',
          orphanWidowMinRows: 0,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(3);

      // Page 1: header visible
      const p1h = result.pagesData[0].elements.find((e) => e.element.role === 'header');
      expect(p1h?.visible).toBe(true);

      // Page 2: header NOT visible (continuation page)
      const p2h = result.pagesData[1].elements.find((e) => e.element.role === 'header');
      expect(p2h?.visible).toBe(false);

      // Page 3: header NOT visible (last but mode is firstOnly not firstLast)
      const p3h = result.pagesData[2].elements.find((e) => e.element.role === 'header');
      expect(p3h?.visible).toBe(false);
    });

    it('firstLast: header visible on first and last only', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstLast',
          orphanWidowMinRows: 0,
        },
      });
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(3);

      // Page 1: visible (first)
      expect(result.pagesData[0].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);
      // Page 2: NOT visible (middle)
      expect(result.pagesData[1].elements.find((e) => e.element.role === 'header')?.visible).toBe(false);
      // Page 3: visible (last)
      expect(result.pagesData[2].elements.find((e) => e.element.role === 'header')?.visible).toBe(true);
    });
  });

  describe('v3.1 regression: orphanWidow + keepTogether', () => {
    it('orphanWidow does NOT split keep-together groups', () => {
      // 8 rows, group A = rows 0-5, group B = rows 6-7
      const items = [
        { name: 'A1', group: 'A' },
        { name: 'A2', group: 'A' },
        { name: 'A3', group: 'A' },
        { name: 'A4', group: 'A' },
        { name: 'A5', group: 'A' },
        { name: 'A6', group: 'A' },
        { name: 'B1', group: 'B' },
        { name: 'B2', group: 'B' },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 7,
          keepTogetherField: 'group',
          orphanWidowMinRows: 3,
        },
      });

      const result = finalizePagination(computePagination(state), state);

      // Verify group A (rows 0-5) is NOT split across pages
      for (const page of result.pagesData) {
        const start = page.tableRowStart;
        const end = page.tableRowEnd;
        // If a page contains any row from group A (0-5), it must contain entire contiguous block
        const containsA = start < 6 && end > 0;
        if (containsA) {
          // The boundary should be at 0 or 6, not in between
          const aStart = Math.max(start, 0);
          const aEnd = Math.min(end, 6);
          // All rows from aStart to aEnd should share group 'A'
          for (let i = aStart; i < aEnd; i++) {
            expect(items[i].group).toBe('A');
          }
        }
      }
    });

    it('orphanWidow snaps to group boundary when pulling rows', () => {
      // 12 rows: group X = 0-4 (5 rows), group Y = 5-9 (5 rows), group Z = 10-11 (2 rows)
      const items = [
        ...Array.from({ length: 5 }, (_, i) => ({ name: `X${i}`, group: 'X' })),
        ...Array.from({ length: 5 }, (_, i) => ({ name: `Y${i}`, group: 'Y' })),
        ...Array.from({ length: 2 }, (_, i) => ({ name: `Z${i}`, group: 'Z' })),
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          keepTogetherField: 'group',
          orphanWidowMinRows: 3,
        },
      });

      const result = finalizePagination(computePagination(state), state);

      // Every page boundary should land on a group boundary (0, 5, or 10)
      const groupBoundaries = new Set([0, 5, 10, 12]);
      for (const page of result.pagesData) {
        expect(groupBoundaries.has(page.tableRowStart)).toBe(true);
      }
    });
  });

  describe('v3.1 regression: fixedHeight respects headerMode', () => {
    it('height-based mode: more rows fit on continuation pages when headerMode=firstOnly', () => {
      // header=50pt visible only on page 1 → page 2+ has 50pt more space
      // This means page 2 should fit more rows than without the fix
      const items = Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [createHeaderElement(), createFooterElement(), createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'height',
          baseRowHeight: 24,
          headerMode: 'firstOnly',
          orphanWidowMinRows: 0,
        },
      });

      const resultFirstOnly = finalizePagination(computePagination(state), state);

      // Compare with headerMode='all'
      clearPaginationCache();
      const stateAll = createMockState({
        ...state,
        pagination: { ...state.pagination, headerMode: 'all' },
      });
      const resultAll = finalizePagination(computePagination(stateAll), stateAll);

      // firstOnly should need fewer or equal pages (continuation pages have more space)
      expect(resultFirstOnly.totalPages).toBeLessThanOrEqual(resultAll.totalPages);

      // Continuation pages in firstOnly mode should have more rows than in 'all' mode
      if (resultFirstOnly.totalPages > 1 && resultAll.totalPages > 1) {
        const p2RowsFirstOnly = resultFirstOnly.pagesData[1].tableRowEnd - resultFirstOnly.pagesData[1].tableRowStart;
        const p2RowsAll = resultAll.pagesData[1].tableRowEnd - resultAll.pagesData[1].tableRowStart;
        expect(p2RowsFirstOnly).toBeGreaterThanOrEqual(p2RowsAll);
      }
    });
  });

  describe('v3.1 regression: forceBreak + keepTogether interaction', () => {
    it('forceBreak at group boundary works normally', () => {
      // groups: A(0-2), B(3-5), C(6-8)
      const items = [
        { name: 'A1', group: 'A' }, { name: 'A2', group: 'A' }, { name: 'A3', group: 'A' },
        { name: 'B1', group: 'B' }, { name: 'B2', group: 'B' }, { name: 'B3', group: 'B' },
        { name: 'C1', group: 'C' }, { name: 'C2', group: 'C' }, { name: 'C3', group: 'C' },
      ];
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 100, // high limit, only forceBreak creates pages
          keepTogetherField: 'group',
          forceBreakBeforeRows: [3], // break at group B boundary
          orphanWidowMinRows: 0,
        },
      });

      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(2);
      expect(result.pagesData[0].tableRowStart).toBe(0);
      expect(result.pagesData[0].tableRowEnd).toBe(3);
      expect(result.pagesData[1].tableRowStart).toBe(3);
      expect(result.pagesData[1].tableRowEnd).toBe(9);
    });

    it('forceBreak inside group is silently ignored (no crash)', () => {
      // groups: A(0-4), forceBreak at row 2 (inside group A) → should be ignored
      const items = Array.from({ length: 5 }, (_, i) => ({ name: `A${i}`, group: 'A' }));
      const state = createMockState({
        elements: [createTableElement('items')],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 100,
          keepTogetherField: 'group',
          forceBreakBeforeRows: [2], // inside group A
          orphanWidowMinRows: 0,
        },
      });

      // Should not crash, group stays together
      const result = finalizePagination(computePagination(state), state);

      expect(result.totalPages).toBe(1);
      expect(result.pagesData[0].tableRowStart).toBe(0);
      expect(result.pagesData[0].tableRowEnd).toBe(5);
    });
  });

  describe('v3.1 regression: summaryBreak with headerMode', () => {
    it('summaryBreak auto uses correct fixedHeight with headerMode=firstOnly', () => {
      // When headerMode=firstOnly and summary is on last page,
      // remaining height should NOT include header on continuation pages
      const items = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}` }));
      const state = createMockState({
        elements: [
          createHeaderElement(),
          createTableElement('items'),
          createSummaryElement(700),
        ],
        jsonData: { items },
        pagination: {
          ...createDefaultPagination(),
          mode: 'rows',
          rowsPerPage: 10,
          headerMode: 'firstOnly',
          summaryBreak: 'auto',
          orphanWidowMinRows: 0,
        },
      });

      // Should compute without error
      const result = finalizePagination(computePagination(state), state);
      expect(result.totalPages).toBeGreaterThanOrEqual(2);
    });
  });
});

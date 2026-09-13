/**
 * Invoice header/summary grids must not replace the detail pagination source.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSampleTemplates } from '../../src/constants/sample-templates';
import { AppStore } from '../../src/state/store';
import { loadJsonData } from '../../src/state/actions';
import * as textMeasure from '../../src/utils/text-measure';
import { clearPaginationCache, computePagination } from '../../src/services/pagination.service';

describe('Invoice detail row source', () => {
  for (const mode of ['rows', 'height'] as const) {
    it(`paginates items rather than the earlier header grid in ${mode} mode`, () => {
      const template = getSampleTemplates()[0];
      const store = new AppStore();
      store.dispatch(draft => {
        draft.elements = template.elements;
        draft.bands = template.bands!;
        draft.page = template.page;
        draft.pagination = { ...template.pagination, mode };
      });
      const items = Array.from({ length: 1000 }, (_, i) => ({ no: i + 1, description: 'Synthetic item' }));
      loadJsonData(store, { document: { docInfoRows: [{ label: 'Doc', value: 'QA' }] },
        totals: { summaryRows: [{ label: 'Total', value: '1000' }] }, items });
      const result = computePagination(store.state);
      expect(result.totalRows).toBe(1000);
      expect(result.totalPages).toBeGreaterThan(1);
      expect(result.pagesData.at(-1)!.tableRowEnd).toBe(1000);
      loadJsonData(store, { ...store.state.jsonData, items: [...items, { no: 1001, description: 'Extra' }] });
      expect(computePagination(store.state).totalRows).toBe(1001);
    });
  }
});


afterEach(() => { vi.restoreAllMocks(); clearPaginationCache(); });

function heightStore(count = 128) {
  clearPaginationCache();
  const template = getSampleTemplates()[0];
  const store = new AppStore();
  store.dispatch(draft => {
    draft.elements = template.elements;
    draft.bands = template.bands!;
    draft.page = template.page;
    draft.pagination = { ...template.pagination, mode: 'height' };
  });
  const seed = (template.jsonData!.items as Record<string, unknown>[])[0];
  loadJsonData(store, { ...template.jsonData, items: Array.from({ length: count }, (_, i) => ({
    ...seed, no: i + 1, description: `Synthetic Thai ทดสอบ ${i} `.repeat(i % 3 + 1),
  })) });
  return store;
}

function pageRanges(result: ReturnType<typeof computePagination>) {
  return { totalRows: result.totalRows, totalPages: result.totalPages,
    ranges: result.pagesData.map(page => [page.tableRowStart, page.tableRowEnd, page.isSummaryPage]),
    elements: result.pagesData.map(page => page.elements.map(element => ({
      id: element.element.id, visible: element.visible, rowSlice: element.rowSlice,
    }))),
  };
}

function expectUncachedParity(store: AppStore) {
  const cached = computePagination(store.state);
  // Mutable deep copy deliberately bypasses both immutable caches.
  const uncached = computePagination(structuredClone(store.state));
  expect(pageRanges(cached)).toEqual(pageRanges(uncached));
}

describe('immutable Invoice row-height reuse', () => {
  it('measures only the changed row and preserves exact cold/warm/edit page ranges', () => {
    const store = heightStore(1000);
    const measure = vi.spyOn(textMeasure, 'calculateRowHeight');
    const cold = computePagination(store.state);
    expect(measure).toHaveBeenCalledTimes(1000);
    expect(computePagination(store.state)).toBe(cold);
    expect(measure).toHaveBeenCalledTimes(1000);
    const items = store.state.jsonData!.items as Record<string, unknown>[];
    loadJsonData(store, { ...store.state.jsonData, items: items.map((row, i) =>
      i === 12 ? { ...row, description: 'Long edited description '.repeat(30) } : row) });
    measure.mockClear();
    computePagination(store.state);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure.mock.calls[0][2]).toBe(8); // Existing pagination font size.
    expectUncachedParity(store);
    clearPaginationCache();
    measure.mockClear();
    computePagination(store.state);
    expect(measure).toHaveBeenCalledTimes(1000);
  });

  for (const mutation of ['width', 'overflow', 'maxLines', 'hidden', 'baseRowHeight', 'lineHeightPx'] as const) {
    it(`invalidates measurements for ${mutation} and matches uncached ranges`, () => {
      const store = heightStore();
      computePagination(store.state);
      const measure = vi.spyOn(textMeasure, 'calculateRowHeight');
      store.dispatch(draft => {
        if (mutation === 'baseRowHeight') draft.pagination.baseRowHeight += 4;
        else if (mutation === 'lineHeightPx') draft.pagination.lineHeightPx += 3;
        else {
          const table = draft.elements.find(element => element.type === 'table' && element.role === 'table');
          if (!table || table.type !== 'table') throw new Error('Missing item table');
          const column = table.columns.find(col => col.key === 'description')!;
          if (mutation === 'width') column.width = 80;
          if (mutation === 'overflow') column.overflow = 'clip';
          if (mutation === 'maxLines') column.maxLines = 1;
          if (mutation === 'hidden') column.hidden = true;
        }
      });
      computePagination(store.state);
      expect(measure).toHaveBeenCalledTimes(128);
      expectUncachedParity(store);
    });
  }

  it('bypasses mutable callers and sees in-place row and column edits', () => {
    const mutable = structuredClone(heightStore().state);
    const measure = vi.spyOn(textMeasure, 'calculateRowHeight');
    computePagination(mutable);
    (mutable.jsonData!.items as Record<string, unknown>[])[0].description = 'changed '.repeat(80);
    const table = mutable.elements.find(element => element.type === 'table' && element.role === 'table');
    if (!table || table.type !== 'table') throw new Error('Missing item table');
    table.columns[1].width = 50;
    measure.mockClear();
    const updated = computePagination(mutable);
    expect(measure).toHaveBeenCalledTimes(128);
    clearPaginationCache();
    expect(pageRanges(computePagination(mutable))).toEqual(pageRanges(updated));
  });

  it('preserves primitive/null rows when columns do not wrap', () => {
    const store = heightStore(3);
    store.dispatch(draft => {
      for (const element of draft.elements) {
        if (element.type === 'table') for (const column of element.columns) column.overflow = 'clip';
      }
    });
    loadJsonData(store, { ...store.state.jsonData, items: [null, 5, 'plain'] });
    expect(() => computePagination(store.state)).not.toThrow();
    expectUncachedParity(store);
    loadJsonData(store, { ...store.state.jsonData });
    expect(() => computePagination(store.state)).not.toThrow();
  });

  it('bypasses frozen columns with mutable accessor values', () => {
    const store = heightStore(1);
    const state = structuredClone(store.state);
    const table = state.elements.find(element => element.type === 'table' && element.role === 'table');
    if (!table || table.type !== 'table') throw new Error('Missing item table');
    let width = 200;
    Object.defineProperty(table.columns[1], 'width', { get: () => width, enumerable: true });
    for (const element of state.elements) {
      if (element.type === 'table') { element.columns.forEach(Object.freeze); Object.freeze(element.columns); }
    }
    state.jsonData = store.state.jsonData;
    Object.freeze(state.elements); Object.freeze(state.page); Object.freeze(state.pagination);
    computePagination(state);
    width = 40;
    const changed = { ...state, jsonData: Object.freeze({ ...state.jsonData }) };
    const measure = vi.spyOn(textMeasure, 'calculateRowHeight');
    const updated = computePagination(changed);
    expect(measure).toHaveBeenCalledTimes(1);
    clearPaginationCache();
    expect(pageRanges(computePagination(changed))).toEqual(pageRanges(updated));
  });

  it('does not reuse shallow-frozen rows containing mutable measured values', () => {
    const state = structuredClone(heightStore(1).state);
    const description = ['short'];
    const row = Object.freeze({ ...(state.jsonData!.items as object[])[0], description });
    state.jsonData!.items = Object.freeze([row]);
    Object.freeze(state.jsonData);
    for (const element of state.elements) {
      if (element.type === 'table') { element.columns.forEach(Object.freeze); Object.freeze(element.columns); }
    }
    Object.freeze(state.elements); Object.freeze(state.page); Object.freeze(state.pagination);
    computePagination(state);
    description[0] = 'long '.repeat(100);
    // New immutable root triggers pagination while retaining the same shallow-frozen row.
    const changed = { ...state, jsonData: Object.freeze({ ...state.jsonData }) };
    const measure = vi.spyOn(textMeasure, 'calculateRowHeight');
    const updated = computePagination(changed);
    expect(measure).toHaveBeenCalledTimes(1);
    clearPaginationCache();
    expect(pageRanges(computePagination(changed))).toEqual(pageRanges(updated));
  });
});

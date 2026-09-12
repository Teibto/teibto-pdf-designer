/**
 * Invoice header/summary grids must not replace the detail pagination source.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { describe, expect, it } from 'vitest';
import { getSampleTemplates } from '../../src/constants/sample-templates';
import { AppStore } from '../../src/state/store';
import { loadJsonData } from '../../src/state/actions';
import { computePagination } from '../../src/services/pagination.service';

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

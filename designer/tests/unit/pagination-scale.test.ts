/**
 * Synthetic large-document coverage and reproducible local timing observations.
 * Timings are evidence, not a machine-independent performance pass threshold.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { describe, expect, it } from 'vitest';
import { AppStore } from '../../src/state/store';
import { addElementToNewBand } from '../../src/state/actions';
import { clearPaginationCache, computePagination } from '../../src/services/pagination.service';
import { exportBfoXml } from '../../src/services/bfo-export.service';

describe('large synthetic Thai document', () => {
  for (const rows of [100, 1000, 10000]) {
    it(`preserves every row across ${rows} rows and reuses unchanged pagination`, () => {
      const store = new AppStore();
      addElementToNewBand(store, 'table', 'table');
      store.dispatch((d) => {
        const table = d.elements.find((el) => el.type === 'table');
        if (!table || table.type !== 'table') throw new Error('Missing table fixture');
        table.binding = 'record.items';
        table.columns = [{ key: 'description', label: 'รายละเอียด', width: 450,
          align: 'left', format: 'text', overflow: 'wrap', maxLines: 0,
          hidden: false, bold: false, uppercase: false }];
        d.jsonData = { record: { items: Array.from({ length: rows }, (_, i) => ({
          description: `สินค้าทดสอบสังเคราะห์ น้ำดื่ม & กล่อง <QA> ${i + 1}`,
        })) } };
        d.pagination.mode = 'rows';
        d.pagination.rowsPerPage = 25;
        d.pagination.orphanWidowMinRows = 0;
      });
      clearPaginationCache();
      const start = performance.now();
      const result = computePagination(store.state);
      const coldMs = performance.now() - start;
      expect(result.totalRows).toBe(rows);
      let nextRow = 0;
      for (const page of result.pagesData) {
        expect(page.tableRowStart).toBe(nextRow);
        expect(page.tableRowEnd).toBeGreaterThanOrEqual(nextRow);
        nextRow = page.tableRowEnd;
      }
      expect(nextRow).toBe(rows);
      const warmStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        if (computePagination(store.state) !== result) throw new Error('Unchanged document lost cache');
      }
      const warm1000Ms = performance.now() - warmStart;
      const exportStart = performance.now();
      const xml = exportBfoXml(store.state, { useBands: true, useFreeMarker: true });
      const exportMs = performance.now() - exportStart;
      expect(xml).toContain('<#list');
      expect(xml).toContain('record.items');
      console.info('PLD_SCALE', JSON.stringify({ rows, pages: result.totalPages,
        coldMs: +coldMs.toFixed(3), warm1000Ms: +warm1000Ms.toFixed(3),
        exportMs: +exportMs.toFixed(3), xmlChars: xml.length }));
    });
  }
});

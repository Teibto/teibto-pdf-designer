/**
 * Mocked NetSuite GET -> app auto-load -> loadJsonData -> form paint/edit.
 * Request-to-observed-form-paint includes fixture layout setup and tab automation.
 * Local production Chromium timings do not measure live NetSuite or BFO.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getSampleTemplates } from '../../src/constants/sample-templates';

// Use the engine's own synthetic builder; never copy live account data.
let invoiceData: any;
runInNewContext(readFileSync(new URL('../../../engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_lib_invoice_data.js', import.meta.url), 'utf8'), {
  define: (_deps: string[], factory: any) => { invoiceData = factory({}, {},
    { Type: { DATETIME: 'datetime' }, format: () => 'Synthetic QA date' },
    { load: () => ({}) }, { bahtText: () => 'Synthetic amount', amountInWords: () => 'Synthetic amount' },
    { breakThai: (text: string) => text }); },
});
const template = getSampleTemplates()[0];

const percentile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];

for (const rectype of ['invoice', 'salesorder', 'purchaseorder', 'creditmemo']) {
  for (const count of [50, 1000, 10000]) {
    test(`${rectype} ${count} rows load and edit through parent`, async ({ page }) => {
      const data = invoiceData.buildSampleData(rectype);
      const seedItems = data.items;
      data.items = Array.from({ length: count }, (_, i) => ({ ...seedItems[i % seedItems.length], no: i + 1 }));
      data._recordType = rectype;
      data._internalId = '213';
      await page.addInitScript(({ rectype }) => {
        (window as any).__NS_CONTEXT__ = { recordType: rectype, recordId: '213', userName: 'QA' };
        (window as any).__NS_SUITELET_URL__ = '/mock-designer';
        (window as any).__tasks = [];
        new PerformanceObserver(list => (window as any).__tasks.push(...list.getEntries().map(e => e.duration)))
          .observe({ type: 'longtask', buffered: true });
      }, { rectype });
      let requests = 0;
      await page.route('**/mock-designer?**', async route => {
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe('GET');
        expect(url.searchParams.get('action')).toBe('load-record');
        expect(url.searchParams.get('rectype')).toBe(rectype);
        requests++;
        // Layout setup only: record data still enters solely through GET auto-load.
        await page.locator('pld-app-shell').evaluate((shell: any, layout) => {
          shell.store.dispatch((draft: any) => {
            draft.elements = layout.elements;
            draft.bands = layout.bands;
            draft.page = layout.page;
            draft.pagination = layout.pagination;
          });
        }, { elements: template.elements, bands: template.bands, page: template.page, pagination: template.pagination });
        await route.fulfill({ json: data });
      });
      const loads: number[] = [], edits: number[] = [], tasks: number[] = [];
      for (let run = 0; run < 10; run++) {
        await page.goto('/');
        await page.locator('pld-sidebar-left #tab-data').click();
        const form = page.locator('pld-data-form').first();
        await expect(form.locator('input').first()).toBeVisible();
        const metrics = await form.evaluate(async (element: any) => {
          const shell = document.querySelector('pld-app-shell') as any;
          await element.updateComplete;
          await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          const request = performance.getEntriesByType('resource').find(e => e.name.includes('/mock-designer?'));
          if (!request) throw new Error('Missing real load-record resource timing');
          const load = performance.now() - request.startTime;
          const input = element.shadowRoot.querySelector('.array-table tbody input[aria-label*="row 1"]') as HTMLInputElement;
          const start = performance.now();
          input.value = '777';
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          await shell.updateComplete;
          await element.updateComplete;
          await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          return { load, edit: performance.now() - start, itemCount: shell.store.state.jsonData.items.length,
            edited: shell.store.state.jsonData.items[0].no, pages: shell.store.state.totalPages,
            tasks: (window as any).__tasks as number[], controls: element.shadowRoot.querySelectorAll('input').length };
        });
        expect(metrics.edited).toBe(777);
        expect(metrics.itemCount).toBe(count);
        expect(metrics.pages).toBeGreaterThan(1);
        // Match the existing shared visual-form control budget.
        expect(metrics.controls).toBeLessThanOrEqual(1000);
        loads.push(metrics.load); edits.push(metrics.edit); tasks.push(...metrics.tasks);
      }
      expect(requests).toBe(10);
      const summary = { rectype, count, runs: loads.length, requestToObservedFormPaintP50: percentile(loads, .5),
        requestToObservedFormPaintP95: percentile(loads, .95), editP50: percentile(edits, .5), editP95: percentile(edits, .95),
        maxLongTask: Math.max(0, ...tasks) };
      console.info('PLD_MOCK_RECORD_LOAD', JSON.stringify(summary));
      expect(summary.requestToObservedFormPaintP95).toBeLessThan(1500);
      expect(summary.editP95).toBeLessThan(250);
      expect(summary.maxLongTask).toBeLessThan(150);
    });
  }
}

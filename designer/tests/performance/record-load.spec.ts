/**
 * Mocked NetSuite GET -> app auto-load -> loadJsonData -> form paint/edit.
 * Gate response-to-form-paint after layout/tab setup; retain request-to-paint as context.
 * Local production Chromium timings do not measure live NetSuite or BFO.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
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
        const recordTasks = (entries: PerformanceEntry[]) => (window as any).__tasks.push(
          ...entries.map(e => ({ startTime: e.startTime, duration: e.duration })),
        );
        const observer = new PerformanceObserver(list => recordTasks(list.getEntries()));
        observer.observe({ type: 'longtask', buffered: true });
        (window as any).__flushTasks = () => recordTasks(observer.takeRecords());
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
        // Finish unrelated layout/tab setup while the actual GET remains pending.
        await page.locator('pld-sidebar-left #tab-data').click();
        await page.locator('pld-data-form').first().evaluate(async (element: any, expectedCount) => {
          const shell = document.querySelector('pld-app-shell') as any;
          const editor = element.getRootNode().host as any;
          await shell.updateComplete;
          await editor.updateComplete;
          await element.updateComplete;
          const paint = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          await paint();
          const setupComplete = performance.now();
          const markers = (window as any).__recordMarkers = { setupComplete } as Record<string, number>;
          // Observe the actual store commit in-browser, not Playwright polling after fulfillment.
          (window as any).__recordMeasurement = new Promise((resolve, reject) => {
            let committed = false;
            const deadline = setTimeout(() => {
              shell.store.removeEventListener('state-changed', changed);
              reject(new Error('Record commit/form paint did not complete within 10 seconds'));
            }, 10_000);
            const changed = () => {
              if (committed || shell.store.state.jsonData?.items?.length !== expectedCount) return;
              committed = true;
              shell.store.removeEventListener('state-changed', changed);
              const dataCommit = markers.dataCommit = performance.now();
              void (async () => {
                await shell.updateComplete;
                await editor.updateComplete;
                await element.updateComplete;
                await paint();
                const formPaint = markers.formPaint = performance.now();
                const request = performance.getEntriesByType('resource')
                  .find(e => e.name.includes('/mock-designer?')) as PerformanceResourceTiming | undefined;
                if (!request || request.responseStart <= 0) throw new Error('Missing actual response timing');
                const input = element.shadowRoot.querySelector('.array-table tbody input[aria-label*="แถวที่ 1"]') as HTMLInputElement;
                if (!input) throw new Error('Missing visible item-cell editor');
                const editStart = markers.editStart = performance.now();
                input.value = '777';
                input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                await shell.updateComplete;
                await editor.updateComplete;
                await element.updateComplete;
                await paint();
                const editPaint = markers.editPaint = performance.now();
                clearTimeout(deadline);
                (window as any).__flushTasks();
                resolve({
                  setupComplete, dataCommit, formPaint, editStart, editPaint,
                  request: { startTime: request.startTime, responseStart: request.responseStart,
                    responseEnd: request.responseEnd, duration: request.duration, transferSize: request.transferSize },
                  responseToFormPaint: formPaint - request.responseStart,
                  responseEndToFormPaint: formPaint - request.responseEnd,
                  requestToObservedFormPaint: formPaint - request.startTime,
                  edit: editPaint - editStart,
                  itemCount: shell.store.state.jsonData.items.length,
                  edited: shell.store.state.jsonData.items[0].no, pages: shell.store.state.totalPages,
                  tasks: (window as any).__tasks,
                  controls: element.shadowRoot.querySelectorAll('input').length,
                });
              })().catch(error => { clearTimeout(deadline); reject(error); });
            };
            shell.store.addEventListener('state-changed', changed);
          });
        }, count);
        await route.fulfill({ json: data });
      });
      const samples: any[] = [];
      try {
        for (let run = 0; run < 10; run++) {
          await page.goto('/');
          await page.waitForFunction(() => !!(window as any).__recordMeasurement);
          // This retrieves already-recorded browser timestamps; polling adds no measured latency.
          const metrics = await page.evaluate(() => (window as any).__recordMeasurement);
          samples.push({ run, ...metrics });
          expect(metrics.edited).toBe(777);
          expect(metrics.itemCount).toBe(count);
          expect(metrics.pages).toBeGreaterThan(1);
          expect(metrics.controls).toBeLessThanOrEqual(1000);
          expect(metrics.request.responseStart).toBeGreaterThanOrEqual(metrics.setupComplete);
          expect(metrics.request.responseEnd).toBeLessThanOrEqual(metrics.formPaint);
        }
      } finally {
        const rawPath = test.info().outputPath('record-load-raw-samples.json');
        writeFileSync(rawPath, JSON.stringify({ rectype, count,
          scope: 'Mocked GET after layout/Data tab setup; responseStart includes body transfer/decode, store/pagination/update and paint. No product speedup claimed from measurement change.',
          samples,
          finalBrowserState: await page.evaluate(() => ({ markers: (window as any).__recordMarkers,
            tasks: (window as any).__tasks })).catch(error => ({ unavailable: String(error) })),
        }, null, 2));
        await test.info().attach('record-load-raw-samples.json', { path: rawPath, contentType: 'application/json' });
      }
      expect(requests).toBe(10);
      const relevantTasks = samples.flatMap(sample => sample.tasks.filter((task: { startTime: number; duration: number }) => {
        const end = task.startTime + task.duration;
        return (task.startTime < sample.formPaint && end > sample.request.responseStart)
          || (task.startTime < sample.editPaint && end > sample.editStart);
      }));
      const summary = { rectype, count, runs: samples.length,
        requestToObservedFormPaintP50: percentile(samples.map(s => s.requestToObservedFormPaint), .5),
        requestToObservedFormPaintP95: percentile(samples.map(s => s.requestToObservedFormPaint), .95),
        responseToFormPaintP50: percentile(samples.map(s => s.responseToFormPaint), .5),
        responseToFormPaintP95: percentile(samples.map(s => s.responseToFormPaint), .95),
        responseEndToFormPaintP95: percentile(samples.map(s => s.responseEndToFormPaint), .95),
        editP50: percentile(samples.map(s => s.edit), .5), editP95: percentile(samples.map(s => s.edit), .95),
        maxLongTask: Math.max(0, ...relevantTasks.map(task => task.duration)),
        maxAllPhaseLongTask: Math.max(0, ...samples.flatMap(sample => sample.tasks.map((task: { duration: number }) => task.duration))),
      };
      console.info('PLD_MOCK_RECORD_LOAD', JSON.stringify(summary));
      const summaryPath = test.info().outputPath('record-load-summary.json');
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      await test.info().attach('record-load-summary.json', { path: summaryPath, contentType: 'application/json' });
      expect(summary.responseToFormPaintP95).toBeLessThan(1500);
      expect(summary.editP95).toBeLessThan(250);
      expect(summary.maxLongTask).toBeLessThan(150);
    });
  }
}

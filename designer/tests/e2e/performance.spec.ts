/**
 * Fixed-Chromium performance evidence for bounded large-data rendering.
 * Timing budgets belong here, not in cross-machine jsdom unit tests.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { expect, test } from '@playwright/test';
import { band, dragPaletteTo, emptyRole, gotoApp, headerBtn, leftTab } from './_helpers';

const p95 = (values: number[]) => values[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;

async function installListenerTracker(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const targetIds = new WeakMap<object, number>();
    const callbackIds = new WeakMap<object, number>();
    const active = new Set<string>();
    let nextId = 1;
    const idFor = (map: WeakMap<object, number>, value: object) => {
      let id = map.get(value);
      if (!id) {
        id = nextId++;
        map.set(value, id);
      }
      return id;
    };
    const captureOf = (options?: boolean | AddEventListenerOptions) =>
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const keyFor = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) =>
      `${idFor(targetIds, target)}:${type}:${idFor(callbackIds, listener)}:${capture ? 1 : 0}`;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      originalAdd.call(this, type, listener, options);
      if (!listener || (typeof options === 'object' && (options.once || options.signal?.aborted))) return;
      const key = keyFor(this, type, listener, captureOf(options));
      active.add(key);
      if (typeof options === 'object' && options.signal) {
        originalAdd.call(options.signal, 'abort', () => active.delete(key), { once: true });
      }
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      originalRemove.call(this, type, listener, options);
      if (listener) active.delete(keyFor(this, type, listener, captureOf(options)));
    };
    (window as any).__PLD_ACTIVE_LISTENERS__ = () => [...active].sort();
  });
}

test('dev-server app startup smoke stays within a broad interaction budget', async ({ page }) => {
  const samples: number[] = [];
  const domContentLoaded: number[] = [];
  const loadEvents: number[] = [];

  for (let iteration = 0; iteration < 5; iteration++) {
    await page.goto('/');
    await page.waitForSelector('pld-band-view');
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        interactiveMs: performance.now(),
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadEventMs: navigation.loadEventEnd,
      };
    });
    samples.push(timing.interactiveMs);
    domContentLoaded.push(timing.domContentLoadedMs);
    loadEvents.push(timing.loadEventMs);
  }
  samples.sort((a, b) => a - b);
  const metrics = {
    runs: samples.length,
    interactiveP95Ms: p95(samples),
    interactiveMaxMs: samples.at(-1) ?? 0,
    domContentLoadedMaxMs: Math.max(...domContentLoaded),
    loadEventMaxMs: Math.max(...loadEvents),
  };

  console.info(`PLD_BROWSER_STARTUP ${JSON.stringify(metrics)}`);
  expect(metrics.interactiveP95Ms).toBeLessThan(1_500);
  expect(metrics.interactiveMaxMs).toBeLessThan(2_000);
});

test('10,000-row form keeps DOM bounded and page switches within budget', async ({ page }) => {
  await gotoApp(page);
  await leftTab(page, 'ข้อมูล');

  const metrics = await page.locator('pld-app-shell').evaluate(async (shell: any) => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      index,
      name: `row-${index}`,
      quantity: index,
      price: index,
      tax: index,
      total: index,
      sku: `sku-${index}`,
      unit: 'EA',
      memo: `memo-${index}`,
      location: 'BKK',
    }));
    const sidebar = shell.shadowRoot.querySelector('pld-sidebar-left') as any;
    const editor = sidebar.shadowRoot.querySelector('pld-json-editor') as any;
    const afterPaint = () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const longTaskSupported = typeof PerformanceObserver !== 'undefined'
      && PerformanceObserver.supportedEntryTypes.includes('longtask');
    const longTasks: number[] = [];
    const observer = longTaskSupported
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : null;
    observer?.observe({ type: 'longtask', buffered: false });

    const mountStart = performance.now();
    shell.store.dispatch((draft: any) => {
      draft.jsonData = { items: rows };
      draft.jsonKeys = ['items'];
    });
    await editor.updateComplete;
    const form = editor.shadowRoot.querySelector('pld-data-form') as any;
    await form.updateComplete;
    await afterPaint();
    const mountMs = performance.now() - mountStart;

    for (let index = 0; index < 6; index++) {
      const selector = index % 2 === 0 ? '.array-page-next' : '.array-page-prev';
      (form.shadowRoot.querySelector(selector) as HTMLButtonElement).click();
      await form.updateComplete;
      await afterPaint();
    }

    const switchSamples: number[] = [];
    for (let index = 0; index < 50; index++) {
      const selector = index % 2 === 0 ? '.array-page-next' : '.array-page-prev';
      const start = performance.now();
      (form.shadowRoot.querySelector(selector) as HTMLButtonElement).click();
      await form.updateComplete;
      await afterPaint();
      switchSamples.push(performance.now() - start);
    }
    observer?.disconnect();
    switchSamples.sort((a, b) => a - b);

    return {
      mountMs,
      switchP95Ms: switchSamples[Math.max(0, Math.ceil(switchSamples.length * 0.95) - 1)],
      switchMaxMs: switchSamples.at(-1) ?? 0,
      maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
      longTaskSupported,
      renderedRows: form.shadowRoot.querySelectorAll('tbody tr').length,
      renderedInputs: form.shadowRoot.querySelectorAll('tbody input').length,
      storedRows: shell.store.state.jsonData.items.length,
    };
  });

  console.info(`PLD_BROWSER_DATA_FORM ${JSON.stringify(metrics)}`);
  expect(metrics.storedRows).toBe(10_000);
  expect(metrics.renderedRows).toBe(50);
  expect(metrics.renderedInputs).toBe(500);
  expect(metrics.longTaskSupported).toBe(true);
  expect(metrics.mountMs).toBeLessThan(500);
  expect(metrics.switchP95Ms).toBeLessThan(100);
  expect(metrics.switchMaxMs).toBeLessThan(150);
  expect(metrics.maxLongTaskMs).toBeLessThan(100);
});

test('500-element column resize stays frame-bounded in Chromium', async ({ page }) => {
  await gotoApp(page);
  await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
  const header = band(page, 'Header');
  await header.locator('button[title="แยกคอลัมน์"]').first().click();

  await page.locator('pld-app-shell').evaluate((shell: any) => {
    const source = shell.store.state.elements[0];
    shell.store.dispatch((draft: any) => {
      const clones = Array.from({ length: 500 }, (_, index) => ({
        ...source,
        id: `perf-${index}`,
        name: `Element ${index}`,
      }));
      draft.elements = clones;
      const row = draft.bands.find((entry: any) => entry.role === 'header').rows[0];
      row.columns[0].elementIds = clones.slice(0, 250).map((entry) => entry.id);
      row.columns[1].elementIds = clones.slice(250).map((entry) => entry.id);
    });
  });
  await expect(header.locator('.chip')).toHaveCount(500);

  const resizer = header.locator('.col-resizer').first();
  const box = await resizer.boundingBox();
  expect(box).not.toBeNull();
  await resizer.evaluate((element: HTMLElement) => {
    const samples: number[] = [];
    const longTasks: number[] = [];
    const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    if (longTaskSupported) observer.observe({ type: 'longtask', buffered: false });
    element.addEventListener('pointermove', () => {
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - start)));
    });
    (window as any).__PLD_RESIZE_METRICS__ = { samples, longTasks, observer, longTaskSupported };
  });

  const startX = box!.x + box!.width / 2;
  const y = box!.y + Math.min(box!.height / 2, 20);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= 30; step++) {
    await page.mouse.move(startX + step, y);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  const metrics = await page.evaluate(() => {
    const collected = (window as any).__PLD_RESIZE_METRICS__;
    if (collected.longTaskSupported) collected.observer.disconnect();
    const samples = [...collected.samples].sort((a: number, b: number) => a - b);
    const shell = document.querySelector('pld-app-shell') as any;
    const row = shell.store.state.bands.find((entry: any) => entry.role === 'header').rows[0];
    return {
      sampleCount: samples.length,
      p95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0,
      maxMs: samples.at(-1) ?? 0,
      maxLongTaskMs: collected.longTasks.length ? Math.max(...collected.longTasks) : 0,
      longTaskSupported: collected.longTaskSupported,
      widths: row.columns.map((column: any) => column.widthPct),
    };
  });

  console.info(`PLD_BROWSER_RESIZE ${JSON.stringify(metrics)}`);
  expect(metrics.sampleCount).toBeGreaterThan(0);
  expect(metrics.longTaskSupported).toBe(true);
  expect(metrics.widths[0]).toBeGreaterThan(50);
  expect(metrics.widths[0] + metrics.widths[1]).toBeCloseTo(100, 5);
  expect(metrics.p95Ms).toBeLessThan(50);
  expect(metrics.maxMs).toBeLessThan(100);
  expect(metrics.maxLongTaskMs).toBeLessThan(100);
});

test('100 Design/Flow switches do not grow live DOM or listener counters', async ({ page, context }) => {
  await installListenerTracker(page);
  await gotoApp(page);
  const cdp = await context.newCDPSession(page);

  // Warm both component paths before taking the baseline so lazy registration
  // is not mistaken for a lifecycle leak.
  for (let iteration = 0; iteration < 3; iteration++) {
    await headerBtn(page, 'ผังข้อมูล').click();
    await expect(page.locator('pld-flow-view')).toBeVisible();
    await headerBtn(page, 'ออกแบบ').click();
    await expect(page.locator('pld-band-view')).toBeVisible();
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const baseline = await cdp.send('Memory.getDOMCounters');
  const baselineListeners = await page.evaluate(() => (window as any).__PLD_ACTIVE_LISTENERS__());

  const start = Date.now();
  for (let iteration = 0; iteration < 50; iteration++) {
    await headerBtn(page, 'ผังข้อมูล').click();
    await expect(page.locator('pld-flow-view')).toBeVisible();
    await headerBtn(page, 'ออกแบบ').click();
    await expect(page.locator('pld-band-view')).toBeVisible();
  }
  const elapsedMs = Date.now() - start;
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Memory.getDOMCounters');
  const afterListeners = await page.evaluate(() => (window as any).__PLD_ACTIVE_LISTENERS__());
  const metrics = {
    switches: 100,
    elapsedMs,
    documentGrowth: after.documents - baseline.documents,
    nodeGrowth: after.nodes - baseline.nodes,
    listenerGrowth: after.jsEventListeners - baseline.jsEventListeners,
    trackedActiveListenerGrowth: afterListeners.length - baselineListeners.length,
  };

  console.info(`PLD_BROWSER_LIFECYCLE ${JSON.stringify(metrics)}`);
  await expect(page.locator('pld-band-view')).toHaveCount(1);
  await expect(page.locator('pld-flow-view')).toHaveCount(0);
  expect(metrics.documentGrowth).toBeLessThanOrEqual(0);
  expect(metrics.nodeGrowth).toBeLessThanOrEqual(100);
  expect(metrics.listenerGrowth).toBeLessThanOrEqual(10);
  expect(afterListeners).toEqual(baselineListeners);
});

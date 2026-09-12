/**
 * Serial production-preview startup budgets for the lockfile-pinned Chromium.
 * Timing claims apply to this fixed local runner, not NetSuite delivery latency.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:4173/';

type StartupSample = {
  appReadyMs: number;
  domContentLoadedMs: number;
  ttfbMs: number;
  maxLongTaskMs: number;
  tbtMs: number;
  resourceCount: number;
  totalEncodedBytes: number;
  initialJsEncodedBytes: number;
  barcodeRequests: number;
  longTaskSupported: boolean;
  loadedUiFontFaces: number;
};

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

async function installLongTaskObserver(page: Page) {
  await page.addInitScript(() => {
    const supported = typeof PerformanceObserver !== 'undefined'
      && PerformanceObserver.supportedEntryTypes.includes('longtask');
    (window as any).__PLD_STARTUP_LONG_TASK_SUPPORTED__ = supported;
    (window as any).__PLD_STARTUP_LONG_TASKS__ = [];
    if (!supported) return;
    new PerformanceObserver((list) => {
      (window as any).__PLD_STARTUP_LONG_TASKS__.push(
        ...list.getEntries().map((entry) => entry.duration),
      );
    }).observe({ type: 'longtask', buffered: true });
  });
}

async function measure(page: Page): Promise<StartupSample> {
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.locator('pld-app-shell').evaluate(async (shell: any) => {
    await shell.updateComplete;
    // Readiness includes the portable Latin/Thai font, not just fallback text.
    await Promise.all(['400', '600', '700'].map((weight) =>
      document.fonts.load(`${weight} 14px "PLD UI Sans"`, 'QA ทดสอบ')));
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    // Inline font data URLs are decoded resources, not additional HTTP requests.
    // Their transfer bytes are already counted in the parent CSS response.
    const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((entry) => /^https?:/.test(entry.name));
    const longTasks = (window as any).__PLD_STARTUP_LONG_TASKS__ as number[];
    const jsResources = resources.filter((entry) => new URL(entry.name).pathname.endsWith('.js'));
    return {
      appReadyMs: performance.now(),
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      ttfbMs: navigation.responseStart,
      maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
      tbtMs: longTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0),
      resourceCount: resources.length,
      totalEncodedBytes: resources.reduce((total, entry) => total + entry.encodedBodySize, 0),
      initialJsEncodedBytes: jsResources.reduce((total, entry) => total + entry.encodedBodySize, 0),
      barcodeRequests: resources.filter((entry) => /barcode|bwip/i.test(entry.name)).length,
      longTaskSupported: (window as any).__PLD_STARTUP_LONG_TASK_SUPPORTED__,
      loadedUiFontFaces: [...document.fonts].filter((face) =>
        face.family.replaceAll('"', '') === 'PLD UI Sans' && face.status === 'loaded').length,
    };
  });
}

function summarize(samples: StartupSample[]) {
  return {
    runs: samples.length,
    appReadyP95Ms: percentile(samples.map((sample) => sample.appReadyMs), 0.95),
    appReadyMaxMs: Math.max(...samples.map((sample) => sample.appReadyMs)),
    domContentLoadedP95Ms: percentile(samples.map((sample) => sample.domContentLoadedMs), 0.95),
    ttfbP95Ms: percentile(samples.map((sample) => sample.ttfbMs), 0.95),
    maxLongTaskMs: Math.max(...samples.map((sample) => sample.maxLongTaskMs)),
    maxTbtMs: Math.max(...samples.map((sample) => sample.tbtMs)),
    maxResourceCount: Math.max(...samples.map((sample) => sample.resourceCount)),
    maxEncodedBytes: Math.max(...samples.map((sample) => sample.totalEncodedBytes)),
    maxInitialJsEncodedBytes: Math.max(...samples.map((sample) => sample.initialJsEncodedBytes)),
    barcodeRequests: Math.max(...samples.map((sample) => sample.barcodeRequests)),
  };
}

function assertRuntimeBudgets(samples: StartupSample[]) {
  expect(samples.every((sample) => sample.longTaskSupported)).toBe(true);
  expect(samples.every((sample) => sample.loadedUiFontFaces === 6)).toBe(true);
  const metrics = summarize(samples);
  expect(metrics.maxLongTaskMs).toBeLessThan(100);
  expect(metrics.maxTbtMs).toBeLessThan(150);
  expect(metrics.barcodeRequests).toBe(0);
  return metrics;
}

function assertColdArtifactBudgets(metrics: ReturnType<typeof summarize>) {
  expect(metrics.maxResourceCount).toBeLessThanOrEqual(4);
  expect(metrics.maxInitialJsEncodedBytes).toBeLessThanOrEqual(110 * 1024);
  // The original 120KiB app allowance plus 70KiB for six portable Latin/Thai
  // WOFF2 faces delivered inline in CSS. Executable JS and latency limits stay
  // unchanged; fonts are included in measured readiness above.
  expect(metrics.maxEncodedBytes).toBeLessThanOrEqual((120 + 70) * 1024);
}

test('cold production startup stays within fixed-Chromium budgets', async ({ browser }: { browser: Browser }) => {
  const samples: StartupSample[] = [];
  for (let index = 0; index < 20; index++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installLongTaskObserver(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    samples.push(await measure(page));
    await context.close();
  }
  const metrics = assertRuntimeBudgets(samples);
  assertColdArtifactBudgets(metrics);
  console.info(`PLD_PRODUCTION_COLD_STARTUP ${JSON.stringify(metrics)}`);
  expect(metrics.appReadyP95Ms).toBeLessThan(750);
});

test('warm production startup stays within fixed-Chromium budgets', async ({ page }) => {
  await installLongTaskObserver(page);
  for (let index = 0; index < 5; index++) await measure(page);
  const samples: StartupSample[] = [];
  for (let index = 0; index < 30; index++) samples.push(await measure(page));
  const metrics = assertRuntimeBudgets(samples);
  console.info(`PLD_PRODUCTION_WARM_STARTUP ${JSON.stringify(metrics)}`);
  expect(metrics.appReadyP95Ms).toBeLessThan(400);
});

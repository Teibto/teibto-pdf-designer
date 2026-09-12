/**
 * Failure-only cold-start CPU diagnostics; instrumentation affects timings.
 * No acceptance budgets are evaluated here. Uses the already-built dist.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, `test-results/performance-diagnostic-${Date.now()}-${process.pid}`);
await mkdir(output, { recursive: true });
const save = (name, value) => writeFile(resolve(output, name), JSON.stringify(value));
let server;
let browser;
try {
  // Vite runs in this process. Its ephemeral loopback listener is owned here.
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing diagnostic preview port');
  const url = `http://127.0.0.1:${address.port}/`;
  browser = await chromium.launch();
  for (let index = 1; index <= 3; index++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline',
        transferMode: 'ReturnAsStream',
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.locator('pld-app-shell').evaluate(async (shell) => {
        await shell.updateComplete;
        await Promise.all(['400', '600', '700'].map((weight) =>
          document.fonts.load(`${weight} 14px "PLD UI Sans"`, 'QA ทดสอบ')));
        await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      });
      const metrics = await page.evaluate(() => ({
        appReadyMs: performance.now(),
        loadedUiFontFaces: [...document.fonts].filter((face) =>
          face.family.replaceAll('"', '') === 'PLD UI Sans' && face.status === 'loaded').length,
      }));
      const { profile } = await cdp.send('Profiler.stop');
      await save(`cold-${index}.cpuprofile`, profile);
      const traceComplete = new Promise((done) => cdp.once('Tracing.tracingComplete', done));
      await cdp.send('Tracing.end');
      const { stream } = await traceComplete;
      const chunks = [];
      try {
        for (;;) {
          const chunk = await cdp.send('IO.read', { handle: stream });
          chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
          if (chunk.eof) break;
        }
      } finally {
        await cdp.send('IO.close', { handle: stream });
      }
      await writeFile(resolve(output, `cold-${index}.trace.json`), Buffer.concat(chunks));
      await save(`cold-${index}.metrics.json`, { diagnosticOnly: true, instrumentationOverhead: true, ...metrics });
      console.info(`PLD_COLD_CPU_DIAGNOSTIC ${JSON.stringify({ run: index, ...metrics })}`);
    } finally {
      await context.close();
    }
  }
} catch (error) {
  await save('error.json', { message: String(error), diagnosticOnly: true });
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    if (server) await new Promise((done, reject) => server.httpServer.close((error) => error ? reject(error) : done()));
  }
}

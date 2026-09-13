/**
 * Local benchmark of the deployed inline NetSuite bundle; not server latency.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { defineConfig } from '@playwright/test';
import performanceConfig from './playwright.performance.config';

export default defineConfig({
  ...performanceConfig,
  testMatch: 'record-load.spec.ts',
  outputDir: `./test-results/netsuite-performance-${Date.now()}-${process.pid}`,
  use: { ...performanceConfig.use, baseURL: 'http://127.0.0.1:4175' },
  webServer: {
    command: 'npm run preview -- --outDir dist-netsuite --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

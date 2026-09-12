/**
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { defineConfig, devices } from '@playwright/test';

/** Serial production-preview performance gate for the pinned Chromium build. */
export default defineConfig({
  testDir: './tests/performance',
  outputDir: `./test-results/performance-${Date.now()}-${process.pid}`,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-production', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

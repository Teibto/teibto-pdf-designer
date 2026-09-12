import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLD_E2E_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('PLD_E2E_PORT must be an unprivileged TCP port');
}
const appUrl = `http://127.0.0.1:${port}`;

/**
 * Playwright E2E Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  outputDir: `./test-results/e2e-${Date.now()}-${process.pid}`,
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: appUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run dev server before starting tests */
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: appUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

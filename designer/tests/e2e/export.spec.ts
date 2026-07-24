/**
 * E2E — Preview, BFO export & JSON copy (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, loadSample, headerBtn, openPreview, toast } from './_helpers';

test.describe('Preview modal', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);
  });

  test('opens and shows page navigation', async ({ page }) => {
    const modal = await openPreview(page);
    await expect(modal.locator('.page-info')).toContainText('/');
  });

  test('zoom controls change the zoom level', async ({ page }) => {
    const modal = await openPreview(page);
    const label = modal.locator('.zoom-label');
    const start = await label.textContent();
    await modal.locator('.zoom-controls .nav-btn').last().click(); // +
    await expect(label).not.toHaveText(start ?? '');
  });

  test('renders a page and closes', async ({ page }) => {
    const modal = await openPreview(page);
    await expect(modal.locator('.page-preview')).toBeVisible();
    await modal.locator('.close-btn').click();
    await expect(modal.getByText('PDF Preview')).toBeHidden();
  });
});

test.describe('BFO export modal', () => {
  test('opens and generates BFO XML', async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);
    await headerBtn(page, 'NetSuite BFO').click();

    const modal = page.locator('pld-bfo-export-modal');
    await expect(modal.getByText('NetSuite BFO XML Export')).toBeVisible();
    await expect(modal.locator('.xml-code')).toContainText('<');

    await modal.locator('.close-btn').click();
    await expect(modal.getByText('NetSuite BFO XML Export')).toBeHidden();
  });
});

test.describe('JSON export', () => {
  test('copies the template JSON and shows a toast', async ({ page }) => {
    await gotoApp(page);
    await headerBtn(page, 'JSON').click();
    await expect(toast(page, 'JSON copied')).toBeVisible();
  });
});

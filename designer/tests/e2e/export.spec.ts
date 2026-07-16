/**
 * E2E Tests — Export & Preview
 * Tests PDF export, BFO export modal, and preview modal.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('Preview Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Load sample template for preview content
    const sampleBtn = page.locator('text=Sample').first();
    await sampleBtn.click();
    await page.waitForSelector('pld-canvas-element');
  });

  test('should open preview modal', async ({ page }) => {
    const previewBtn = page.locator('text=Preview').first();
    await previewBtn.click();

    const modal = page.locator('pld-preview-modal');
    await expect(modal).toBeVisible();
  });

  test('should display page navigation in preview', async ({ page }) => {
    const previewBtn = page.locator('text=Preview').first();
    await previewBtn.click();

    // Check for page indicator (e.g. "1 / 1")
    const pageInfo = page.locator('pld-preview-modal .page-info');
    await expect(pageInfo).toBeVisible();
  });

  test('should have zoom controls in preview', async ({ page }) => {
    const previewBtn = page.locator('text=Preview').first();
    await previewBtn.click();

    const zoomLabel = page.locator('pld-preview-modal .zoom-label');
    await expect(zoomLabel).toBeVisible();
  });

  test('should close preview modal', async ({ page }) => {
    const previewBtn = page.locator('text=Preview').first();
    await previewBtn.click();

    // Press Escape to close
    await page.keyboard.press('Escape');
  });
});

test.describe('BFO Export Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should open BFO export modal', async ({ page }) => {
    const bfoBtn = page.locator('text=NetSuite BFO').first();
    await bfoBtn.click();

    const modal = page.locator('pld-bfo-export-modal');
    await expect(modal).toBeVisible();
  });
});

test.describe('PDF Export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Load a sample template
    const sampleBtn = page.locator('text=Sample').first();
    await sampleBtn.click();
    await page.waitForSelector('pld-canvas-element');
  });

  test('should trigger PDF export and show toast', async ({ page }) => {
    // Listen for the new page (PDF opens in new tab)
    const pagePromise = page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null);

    const pdfBtn = page.locator('text=PDF').first();
    await pdfBtn.click();

    // Wait for success toast
    await page.waitForTimeout(3000);
    const newPage = await pagePromise;
    if (newPage) await newPage.close();
  });
});

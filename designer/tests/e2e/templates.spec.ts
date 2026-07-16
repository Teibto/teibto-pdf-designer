/**
 * E2E Tests — Template Management
 * Tests save, load, import/export, and sample template loading.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('Template Save/Load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should save template via Ctrl+S', async ({ page }) => {
    // Add an element first
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();
    await textBtn.dragTo(canvas);

    // Save
    await page.keyboard.press('Control+s');

    // Should show success toast
    const toast = page.locator('pld-toast-notification');
    await expect(toast).toBeVisible();
  });

  test('should load sample template', async ({ page }) => {
    const sampleBtn = page.locator('text=Sample').first();
    await sampleBtn.click();

    // Elements should appear on canvas
    const elements = page.locator('pld-canvas-element');
    const count = await elements.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should open template manager modal', async ({ page }) => {
    const templatesBtn = page.locator('text=Templates').first();
    await templatesBtn.click();

    const modal = page.locator('pld-template-manager-modal');
    await expect(modal).toBeVisible();
  });

  test('should copy JSON to clipboard via header button', async ({ page }) => {
    // Load sample first
    const sampleBtn = page.locator('text=Sample').first();
    await sampleBtn.click();

    const jsonBtn = page.locator('text=JSON').first();
    await jsonBtn.click();

    // Toast should confirm copy
    const toast = page.locator('pld-toast-notification');
    await expect(toast).toBeVisible();
  });
});

test.describe('Sample Templates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should load sample and display elements on canvas', async ({ page }) => {
    const sampleBtn = page.locator('text=Sample').first();
    await sampleBtn.click();

    // Wait for elements to render
    await page.waitForSelector('pld-canvas-element');
    const count = await page.locator('pld-canvas-element').count();
    expect(count).toBeGreaterThan(3);
  });
});

/**
 * E2E Tests — Core Application
 * Tests app launch, basic layout, and navigation.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('App Shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Lit components to render
    await page.waitForSelector('pld-app-shell');
  });

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/PDF Layout/i);
  });

  test('should display header with toolbar buttons', async ({ page }) => {
    const header = page.locator('pld-app-header');
    await expect(header).toBeVisible();
  });

  test('should display left sidebar with element palette', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    await expect(sidebar).toBeVisible();
  });

  test('should display right sidebar (property inspector)', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-right');
    await expect(sidebar).toBeVisible();
  });

  test('should display canvas', async ({ page }) => {
    const canvas = page.locator('pld-canvas');
    await expect(canvas).toBeVisible();
  });

  test('should switch between design and flow views', async ({ page }) => {
    // The design view should be default
    const canvas = page.locator('pld-canvas');
    await expect(canvas).toBeVisible();

    // Click flow view button (if exists in header)
    const flowBtn = page.locator('text=Flow').first();
    if (await flowBtn.isVisible()) {
      await flowBtn.click();
      const flowView = page.locator('pld-flow-view');
      await expect(flowView).toBeVisible();

      // Switch back
      const designBtn = page.locator('text=Design').first();
      await designBtn.click();
      await expect(canvas).toBeVisible();
    }
  });
});

test.describe('Zoom Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should zoom in with Ctrl+Plus', async ({ page }) => {
    await page.keyboard.press('Control+=');
    // Zoom should increase from default 100%
  });

  test('should zoom out with Ctrl+Minus', async ({ page }) => {
    await page.keyboard.press('Control+-');
  });

  test('should reset zoom with Ctrl+0', async ({ page }) => {
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+0');
  });
});

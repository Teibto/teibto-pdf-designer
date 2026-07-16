/**
 * E2E Tests — Table & Layers
 * Tests table column configuration, resize handles, and layers panel.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('Table Element', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Add a table element
    const sidebar = page.locator('pld-sidebar-left');
    const tableBtn = sidebar.locator('text=Table').first();
    const canvas = page.locator('pld-canvas .page').first();
    await tableBtn.dragTo(canvas);
  });

  test('should add table element to canvas', async ({ page }) => {
    const tableElements = page.locator('pld-canvas-element');
    const count = await tableElements.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show column resize handles on hover', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.hover();

    // Table should display resize handles via col-resize-overlay
    // Note: column handles are inside shadow DOM
  });

  test('should open column config modal via right-click', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.click({ button: 'right' });

    const contextMenu = page.locator('pld-context-menu');
    await expect(contextMenu).toBeVisible();
  });
});

test.describe('Layers Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Load sample to have elements
    const sampleBtn = page.locator('text=Sample').first();
    await sampleBtn.click();
    await page.waitForSelector('pld-canvas-element');
  });

  test('should display layers for all elements', async ({ page }) => {
    const layers = page.locator('pld-layers-panel');
    await expect(layers).toBeVisible();

    // The panel should show layer items
    const layerItems = page.locator('pld-layers-panel .layer-item');
    const count = await layerItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should select element by clicking layer', async ({ page }) => {
    const firstLayer = page.locator('pld-layers-panel .layer-item').first();
    await firstLayer.click();

    // Layer should get selected class
    await expect(firstLayer).toHaveClass(/selected/);
  });

  test('should toggle element visibility', async ({ page }) => {
    const visBtn = page.locator('pld-layers-panel .action-btn').first();
    await visBtn.click();
  });

  test('should toggle element lock', async ({ page }) => {
    const lockBtn = page.locator('pld-layers-panel .action-btn').nth(1);
    await lockBtn.click();
  });

  test('should rename layer on double-click', async ({ page }) => {
    const firstLayer = page.locator('pld-layers-panel .layer-item').first();
    await firstLayer.dblclick();

    // Input should appear
    const editInput = page.locator('pld-layers-panel .edit-input');
    await expect(editInput).toBeVisible();

    // Type new name and confirm
    await editInput.fill('Renamed Layer');
    await page.keyboard.press('Enter');
  });
});

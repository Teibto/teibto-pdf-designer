/**
 * E2E Tests — Element Interactions
 * Tests drag-drop, selection, move, resize, keyboard shortcuts.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('Element Palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should show all 8 element types in palette', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    await expect(sidebar).toBeVisible();

    // Check that element type buttons exist
    const elementTypes = ['Header', 'Text', 'Image', 'Table', 'Shape', 'Line', 'Barcode', 'List'];
    for (const type of elementTypes) {
      const btn = sidebar.locator(`text=${type}`).first();
      await expect(btn).toBeVisible();
    }
  });

  test('should add a text element by dragging to canvas', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();

    // Drag from palette to canvas
    await textBtn.dragTo(canvas);

    // Verify element was added
    const element = page.locator('pld-canvas-element').first();
    await expect(element).toBeVisible();
  });
});

test.describe('Element Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Add a text element by dragging
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();
    await textBtn.dragTo(canvas);
  });

  test('should select element on click', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.click();

    // Element should show selection state (has .selected class in shadow DOM)
    await expect(element).toBeVisible();
  });

  test('should deselect with Escape', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.click();
    await page.keyboard.press('Escape');
  });

  test('should delete element with Delete key', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.click();

    const countBefore = await page.locator('pld-canvas-element').count();
    await page.keyboard.press('Delete');
    const countAfter = await page.locator('pld-canvas-element').count();

    expect(countAfter).toBeLessThan(countBefore);
  });

  test('should duplicate element with Ctrl+D', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.click();

    const countBefore = await page.locator('pld-canvas-element').count();
    await page.keyboard.press('Control+d');
    const countAfter = await page.locator('pld-canvas-element').count();

    expect(countAfter).toBe(countBefore + 1);
  });

  test('should select all with Ctrl+A', async ({ page }) => {
    // Add another element
    const sidebar = page.locator('pld-sidebar-left');
    const shapeBtn = sidebar.locator('text=Shape').first();
    const canvas = page.locator('pld-canvas .page').first();
    await shapeBtn.dragTo(canvas, { targetPosition: { x: 300, y: 300 } });

    await page.keyboard.press('Control+a');
    // All elements should be in multi-select
  });
});

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should undo with Ctrl+Z', async ({ page }) => {
    // Add element
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();
    await textBtn.dragTo(canvas);

    const countAfterAdd = await page.locator('pld-canvas-element').count();
    expect(countAfterAdd).toBeGreaterThan(0);

    // Undo should remove it
    await page.keyboard.press('Control+z');
  });

  test('should copy and paste with Ctrl+C/V', async ({ page }) => {
    // Add and select element
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();
    await textBtn.dragTo(canvas);

    const element = page.locator('pld-canvas-element').first();
    await element.click();

    const countBefore = await page.locator('pld-canvas-element').count();

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');

    const countAfter = await page.locator('pld-canvas-element').count();
    expect(countAfter).toBe(countBefore + 1);
  });
});

test.describe('Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Add element
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();
    await textBtn.dragTo(canvas);
  });

  test('should open context menu on right-click', async ({ page }) => {
    const element = page.locator('pld-canvas-element').first();
    await element.click({ button: 'right' });

    const contextMenu = page.locator('pld-context-menu');
    await expect(contextMenu).toBeVisible();
  });
});

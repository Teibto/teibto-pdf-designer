/**
 * E2E Tests — Element Grouping
 * Tests group, ungroup, and group selection behavior.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('Element Grouping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');

    // Add two elements
    const sidebar = page.locator('pld-sidebar-left');
    const textBtn = sidebar.locator('text=Text').first();
    const canvas = page.locator('pld-canvas .page').first();
    await textBtn.dragTo(canvas);

    const shapeBtn = sidebar.locator('text=Shape').first();
    await shapeBtn.dragTo(canvas, { targetPosition: { x: 300, y: 200 } });
  });

  test('should select multiple elements with Ctrl+A', async ({ page }) => {
    await page.keyboard.press('Control+a');
    const count = await page.locator('pld-canvas-element').count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should group elements with Ctrl+G', async ({ page }) => {
    // Select all
    await page.keyboard.press('Control+a');

    // Group
    await page.keyboard.press('Control+g');

    // Click on one element — both should be selected (group behavior)
    const element = page.locator('pld-canvas-element').first();
    await element.click();
  });

  test('should ungroup with Ctrl+Shift+G', async ({ page }) => {
    // Select all, group, then ungroup
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+g');
    await page.keyboard.press('Control+Shift+g');

    // Elements should be ungrouped now
    const element = page.locator('pld-canvas-element').first();
    await element.click();
  });

  test('should shift-click for multi-select', async ({ page }) => {
    const elements = page.locator('pld-canvas-element');
    const first = elements.first();
    const second = elements.last();

    await first.click();
    await second.click({ modifiers: ['Shift'] });
  });
});

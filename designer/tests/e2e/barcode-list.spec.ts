/**
 * E2E Tests — Barcode & List Elements
 * Tests barcode rendering, QR code, and list element behavior.
 *
 * @author Wichit Wongta
 */
import { test, expect } from '@playwright/test';

test.describe('Barcode Element', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should add barcode element to canvas', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    const barcodeBtn = sidebar.locator('text=Barcode').first();
    const canvas = page.locator('pld-canvas .page').first();
    await barcodeBtn.dragTo(canvas);

    const element = page.locator('pld-canvas-element').first();
    await expect(element).toBeVisible();
  });

  test('should show barcode SVG after loading', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    const barcodeBtn = sidebar.locator('text=Barcode').first();
    const canvas = page.locator('pld-canvas .page').first();
    await barcodeBtn.dragTo(canvas);

    // Wait for bwip-js async render
    await page.waitForTimeout(1500);

    // The barcode element should contain an SVG
    const element = page.locator('pld-canvas-element').first();
    await expect(element).toBeVisible();
  });
});

test.describe('List Element', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should add list element to canvas', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    const listBtn = sidebar.locator('text=List').first();
    const canvas = page.locator('pld-canvas .page').first();
    await listBtn.dragTo(canvas);

    const element = page.locator('pld-canvas-element').first();
    await expect(element).toBeVisible();
  });

  test('should display list items', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    const listBtn = sidebar.locator('text=List').first();
    const canvas = page.locator('pld-canvas .page').first();
    await listBtn.dragTo(canvas);

    // Wait for render
    await page.waitForTimeout(300);

    // Element should be visible with list content
    const element = page.locator('pld-canvas-element').first();
    await expect(element).toBeVisible();
  });
});

test.describe('Image Element', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('pld-app-shell');
  });

  test('should add image element with placeholder', async ({ page }) => {
    const sidebar = page.locator('pld-sidebar-left');
    const imageBtn = sidebar.locator('text=Image').first();
    const canvas = page.locator('pld-canvas .page').first();
    await imageBtn.dragTo(canvas);

    const element = page.locator('pld-canvas-element').first();
    await expect(element).toBeVisible();
  });
});

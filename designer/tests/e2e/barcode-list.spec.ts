/**
 * E2E — Barcode, List & Image element drops (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, dragPaletteTo, emptyRole, band, chips } from './_helpers';

test.describe('Barcode element', () => {
  test.beforeEach(async ({ page }) => gotoApp(page));

  test('drops a barcode into the Header band', async ({ page }) => {
    await dragPaletteTo(page, 'Barcode', emptyRole(page, 'Header'));
    await expect(band(page, 'Header')).toBeVisible();
    await expect(chips(page).filter({ hasText: 'barcode' })).toHaveCount(1);
  });

  test('drops a barcode into the Content band', async ({ page }) => {
    await dragPaletteTo(page, 'Barcode', emptyRole(page, 'Content'));
    await expect(chips(page).filter({ hasText: 'barcode' })).toHaveCount(1);
  });

  test('rejects a barcode on the Summary band (acceptance matrix #49)', async ({ page }) => {
    await dragPaletteTo(page, 'Barcode', emptyRole(page, 'Summary'));
    await expect(emptyRole(page, 'Summary')).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
  });
});

test.describe('List element', () => {
  test('drops a list into the Content band', async ({ page }) => {
    await gotoApp(page);
    await dragPaletteTo(page, 'List', emptyRole(page, 'Content'));
    await expect(band(page, 'Content')).toBeVisible();
    await expect(chips(page).filter({ hasText: 'list' })).toHaveCount(1);
  });
});

test.describe('Image element', () => {
  test('drops an image into the Header band', async ({ page }) => {
    await gotoApp(page);
    await dragPaletteTo(page, 'Image', emptyRole(page, 'Header'));
    await expect(chips(page).filter({ hasText: 'image' })).toHaveCount(1);
  });
});

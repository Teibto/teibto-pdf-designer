/**
 * E2E — Palette drag & band-cell editing (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, dragPaletteTo, emptyRole, band, chips } from './_helpers';

test.describe('Palette → band drop', () => {
  test.beforeEach(async ({ page }) => gotoApp(page));

  test('drops a Text element into the Header band', async ({ page }) => {
    await expect(chips(page)).toHaveCount(0);
    await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
    await expect(band(page, 'Header')).toBeVisible();
    await expect(chips(page)).toHaveCount(1);
  });

  test('drops a Table into the Table band', async ({ page }) => {
    await dragPaletteTo(page, 'Table', emptyRole(page, 'Table'));
    await expect(band(page, 'Table')).toBeVisible();
    await expect(chips(page).filter({ hasText: 'table' })).toHaveCount(1);
  });

  test('drops a List into the Content band', async ({ page }) => {
    await dragPaletteTo(page, 'List', emptyRole(page, 'Content'));
    await expect(band(page, 'Content')).toBeVisible();
    await expect(chips(page).filter({ hasText: 'list' })).toHaveCount(1);
  });

  test('rejects a List on the Header band (acceptance matrix #49)', async ({ page }) => {
    // header does not accept `list` → the drop never applies, Header stays empty.
    await dragPaletteTo(page, 'List', emptyRole(page, 'Header'));
    await expect(emptyRole(page, 'Header')).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
  });
});

test.describe('Chip selection & deletion', () => {
  test('dropping auto-selects the element and populates the property inspector', async ({ page }) => {
    await gotoApp(page);
    // Before any element exists the inspector shows its empty placeholder.
    await expect(page.locator('pld-sidebar-right .empty')).toBeVisible();

    await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));

    // addElement() selects the new element, so the inspector is populated
    // immediately on drop — no extra click needed.
    await expect(page.locator('pld-sidebar-right .empty')).toBeHidden();
    await expect(page.locator('pld-sidebar-right label', { hasText: 'Name' })).toBeVisible();
  });

  test('clicking a chip selects it in the property inspector', async ({ page }) => {
    await gotoApp(page);
    await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
    // Deselect (click a chip re-selects), then confirm click drives selection.
    await chips(page).first().click();
    await expect(chips(page).first()).toHaveClass(/sel/);
    await expect(page.locator('pld-sidebar-right label', { hasText: 'Name' })).toBeVisible();
  });

  test('deletes a chip via its ✕ button', async ({ page }) => {
    await gotoApp(page);
    await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
    await expect(chips(page)).toHaveCount(1);

    await chips(page).first().locator('button.del').click();
    await expect(chips(page)).toHaveCount(0);
  });
});

test.describe('Chip move between cells', () => {
  test('drags a chip from one column to another in the same band', async ({ page }) => {
    await gotoApp(page);
    await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
    const header = band(page, 'Header');

    // Split into two columns, then move the chip from cell 0 → cell 1.
    await header.locator('.cell').first().getByTitle('แยกคอลัมน์').click();
    await expect(header.locator('.cell')).toHaveCount(2);
    await expect(header.locator('.cell').nth(0).locator('.chip')).toHaveCount(1);

    await chips(page).first().dragTo(header.locator('.cell').nth(1));
    await expect(header.locator('.cell').nth(1).locator('.chip')).toHaveCount(1);
    await expect(header.locator('.cell').nth(0).locator('.chip')).toHaveCount(0);
  });
});

test.describe('Row management', () => {
  test('adds and removes a row in a band', async ({ page }) => {
    await gotoApp(page);
    await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
    const header = band(page, 'Header');
    await expect(header.locator('.band-head').first()).toContainText('1 row');

    await header.locator('button', { hasText: '+ row' }).click();
    await expect(header.locator('.band-head').first()).toContainText('2 row');

    // Remove the last row via its rowtools ✕.
    await header.locator('.rowtools button[title="ลบแถว"]').last().click();
    await expect(header.locator('.band-head').first()).toContainText('1 row');
  });
});

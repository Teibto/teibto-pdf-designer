/**
 * E2E — Settings tab: pagination, watermark & copy-set (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { test, expect } from '@playwright/test';
import { gotoApp, leftTab, storeState } from './_helpers';

const panel = (p: import('@playwright/test').Page) => p.locator('pld-pagination-panel');
const field = (p: import('@playwright/test').Page, label: string) =>
  panel(p).locator('.field').filter({ hasText: label });

test.describe('Pagination panel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await leftTab(page, 'ตั้งค่า');
    await expect(panel(page)).toBeVisible();
  });

  test('switches between row-based and height-based modes', async ({ page }) => {
    await expect(field(page, 'Rows per Page')).toBeVisible();
    await panel(page).locator('.mode-btn', { hasText: 'Height-based' }).click();
    await expect(field(page, 'Base Row Height')).toBeVisible();
    await expect(field(page, 'Rows per Page')).toBeHidden();
    const mode = await storeState(page, (s) => s.pagination.mode);
    expect(mode).toBe('height');
  });

  test('edits rows per page', async ({ page }) => {
    await field(page, 'Rows per Page').locator('input').fill('25');
    await field(page, 'Rows per Page').locator('input').blur();
    const n = await storeState(page, (s) => s.pagination.rowsPerPage);
    expect(n).toBe(25);
  });

  test('toggles the continuation-header checkbox', async ({ page }) => {
    const before = await storeState(page, (s) => s.pagination.showContinuationHeader);
    await panel(page).locator('.check-item', { hasText: 'แสดงหัวตารางซ้ำ' }).locator('input').click();
    const after = await storeState(page, (s) => s.pagination.showContinuationHeader);
    expect(after).toBe(!before);
  });

  test('sets a watermark', async ({ page }) => {
    await field(page, 'ลายน้ำ').locator('input').fill('สำเนา');
    await field(page, 'ลายน้ำ').locator('input').blur();
    const wm = await storeState(page, (s) => s.page.watermarkText);
    expect(wm).toBe('สำเนา');
  });

  test('adds, edits and removes a copy set (#92)', async ({ page }) => {
    // First add seeds the engine default: ต้นฉบับ + สำเนา (two rows).
    await panel(page).locator('.mode-btn', { hasText: 'เพิ่มสำเนา' }).click();
    const seeded = await storeState(page, (s) => s.copies?.length ?? 0);
    expect(seeded).toBe(2);

    await panel(page).locator('input[placeholder*="ป้ายไทย"]').first().fill('ต้นฉบับ (ลูกค้า)');
    await panel(page).locator('input[placeholder*="ป้ายไทย"]').first().blur();
    const firstTh = await storeState(page, (s) => s.copies[0].th);
    expect(firstTh).toBe('ต้นฉบับ (ลูกค้า)');

    await panel(page).locator('.mode-btn[title="Remove copy"]').first().click();
    const after = await storeState(page, (s) => s.copies?.length ?? 0);
    expect(after).toBe(1);
  });

  test('expands the collapsible advanced sections and sets header mode', async ({ page }) => {
    await panel(page).locator('.section-header', { hasText: 'Page Breaks' }).click();
    const headerMode = field(page, 'Header Mode').locator('select');
    await expect(headerMode).toBeVisible();
    await headerMode.selectOption('firstOnly');
    const mode = await storeState(page, (s) => s.pagination.headerMode);
    expect(mode).toBe('firstOnly');
  });

  test('parses force-break row numbers to 0-based (#84)', async ({ page }) => {
    await panel(page).locator('.section-header', { hasText: 'Page Breaks' }).click();
    const input = field(page, 'Force Break Before Row').locator('input');
    await input.fill('5, 15');
    await input.blur();
    const rows = await storeState(page, (s) => s.pagination.forceBreakBeforeRows);
    expect(rows).toEqual([4, 14]);
  });
});

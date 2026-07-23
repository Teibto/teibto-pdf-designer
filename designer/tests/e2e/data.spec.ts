/**
 * E2E — Data tab: JSON editor + visual data form (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { test, expect } from '@playwright/test';
import { gotoApp, leftTab, storeState } from './_helpers';

const editor = (p: import('@playwright/test').Page) => p.locator('pld-json-editor');

test.describe('Data tab — JSON editor', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await leftTab(page, 'ข้อมูล');
    await expect(editor(page)).toBeVisible();
  });

  test('loads sample data and shows the key count', async ({ page }) => {
    await editor(page).locator('.small-btn', { hasText: 'ตัวอย่าง' }).click();
    await expect(editor(page).locator('.badge.keys')).toBeVisible();
    // data-form renders raw keys (lowercase); CSS only capitalizes them visually.
    await expect(page.locator('pld-data-form')).toContainText('company');
    const keys = await storeState(page, (s) => s.jsonKeys.length);
    expect(keys).toBeGreaterThan(0);
  });

  test('toggles between Form and JSON views and validates JSON', async ({ page }) => {
    await editor(page).locator('.small-btn', { hasText: 'ตัวอย่าง' }).click();
    await editor(page).locator('.view-btn', { hasText: 'JSON' }).click();
    await expect(editor(page).locator('.badge.valid')).toBeVisible();
    // textarea content lives in .value, not textContent.
    await expect(editor(page).locator('textarea')).toHaveValue(/company/);
  });

  test('flags invalid JSON and blocks switching to Form', async ({ page }) => {
    await editor(page).locator('.view-btn', { hasText: 'JSON' }).click();
    await editor(page).locator('textarea').fill('{ not valid json ');
    await expect(editor(page).locator('.badge.invalid')).toBeVisible();

    await editor(page).locator('.view-btn', { hasText: 'Form' }).click();
    await expect(page.locator('pld-toast')).toContainText('Fix JSON errors');
    await expect(editor(page).locator('.view-btn', { hasText: 'JSON' })).toHaveClass(/active/);
  });

  test('clears loaded data', async ({ page }) => {
    await editor(page).locator('.small-btn', { hasText: 'ตัวอย่าง' }).click();
    await expect(editor(page).locator('.badge.keys')).toBeVisible();
    await editor(page).locator('.small-btn[title="Clear"]').click();
    await expect(editor(page).locator('.badge.keys')).toBeHidden();
    const data = await storeState(page, (s) => s.jsonData);
    expect(data).toBeNull();
  });
});

test.describe('Data tab — visual form', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await leftTab(page, 'ข้อมูล');
    await editor(page).locator('.small-btn', { hasText: 'ตัวอย่าง' }).click();
    await expect(page.locator('pld-data-form')).toContainText('items');
  });

  test('adds and removes an array row', async ({ page }) => {
    const before = await storeState(page, (s) => (s.jsonData.items as unknown[]).length);

    await page.locator('pld-data-form .small-btn', { hasText: 'Add Row' }).click();
    const added = await storeState(page, (s) => (s.jsonData.items as unknown[]).length);
    expect(added).toBe(before + 1);

    await page.locator('pld-data-form .del-btn').last().click();
    const removed = await storeState(page, (s) => (s.jsonData.items as unknown[]).length);
    expect(removed).toBe(before);
  });
});

/**
 * E2E — Keyboard-shortcut cheatsheet (#124)
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from './_helpers';

const sheet = (p: import('@playwright/test').Page) => p.locator('pld-shortcuts-modal');

test.describe('Shortcuts cheatsheet', () => {
  test('press ? opens the cheatsheet, Esc closes it', async ({ page }) => {
    await gotoApp(page);
    // Closed by default: pld-modal renders nothing, so no backdrop exists.
    await expect(sheet(page).locator('.backdrop')).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(sheet(page).locator('.card')).toBeVisible();
    // A couple of real shortcuts are listed.
    await expect(sheet(page).getByText('ทำสำเนา')).toBeVisible();
    await expect(sheet(page).getByText('ย้อนกลับ (Undo)')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet(page).locator('.backdrop')).toHaveCount(0);
  });

  test('? toggles the cheatsheet closed again', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('?');
    await expect(sheet(page).locator('.card')).toBeVisible();
    await page.keyboard.press('?');
    await expect(sheet(page).locator('.backdrop')).toHaveCount(0);
  });

  test('the header ⌨ button opens the cheatsheet', async ({ page }) => {
    await gotoApp(page);
    await page.locator('pld-header button[title*="คีย์ลัด"]').click();
    await expect(sheet(page).locator('.card')).toBeVisible();
  });
});

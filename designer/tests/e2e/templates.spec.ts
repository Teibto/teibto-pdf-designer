/**
 * E2E — Template save / load / manager (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, loadSample, headerBtn, toast } from './_helpers';

const badge = 'pld-template-bar .badge';

test.describe('Save', () => {
  test.beforeEach(async ({ page }) => gotoApp(page));

  test('saves via the 💾 บันทึก button (exactly once — #131)', async ({ page }) => {
    // Regression for #131: the header event is now handled by a single window
    // listener, so one click produces exactly one save toast (previously two:
    // app-shell listened on both `this` and `window`).
    await headerBtn(page, 'บันทึก').click();
    await expect(toast(page, 'saved')).toHaveCount(1);
    await expect(page.locator(badge)).toHaveText(/Saved/);
  });

  test('saves via Ctrl+S', async ({ page }) => {
    await loadSample(page);
    await expect(page.locator(badge)).toHaveText(/Unsaved/);
    await page.keyboard.press('Control+s');
    await expect(toast(page, 'saved')).toHaveCount(1);
    await expect(page.locator(badge)).toHaveText(/Saved/);
  });
});

test.describe('Dirty state', () => {
  test('loading a sample marks the template unsaved', async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);
    await expect(page.locator(badge)).toHaveText(/Unsaved/);
  });
});

test.describe('Template manager', () => {
  test('opens and closes the manager modal', async ({ page }) => {
    await gotoApp(page);
    await headerBtn(page, 'เทมเพลต').click();

    const modal = page.locator('pld-template-manager-modal');
    await expect(modal.getByText('Template Manager')).toBeVisible();
    await modal.locator('.close-btn').click();
    await expect(modal.getByText('Template Manager')).toBeHidden();
  });
});

test.describe('Template name', () => {
  test('edits the template name in the template bar', async ({ page }) => {
    await gotoApp(page);
    const input = page.locator('pld-template-bar input');
    await input.fill('My Invoice Template');
    await input.blur();
    await expect(input).toHaveValue('My Invoice Template');
  });
});

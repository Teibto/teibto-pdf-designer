/**
 * E2E — Table column config & Layers panel (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, loadSample, band } from './_helpers';

test.describe('Table column configuration', () => {
  test('opens the column config modal from the Table band head', async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    // The sample's Table band exposes a ⚙ คอลัมน์ shortcut (#119).
    await band(page, 'Table').locator('button', { hasText: 'คอลัมน์' }).click();

    const modal = page.locator('pld-column-config-modal');
    await expect(modal.getByText('Table Column Configuration')).toBeVisible();

    await modal.locator('.close-btn').click();
    await expect(modal.getByText('Table Column Configuration')).toBeHidden();
  });
});

test.describe('Layers panel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);
    await page.locator('pld-sidebar-left .tab', { hasText: 'เลเยอร์' }).click();
    await expect(page.locator('pld-layers-panel')).toBeVisible();
  });

  test('lists a layer per element', async ({ page }) => {
    const items = page.locator('pld-layers-panel .layer-item');
    expect(await items.count()).toBeGreaterThan(3);
  });

  test('selecting a layer populates the property inspector', async ({ page }) => {
    await page.locator('pld-layers-panel .layer-item').first().click();
    await expect(page.locator('pld-layers-panel .layer-item.selected')).toHaveCount(1);
    await expect(page.locator('pld-sidebar-right .empty')).toBeHidden();
  });

  test('toggles element visibility', async ({ page }) => {
    const first = page.locator('pld-layers-panel .layer-item').first();
    await first.click();
    await first.locator('.action-btn[title="ซ่อน (Hide)"]').click();
    await expect(first).toHaveClass(/hidden-el/);
    await first.locator('.action-btn[title="แสดง (Show)"]').click();
    await expect(first).not.toHaveClass(/hidden-el/);
  });

  test('toggles element lock', async ({ page }) => {
    const first = page.locator('pld-layers-panel .layer-item').first();
    await first.click();
    await first.locator('.action-btn[title="ล็อก (Lock)"]').click();
    await expect(first).toHaveClass(/locked/);
    await first.locator('.action-btn[title="ปลดล็อก (Unlock)"]').click();
    await expect(first).not.toHaveClass(/locked/);
  });

  test('renames a layer via double-click', async ({ page }) => {
    const first = page.locator('pld-layers-panel .layer-item').first();
    await first.dblclick();
    const input = first.locator('.edit-input');
    await expect(input).toBeVisible();
    await input.fill('Renamed Layer');
    await input.press('Enter');
    await expect(first.locator('.layer-name')).toHaveText('Renamed Layer');
  });
});

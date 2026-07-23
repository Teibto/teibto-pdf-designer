/**
 * E2E — Table column configuration modal, full CRUD (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { test, expect } from '@playwright/test';
import { gotoApp, loadSample, band, storeState } from './_helpers';

const modal = (p: import('@playwright/test').Page) => p.locator('pld-column-config-modal');

/** Open the column config from the sample's Table band shortcut (#119). */
async function openConfig(page: import('@playwright/test').Page) {
  await gotoApp(page);
  await loadSample(page);
  await band(page, 'Table').locator('button', { hasText: 'คอลัมน์' }).click();
  await expect(modal(page).getByText('Table Column Configuration')).toBeVisible();
}

/** Columns of the table the modal is editing (the selected element) — the sample
 *  carries more than one table, so "first table" would read the wrong one. */
const tableCols = (p: import('@playwright/test').Page) =>
  storeState(p, (s) => {
    const t = s.elements.find((e: any) => e.id === s.selectedId && e.type === 'table');
    return t ? t.columns.length : -1;
  });

test.describe('Column config modal', () => {
  test('lists the existing columns', async ({ page }) => {
    await openConfig(page);
    await expect(modal(page).locator('.col-item').first()).toBeVisible();
    await expect(modal(page).locator('.col-list-header h3')).toContainText('Columns (');
  });

  test('adds a column and Apply persists it to the table', async ({ page }) => {
    await openConfig(page);
    const before = await tableCols(page);
    const listed = await modal(page).locator('.col-item').count();

    await modal(page).locator('.add-col-btn', { hasText: 'เพิ่มคอลัมน์' }).click();
    await expect(modal(page).locator('.col-item')).toHaveCount(listed + 1);

    await modal(page).locator('.btn-primary', { hasText: 'Apply' }).click();
    await expect(page.locator('pld-toast')).toContainText('Updated');
    expect(await tableCols(page)).toBe(before + 1);
  });

  test('edits a column label', async ({ page }) => {
    await openConfig(page);
    await modal(page).locator('.col-item').first().click();
    const labelInput = modal(page).locator('.prop-field').filter({ hasText: 'Label' }).locator('input');
    await labelInput.fill('รายการสินค้า');
    await labelInput.blur();
    await expect(modal(page).locator('.col-item').first()).toContainText('รายการสินค้า');
  });

  test('removes a column', async ({ page }) => {
    await openConfig(page);
    const listed = await modal(page).locator('.col-item').count();
    await modal(page).locator('.col-item').first().click();
    await modal(page).locator('.btn-danger', { hasText: 'Remove Column' }).click();
    await expect(modal(page).locator('.col-item')).toHaveCount(listed - 1);
  });

  test('opens presets and applies one', async ({ page }) => {
    await openConfig(page);
    await modal(page).locator('.btn', { hasText: 'Presets' }).click();
    await expect(modal(page).locator('.preset-card').first()).toBeVisible();
    // The preset card lives two shadow roots deep; Playwright's hit test resolves
    // the point to the <pld-modal> host and won't deliver the click. Fire the
    // element's own click() so its Lit @click handler runs.
    await page.evaluate(() => {
      const shell = document.querySelector('pld-app-shell') as any;
      const m = shell.shadowRoot.querySelector('pld-column-config-modal') as any;
      (m.shadowRoot.querySelector('.preset-card') as HTMLElement).click();
    });
    await expect(page.locator('pld-toast')).toContainText('Applied preset');
    await expect(modal(page).locator('.col-item').first()).toBeVisible();
  });

  test('cancel discards in-modal edits', async ({ page }) => {
    await openConfig(page);
    const before = await tableCols(page);
    await modal(page).locator('.add-col-btn', { hasText: 'เพิ่มคอลัมน์' }).click();
    await modal(page).locator('.btn', { hasText: 'Cancel' }).click();
    await expect(modal(page).getByText('Table Column Configuration')).toBeHidden();
    expect(await tableCols(page)).toBe(before);
  });
});

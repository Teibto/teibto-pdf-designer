/**
 * E2E — Flow map (ผังข้อมูล) data-binding view (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { test, expect } from '@playwright/test';
import { gotoApp, loadSample, headerBtn, openHeaderMore, toast } from './_helpers';

const flow = (p: import('@playwright/test').Page) => p.locator('pld-flow-view');

test.describe('Flow map', () => {
  test('shows an empty state on a blank template', async ({ page }) => {
    await gotoApp(page);
    await headerBtn(page, 'ผังข้อมูล').click();
    await expect(flow(page)).toContainText('No data bindings yet');
  });

  // Regression for #130: flow-view now seeds elements/jsonKeys from the store in
  // connectedCallback, so opening it AFTER data is loaded shows the map at once.
  test('maps JSON keys to bound elements after loading a sample', async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);
    await headerBtn(page, 'ผังข้อมูล').click();

    await expect(flow(page).locator('.column-header', { hasText: 'ฟิลด์ข้อมูล' })).toBeVisible();
    await expect(flow(page).locator('.flow-node-sub').filter({ hasText: '{{' }).first()).toBeVisible();
  });

  test('renders the binding map when data loads while the flow view is open', async ({ page }) => {
    await gotoApp(page);
    await headerBtn(page, 'ผังข้อมูล').click();
    // Load the sample from within flow view (chips are hidden here, so we can't
    // use the chip-waiting loadSample helper). The state-changed event fires
    // while flow-view is mounted, so its listener populates the map.
    await openHeaderMore(page);
    await headerBtn(page, 'ตัวอย่าง').click();
    await expect(toast(page, 'โหลดตัวอย่างแล้ว')).toBeVisible();
    await expect(flow(page).locator('.column-header', { hasText: 'ฟิลด์ข้อมูล' })).toBeVisible();
    await expect(flow(page).locator('.flow-node-sub').filter({ hasText: '{{' }).first()).toBeVisible();
  });
});

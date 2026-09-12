/**
 * E2E — App shell & global chrome (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, headerBtn } from './_helpers';

test.describe('App shell', () => {
  test.beforeEach(async ({ page }) => gotoApp(page));

  test('loads with the expected title', async ({ page }) => {
    await expect(page).toHaveTitle(/PDF Layout/i);
  });

  test('renders header, template bar, both sidebars and the band view', async ({ page }) => {
    await expect(page.locator('pld-header')).toBeVisible();
    await expect(page.locator('pld-template-bar')).toBeVisible();
    await expect(page.locator('pld-sidebar-left')).toBeVisible();
    await expect(page.locator('pld-band-view')).toBeVisible();
    await expect(page.locator('pld-sidebar-right')).toBeVisible();
  });

  test('band view shows all six role slots on a blank template', async ({ page }) => {
    for (const role of ['Header', 'Content', 'Table', 'Summary', 'Footer', 'Watermark']) {
      await expect(
        page.locator('pld-band-view .empty-slot').filter({ hasText: role }),
      ).toBeVisible();
    }
  });
});

test.describe('View switcher', () => {
  test.beforeEach(async ({ page }) => gotoApp(page));

  test('switches between ออกแบบ (design) and ผังข้อมูล (flow)', async ({ page }) => {
    await expect(page.locator('pld-band-view')).toBeVisible();

    await headerBtn(page, 'ผังข้อมูล').click();
    await expect(page.locator('pld-flow-view')).toBeVisible();

    await headerBtn(page, 'ออกแบบ').click();
    await expect(page.locator('pld-band-view')).toBeVisible();
  });
});

test.describe('Theme toggle', () => {
  test('flips dark ↔ light and persists on the document element', async ({ page }) => {
    await gotoApp(page);

    // Oracle Redwood is light by default → button offers the optional dark theme.
    const btn = headerBtn(page, 'Dark');
    await expect(btn).toBeVisible();

    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(headerBtn(page, 'Light')).toBeVisible();

    await headerBtn(page, 'Light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(headerBtn(page, 'Dark')).toBeVisible();
  });
});

test.describe('Page settings', () => {
  test.beforeEach(async ({ page }) => gotoApp(page));

  test('changes page size', async ({ page }) => {
    const letter = page.locator('pld-sidebar-left .page-size-btn', { hasText: 'Letter' });
    await letter.click();
    await expect(letter).toHaveClass(/active/);
  });

  test('changes orientation', async ({ page }) => {
    const landscape = page.locator('pld-sidebar-left .page-size-btn', { hasText: 'แนวนอน' });
    await landscape.click();
    await expect(landscape).toHaveClass(/active/);
  });
});

test.describe('Left sidebar tabs', () => {
  test('switches Elements → Layers → Data → Settings', async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.locator('pld-sidebar-left');

    await sidebar.locator('.tab', { hasText: 'เลเยอร์' }).click();
    await expect(page.locator('pld-layers-panel')).toBeVisible();

    await sidebar.locator('.tab', { hasText: 'ข้อมูล' }).click();
    await expect(page.locator('pld-json-editor')).toBeVisible();

    await sidebar.locator('.tab', { hasText: 'ตั้งค่า' }).click();
    await expect(page.locator('pld-pagination-panel')).toBeVisible();

    await sidebar.locator('.tab', { hasText: 'องค์ประกอบ' }).click();
    await expect(sidebar.locator('.element-grid')).toBeVisible();
  });
});

test.describe('Responsive Redwood workspace', () => {
  test('turns both sidebars into mutually exclusive drawers', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await gotoApp(page);

    const leftPanel = page.locator('.workspace-panel.left');
    const rightPanel = page.locator('.workspace-panel.right');
    await expect(leftPanel).not.toHaveClass(/open/);
    await expect(rightPanel).not.toHaveClass(/open/);

    await page.getByRole('button', { name: 'เปิดเครื่องมือ' }).click();
    await expect(leftPanel).toHaveClass(/open/);
    await expect(page.getByRole('button', { name: 'ปิดแผงด้านข้าง' })).toBeVisible();

    await page.getByRole('button', { name: 'เปิดคุณสมบัติ' }).click();
    await expect(leftPanel).not.toHaveClass(/open/);
    await expect(rightPanel).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect(rightPanel).not.toHaveClass(/open/);
  });

  test('keeps the workspace within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page);
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport);
  });
});

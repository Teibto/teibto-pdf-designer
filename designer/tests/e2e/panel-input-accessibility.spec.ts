/**
 * Native keyboard activation and panel input containment.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from './_helpers';

test('JSON editor has an associated label and keyboard-operable expansion without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await page.getByRole('tab', { name: 'ข้อมูล', exact: true }).click();
  await page.locator('pld-json-editor').getByRole('button', { name: 'JSON', exact: true }).click();
  const textarea = page.getByLabel('ข้อมูล JSON (JSON data)', { exact: true });
  await expect(textarea).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Expand', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Collapse', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(textarea).toHaveCSS('min-height', '300px');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const contained = await textarea.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const host = element.getRootNode() as ShadowRoot;
    const parent = host.host.getBoundingClientRect();
    return box.left >= parent.left && box.right <= parent.right;
  });
  expect(contained).toBe(true);
});

test('layer rename input fits its information column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await page.getByRole('button', { name: 'เพิ่ม Text ใน เนื้อหา', exact: true }).click();
  await page.getByRole('tab', { name: 'เลเยอร์', exact: true }).click();
  await page.locator('pld-layers-panel .layer-select').dblclick();
  const input = page.getByRole('textbox', { name: 'ชื่อเลเยอร์', exact: true });
  await expect(input).toBeVisible();
  expect(await input.evaluate(element => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return box.left >= parent.left && box.right <= parent.right;
  })).toBe(true);
});

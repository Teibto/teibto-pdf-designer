/**
 * Explicit rebuild consent protects custom band layout.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from './_helpers';

test('rebuild Cancel preserves edits and confirmed reset can be undone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  const addText = page.getByRole('button', { name: 'เพิ่ม Text ใน content', exact: true });
  await addText.click();
  await addText.click();
  await page.locator('pld-band-view').getByTitle('แยกคอลัมน์', { exact: true }).first().click();
  await page.locator('pld-band-view').getByTitle('ลดความกว้าง 5%', { exact: true }).first().click();
  await page.locator('pld-band-view').getByTitle('เลื่อนขึ้น', { exact: true }).last().click();
  const snapshot = () => page.locator('pld-app-shell').evaluate((s: any) => s.store.state.bands);
  const before = await snapshot();
  const rebuild = page.getByRole('button', { name: 'สร้างโครงหน้าใหม่ · Rebuild layout', exact: true });
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Undo'); await dialog.dismiss(); });
  await rebuild.click();
  expect(await snapshot()).toEqual(before);
  page.once('dialog', dialog => dialog.accept());
  await rebuild.click();
  expect(await snapshot()).not.toEqual(before);
  await expect(page.locator('pld-band-view .chip')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  expect(await snapshot()).toEqual(before);
  await expect(page.locator('pld-band-view .empty-slot').first()).toHaveCSS('opacity', '1');
});

/**
 * Keyboard and computed-style coverage for owned Redwood chrome.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from './_helpers';

test('inspector labels route edits and font/icon styles resolve in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page);
  await page.getByRole('button', { name: 'เพิ่ม Text ใน content', exact: true }).click();
  const inspector = page.locator('pld-sidebar-right');
  const name = inspector.getByLabel('ชื่อ (Name)', { exact: true });
  await name.fill('Readable Thai ไทย');
  await name.press('Tab');
  await expect(page.locator('pld-band-view .chip')).toContainText('Readable Thai ไทย');
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const styles = await name.evaluate(el => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      height: el.getBoundingClientRect().height,
      color: getComputedStyle(el).color,
      expectedColor: getComputedStyle(document.documentElement).getPropertyValue('--c-text').trim(),
    }));
    expect(styles.size).toBeGreaterThanOrEqual(12);
    expect(styles.height).toBeGreaterThanOrEqual(32);
    expect(styles.color).toBe(theme === 'light' ? 'rgb(22, 21, 19)' : 'rgb(245, 244, 242)');
    const svg = inspector.locator('button svg').first();
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(await svg.evaluate(el => el.getBoundingClientRect().width)).toBe(18);
  }
  const fonts = await page.evaluate(async () => {
    const loaded = await Promise.all([400, 600, 700].map(weight =>
      document.fonts.load(`${weight} 14px "PLD UI Sans"`, 'Readable ไทย')));
    return loaded.flat().map(face => ({ family: face.family, status: face.status }));
  });
  expect(fonts).toHaveLength(6);
  expect(fonts.every(face => face.family === 'PLD UI Sans' && face.status === 'loaded')).toBe(true);
});

test('pagination disclosures work by keyboard and copy labels remain unique after edits', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await page.getByRole('tab', { name: 'ตั้งค่า', exact: true }).click();
  const pagination = page.locator('pld-pagination-panel');
  const breaks = pagination.getByRole('button', { name: 'จุดแบ่งหน้า', exact: true });
  await breaks.focus(); await page.keyboard.press('Enter');
  await expect(breaks).toHaveAttribute('aria-expanded', 'true');
  await expect(pagination.getByLabel('ฟิลด์จัดกลุ่มไม่ให้แยกหน้า')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(pagination.getByLabel('ฟิลด์จัดกลุ่มไม่ให้แยกหน้า')).toBeHidden();
  await pagination.getByRole('button', { name: '+ เพิ่มสำเนา', exact: true }).click();
  await pagination.getByLabel('สำเนา 2 (ไทย)', { exact: true }).fill('สำเนาฝ่ายบัญชี');
  await page.keyboard.press('Tab');
  await pagination.getByRole('button', { name: 'ลบสำเนา 1', exact: true }).click();
  await expect(pagination.getByLabel('สำเนา 1 (ไทย)', { exact: true })).toHaveValue('สำเนาฝ่ายบัญชี');
  const overflow = await pagination.evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);
});

test('layers select, rename, visibility and document order are keyboard operable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page);
  const add = page.getByRole('button', { name: 'เพิ่ม Text ใน content', exact: true });
  await add.click(); await add.click();
  await page.getByRole('tab', { name: 'เลเยอร์', exact: true }).click();
  const layers = page.locator('pld-layers-panel');
  const second = layers.locator('.layer-select').nth(1);
  await second.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('F2');
  await layers.getByLabel('ชื่อเลเยอร์', { exact: true }).fill('Layer renamed');
  await page.keyboard.press('Enter');
  const renamed = layers.getByRole('button', { name: 'Layer renamed', exact: true });
  await renamed.focus(); await page.keyboard.press('Alt+ArrowUp');
  await expect(layers.locator('.layer-select').first()).toHaveText('Layer renamed');
  await expect(renamed).toBeFocused();
  const bandNames = await page.locator('pld-band-view .chip-select').allTextContents();
  expect(bandNames[0]).toContain('Layer renamed');
  await layers.getByRole('button', { name: 'Hide Layer renamed', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(layers.getByRole('button', { name: 'Show Layer renamed', exact: true })).toHaveAttribute('aria-pressed', 'true');
});


test('height pagination exposes its padding count without switching mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await page.getByRole('tab', { name: 'ตั้งค่า', exact: true }).click();
  const pagination = page.locator('pld-pagination-panel');
  const height = pagination.getByRole('button', { name: 'ตามความสูง', exact: true });
  await height.focus(); await page.keyboard.press('Enter');
  const fill = pagination.getByRole('checkbox', { name: 'เติมแถวว่างให้เต็มหน้า (summary อยู่ตำแหน่งคงที่)', exact: true });
  if (!(await fill.isChecked())) {
    await fill.focus(); await page.keyboard.press('Space');
  }
  const count = pagination.getByLabel('จำนวนแถวสำหรับเติมแถวว่าง', { exact: true });
  await expect(count).toBeVisible();
  await expect(pagination.locator('#pagination-fill-row-help')).toContainText('อาจดันส่วนสรุปไปหน้าใหม่');
  await count.focus(); await page.keyboard.press('Control+A'); await page.keyboard.type('7');
  await page.keyboard.press('Tab');
  await expect(height).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('pld-app-shell').evaluate((shell: any) => ({
    mode: shell.store.state.pagination.mode, rows: shell.store.state.pagination.rowsPerPage,
  }))).toEqual({ mode: 'height', rows: 7 });
  await fill.focus(); await page.keyboard.press('Space');
  await expect(count).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(count).toHaveValue('7');
  await pagination.getByRole('button', { name: 'ตามจำนวนแถว', exact: true }).click();
  await expect(count).toHaveCount(0);
  await expect(pagination.getByLabel('จำนวนแถวต่อหน้า', { exact: true })).toHaveValue('7');
});


test('import errors remain inside the modal and hovered primary controls retain contrast', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await page.getByRole('button', { name: 'เทมเพลต', exact: true }).click();
  const manager = page.locator('pld-template-manager-modal');
  await manager.getByRole('tab', { name: 'Import / Export', exact: true }).click();
  const input = manager.getByLabel('Template JSON / JSON เทมเพลต', { exact: true });
  await input.fill('{');
  const submit = manager.getByRole('button', { name: 'Import JSON', exact: true });
  await submit.click();
  const alert = manager.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Invalid JSON');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await submit.hover();
  await expect.poll(() => submit.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })))
    .toEqual({ background: 'rgb(50, 92, 114)', color: 'rgb(255, 255, 255)' });
  const body = manager.locator('pld-modal .body');
  expect(await body.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await input.fill('{}');
  await expect(alert).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-invalid', 'false');
});

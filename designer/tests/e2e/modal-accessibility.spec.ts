/**
 * Shared modal keyboard and top-layer behavior in a real browser (#199).
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from './_helpers';

async function fixture(page: Page) {
  await gotoApp(page);
  await page.evaluate(async () => {
    document.querySelector('pld-app-shell')?.remove();
    const opener = document.createElement('button');
    opener.textContent = 'Open settings';
    document.body.append(opener);
    const modal = document.createElement('pld-modal');
    modal.id = 'settings';
    modal.modalTitle = 'ตั้งค่าเอกสาร';
    const body = document.createElement('div');
    body.slot = 'body';
    body.innerHTML = '<input aria-label="ชื่อเอกสาร" autofocus><button>Next field</button>';
    const shadowField = document.createElement('div');
    shadowField.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Shadow field">';
    body.append(shadowField);
    const footer = document.createElement('div');
    footer.slot = 'footer';
    footer.innerHTML = '<button>Save settings</button>';
    modal.append(body, footer);
    document.body.append(modal);
    modal.addEventListener('close', () => { modal.open = false; });
    opener.addEventListener('click', () => { modal.open = true; });
    await modal.updateComplete;
  });
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'ตั้งค่าเอกสาร' })).toBeVisible();
}

test('named dialog focuses slotted autofocus, traverses shadow content, excludes background and restores opener', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('textbox', { name: 'ชื่อเอกสาร' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Next field' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Shadow field' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeFocused();
  // Native inertness rejects even programmatic attempts to focus the editor.
  await page.getByRole('button', { name: 'Open settings', includeHidden: true }).evaluate((el: HTMLElement) => el.focus());
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Open settings', includeHidden: true })).not.toBeFocused();
  }
  await page.getByRole('button', { name: 'ปิด / Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeFocused();
});

test('Escape closes only the top dialog and restores focus through the stack', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Next field' }).focus();
  await page.evaluate(async () => {
    const nested = document.createElement('pld-modal');
    nested.modalTitle = 'ยืนยัน';
    nested.id = 'confirmation';
    nested.addEventListener('close', () => { nested.open = false; });
    document.body.append(nested);
    nested.open = true;
    await nested.updateComplete;
  });
  await expect(page.getByRole('dialog', { name: 'ยืนยัน' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'ยืนยัน' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'ตั้งค่าเอกสาร' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next field' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeFocused();
});

test('cancel respects a controlled caller that refuses close, and removal releases background', async ({ page }) => {
  await fixture(page);
  await page.evaluate(async () => {
    const modal = document.createElement('pld-modal');
    modal.id = 'busy';
    modal.modalTitle = 'กำลังบันทึก';
    document.body.append(modal);
    modal.open = true;
    await modal.updateComplete;
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'กำลังบันทึก' })).toBeVisible();
  await page.evaluate(() => document.querySelector('#busy')?.remove());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeFocused();
});

test('modal keys do not reach editor shortcuts and a narrow viewport keeps close visible', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await fixture(page);
  await page.evaluate(() => {
    window.addEventListener('keydown', () => document.body.dataset.shortcutReached = 'yes');
  });
  await page.getByRole('textbox', { name: 'ชื่อเอกสาร' }).fill('ใบกำกับภาษี');
  await page.keyboard.press('Control+s');
  expect(await page.evaluate(() => document.body.dataset.shortcutReached)).toBeUndefined();
  const close = page.getByRole('button', { name: 'ปิด / Close' });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeFocused();
});

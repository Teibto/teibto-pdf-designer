/**
 * Save dialog restores keyboard focus after successful save and dismissal.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { test, expect } from '@playwright/test';
import { gotoApp, loadSample } from './_helpers';

for (const entry of ['primary', 'overflow'] as const) {
  for (const exit of ['save', 'cancel', 'escape'] as const) {
    test(`${entry} Save restores its opener after ${exit}`, async ({ page }) => {
      let saves = 0;
      await page.route('**/qa-renderer*', async route => {
        expect(new URL(route.request().url()).searchParams.get('action')).toBe('save');
        expect(route.request().method()).toBe('POST');
        saves++;
        await route.fulfill({ json: { success: true, id: '42' } });
      });
      await page.addInitScript(() => {
        Object.assign(window, {
          __NS_CONTEXT__: { recordType: null, recordId: null, canEditTemplates: true, fontRegularUrl: '/qa-font.ttf' },
          __NS_RENDER_URL__: '/qa-renderer',
        });
      });
      await gotoApp(page);
      await loadSample(page);
      const opener = entry === 'primary'
        ? page.locator('pld-header button.save')
        : page.getByRole('button', { name: 'ตั้งค่าการบันทึก · Save settings' });
      if (entry === 'primary') {
        await opener.focus();
        await page.keyboard.press('Enter');
      } else {
        if (await page.locator('pld-header details').getAttribute('open') === null) {
          await page.locator('pld-header summary[aria-label="การทำงานเพิ่มเติม"]').click();
        }
        await opener.focus();
        await page.keyboard.press('Enter');
      }
      const dialog = page.getByRole('dialog', { name: 'บันทึกเข้า NetSuite' });
      await expect(dialog).toBeVisible();
      if (exit === 'escape') {
        await page.keyboard.press('Escape');
      } else {
        await page.locator('pld-save-ns-modal').getByRole('button', { name: exit === 'save' ? 'บันทึกเข้า NetSuite' : 'ยกเลิก', exact: true }).focus();
        await page.keyboard.press('Enter');
      }
      await expect(dialog).toHaveCount(0);
      await expect(entry === 'primary' ? opener : page.locator('pld-header summary[aria-label="การทำงานเพิ่มเติม"]')).toBeFocused();
      expect(saves).toBe(exit === 'save' ? 1 : 0);
    });
  }
}

/**
 * E2E — Undo / redo (band-model UI, #123)
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { test, expect } from '@playwright/test';
import { gotoApp, seedElement, band, chips } from './_helpers';

/** Blur any focused control so the app-shell keydown handler runs (it ignores
 *  keys while an INPUT/TEXTAREA/SELECT is focused). */
async function blur(page: import('@playwright/test').Page) {
  await page.locator('pld-band-view').click({ position: { x: 5, y: 5 } });
}

test.describe('Undo / redo', () => {
  test('undo reverts a column split; redo re-applies it', async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Text', 'Header');
    const header = band(page, 'Header');

    await header.locator('.cell').first().getByTitle('แยกคอลัมน์').click();
    await expect(header.locator('.cell')).toHaveCount(2);

    await blur(page);
    await page.keyboard.press('Control+z');
    await expect(header.locator('.cell')).toHaveCount(1);

    await page.keyboard.press('Control+y');
    await expect(header.locator('.cell')).toHaveCount(2);
  });

  /**
   * Regression for #129: a single Ctrl+Z right after dropping an element must
   * remove it. The drop path used to issue UNTAGGED `dragType` dispatches
   * (dragstart set it, band-view cleared it) and untagged dispatches count as
   * undoable, so a spurious snapshot of the post-drop state landed on the stack —
   * the first undo restored that identical state (no-op) and a later undo
   * desynced elements vs bands. Fixed by routing `dragType` writes through
   * `setDragType()`, tagged `undoable:false`, so the only undo point is the
   * `addElement` inside the drop. See issue #129.
   */
  test('one undo removes a freshly dropped element', async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Text', 'Header');
    await expect(chips(page)).toHaveCount(1);

    await blur(page);
    await page.keyboard.press('Control+z');
    await expect(chips(page)).toHaveCount(0);
  });
});

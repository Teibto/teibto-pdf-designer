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
   * OPEN BUG #129: a single Ctrl+Z right after dropping an element is a no-op.
   * The drop path issues extra UNTAGGED dispatches — notably
   * `store.dispatch(d => d.dragType = null)` in band-view — and untagged
   * dispatches count as undoable, so a spurious snapshot of the post-drop state
   * lands on top of the history stack. The first undo restores that identical
   * state; worse, a later undo restores elements and bands from different
   * snapshots, desyncing the two. Fix (deferred, architectural): keep transient
   * UI flags like `dragType` out of the undoable state. See issue #129.
   */
  test.fail('one undo removes a freshly dropped element', async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Text', 'Header');
    await expect(chips(page)).toHaveCount(1);

    await blur(page);
    await page.keyboard.press('Control+z');
    await expect(chips(page)).toHaveCount(0);
  });
});

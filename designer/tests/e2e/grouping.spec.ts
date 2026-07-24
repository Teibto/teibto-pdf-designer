/**
 * E2E — Column & row operations in a band (band-model UI, #123)
 *
 * Replaces the retired free-canvas "grouping" suite: the band model expresses
 * layout through columns (split/merge/width) and row order, not x/y groups.
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { test, expect } from '@playwright/test';
import { gotoApp, dragPaletteTo, emptyRole, band } from './_helpers';

/** Seed a Header band holding one Text element (1 row, 1 column). */
async function seedHeader(page: import('@playwright/test').Page) {
  await gotoApp(page);
  await dragPaletteTo(page, 'Text', emptyRole(page, 'Header'));
  await expect(band(page, 'Header')).toBeVisible();
}

test.describe('Column operations', () => {
  test('splits a column into two', async ({ page }) => {
    await seedHeader(page);
    const header = band(page, 'Header');
    await expect(header.locator('.cell')).toHaveCount(1);

    await header.locator('.cell').first().getByTitle('แยกคอลัมน์').click();
    await expect(header.locator('.cell')).toHaveCount(2);
  });

  test('adjusts column width with − / +', async ({ page }) => {
    await seedHeader(page);
    const header = band(page, 'Header');
    await header.locator('.cell').first().getByTitle('แยกคอลัมน์').click();

    const firstCellW = header.locator('.cell').first().locator('.cell-w');
    await expect(firstCellW).toContainText('50%');
    await firstCellW.locator('button').first().click(); // decrease
    await expect(firstCellW).toContainText('45%');
  });

  test('merges a column back into its left neighbour', async ({ page }) => {
    await seedHeader(page);
    const header = band(page, 'Header');
    await header.locator('.cell').first().getByTitle('แยกคอลัมน์').click();
    await expect(header.locator('.cell')).toHaveCount(2);

    await header.locator('.cell').nth(1).getByTitle('รวมกับคอลัมน์ซ้าย').click();
    await expect(header.locator('.cell')).toHaveCount(1);
  });
});

test.describe('Row operations', () => {
  test('adds, reorders and removes rows', async ({ page }) => {
    await seedHeader(page);
    const header = band(page, 'Header');
    const head = header.locator('.band-head').first();

    await header.locator('button', { hasText: '+ row' }).click();
    await expect(head).toContainText('2 row');

    // Reorder: move the first row down, then back up — count stays stable.
    await header.locator('.rowtools button[title="เลื่อนลง"]').first().click();
    await expect(head).toContainText('2 row');
    await header.locator('.rowtools button[title="เลื่อนขึ้น"]').last().click();
    await expect(head).toContainText('2 row');

    await header.locator('.rowtools button[title="ลบแถว"]').last().click();
    await expect(head).toContainText('1 row');
  });
});

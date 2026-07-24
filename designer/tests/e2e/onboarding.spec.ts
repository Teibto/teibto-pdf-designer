/**
 * E2E — Blank-doc onboarding CTA (#124)
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import { test, expect } from '@playwright/test';
import { gotoApp, chips } from './_helpers';

const cta = (p: import('@playwright/test').Page) => p.locator('pld-band-view .cta');

test.describe('Onboarding CTA', () => {
  test('a blank template shows the start CTA', async ({ page }) => {
    await gotoApp(page);
    await expect(cta(page)).toBeVisible();
    await expect(cta(page)).toContainText('เริ่มออกแบบเอกสาร');
  });

  test('CTA "load sample" populates the design and dismisses the CTA', async ({ page }) => {
    await gotoApp(page);
    await cta(page).locator('button.primary').click();
    await expect(chips(page).first()).toBeVisible();
    await expect(cta(page)).toHaveCount(0); // elements > 0 → CTA gone
  });

  test('CTA "start blank" dismisses it while keeping the empty role slots', async ({ page }) => {
    await gotoApp(page);
    await cta(page).getByText('เริ่มจากว่าง').click();
    await expect(cta(page)).toHaveCount(0);
    // Empty role drop-zones remain usable.
    await expect(page.locator('pld-band-view .empty-slot').first()).toBeVisible();
  });
});

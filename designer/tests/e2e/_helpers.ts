/**
 * E2E shared helpers — band-model editor (#123)
 *
 * The old suite drove a free-canvas x/y model that no longer exists after the
 * band-based cutover (#13/#107). These helpers target the current UI:
 * band-view (bands → rows → columns → element chips), Thai header buttons,
 * and the shared modal/toast primitives. Locators pierce open shadow DOM,
 * which every Lit component here uses.
 *
 * @author Wichit Wongta
 * @since 2026-07-22
 */
import { type Page, type Locator, expect } from '@playwright/test';

/** Load the app and wait until the band editor is on screen. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('pld-app-shell');
  await page.waitForSelector('pld-band-view');
}

/** A header action button, matched by its (Thai) visible label fragment. */
export function headerBtn(page: Page, label: string): Locator {
  return page.locator('pld-header button:visible', { hasText: label });
}

/** Open the Redwood top-bar overflow menu for secondary actions. */
export async function openHeaderMore(page: Page): Promise<void> {
  const disclosure = page.locator('pld-header summary[aria-label="การทำงานเพิ่มเติม"]');
  const details = page.locator('pld-header details');
  if (!(await details.getAttribute('open'))) await disclosure.click();
}

/** The most recent toast, by text fragment. */
export function toast(page: Page, text: string): Locator {
  return page.locator('pld-toast .toast', { hasText: text });
}

/** A palette element tile in the left sidebar (English label: Text, Table, …). */
export function paletteItem(page: Page, label: string): Locator {
  return page.locator('pld-sidebar-left .element-item').filter({ hasText: label });
}

/** An empty role drop-zone in band-view (role label: Header, Content, …). */
export function emptyRole(page: Page, roleLabel: string): Locator {
  return page.locator('pld-band-view .empty-slot').filter({ hasText: roleLabel });
}

/** A populated band by role label. */
export function band(page: Page, roleLabel: string): Locator {
  return page
    .locator('pld-band-view .band:not(.empty-slot)')
    .filter({ hasText: roleLabel });
}

/** All element chips currently rendered in band-view. */
export function chips(page: Page): Locator {
  return page.locator('pld-band-view .chip');
}

/**
 * Load the built-in sample (Invoice) via the header ★ ตัวอย่าง button and wait
 * for its bands to render. Sample carries a full band structure.
 */
export async function loadSample(page: Page): Promise<void> {
  await openHeaderMore(page);
  await headerBtn(page, 'ตัวอย่าง').click();
  await expect(toast(page, 'Loaded sample')).toBeVisible();
  await expect(chips(page).first()).toBeVisible();
}

/**
 * Drag a palette element onto a target cell/slot. HTML5 DnD: the palette
 * dragstart sets store.dragType, band-view dragover/drop consume it. Playwright's
 * dragTo dispatches the real dragstart/dragover/drop sequence.
 */
export async function dragPaletteTo(
  page: Page,
  paletteLabel: string,
  target: Locator,
): Promise<void> {
  await paletteItem(page, paletteLabel).dragTo(target);
}

/** Open the ▶ พรีวิว modal and wait for it. */
export async function openPreview(page: Page): Promise<Locator> {
  await headerBtn(page, 'พรีวิว').click();
  const modal = page.locator('pld-preview-modal');
  await expect(modal.getByText('PDF Preview')).toBeVisible();
  return modal;
}

/** The right-hand property inspector. */
export function inspector(page: Page): Locator {
  return page.locator('pld-sidebar-right');
}

/** An inspector field (label + control) matched by its label fragment. */
export function inspectorField(page: Page, label: string): Locator {
  return inspector(page).locator('.field').filter({ hasText: label });
}

/** Drop a palette element into an empty role and return once its band renders. */
export async function seedElement(
  page: Page,
  paletteLabel: string,
  roleLabel: string,
): Promise<void> {
  await dragPaletteTo(page, paletteLabel, emptyRole(page, roleLabel));
  await expect(band(page, roleLabel)).toBeVisible();
}

/** Switch the left sidebar to a tab by its (Thai) label. */
export async function leftTab(page: Page, label: string): Promise<void> {
  await page.locator('pld-sidebar-left .tab').filter({ hasText: label }).click();
}

/** Read a slice of the live store state from the app-shell (source of truth). */
export function storeState<T>(page: Page, pick: (s: any) => T): Promise<T> {
  return page.evaluate(
    ([fn]) => {
      const shell = document.querySelector('pld-app-shell') as any;
      // eslint-disable-next-line no-new-func
      return new Function('s', `return (${fn})(s);`)(shell?.store?.state);
    },
    [pick.toString()] as const,
  );
}

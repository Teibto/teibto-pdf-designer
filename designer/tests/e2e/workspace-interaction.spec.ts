/**
 * Responsive workspace and keyboard insertion journeys.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from './_helpers';

for (const width of [860, 861, 1023, 1024]) {
  test(`workspace rails and drawer focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page);
    const tools = page.getByRole('button', { name: 'เปิดเครื่องมือ (Open tools)', exact: true });
    const panel = page.locator('#tools-panel');
    if (width === 1024) {
      await expect(tools).toBeHidden();
      await expect(panel).not.toHaveAttribute('inert');
      await expect(page.getByRole('button', { name: 'เพิ่ม Text ใน เนื้อหา', exact: true })).toBeVisible();
      return;
    }
    await expect(tools).toBeVisible();
    await expect(panel).toHaveAttribute('inert');
    await tools.focus();
    await page.keyboard.press('Enter');
    await expect(tools).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeFocused();
    await expect(panel).not.toHaveAttribute('inert');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: 'องค์ประกอบ', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tools).toBeFocused();
    await expect(panel).toHaveAttribute('inert');
    await expect(tools).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'เปิดคุณสมบัติ (Open properties)', exact: true }).click();
    await expect(panel).toHaveAttribute('inert');
    await expect(page.locator('#properties-panel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'เปิดคุณสมบัติ (Open properties)', exact: true })).toBeFocused();
  });
}

test('keyboard tabs, explicit insertion destination and undo preserve band semantics', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  const firstTab = page.getByRole('tab', { name: 'องค์ประกอบ', exact: true });
  await firstTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'เลเยอร์', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'เลเยอร์', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(firstTab).toBeFocused();
  await page.getByLabel('เพิ่มแถวใหม่ในส่วน (Destination)').selectOption('footer');
  const text = page.getByRole('button', { name: 'เพิ่ม Text ใน ท้ายกระดาษ', exact: true });
  await text.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await text.click();
  await expect(page.locator('pld-band-view .chip')).toHaveCount(3);
  const roles = await page.locator('pld-app-shell').evaluate((shell: any) => shell.store.state.elements.map((el: any) => el.role));
  expect(roles).toEqual(['footer', 'footer', 'footer']);
  await page.keyboard.press('Control+z');
  await expect(page.locator('pld-band-view .chip')).toHaveCount(2);
  await page.getByRole('button', { name: 'A5', exact: true }).click();
  await expect(page.getByRole('button', { name: 'A5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'แนวนอน', exact: true }).click();
  await expect(page.getByRole('button', { name: 'แนวนอน', exact: true })).toHaveAttribute('aria-pressed', 'true');
});


test('native palette drag keeps drop destination and inserts exactly once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page);
  // The click destination rejects List, but dragging to Content remains valid.
  await page.getByLabel('เพิ่มแถวใหม่ในส่วน (Destination)').selectOption('footer');
  const list = page.getByRole('button', { name: 'เพิ่ม List ใน ท้ายกระดาษ', exact: true });
  await list.click();
  await expect(page.locator('pld-band-view .chip')).toHaveCount(0);
  await list.dragTo(page.locator('pld-band-view .empty-slot').filter({ hasText: 'Content' }));
  await expect(page.locator('pld-band-view .chip')).toHaveCount(1);
  const roles = await page.locator('pld-app-shell').evaluate((shell: any) => shell.store.state.elements.map((el: any) => el.role));
  expect(roles).toEqual(['content']);
});

test('resizing desktop controls into a closed drawer restores focus to its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page);
  await page.getByRole('button', { name: 'เพิ่ม Text ใน เนื้อหา', exact: true }).focus();
  await page.setViewportSize({ width: 1023, height: 900 });
  await expect(page.getByRole('button', { name: 'เปิดเครื่องมือ (Open tools)', exact: true })).toBeFocused();
  await expect(page.locator('#tools-panel')).toHaveAttribute('inert');
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('#tools-panel')).not.toHaveAttribute('inert');
  await expect(page.locator('#tools-panel')).toBeFocused();
});


for (const cancel of ['Escape', 'outside'] as const) {
  test(`canceled palette drag (${cancel}) does not change the next existing-chip move`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page);
    await page.getByRole('button', { name: 'เพิ่ม Text ใน เนื้อหา', exact: true }).click();
    await page.getByRole('button', { name: 'เพิ่ม Text ใน เนื้อหา', exact: true }).click();
    const before = await page.locator('pld-app-shell').evaluate((shell: any) => shell.store.state.elements.map((el: any) => el.id));
    const palette = page.getByRole('button', { name: 'เพิ่ม List ใน เนื้อหา', exact: true });
    const box = (await palette.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 5 });
    await expect.poll(() => page.locator('pld-app-shell').evaluate((shell: any) => shell.store.state.dragType)).toBe('list');
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await page.mouse.move(700, 15, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.locator('pld-app-shell').evaluate((shell: any) => shell.store.state.dragType)).toBeNull();
    const cells = page.locator('pld-band-view .cell');
    await page.locator('pld-band-view .chip').first().dragTo(cells.nth(1));
    await expect(cells.first().locator('.chip')).toHaveCount(0);
    await expect(cells.nth(1).locator('.chip')).toHaveCount(2);
    const after = await page.locator('pld-app-shell').evaluate((shell: any) => shell.store.state.elements.map((el: any) => el.id));
    expect(after).toEqual(before);
  });
}

test('keyboard overflow actions restore visible focus while a modal retains its own focus', async ({ page }) => {
  await gotoApp(page);
  const summary = page.locator('pld-header summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // Theme is a nonmodal action.
  await expect(summary).toBeFocused();
  await expect(page.locator('pld-header details')).not.toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await page.locator('pld-header .menu').getByRole('button', { name: 'คีย์ลัด · Shortcuts', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(summary).not.toBeFocused();
  await expect(page.locator('pld-shortcuts-modal pld-modal')).toHaveAttribute('open');
});


for (const multiple of [false, true]) {
  test(`drawer Escape retains ${multiple ? 'multiple' : 'single'} selection and normal Escape still deselects`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoApp(page);
    const text = page.getByRole('button', { name: 'เพิ่ม Text ใน เนื้อหา', exact: true });
    await text.click();
    await text.click();
    if (multiple) await page.keyboard.press('Control+a');
    const selected = await page.locator('pld-app-shell').evaluate((shell: any) => ({ id: shell.store.state.selectedId, multi: shell.store.state.multiSelect }));
    expect(selected.id).toBeTruthy();
    expect(selected.multi.length).toBe(multiple ? 2 : 0);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, panel] of [['เปิดเครื่องมือ (Open tools)', '#tools-panel'], ['เปิดคุณสมบัติ (Open properties)', '#properties-panel']]) {
      const trigger = page.getByRole('button', { name, exact: true });
      await trigger.click();
      await expect(page.locator(panel)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(await page.locator('pld-app-shell').evaluate((shell: any) => ({ id: shell.store.state.selectedId, multi: shell.store.state.multiSelect }))).toEqual(selected);
    }
    await page.keyboard.press('Escape');
    expect(await page.locator('pld-app-shell').evaluate((shell: any) => ({ id: shell.store.state.selectedId, multi: shell.store.state.multiSelect }))).toEqual({ id: null, multi: [] });
  });
}

test('inner modal Escape closes the modal without dismissing the tools drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page);
  const trigger = page.getByRole('button', { name: 'เปิดเครื่องมือ (Open tools)', exact: true });
  await trigger.click();
  await page.keyboard.press('?');
  await expect(page.locator('pld-shortcuts-modal pld-modal')).toHaveAttribute('open');
  await page.keyboard.press('Escape');
  await expect(page.locator('pld-shortcuts-modal pld-modal')).not.toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});


test('mobile More menu stays pointer-accessible above an open drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page);
  const trigger = page.getByRole('button', { name: 'เปิดเครื่องมือ (Open tools)', exact: true });
  await trigger.click();
  await page.locator('pld-header summary').click();
  await page.locator('pld-header .menu').getByRole('button', { name: 'คีย์ลัด · Shortcuts', exact: true }).click();
  const modal = page.locator('pld-shortcuts-modal pld-modal');
  await expect(modal).toHaveAttribute('open');
  // A modal must remain above the elevated menu/header and take keyboard focus.
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

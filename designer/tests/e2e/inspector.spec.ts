/**
 * E2E — Right-hand property inspector (band-model UI, #123)
 *
 * Exercises every editable field the inspector exposes per element type, plus
 * the shared actions (duplicate / delete / role). The role-selector desync
 * (#127) is still open and encoded as `test.fail()` — it passes while the bug
 * is present and flips red the moment it is fixed (remove the annotation then).
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { test, expect } from '@playwright/test';
import {
  gotoApp,
  seedElement,
  inspector,
  inspectorField,
  chips,
  band,
  storeState,
} from './_helpers';

test.describe('Inspector — common fields', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Text', 'Header');
  });

  test('renames the element and the chip label follows', async ({ page }) => {
    await inspectorField(page, 'Name').locator('input').fill('CompanyName');
    await inspectorField(page, 'Name').locator('input').blur();
    await expect(chips(page).first()).toContainText('CompanyName');
  });

  test('type field is read-only', async ({ page }) => {
    const typeInput = inspectorField(page, 'Type').locator('input');
    await expect(typeInput).toHaveValue('text');
    await expect(typeInput).toBeDisabled();
  });

  test('edits width and height', async ({ page }) => {
    await inspectorField(page, 'Width').locator('input').fill('240');
    await inspectorField(page, 'Width').locator('input').blur();
    await inspectorField(page, 'Height').locator('input').fill('60');
    await inspectorField(page, 'Height').locator('input').blur();
    const dims = await storeState(page, (s) => ({ w: s.elements[0].w, h: s.elements[0].h }));
    expect(dims).toEqual({ w: 240, h: 60 });
  });

  test('sets a data binding and shows the binding tag', async ({ page }) => {
    await inspectorField(page, 'JSON Path').locator('input').fill('company.name');
    await inspectorField(page, 'JSON Path').locator('input').blur();
    await expect(inspector(page).locator('.binding-tag')).toContainText('company.name');
    const binding = await storeState(page, (s) => s.elements[0].binding);
    expect(binding).toBe('company.name');
  });

  // Regression for #128: 'visibleIf' is now in ALLOWED_KEYS._base so the #90
  // conditional-visibility control writes through updateElement().
  test('sets a visible-if condition (#90)', async ({ page }) => {
    await inspectorField(page, 'แสดงเมื่อฟิลด์มีค่า').locator('input').fill('totals.wht');
    await inspectorField(page, 'แสดงเมื่อฟิลด์มีค่า').locator('input').blur();
    const v = await storeState(page, (s) => s.elements[0].visibleIf);
    expect(v).toBe('totals.wht');
  });
});

test.describe('Inspector — text style', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Text', 'Header');
  });

  test('edits content, font size, weight and alignment', async ({ page }) => {
    await inspectorField(page, 'Content').locator('textarea').fill('ใบกำกับภาษี');
    await inspectorField(page, 'Content').locator('textarea').blur();
    await inspectorField(page, 'Font Size').locator('input').fill('22');
    await inspectorField(page, 'Font Size').locator('input').blur();
    await inspectorField(page, 'Weight').locator('select').selectOption('bold');
    await inspectorField(page, 'Align').locator('select').selectOption('center');

    const el = await storeState(page, (s) => {
      const e = s.elements[0];
      return { content: e.content, fontSize: e.fontSize, fontWeight: e.fontWeight, textAlign: e.textAlign };
    });
    expect(el).toEqual({ content: 'ใบกำกับภาษี', fontSize: 22, fontWeight: 'bold', textAlign: 'center' });
  });
});

test.describe('Inspector — barcode', () => {
  test('edits value and type', async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Barcode', 'Header');
    await inspectorField(page, 'Value').locator('input').fill('1234567890');
    await inspectorField(page, 'Value').locator('input').blur();
    await inspectorField(page, 'Type').locator('select').selectOption('qrcode');
    const el = await storeState(page, (s) => {
      const e = s.elements[0];
      return { value: e.value, barcodeType: e.barcodeType };
    });
    expect(el).toEqual({ value: '1234567890', barcodeType: 'qrcode' });
  });
});

test.describe('Inspector — list', () => {
  test('edits items and list style', async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'List', 'Content');
    await inspectorField(page, 'Items').locator('textarea').fill('หนึ่ง\nสอง\nสาม');
    await inspectorField(page, 'Items').locator('textarea').blur();
    await inspectorField(page, 'Style').locator('select').selectOption('number');
    const el = await storeState(page, (s) => {
      const e = s.elements[0];
      return { items: e.items, listStyle: e.listStyle };
    });
    expect(el).toEqual({ items: ['หนึ่ง', 'สอง', 'สาม'], listStyle: 'number' });
  });
});

test.describe('Inspector — actions', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await seedElement(page, 'Text', 'Header');
  });

  test('delete removes the chip from the band', async ({ page }) => {
    await expect(chips(page)).toHaveCount(1);
    await inspector(page).locator('button', { hasText: 'ลบ' }).click();
    await expect(chips(page)).toHaveCount(0);
  });

  // Regression for #126: removeElement() now also strips the id from the band
  // structure, so no dangling reference survives in state.bands.
  test('delete also cleans the band reference', async ({ page }) => {
    await inspector(page).locator('button', { hasText: 'ลบ' }).click();
    const bandRefs = await storeState(page, (s) =>
      s.bands.flatMap((b: any) => b.rows.flatMap((r: any) => r.columns.flatMap((c: any) => c.elementIds))).length,
    );
    expect(bandRefs).toBe(0);
  });

  // Regression for #125: duplicateElement() now inserts the clone into the same
  // band cell, so it shows up as a real chip (not a pool-only orphan).
  test('duplicate places the clone as a chip in the band', async ({ page }) => {
    await inspector(page).locator('button', { hasText: 'ทำสำเนา' }).click();
    await expect(chips(page)).toHaveCount(2);
  });

  /**
   * OPEN BUG #127: the inspector's "ส่วนของหน้า (Band)" role selector calls
   * updateElement('role', …) which only mutates el.role. Band placement lives in
   * state.bands and is never updated, so the chip stays in its original band
   * while its role says otherwise — role and placement silently disagree.
   * (Design decision pending — see issue #127.)
   */
  test.fail('changing role should move the chip to the matching band (role desync)', async ({ page }) => {
    await expect(band(page, 'Header')).toBeVisible();
    await inspector(page).locator('.role-option', { hasText: 'Summary' }).click();
    // Correct behaviour: the element ends up referenced by a Summary band.
    const inSummary = await storeState(page, (s) => {
      const el = s.elements[0];
      const summary = s.bands.find((b: any) => b.role === 'summary');
      const ids = summary ? summary.rows.flatMap((r: any) => r.columns.flatMap((c: any) => c.elementIds)) : [];
      return el.role === 'summary' && ids.includes(el.id);
    });
    expect(inSummary).toBe(true);
  });
});

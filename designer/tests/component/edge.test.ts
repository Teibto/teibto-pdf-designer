// @vitest-environment jsdom
/**
 * jsdom harness — edge/validation hunt (#123): out-of-range rejection, enum
 * selects, barcode edit, full copy-set CRUD, page-break 1-based→0-based parsing.
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, dragPaletteToRole, allInShadow, inShadow, click, setValue, type Harness } from './_harness';

const sel = (h: Harness) => h.store.state.elements[0];
function field(h: Harness, label: string, tag: 'input' | 'select' | 'textarea' = 'input'): any {
  const right = h.comp('pld-sidebar-right');
  const f = allInShadow(right, '.field').find((x) => x.textContent?.includes(label));
  return f ? f.querySelector(tag) : null;
}

describe('inspector — text validation & enums', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Text', 'Content');
    await h.flush();
  });

  it('font size within range applies; out-of-range is rejected (no crash)', async () => {
    setValue(field(h, 'Font Size'), '18');
    await h.flush();
    expect(sel(h).fontSize).toBe(18);
    setValue(field(h, 'Font Size'), '500'); // > 200 → validatePropertyUpdate rejects
    await h.flush();
    expect(sel(h).fontSize).toBe(18);
  });

  it('weight and align selects reach the store', async () => {
    setValue(field(h, 'Weight', 'select'), 'bold');
    setValue(field(h, 'Align', 'select'), 'right');
    await h.flush();
    expect(sel(h).fontWeight).toBe('bold');
    expect(sel(h).textAlign).toBe('right');
  });
});

describe('inspector — barcode edit', () => {
  it('value and type reach the store without throwing in jsdom', async () => {
    const h = await mount();
    await dragPaletteToRole(h, 'Barcode', 'Header');
    await h.flush();
    // Capture control refs once — re-querying comp() per field is flaky under
    // jsdom's async Lit rendering (the element exists, but a fresh lookup can
    // miss it mid-cycle). The store assertions below are the source of truth.
    const right = h.comp('pld-sidebar-right');
    const fields = allInShadow(right, '.field');
    const valueInput = fields.find((x: any) => x.textContent?.includes('Value'))?.querySelector('input');
    const typeSelect = fields.find((x: any) => x.textContent?.includes('Type') && x.querySelector('select'))?.querySelector('select');
    expect(valueInput).toBeTruthy();
    expect(typeSelect).toBeTruthy();
    setValue(valueInput, 'ABC-123');
    setValue(typeSelect, 'qrcode');
    await h.flush();
    expect(sel(h).value).toBe('ABC-123');
    expect(sel(h).barcodeType).toBe('qrcode');
  });
});

describe('pagination — copy set full CRUD + page breaks', () => {
  let h: Harness;
  let panel: any;
  beforeEach(async () => {
    h = await mount();
    const left = h.comp('pld-sidebar-left');
    click(allInShadow(left, '.tab').find((t: any) => t.textContent?.includes('ตั้งค่า')));
    await h.flush();
    panel = inShadow(left, 'pld-pagination-panel');
  });

  it('add → edit label → remove a copy', async () => {
    click(allInShadow(panel, '.mode-btn').find((b: any) => b.textContent?.includes('เพิ่มสำเนา')));
    await h.flush();
    expect((h.store.state.copies ?? []).length).toBe(2);

    const thInput = allInShadow(panel, 'input').find((i: any) => i.getAttribute('placeholder')?.includes('ป้ายไทย'));
    setValue(thInput, 'ต้นฉบับ (ลูกค้า)');
    await h.flush();
    expect(h.store.state.copies[0].th).toBe('ต้นฉบับ (ลูกค้า)');

    const removeBtn = allInShadow(panel, '.mode-btn').find((b: any) => b.getAttribute('title') === 'ลบสำเนา');
    click(removeBtn);
    await h.flush();
    expect((h.store.state.copies ?? []).length).toBe(1);
  });

  it('force-break rows parse 1-based input to 0-based store (#84)', async () => {
    // expand the Page Breaks collapsible
    click(allInShadow(panel, '.section-header').find((s: any) => s.textContent?.includes('จุดแบ่งหน้า')));
    await h.flush();
    const fb = allInShadow(panel, '.field').find((f: any) => f.textContent?.includes('บังคับขึ้นหน้าใหม่ก่อนแถวที่'))?.querySelector('input');
    setValue(fb, '5, 15');
    await h.flush();
    expect(h.store.state.pagination.forceBreakBeforeRows).toEqual([4, 14]);
  });
});

// @vitest-environment jsdom
/**
 * jsdom harness — header actions, page settings, pagination panel, layers (#123).
 * Drives real component wiring and asserts store state to hunt dead controls.
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, dragPaletteToRole, allInShadow, inShadow, click, setValue, setChecked, chips, type Harness } from './_harness';

/** Switch the left sidebar tab by label, return the rendered panel element. */
async function leftTab(h: Harness, label: string, panelTag: string): Promise<any> {
  const left = h.comp('pld-sidebar-left');
  const tab = allInShadow(left, '.tab').find((t) => t.textContent?.includes(label));
  click(tab);
  await h.flush();
  return inShadow(left, panelTag);
}

describe('header + page settings', () => {
  let h: Harness;
  beforeEach(async () => { h = await mount(); });

  it('view switch design ↔ flow updates the store', async () => {
    const header = h.comp('pld-header');
    const flowTab = allInShadow(header, 'button').find((b) => b.textContent?.includes('ผังข้อมูล'));
    click(flowTab);
    await h.flush();
    expect(h.store.state.view).toBe('flow');
    const designTab = allInShadow(header, 'button').find((b) => b.textContent?.includes('ออกแบบ'));
    click(designTab);
    await h.flush();
    expect(h.store.state.view).toBe('design');
  });

  it('theme toggle flips document data-theme', async () => {
    const header = h.comp('pld-header');
    const before = document.documentElement.getAttribute('data-theme');
    const themeBtn = allInShadow(header, 'button').find((b) => /Light|Dark/.test(b.textContent || ''));
    click(themeBtn);
    await h.flush();
    const after = document.documentElement.getAttribute('data-theme');
    expect(after).not.toBe(before);
  });

  it('page size and orientation reach the store', async () => {
    const left = h.comp('pld-sidebar-left');
    const letter = allInShadow(left, '.page-size-btn').find((b) => b.textContent?.trim() === 'Letter');
    click(letter);
    await h.flush();
    expect(h.store.state.page.size).toBe('Letter');
    const land = allInShadow(left, '.page-size-btn').find((b) => b.textContent?.includes('แนวนอน'));
    click(land);
    await h.flush();
    expect(h.store.state.page.orientation).toBe('landscape');
  });
});

describe('pagination panel (Settings tab)', () => {
  let h: Harness;
  let panel: any;
  beforeEach(async () => {
    h = await mount();
    panel = await leftTab(h, 'ตั้งค่า', 'pld-pagination-panel');
  });

  const pfield = (label: string, tag = 'input') =>
    allInShadow(panel, '.field').find((f: any) => f.textContent?.includes(label))?.querySelector(tag);

  it('mode toggle rows → height updates the store', async () => {
    const heightBtn = allInShadow(panel, '.mode-btn').find((b: any) => b.textContent?.includes('ตามความสูง'));
    click(heightBtn);
    await h.flush();
    expect(h.store.state.pagination.mode).toBe('height');
  });

  it('rows per page reaches the store', async () => {
    setValue(pfield('จำนวนแถวต่อหน้า'), '25');
    await h.flush();
    expect(h.store.state.pagination.rowsPerPage).toBe(25);
  });

  it('watermark reaches the store', async () => {
    setValue(pfield('ลายน้ำ'), 'สำเนา');
    await h.flush();
    expect(h.store.state.page.watermarkText).toBe('สำเนา');
  });

  it('continuation-header checkbox toggles', async () => {
    const before = h.store.state.pagination.showContinuationHeader;
    const cb = allInShadow(panel, '.check-item').find((c: any) => c.textContent?.includes('แสดงหัวตารางซ้ำ'))?.querySelector('input');
    setChecked(cb, !before);
    await h.flush();
    expect(h.store.state.pagination.showContinuationHeader).toBe(!before);
  });

  it('add copy set seeds the engine default (ต้นฉบับ + สำเนา)', async () => {
    const addBtn = allInShadow(panel, '.mode-btn').find((b: any) => b.textContent?.includes('เพิ่มสำเนา'));
    click(addBtn);
    await h.flush();
    expect((h.store.state.copies ?? []).length).toBe(2);
  });
});

describe('layers panel (Layers tab)', () => {
  let h: Harness;
  let panel: any;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Text', 'Content');
    await h.flush();
    panel = await leftTab(h, 'เลเยอร์', 'pld-layers-panel');
  });

  it('lists a layer per element', () => {
    expect(allInShadow(panel, '.layer-item').length).toBe(1);
  });

  it('toggles visibility and lock through the store', async () => {
    const item = allInShadow(panel, '.layer-item')[0];
    const hideBtn = item.querySelector('.action-btn[title="ซ่อน (Hide)"]');
    click(hideBtn);
    await h.flush();
    expect(h.store.state.elements[0].visible).toBe(false);

    const lockBtn = allInShadow(panel, '.layer-item')[0].querySelector('.action-btn[title="ล็อก (Lock)"]');
    click(lockBtn);
    await h.flush();
    expect(h.store.state.elements[0].locked).toBe(true);
  });
});

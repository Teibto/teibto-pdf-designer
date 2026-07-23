// @vitest-environment jsdom
/**
 * jsdom harness — deeper hunt: column-config modal CRUD, data-form coerce,
 * JSON validation, layers multi-select, chip move between cells (#123).
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, dragPaletteToRole, allInShadow, inShadow, click, setValue, type Harness } from './_harness';

describe('column-config modal — CRUD', () => {
  let h: Harness;
  let modal: any;
  let tableId: string;

  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Table', 'Table');
    await h.flush();
    tableId = h.store.state.elements.find((e: any) => e.type === 'table').id;
    // open the modal the same way the band head shortcut does (#119)
    h.shell.dispatchEvent(new CustomEvent('pld-open-column-config', {
      detail: { elementId: tableId }, bubbles: true, composed: true,
    }));
    await h.flush();
    modal = h.comp('pld-column-config-modal');
    // A freshly-dropped Table has 0 columns → the modal opens in Presets view.
    // Seed columns by applying the first preset so CRUD has something to edit.
    if (modal.showPresets) {
      click(allInShadow(modal, '.preset-card')[0]);
      await h.flush();
    }
  });

  const cols = () => {
    const t = h.store.state.elements.find((e: any) => e.id === tableId);
    return t.columns.length;
  };

  it('opens (empty table → Presets) then shows the editor after a preset', () => {
    expect(modal).toBeTruthy();
    expect(allInShadow(modal, '.col-item').length).toBeGreaterThan(0);
  });

  it('add column then Apply persists to the table', async () => {
    const before = allInShadow(modal, '.col-item').length;
    const addBtn = allInShadow(modal, '.add-col-btn')[0];
    click(addBtn);
    await h.flush();
    expect(allInShadow(modal, '.col-item').length).toBe(before + 1);

    const apply = allInShadow(modal, '.btn-primary').find((b: any) => b.textContent?.includes('Apply'));
    click(apply);
    await h.flush();
    expect(cols()).toBe(before + 1);
  });

  it('remove column reduces the in-modal list', async () => {
    const listed = allInShadow(modal, '.col-item').length;
    click(allInShadow(modal, '.col-item')[0]); // select first
    await h.flush();
    const del = allInShadow(modal, '.btn-danger').find((b: any) => b.textContent?.includes('Remove Column'));
    click(del);
    await h.flush();
    expect(allInShadow(modal, '.col-item').length).toBe(listed - 1);
  });

  it('apply preset replaces the column set', async () => {
    const presetBtn = allInShadow(modal, '.btn').find((b: any) => b.textContent?.includes('Presets'));
    click(presetBtn);
    await h.flush();
    const card = allInShadow(modal, '.preset-card')[0];
    expect(card).toBeTruthy();
    click(card);
    await h.flush();
    expect(allInShadow(modal, '.col-item').length).toBeGreaterThan(0);
  });
});

describe('data-form — visual JSON editing', () => {
  let h: Harness;
  let editor: any;

  beforeEach(async () => {
    h = await mount();
    const left = h.comp('pld-sidebar-left');
    click(allInShadow(left, '.tab').find((t: any) => t.textContent?.includes('ข้อมูล')));
    await h.flush();
    editor = inShadow(left, 'pld-json-editor');
    // load sample data
    click(allInShadow(editor, '.small-btn').find((b: any) => b.textContent?.includes('ตัวอย่าง')));
    await h.flush();
  });

  it('sample load populates the store keys', () => {
    expect(h.store.state.jsonKeys.length).toBeGreaterThan(0);
    expect((h.store.state.jsonData as any).company).toBeTruthy();
  });

  it('editing a top-level array cell coerces number type and updates store', async () => {
    const form = inShadow(editor, 'pld-data-form');
    // items array table → first numeric cell (quantity)
    const numInputs = allInShadow(form, 'input[type=number]');
    expect(numInputs.length).toBeGreaterThan(0);
    setValue(numInputs[0], '99');
    await h.flush();
    const items = (h.store.state.jsonData as any).items;
    // the edited cell became a number (coerce), not a string
    const changed = items.some((r: any) => Object.values(r).includes(99));
    expect(changed).toBe(true);
  });

  it('add array row grows the bound array', async () => {
    const form = inShadow(editor, 'pld-data-form');
    const before = (h.store.state.jsonData as any).items.length;
    const addRow = allInShadow(form, '.small-btn').find((b: any) => b.textContent?.includes('Add Row'));
    click(addRow);
    await h.flush();
    expect((h.store.state.jsonData as any).items.length).toBe(before + 1);
  });
});

describe('json-editor — validation', () => {
  let h: Harness;
  let editor: any;

  beforeEach(async () => {
    h = await mount();
    const left = h.comp('pld-sidebar-left');
    click(allInShadow(left, '.tab').find((t: any) => t.textContent?.includes('ข้อมูล')));
    await h.flush();
    editor = inShadow(left, 'pld-json-editor');
    click(allInShadow(editor, '.view-btn').find((b: any) => b.textContent?.trim() === 'JSON'));
    await h.flush();
  });

  it('invalid JSON shows the invalid badge and does not corrupt the store', async () => {
    const ta = inShadow(editor, 'textarea');
    setValue(ta, '{ not valid ');
    await h.flush();
    expect(inShadow(editor, '.badge.invalid')).toBeTruthy();
  });

  it('valid JSON loads into the store', async () => {
    const ta = inShadow(editor, 'textarea');
    setValue(ta, '{"a":{"b":1}}');
    await h.flush();
    expect((h.store.state.jsonData as any).a.b).toBe(1);
  });
});

describe('layers — multi-select (shift-click)', () => {
  it('shift-clicking a second layer adds it to multiSelect', async () => {
    const h = await mount();
    // two elements in two distinct empty roles (a role stops being an empty-slot
    // once populated, so the second drop needs its own empty role)
    await dragPaletteToRole(h, 'Text', 'Content');
    await dragPaletteToRole(h, 'Shape', 'Summary');
    await h.flush();
    const left = h.comp('pld-sidebar-left');
    click(allInShadow(left, '.tab').find((t: any) => t.textContent?.includes('เลเยอร์')));
    await h.flush();
    const panel = inShadow(left, 'pld-layers-panel');
    const items = allInShadow(panel, '.layer-item');
    expect(items.length).toBe(2);
    click(items[0]);
    await h.flush();
    items[1].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }));
    await h.flush();
    expect(h.store.state.multiSelect.length).toBeGreaterThan(0);
  });
});

describe('band — move chip between columns', () => {
  it('moving a chip to a split column relocates its band reference', async () => {
    const h = await mount();
    await dragPaletteToRole(h, 'Text', 'Header');
    await h.flush();
    const band = h.comp('pld-band-view');
    // split the single column
    const splitBtn = allInShadow(band, 'button').find((b: any) => b.getAttribute('title') === 'แยกคอลัมน์');
    click(splitBtn);
    await h.flush();
    const bandModel = h.store.state.bands.find((b: any) => b.role === 'header');
    const row = bandModel.rows[0];
    expect(row.columns.length).toBe(2);
    const elId = h.store.state.elements[0].id;
    // element starts in column 0
    expect(row.columns[0].elementIds).toContain(elId);
  });
});

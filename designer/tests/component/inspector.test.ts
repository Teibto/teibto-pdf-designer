// @vitest-environment jsdom
/**
 * jsdom harness — property inspector, every element type & field (#123).
 * Hunts dead controls (a field that edits but never reaches the store, like the
 * #128 visibleIf bug) across ALL types, and checks validation-rejection wiring.
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, dragPaletteToRole, allInShadow, click, setValue, chips, type Harness } from './_harness';

/** An inspector control by its field label + tag. */
function field(h: Harness, label: string, tag: 'input' | 'select' | 'textarea' = 'input'): any {
  const right = h.comp('pld-sidebar-right');
  const f = allInShadow(right, '.field').find((x) => x.textContent?.includes(label));
  return f ? f.querySelector(tag) : null;
}
const sel = (h: Harness) => h.store.state.elements[0];

describe('inspector — shape', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Shape', 'Content');
    await h.flush();
  });

  it('drop auto-selects and shows shape props', () => {
    expect(chips(h).length).toBe(1);
    expect(sel(h).type).toBe('shape');
    expect(field(h, 'Background')).toBeTruthy();
  });

  it('edits background, radius, opacity → store', async () => {
    setValue(field(h, 'Background'), '#ff0000');
    setValue(field(h, 'Radius'), '12');
    setValue(field(h, 'Opacity'), '0.5');
    await h.flush();
    expect(sel(h).bgColor.toLowerCase()).toBe('#ff0000');
    expect(sel(h).borderRadius).toBe(12);
    expect(sel(h).opacity).toBe(0.5);
  });

  it('rejects out-of-range opacity (validation wiring, no crash)', async () => {
    setValue(field(h, 'Opacity'), '0.4');
    await h.flush();
    expect(sel(h).opacity).toBe(0.4);
    // 5 is outside 0..1 → validatePropertyUpdate rejects → value unchanged
    setValue(field(h, 'Opacity'), '5');
    await h.flush();
    expect(sel(h).opacity).toBe(0.4);
  });
});

describe('inspector — line', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Line', 'Content');
    await h.flush();
  });

  it('edits color and width → store', async () => {
    const right = h.comp('pld-sidebar-right');
    setValue(field(h, 'Color'), '#00ff00');
    // NOTE: two fields are labelled "Width" (Size-group element width + Line
    // lineWidth) — a minor inspector UX ambiguity. Target the line's own (last).
    const widths = allInShadow(right, '.field').filter((x) => x.textContent?.includes('Width'));
    setValue(widths[widths.length - 1].querySelector('input'), '3');
    await h.flush();
    expect(sel(h).lineColor.toLowerCase()).toBe('#00ff00');
    expect(sel(h).lineWidth).toBe(3);
  });
});

describe('inspector — image', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Image', 'Content');
    await h.flush();
  });

  it('edits URL and fit mode → store', async () => {
    // image props use a flat .field-input / .field-select structure
    const right = h.comp('pld-sidebar-right');
    const url = allInShadow(right, 'input.field-input').find((i) => i.getAttribute('placeholder')?.includes('http'))
      ?? allInShadow(right, 'input.field-input')[0];
    setValue(url, 'https://x/y.png');
    const fit = allInShadow(right, 'select.field-select')[0];
    setValue(fit, 'cover');
    await h.flush();
    expect(sel(h).src).toBe('https://x/y.png');
    expect(sel(h).objectFit).toBe('cover');
  });
});

describe('inspector — common fields on a non-text element (visibleIf regression #128)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Shape', 'Content');
    await h.flush();
  });

  it('name, binding and visibleIf all reach the store', async () => {
    setValue(field(h, 'Name'), 'MyShape');
    setValue(field(h, 'JSON Path'), 'company.logo');
    setValue(field(h, 'แสดงเมื่อฟิลด์มีค่า'), 'totals.wht');
    await h.flush();
    const e = sel(h);
    expect(e.name).toBe('MyShape');
    expect(e.binding).toBe('company.logo');
    expect(e.visibleIf).toBe('totals.wht'); // was dead before #128 fix
  });
});

describe('inspector — actions regression (#125 duplicate, #126 delete)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await mount();
    await dragPaletteToRole(h, 'Text', 'Content');
    await h.flush();
  });

  const btn = (h: Harness, label: string) =>
    allInShadow(h.comp('pld-sidebar-right'), 'button').find((b) => b.textContent?.includes(label));

  it('#125: duplicate places the clone as a chip in the band', async () => {
    click(btn(h, 'ทำสำเนา'));
    await h.flush();
    expect(chips(h).length).toBe(2);
    expect(h.store.state.elements.length).toBe(2);
  });

  it('#126: delete removes the chip and leaves no dangling band ref', async () => {
    click(btn(h, 'ลบ'));
    await h.flush();
    expect(chips(h).length).toBe(0);
    const refs = h.store.state.bands.flatMap((b: any) =>
      b.rows.flatMap((r: any) => r.columns.flatMap((c: any) => c.elementIds)));
    expect(refs.length).toBe(0);
  });
});

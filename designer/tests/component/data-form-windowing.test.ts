// @vitest-environment jsdom
/**
 * Bounded visual-form rendering for large arrays.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/components/panels/data-form';

function fixture(rowCount = 10_000) {
  return {
    items: Array.from({ length: rowCount }, (_, index) => ({
      index,
      name: `row-${index}`,
      quantity: index,
      price: index,
      tax: index,
      total: index,
      sku: `sku-${index}`,
      unit: 'EA',
      memo: `memo-${index}`,
      location: 'BKK',
    })),
  };
}

async function mount(rowCount = 10_000) {
  const form = document.createElement('pld-data-form') as any;
  form.jsonData = fixture(rowCount);
  document.body.append(form);
  await form.updateComplete;
  return form;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('data-form large-array paging', () => {
  it('bounds a 10,000-row table to 50 rendered rows without truncating data', async () => {
    const form = await mount();

    expect(form.shadowRoot.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(form.shadowRoot.querySelectorAll('tbody input')).toHaveLength(500);
    expect(form.shadowRoot.querySelector('.array-page-status')?.textContent).toContain('แถวที่ 1–50 จาก 10000');
    expect(form.jsonData.items).toHaveLength(10_000);
  });

  it('uses absolute indexes for page-two edits and preserves the complete array', async () => {
    const form = await mount();
    (form.shadowRoot.querySelector('.array-page-next') as HTMLButtonElement).click();
    await form.updateComplete;

    const firstRow = form.shadowRoot.querySelector('tbody tr') as HTMLTableRowElement;
    expect(firstRow.dataset.rowIndex).toBe('50');
    expect(form.shadowRoot.querySelector('.array-page-status')?.textContent).toContain('แถวที่ 51–100 จาก 10000');

    const changed = new Promise<CustomEvent>((resolve) => {
      form.addEventListener('data-changed', (event: Event) => resolve(event as CustomEvent), { once: true });
    });
    const quantity = firstRow.querySelectorAll('input')[2] as HTMLInputElement;
    quantity.value = '777';
    quantity.dispatchEvent(new Event('change'));
    const updated = (await changed).detail;

    expect(updated.items).toHaveLength(10_000);
    expect(updated.items[50].quantity).toBe(777);
    expect(updated.items[0]).toBe(form.jsonData.items[0]);
    expect(updated.items[51]).toBe(form.jsonData.items[51]);
  });

  it('clamps the visible page after the backing array shrinks', async () => {
    const form = await mount(101);
    (form.shadowRoot.querySelector('.array-page-next') as HTMLButtonElement).click();
    await form.updateComplete;
    (form.shadowRoot.querySelector('.array-page-next') as HTMLButtonElement).click();
    await form.updateComplete;
    expect(form.shadowRoot.querySelector('tbody tr')?.getAttribute('data-row-index')).toBe('100');

    form.jsonData = fixture(50);
    await form.updateComplete;

    expect(form.shadowRoot.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(form.shadowRoot.querySelector('tbody tr')?.getAttribute('data-row-index')).toBe('0');
    expect(form.shadowRoot.querySelector('.array-page-status')).toBeNull();
  });

  it('caps pathological wide and many-section data without truncating the source', async () => {
    const wideRow = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, index]));
    const sharedRows = Array.from({ length: 10_000 }, () => wideRow);
    const jsonData = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`section${index}`, sharedRows]));
    const form = document.createElement('pld-data-form') as any;
    form.jsonData = jsonData;
    document.body.append(form);
    await form.updateComplete;

    expect(form.shadowRoot.querySelectorAll('input').length).toBeLessThanOrEqual(1_000);
    expect(form.shadowRoot.querySelectorAll('.group')).toHaveLength(20);
    expect(form.shadowRoot.querySelectorAll('thead th')).toHaveLength(22);
    const overflowText = Array.from(form.shadowRoot.querySelectorAll('.form-overflow'))
      .map((element: Element) => element.textContent)
      .join(' ');
    expect(overflowText).toContain('80 more top-level sections');
    expect(form.jsonData).toBe(jsonData);
    expect(form.jsonData.section99).toHaveLength(10_000);
    expect(Object.keys(form.jsonData.section0[0])).toHaveLength(100);

    const changed = new Promise<CustomEvent>((resolve) => {
      form.addEventListener('data-changed', (event: Event) => resolve(event as CustomEvent), { once: true });
    });
    (form.shadowRoot.querySelector('.array-actions .small-btn') as HTMLButtonElement).click();
    const updated = (await changed).detail;
    expect(updated.section0).toHaveLength(10_001);
    expect(Object.keys(updated.section0[10_000])).toHaveLength(100);
  });

  it('summarizes oversized simple arrays and nested payloads without materializing their contents', async () => {
    const form = document.createElement('pld-data-form') as any;
    form.jsonData = {
      tags: Array.from({ length: 100_000 }, (_, index) => `tag-${index}`),
      metadata: { nested: { secretLargeValue: 'x'.repeat(100_000) } },
    };
    document.body.append(form);
    await form.updateComplete;

    expect(form.shadowRoot.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(form.shadowRoot.textContent).toContain('100000 items');
    expect(form.shadowRoot.textContent).toContain('Object with 1 keys');
    expect(form.shadowRoot.textContent).not.toContain('secretLargeValue');
    expect(form.jsonData.tags).toHaveLength(100_000);
  });
});

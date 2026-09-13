// @vitest-environment jsdom
/**
 * Data-form immutable structural-sharing regressions for large datasets.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/components/panels/data-form';

function frozenFixture(rowCount = 10_000) {
  const rows = Array.from({ length: rowCount }, (_, index) => Object.freeze({
    index,
    name: `row-${index}`,
    quantity: index,
  }));
  const items = Object.freeze(rows);
  const company = Object.freeze({ name: 'ACME', taxId: '123' });
  return Object.freeze({ items, company, title: 'fixture' });
}

function captureChange(component: any): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    component.addEventListener('data-changed', (event: Event) => {
      resolve((event as CustomEvent<Record<string, unknown>>).detail);
    }, { once: true });
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('data-form structural sharing', () => {
  it('copies only the root, array, and edited row for a 10,000-row cell update', async () => {
    const original = frozenFixture();
    const form = document.createElement('pld-data-form') as any;
    form.jsonData = original;
    const changed = captureChange(form);

    form._updateArrayCell('items', 5_000, 'quantity', 99);
    const updated = await changed;
    const updatedRows = updated.items as Array<Record<string, unknown>>;

    expect(updated).not.toBe(original);
    expect(updated.company).toBe(original.company);
    expect(updatedRows).not.toBe(original.items);
    expect(updatedRows[0]).toBe(original.items[0]);
    expect(updatedRows[4_999]).toBe(original.items[4_999]);
    expect(updatedRows[5_000]).not.toBe(original.items[5_000]);
    expect(updatedRows[5_001]).toBe(original.items[5_001]);
    expect(updatedRows[5_000].quantity).toBe(99);
    expect(original.items[5_000].quantity).toBe(5_000);
  });

  it('preserves untouched branches for object, add, remove, and simple-array edits', async () => {
    const original = frozenFixture(3);
    const form = document.createElement('pld-data-form') as any;
    form.jsonData = original;

    let changed = captureChange(form);
    form._updateField('company', 'name', 'Changed');
    const objectEdit = await changed;
    expect(objectEdit.items).toBe(original.items);
    expect(objectEdit.company).not.toBe(original.company);

    changed = captureChange(form);
    form._addArrayRow('items', ['index', 'name', 'quantity']);
    const added = await changed;
    expect((added.items as unknown[]).slice(0, 3)).toEqual(original.items);
    expect(added.company).toBe(original.company);

    changed = captureChange(form);
    form._removeArrayRow('items', 1);
    const removed = await changed;
    expect(removed.items).toEqual([original.items[0], original.items[2]]);
    expect(removed.company).toBe(original.company);

    changed = captureChange(form);
    form._updateSimpleArray('tags', 'one, two');
    const simple = await changed;
    expect(simple.items).toBe(original.items);
    expect(simple.tags).toEqual(['one', 'two']);
  });

  it('keeps 10,000-row cell-update p95 below the interaction budget', () => {
    const form = document.createElement('pld-data-form') as any;
    let current: Record<string, unknown> = frozenFixture();
    const samples: number[] = [];

    for (let index = 0; index < 100; index++) {
      form.jsonData = current;
      let next: Record<string, unknown> | null = null;
      form.addEventListener('data-changed', (event: Event) => {
        next = (event as CustomEvent<Record<string, unknown>>).detail;
      }, { once: true });
      const start = performance.now();
      form._updateArrayCell('items', (index * 97) % 10_000, 'quantity', index);
      samples.push(performance.now() - start);
      expect(next).not.toBeNull();
      current = next!;
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.info(`PLD_DATA_FORM_SCALE ${JSON.stringify({ rows: 10_000, updates: 100, p95Ms: Number(p95.toFixed(3)) })}`);
    expect(p95).toBeLessThan(50);
  });
});

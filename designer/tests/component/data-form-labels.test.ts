// @vitest-environment jsdom
/**
 * Data field labels remain associated across nested paths and paged rows.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, expect, it } from 'vitest';
import '../../src/components/panels/data-form';

afterEach(() => document.body.replaceChildren());

it('associates primitive, object, long-text and array labels without path collisions', async () => {
  const form = document.createElement('pld-data-form');
  form.jsonData = { title: 'Example', company: { name: 'Company', memo: 'long '.repeat(20) }, 'company.name': 'literal dotted key', tags: ['a', 'b'], items: [{ name: 'first', quantity: 1 }, { name: 'second', quantity: 2 }] };
  document.body.append(form);
  await form.updateComplete;
  const root = form.shadowRoot!;
  const labels = [...root.querySelectorAll('label')];
  expect(labels).toHaveLength(5);
  for (const label of labels) {
    expect(label.control).not.toBeNull();
    expect(label.control!.id).toBe(label.htmlFor);
  }
  const controls = [...root.querySelectorAll('input,textarea')];
  const ids = controls.map(control => control.id).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
  const cells = [...root.querySelectorAll('tbody input')];
  expect(cells.map(cell => cell.getAttribute('aria-label'))).toEqual(['items, แถวที่ 1 (row), name', 'items, แถวที่ 1 (row), quantity', 'items, แถวที่ 2 (row), name', 'items, แถวที่ 2 (row), quantity']);
});

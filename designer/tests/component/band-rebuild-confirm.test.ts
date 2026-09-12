// @vitest-environment jsdom
/**
 * Rebuild layout requires consent and remains one undoable operation.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, update: async () => {}, del: async () => {}, keys: async () => [] }));
import { mount } from './_harness';
import { addElementToNewBand, splitColumn, setColumnWidth, moveBandRow } from '../../src/state/actions';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('cancel preserves custom row order/widths, confirm rebuilds, and one Undo restores the exact layout', async () => {
  const { shell, store, comp, flush } = await mount();
  const first = addElementToNewBand(store, 'text', 'content');
  const second = addElementToNewBand(store, 'text', 'content');
  splitColumn(store, 0, 0, 0);
  setColumnWidth(store, 0, 0, 0, 30);
  moveBandRow(store, 0, 1, -1);
  store.dispatch((d: any) => { d.template.isDirty = false; });
  await flush();
  const before = store.state;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  comp('pld-band-view').shadowRoot.querySelector('.toolbar button').click();
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0]).toContain('ความกว้างคอลัมน์');
  expect(store.state).toBe(before);
  confirm.mockReturnValue(true);
  comp('pld-band-view').shadowRoot.querySelector('.toolbar button').click();
  expect(store.state.bands[0].rows).toHaveLength(1);
  expect(store.state.bands[0].rows[0].columns.map((c: any) => c.elementIds)).toEqual([[first], [second]]);
  expect(store.state.template.isDirty).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
  expect(store.state.bands).toEqual(before.bands);
  expect(store.state.elements).toEqual(before.elements);
  shell.remove();
});

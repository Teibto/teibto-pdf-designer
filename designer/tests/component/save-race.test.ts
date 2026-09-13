// @vitest-environment jsdom
/**
 * Save completion must not discard newer recovery data.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => {}), update: vi.fn(async () => {}), del: vi.fn(async () => {}), keys: vi.fn(async () => []) }));
import { update, set } from 'idb-keyval';
import { mount } from './_harness';
import '../../src/components/modals/save-ns-modal';
import * as persistence from '../../src/services/template.service';
import { addElementToNewBand } from '../../src/state/actions';

afterEach(() => {
  document.querySelector('pld-app-shell')?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
describe('app-shell save draft safety', () => {
  it.each([true, false])('clears draft only when saved content remains current (edit=%s)', async (edit) => {
    const { shell, store } = await mount();
    addElementToNewBand(store, 'text', 'content');
    let complete!: () => void;
    vi.mocked(set).mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const pending = shell._saveTemplate();
    if (edit) store.dispatch((d: { template: { name: string } }) => { d.template.name = 'งานที่แก้เพิ่ม'; });
    complete();
    await pending;
    expect(update).toHaveBeenCalledTimes(edit ? 0 : 1);
    expect(store.state.template.isDirty).toBe(edit);
  });
});


describe('NetSuite save dialog metadata', () => {
  it('refreshes loaded-template metadata on every opening and preserves explicit false', async () => {
    const { store } = await mount();
    const modal = document.createElement('pld-save-ns-modal') as any;
    modal.store = store;
    document.body.append(modal);
    store.dispatch((d: any) => {
      d.template.id = '42';
      d.template.nsMetadata = { rectype: 'purchaseorder', isDefault: false };
    });
    modal.open = true;
    await modal.updateComplete;
    expect(modal.shadowRoot.querySelector('select').value).toBe('purchaseorder');
    expect(modal.shadowRoot.querySelector('input').checked).toBe(false);
    modal.open = false;
    await modal.updateComplete;
    store.dispatch((d: any) => { d.template.nsMetadata = { rectype: 'invoice', isDefault: true }; });
    modal.open = true;
    await modal.updateComplete;
    expect(modal.shadowRoot.querySelector('select').value).toBe('invoice');
    expect(modal.shadowRoot.querySelector('input').checked).toBe(true);
    modal.remove();
  });
});


it('keeps a durable-save warning and template ID visible inside the dialog', async () => {
  const { store } = await mount();
  const modal = document.createElement('pld-save-ns-modal') as any;
  modal.store = store;
  document.body.append(modal);
  modal.open = true;
  await modal.updateComplete;
  vi.spyOn(persistence, 'saveTemplateToNetSuite').mockResolvedValueOnce({ id: '42', warning: 'Default conflict needs repair' });
  const closed = vi.fn();
  modal.addEventListener('close', closed);
  await modal._save();
  await modal.updateComplete;
  expect(modal.shadowRoot.querySelector('[role="alert"]').textContent).toContain('ID: 42');
  expect(modal.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Default conflict needs repair');
  expect(closed).not.toHaveBeenCalled();
  expect(modal.shadowRoot.querySelector('button.btn-primary').disabled).toBe(false);
  modal.remove();
});

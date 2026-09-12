// @vitest-environment jsdom
/**
 * Primary save requires record-type selection before a standalone NetSuite write.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, update: async () => {}, del: async () => {}, keys: async () => [] }));
import { mount } from './_harness';
import * as adapter from '../../src/services/netsuite-adapter.service';
import * as persistence from '../../src/services/template.service';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it.each(['new', 'loaded-blank'] as const)('primary Save opens record type selection for %s and waits for explicit dialog save', async kind => {
  const { store, comp, flush } = await mount();
  vi.spyOn(adapter, 'isNetSuiteEnv').mockReturnValue(true);
  vi.spyOn(adapter, 'getNsContext').mockReturnValue({ recordType: null } as any);
  vi.spyOn(adapter, 'canEditNsTemplates').mockReturnValue(true);
  const save = vi.spyOn(persistence, 'saveTemplateToNetSuite').mockResolvedValue({ id: '42' });
  if (kind === 'loaded-blank') store.dispatch((d: any) => {
    d.template.id = '44'; d.template.nsMetadata = { rectype: '', isDefault: false };
  });
  comp('pld-header').shadowRoot.querySelector('button.save').click();
  await flush();
  const modal = comp('pld-save-ns-modal');
  expect(modal.open).toBe(true);
  expect(save).not.toHaveBeenCalled();
  const select = modal.shadowRoot.querySelector('select');
  select.value = 'purchaseorder';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  modal.shadowRoot.querySelector('button.btn-primary').click();
  await flush();
  expect(save).toHaveBeenCalledExactlyOnceWith(store, { rectype: 'purchaseorder', isDefault: false });
});

it('quick save preserves known loaded metadata despite a standalone launch context', async () => {
  const { store, comp, flush } = await mount();
  vi.spyOn(adapter, 'isNetSuiteEnv').mockReturnValue(true);
  vi.spyOn(adapter, 'getNsContext').mockReturnValue({ recordType: null } as any);
  vi.spyOn(adapter, 'hasThaiFontConfigured').mockReturnValue(true);
  const save = vi.spyOn(persistence, 'saveTemplateToNetSuite').mockResolvedValue({ id: '42' });
  store.dispatch((d: any) => {
    d.template.id = '42'; d.template.nsMetadata = { rectype: 'purchaseorder', isDefault: false };
  });
  comp('pld-header').shadowRoot.querySelector('button.save').click();
  await flush();
  expect(comp('pld-save-ns-modal').open).toBe(false);
  expect(save).toHaveBeenCalledExactlyOnceWith(store);
});

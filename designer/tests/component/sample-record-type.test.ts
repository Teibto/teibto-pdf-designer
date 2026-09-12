// @vitest-environment jsdom
/**
 * Synthetic requests follow the opened template; real previews retain record identity.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, update: async () => {}, del: async () => {}, keys: async () => [] }));
const mocks = vi.hoisted(() => ({ context: vi.fn(), isNs: vi.fn(), sample: vi.fn(), preview: vi.fn() }));
vi.mock('../../src/services/netsuite-adapter.service', async original => ({
  ...await original<typeof import('../../src/services/netsuite-adapter.service')>(),
  getNsContext: mocks.context, isNetSuiteEnv: mocks.isNs,
  fetchNsSampleData: mocks.sample, renderLivePreview: mocks.preview,
}));
vi.mock('../../src/services/bfo-export.service', () => ({ exportBfoXml: () => '<pdf>sample test</pdf>' }));
import { mount } from './_harness';

beforeEach(() => {
  mocks.context.mockReset().mockReturnValue(null);
  mocks.isNs.mockReset().mockReturnValue(false);
  mocks.sample.mockReset().mockResolvedValue({ data: { synthetic: true } });
  mocks.preview.mockReset().mockResolvedValue(new Blob(['pdf']));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it.each([
  ['customerpayment', null, 'customerpayment'],
  ['itemfulfillment', null, 'itemfulfillment'],
  ['customerpayment', 'invoice', 'customerpayment'],
  ['itemfulfillment', 'invoice', 'itemfulfillment'],
  ['  customerpayment  ', 'invoice', 'customerpayment'],
  ['', ' itemfulfillment ', 'itemfulfillment'],
  ['  ', ' customerpayment ', 'customerpayment'],
  [undefined, null, 'invoice'],
  ['', ' ', 'invoice'],
])('sample load and preview select metadata %j over context %j → %s', async (metadata, context, expected) => {
  const { shell, store, comp, flush } = await mount();
  if (metadata !== undefined) store.dispatch((d: any) => {
    d.template.id = 'synthetic-template'; d.template.nsMetadata = { rectype: metadata, isDefault: false };
  });
  mocks.context.mockReturnValue({ recordType: context, recordId: null });
  mocks.isNs.mockReturnValue(true);
  await shell._loadSampleData();
  expect(mocks.sample).toHaveBeenCalledExactlyOnceWith(expected);
  const preview = comp('pld-preview-modal');
  preview.open = true;
  await flush();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rectype: expected, sample: true, recid: undefined }));
});

it.each([
  ['customerpayment', 'itemfulfillment'],
  ['itemfulfillment', 'customerpayment'],
])('actual %s preview never borrows template type %s for its record ID', async (recordType, templateType) => {
  const { store, comp, flush } = await mount();
  store.dispatch((d: any) => { d.template.nsMetadata = { rectype: templateType, isDefault: false }; });
  mocks.context.mockReturnValue({ recordType, recordId: 'synthetic-record-42' });
  mocks.isNs.mockReturnValue(true);
  comp('pld-preview-modal').open = true;
  await flush();
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rectype: recordType, recid: 'synthetic-record-42', sample: false }));
});

it('rejects a real record ID with no context type rather than guessing from template metadata', async () => {
  const { store, comp, flush } = await mount();
  store.dispatch((d: any) => { d.template.nsMetadata = { rectype: 'customerpayment', isDefault: false }; });
  mocks.context.mockReturnValue({ recordType: null, recordId: 'synthetic-record-42' });
  mocks.isNs.mockReturnValue(true);
  comp('pld-preview-modal').open = true;
  await flush();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(comp('pld-preview-modal').shadowRoot.querySelector('.error').textContent).toContain('ไม่พบประเภทเอกสารจริง');
});

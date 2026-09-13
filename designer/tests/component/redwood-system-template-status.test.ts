// @vitest-environment jsdom
/**
 * Template status reflects identity and dirty lifecycle, not only isDirty=false.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AppStore } from '../../src/state/store';
import { setTemplateName } from '../../src/state/actions';
import { exportTemplateJson, importTemplateJson, needsNetSuiteRecordType } from '../../src/services/template.service';
import '../../src/components/layout/template-bar';

async function mount(store = new AppStore()) {
  const bar = document.createElement('pld-template-bar') as any;
  bar.store = store;
  document.body.append(bar);
  await bar.updateComplete;
  return { bar, store, badge: () => bar.shadowRoot.querySelector('[role="status"]') as HTMLElement };
}
afterEach(() => { document.body.replaceChildren(); });

describe('template persistence status', () => {
  it('does not label the untouched, identity-free initial document Saved', async () => {
    const { badge, store } = await mount();
    expect(store.state.template.isDirty).toBe(false);
    expect(store.state.template.id).toBeNull();
    expect(badge().textContent).toContain('New');
    expect(badge().textContent).not.toContain('Saved');
  });

  it.each(['local', 'netsuite'])('preserves clean %s saved status and changes to Unsaved after editing', async source => {
    const store = new AppStore();
    store.dispatch(draft => {
      draft.template.id = source === 'local' ? 'local-template' : '45';
      if (source === 'netsuite') draft.template.nsMetadata = { rectype: 'invoice', isDefault: false };
    });
    const { bar, badge } = await mount(store);
    expect(badge().textContent).toContain('Saved');
    setTemplateName(store, 'Edited synthetic');
    await bar.updateComplete;
    expect(badge().textContent).toContain('Unsaved');
  });

  it('responds when a successful first save assigns an ID without changing dirty state', async () => {
    const { bar, store, badge } = await mount();
    store.dispatch(draft => { draft.template.id = 'saved-template'; });
    await bar.updateComplete;
    expect(badge().textContent).toContain('Saved');
    store.beginDocumentSession();
    store.dispatch(draft => { draft.template.id = null; draft.template.isDirty = false; });
    await bar.updateComplete;
    expect(badge().textContent).toContain('New');
  });
});


describe('local-save badge (#217)', () => {
  afterEach(() => { delete (window as any).__NS_CONTEXT__; });

  it('labels a saved template "Saved locally" when not connected to NetSuite', async () => {
    const store = new AppStore();
    store.dispatch(draft => { draft.template.id = 'local-template'; });
    const { badge } = await mount(store);
    expect(badge().textContent).toContain('บันทึกในเครื่อง · Saved locally');
  });

  it('keeps the NetSuite-saved label unchanged when connected', async () => {
    (window as any).__NS_CONTEXT__ = { userId: 1 };
    const store = new AppStore();
    store.dispatch(draft => { draft.template.id = '45'; });
    const { badge } = await mount(store);
    expect(badge().textContent).toContain('บันทึกแล้ว · Saved');
    expect(badge().textContent).not.toContain('locally');
  });
});

it('treats imported JSON as unsaved and detaches previous NetSuite identity/default metadata', async () => {
  const { bar, store, badge } = await mount();
  store.dispatch(draft => {
    draft.template.id = '45';
    draft.template.nsMetadata = { rectype: 'invoice', isDefault: true };
    draft.copies = [{ th: 'ต้นฉบับ', en: 'Original' }];
  });
  const exported = JSON.parse(exportTemplateJson(store));
  exported.name = 'Imported synthetic';
  const previousSession = store.documentSession;
  importTemplateJson(store, JSON.stringify(exported));
  await bar.updateComplete;
  expect(store.state.template).toMatchObject({ id: null, isDirty: true, name: 'Imported synthetic' });
  expect(store.state.template.nsMetadata).toBeUndefined();
  expect(store.documentSession).toBe(previousSession + 1);
  expect(store.state.copies).toEqual(exported.copies);
  expect(store.state.page).toEqual(exported.page);
  expect(badge().textContent).toContain('Unsaved');
  expect(needsNetSuiteRecordType(store)).toBe(true);
});

// @vitest-environment jsdom
/**
 * First-save defaults require explicit opt-in; edits retain saved metadata.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/template.service', () => ({ saveTemplateToNetSuite: save }));
vi.mock('../../src/services/netsuite-adapter.service', () => ({
  getNsContext: () => ({ recordType: 'invoice' }),
  canEditNsTemplates: () => true,
  READ_ONLY_REASON: 'Read only',
}));
import '../../src/components/modals/save-ns-modal';

async function mount(isDefault?: boolean) {
  const store = new AppStore();
  if (isDefault !== undefined) {
    store.dispatch(draft => {
      draft.template.id = 'saved-qa';
      draft.template.nsMetadata = { rectype: 'invoice', isDefault };
    });
  }
  const modal = document.createElement('pld-save-ns-modal') as any;
  modal.store = store;
  document.body.append(modal);
  modal.open = true;
  await modal.updateComplete;
  const checkbox = () => modal.shadowRoot.querySelector('input[type="checkbox"]') as HTMLInputElement;
  return { modal, store, checkbox };
}

beforeEach(() => { save.mockReset().mockResolvedValue({ id: 'synthetic-saved' }); });
afterEach(() => { document.body.replaceChildren(); });

describe('NetSuite Save default choice', () => {
  it('leaves a new template unchecked and sends false on routine first Save', async () => {
    const { modal, store, checkbox } = await mount();
    expect(checkbox().checked).toBe(false);
    modal.shadowRoot.querySelector('.btn-primary').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(store, { rectype: 'invoice', isDefault: false }));
  });

  it('allows explicit opt-in when saving a new template', async () => {
    const { modal, store, checkbox } = await mount();
    checkbox().click(); await modal.updateComplete;
    expect(checkbox().checked).toBe(true);
    modal.shadowRoot.querySelector('.btn-primary').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(store, { rectype: 'invoice', isDefault: true }));
  });

  it.each([true, false])('preserves saved isDefault=%s after an edit dialog is reopened', async isDefault => {
    const { modal, checkbox } = await mount(isDefault);
    expect(checkbox().checked).toBe(isDefault);
    checkbox().click(); await modal.updateComplete;
    expect(checkbox().checked).toBe(!isDefault);
    modal.open = false; await modal.updateComplete;
    modal.open = true; await modal.updateComplete;
    expect(checkbox().checked).toBe(isDefault);
  });

  it('resets an abandoned new-template opt-in when reopened', async () => {
    const { modal, checkbox } = await mount();
    checkbox().click(); await modal.updateComplete;
    expect(checkbox().checked).toBe(true);
    modal.open = false; await modal.updateComplete;
    modal.open = true; await modal.updateComplete;
    expect(checkbox().checked).toBe(false);
  });
});

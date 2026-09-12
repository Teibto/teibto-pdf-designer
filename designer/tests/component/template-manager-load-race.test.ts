// @vitest-environment jsdom
/**
 * Template manager async load intent regressions.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadTemplate: vi.fn(),
  listTemplates: vi.fn(),
  getNsTemplate: vi.fn(),
  listNsTemplates: vi.fn(),
  isNetSuiteEnv: vi.fn(),
  confirmDiscardUnsaved: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../src/services/template.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/template.service')>(),
  loadTemplate: mocks.loadTemplate,
  listTemplates: mocks.listTemplates,
}));

vi.mock('../../src/services/netsuite-adapter.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/netsuite-adapter.service')>(),
  getNsTemplate: mocks.getNsTemplate,
  listNsTemplates: mocks.listNsTemplates,
  isNetSuiteEnv: mocks.isNetSuiteEnv,
}));

vi.mock('../../src/utils/unsaved-guard', () => ({
  confirmDiscardUnsaved: mocks.confirmDiscardUnsaved,
}));

vi.mock('../../src/components/shared/toast-notification', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/components/shared/toast-notification')>(),
  showToast: mocks.showToast,
}));

import '../../src/components/modals/template-manager-modal';
import { AppStore } from '../../src/state/store';
import { exportTemplateJson } from '../../src/services/template.service';
import { loadJsonData } from '../../src/state/actions';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function textElement(id: string) {
  return {
    id,
    type: 'text' as const,
    name: id,
    role: 'content' as const,
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    visible: true,
    locked: false,
    rotation: 0,
    content: id,
    fontSize: 10,
    fontFamily: 'Noto Sans Thai',
    fontWeight: 'normal' as const,
    fontStyle: 'normal' as const,
    textAlign: 'left' as const,
    color: '#000000',
    lineHeight: 1.4,
    letterSpacing: 0,
  };
}

function createModal() {
  const modal = document.createElement('pld-template-manager-modal') as any;
  modal.store = new AppStore();
  modal.open = true;
  return modal;
}

beforeEach(() => {
  mocks.loadTemplate.mockReset();
  mocks.listTemplates.mockReset().mockResolvedValue([]);
  mocks.getNsTemplate.mockReset();
  mocks.listNsTemplates.mockReset().mockResolvedValue([]);
  mocks.isNetSuiteEnv.mockReset().mockReturnValue(false);
  mocks.confirmDiscardUnsaved.mockReset().mockReturnValue(true);
  mocks.showToast.mockReset();
});

describe('template-manager load intent', () => {
  it('opens XML-only NetSuite records in canonical source mode without fake elements', async () => {
    const canonical = '<?xml version="1.0"?>\n<pdf>\n<#list record.item as line>${line.amount}</#list>\n</pdf>\n';
    mocks.getNsTemplate.mockResolvedValue({
      id: 'xml-207', name: 'Canonical invoice', rectype: 'invoice', isDefault: false,
      data: '', xml: canonical,
    });
    const modal = createModal();

    await modal._loadNsTemplate('xml-207');

    expect(modal.store.state).toMatchObject({
      editorMode: 'xml',
      rawXml: canonical,
      elements: [],
      bands: [],
      template: { id: 'xml-207', name: 'Canonical invoice', isDirty: false },
    });
    expect(mocks.showToast).toHaveBeenCalledWith('Opened canonical XML: Canonical invoice', 'success');
  });

  it('rejects an XML-only record whose canonical source is empty', async () => {
    mocks.getNsTemplate.mockResolvedValue({
      id: 'empty', name: 'Empty', rectype: 'invoice', isDefault: false,
      data: '', xml: ' \n',
    });
    const modal = createModal();

    await modal._loadNsTemplate('empty');

    expect(modal.store.state.editorMode).toBe('visual');
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/Load failed:.*XML is empty/), 'error');
  });

  it('keeps the latest local template when reads resolve in reverse order', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.loadTemplate.mockImplementation((staged: AppStore, id: string) => {
      const pending = id === 'first' ? first : second;
      return pending.promise.then(() => {
        staged.dispatch((draft) => {
          draft.elements = [textElement(id)];
          draft.template.id = id;
          draft.template.name = id;
          draft.template.isDirty = false;
        });
        return { warnings: [] };
      });
    });
    const modal = createModal();

    const firstLoad = modal._loadTemplate('first');
    const secondLoad = modal._loadTemplate('second');
    second.resolve();
    await secondLoad;
    first.resolve();
    await firstLoad;

    expect(modal.store.state.template.id).toBe('second');
    expect(modal.store.state.elements[0].id).toBe('second');
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it('preserves an edit made during a local read without reopening discard intent', async () => {
    const pending = deferred<void>();
    mocks.loadTemplate.mockImplementation((staged: AppStore) => pending.promise.then(() => {
      staged.dispatch((draft) => {
        draft.elements = [textElement('loaded')];
        draft.template.id = 'loaded';
      });
      return { warnings: [] };
    }));
    const modal = createModal();

    const load = modal._loadTemplate('loaded');
    modal.store.dispatch((draft: any) => {
      draft.elements = [textElement('local-edit')];
      draft.template.isDirty = true;
    });
    pending.resolve();
    await load;

    expect(mocks.confirmDiscardUnsaved).toHaveBeenCalledTimes(1);
    expect(modal.store.state.elements[0].id).toBe('local-edit');
    expect(modal.store.state.template.id).toBeNull();
  });

  it('does not overwrite newer non-dirty JSON while a local template read is pending', async () => {
    const pending = deferred<void>();
    mocks.loadTemplate.mockImplementation((staged: AppStore) => pending.promise.then(() => {
      staged.dispatch((draft) => {
        draft.jsonData = { source: 'stale-template' };
        draft.jsonKeys = ['source'];
        draft.template.id = 'loaded';
      });
      return { warnings: [] };
    }));
    const modal = createModal();

    const load = modal._loadTemplate('loaded');
    loadJsonData(modal.store, { source: 'newer-user-data' });
    expect(modal.store.state.template.isDirty).toBe(false);
    pending.resolve();
    await load;

    expect(modal.store.state.jsonData).toEqual({ source: 'newer-user-data' });
    expect(modal.store.state.template.id).toBeNull();
    expect(mocks.confirmDiscardUnsaved).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('keeps the latest NetSuite selection when responses resolve in reverse order', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mocks.getNsTemplate.mockImplementation((id: string) => id === 'first' ? first.promise : second.promise);
    const modal = createModal();

    const firstLoad = modal._loadNsTemplate('first');
    const secondLoad = modal._loadNsTemplate('second');
    second.resolve({
      id: 'second', name: 'Second', rectype: 'invoice', isDefault: false,
      data: JSON.stringify({ elements: [textElement('second')] }),
    });
    await secondLoad;
    first.resolve({
      id: 'first', name: 'First', rectype: 'invoice', isDefault: false,
      data: JSON.stringify({ elements: [textElement('first')] }),
    });
    await firstLoad;

    expect(modal.store.state.template.id).toBe('second');
    expect(modal.store.state.elements[0].id).toBe('second');
  });

  it('does not let a pending NetSuite response cross a document switch', async () => {
    const pending = deferred<any>();
    mocks.getNsTemplate.mockReturnValueOnce(pending.promise);
    const modal = createModal();
    const load = modal._loadNsTemplate('stale');

    modal.store.beginDocumentSession();
    modal.store.dispatch((draft: any) => {
      draft.elements = [textElement('new-document')];
      draft.template.name = 'New document';
    });
    pending.resolve({
      id: 'stale', name: 'Stale', rectype: 'invoice', isDefault: false,
      data: JSON.stringify({ elements: [textElement('stale')] }),
    });
    await load;

    expect(modal.store.state.elements[0].id).toBe('new-document');
    expect(modal.store.state.template.id).toBeNull();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});


describe('template-manager import accessibility', () => {
  it('associates a visible label with the native JSON textarea and preserves input', async () => {
    const modal = createModal();
    modal.activeTab = 'import';
    document.body.append(modal);
    try {
      await modal.updateComplete;
      const label = modal.shadowRoot.querySelector('label[for="template-import-json"]') as HTMLLabelElement;
      const textarea = modal.shadowRoot.getElementById(label.htmlFor) as HTMLTextAreaElement;
      expect(label.textContent).toContain('Template JSON / JSON เทมเพลต');
      expect(textarea.tagName).toBe('TEXTAREA');
      expect(modal.shadowRoot.getElementById(textarea.getAttribute('aria-describedby'))).not.toBeNull();
      const pastedJson = '{"name":"Synthetic import","elements":[]}';
      textarea.value = pastedJson;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      await modal.updateComplete;
      expect(modal.importJson).toBe(pastedJson);
      expect(textarea.value).toBe(pastedJson);
      const importButton = modal.shadowRoot.querySelector('.import-actions .btn-primary') as HTMLButtonElement;
      expect(importButton.textContent?.trim()).toBe('Import JSON');
      expect(importButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    } finally {
      modal.remove();
    }
  });
});


describe('template-manager inline import errors', () => {
  it.each(['blank', 'invalid-json', 'validation'])('keeps the document and shows a persistent %s error until corrected', async kind => {
    const modal = createModal();
    modal.activeTab = 'import';
    document.body.append(modal);
    try {
      await modal.updateComplete;
      const original = modal.store.state;
      const valid = JSON.parse(exportTemplateJson(modal.store));
      valid.name = 'Corrected synthetic import';
      const invalid = { ...valid, elements: [{ ...textElement('bad'), type: 'barcode', barcodeType: '' }] };
      const textarea = modal.shadowRoot.getElementById('template-import-json') as HTMLTextAreaElement;
      textarea.value = kind === 'blank' ? '' : kind === 'invalid-json' ? '{' : JSON.stringify(invalid);
      textarea.dispatchEvent(new Event('input'));
      modal.shadowRoot.querySelector('.import-actions .btn-primary').click();
      await modal.updateComplete;
      const alert = modal.shadowRoot.querySelector('[role="alert"]');
      expect(alert?.textContent).toMatch(kind === 'blank' ? /Please paste/ : kind === 'invalid-json' ? /Invalid JSON/ : /barcodeType/);
      expect(textarea.getAttribute('aria-invalid')).toBe('true');
      expect(textarea.getAttribute('aria-describedby')).toContain(alert.id);
      expect(modal.store.state).toBe(original);
      // Ordinary rerenders do not dismiss the error or require an outside toast.
      modal.requestUpdate(); await modal.updateComplete;
      expect(modal.shadowRoot.querySelector('[role="alert"]')?.textContent).toBe(alert.textContent);
      textarea.value = JSON.stringify(valid);
      textarea.dispatchEvent(new Event('input'));
      await modal.updateComplete;
      expect(modal.shadowRoot.querySelector('[role="alert"]')).toBeNull();
      expect(textarea.getAttribute('aria-invalid')).toBe('false');
      modal.shadowRoot.querySelector('.import-actions .btn-primary').click();
      await modal.updateComplete;
      expect(modal.store.state.template.name).toBe('Corrected synthetic import');
      expect(modal.importError).toBe('');
    } finally { modal.remove(); }
  });

  it('clears a previous error when the dialog is reopened', async () => {
    const modal = createModal(); modal.activeTab = 'import'; document.body.append(modal);
    try {
      await modal.updateComplete;
      modal._importFromJson(); await modal.updateComplete;
      expect(modal.importError).not.toBe('');
      modal.open = false; await modal.updateComplete;
      modal.open = true; await modal.updateComplete; await modal.updateComplete;
      expect(modal.importError).toBe('');
    } finally { modal.remove(); }
  });
});

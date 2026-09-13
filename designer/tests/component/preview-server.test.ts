// @vitest-environment jsdom
/**
 * Current PDF download and asynchronous preview lifecycle regressions.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import { PldPreviewModal } from '../../src/components/modals/preview-modal';
import '../../src/components/modals/preview-modal';
import { renderLivePreview } from '../../src/services/netsuite-adapter.service';

vi.mock('../../src/services/netsuite-adapter.service', () => ({
  isNetSuiteEnv: () => true,
  getNsContext: () => ({ recordType: 'invoice', recordId: '42' }),
  renderLivePreview: vi.fn(),
}));
vi.mock('../../src/services/bfo-export.service', () => ({
  getCurrentBfoXml: (state: { editorMode: string; rawXml: string }) =>
    state.editorMode === 'xml' ? state.rawXml : '<pdf>edited</pdf>',
}));

function deferred() {
  let resolve!: (blob: Blob) => void;
  const promise = new Promise<Blob>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('server preview lifecycle', () => {
  let modal: PldPreviewModal;
  const createUrl = vi.fn(() => 'blob:current-preview');
  const revokeUrl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: createUrl, revokeObjectURL: revokeUrl,
    }));
    modal = document.createElement('pld-preview-modal') as PldPreviewModal;
    Object.assign(modal, { store: new AppStore() });
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    vi.unstubAllGlobals();
  });

  async function open() {
    modal.open = true;
    await modal.updateComplete;
  }
  async function settle() {
    await Promise.resolve();
    await modal.updateComplete;
  }

  it('downloads the displayed blob without requesting a default saved template', async () => {
    vi.mocked(renderLivePreview).mockResolvedValue(new Blob(['edited pdf']));
    await open();
    await settle();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.href).toBe(modal.shadowRoot!.querySelector('iframe')!.src);
      expect(this.download).toBe('preview.pdf');
    });
    (modal.shadowRoot!.querySelector('.export-btn') as HTMLButtonElement).click();
    expect(click).toHaveBeenCalledOnce();
    expect(renderLivePreview).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('sends canonical XML to the existing live BFO preview unchanged', async () => {
    const canonical = '<?xml version="1.0"?>\n<pdf>\n  ${record.tranid!""}\n</pdf>\n';
    modal.store.dispatch((draft) => {
      draft.editorMode = 'xml';
      draft.rawXml = canonical;
    });
    vi.mocked(renderLivePreview).mockResolvedValue(new Blob(['canonical pdf']));

    await open();
    await settle();

    expect(renderLivePreview).toHaveBeenCalledWith(expect.objectContaining({ xml: canonical }));
    expect(modal.shadowRoot!.querySelector('iframe')).not.toBeNull();
  });

  it('discards a response after close without creating an object URL', async () => {
    const response = deferred();
    vi.mocked(renderLivePreview).mockReturnValue(response.promise);
    await open();
    modal.open = false;
    await modal.updateComplete;
    response.resolve(new Blob(['late']));
    await settle();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('keeps the newer response when close/reopen requests resolve in reverse order', async () => {
    const old = deferred();
    const current = deferred();
    vi.mocked(renderLivePreview).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await open();
    modal.open = false;
    await modal.updateComplete;
    await open();
    const currentBlob = new Blob(['current']);
    current.resolve(currentBlob);
    await settle();
    old.resolve(new Blob(['old']));
    await settle();
    expect(createUrl).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledWith(currentBlob);
    modal.remove();
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:current-preview');
  });
});

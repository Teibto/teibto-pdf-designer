// @vitest-environment jsdom
/**
 * App-shell pagination invalidation and listener lifecycle regressions.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../../src/components/app-shell';

afterEach(() => {
  document.querySelectorAll('pld-app-shell').forEach((element) => element.remove());
  vi.restoreAllMocks();
});

describe('app-shell pagination lifecycle', () => {
  it('recomputes for immutable pagination inputs, not unrelated view-only changes', async () => {
    const shell = document.createElement('pld-app-shell') as any;
    document.body.appendChild(shell);
    await shell.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dispatch = vi.spyOn(shell.store, 'dispatch');
    dispatch.mockClear();

    shell.store.dispatch((draft: any) => { draft.view = 'flow'; });
    expect(dispatch).toHaveBeenCalledTimes(1);

    dispatch.mockClear();
    shell.store.dispatch((draft: any) => {
      draft.elements.push({
        id: 'text-1', type: 'text', name: 'Text', role: 'content',
        x: 0, y: 0, w: 100, h: 20, zIndex: 0, locked: false, visible: true,
        content: 'before', fontSize: 12, fontWeight: 'normal', color: '#000000',
        textAlign: 'left',
      });
    });
    expect(dispatch).toHaveBeenCalledTimes(2);

    dispatch.mockClear();
    shell.store.dispatch((draft: any) => { draft.elements[0].content = 'after'; });
    expect(dispatch).toHaveBeenCalledTimes(2);

    dispatch.mockClear();
    shell.store.dispatch((draft: any) => { draft.jsonData = { items: [{ name: 'A' }] }; });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('removes and reinstalls the pagination listener exactly once', async () => {
    const shell = document.createElement('pld-app-shell') as any;
    const paginationHandler = vi.fn(shell._paginationHandler);
    shell._paginationHandler = paginationHandler;
    document.body.appendChild(shell);
    await shell.updateComplete;
    const store = shell.store;

    paginationHandler.mockClear();
    shell.remove();
    store.dispatch((draft: any) => { draft.page.height += 1; });
    expect(paginationHandler).not.toHaveBeenCalled();

    document.body.appendChild(shell);
    expect(paginationHandler).toHaveBeenCalled();

    paginationHandler.mockClear();
    store.dispatch((draft: any) => { draft.view = 'flow'; });
    expect(paginationHandler).toHaveBeenCalledTimes(1);
  });

  it('shares one finalized pagination result across the preview render', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/modals/preview-modal.ts'),
      'utf8',
    );

    expect(source.match(/finalizePagination\(computePagination/g) ?? []).toHaveLength(1);
    expect(source).toContain('this._renderTablePreview(te, jsonData, pageNum, pageData)');
  });
});

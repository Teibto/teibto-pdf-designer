/**
 * Tests: confirmDiscardUnsaved (#141)
 * Loading over unsaved work must ask first; a clean design proceeds silently.
 * @author Wichit Wongta
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AppStore } from '../../src/state/store';
import { addElement, markTemplateClean } from '../../src/state/actions';
import { confirmDiscardUnsaved } from '../../src/utils/unsaved-guard';

afterEach(() => { vi.unstubAllGlobals(); });

describe('confirmDiscardUnsaved', () => {
  it('proceeds without asking when the design is clean', () => {
    const store = new AppStore();
    markTemplateClean(store);
    const confirmFn = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmFn);
    expect(confirmDiscardUnsaved(store)).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('asks and proceeds when dirty and the user confirms', () => {
    const store = new AppStore();
    addElement(store, 'text'); // sets isDirty
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    expect(confirmDiscardUnsaved(store)).toBe(true);
  });

  it('blocks when dirty and the user cancels', () => {
    const store = new AppStore();
    addElement(store, 'text');
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    expect(confirmDiscardUnsaved(store)).toBe(false);
  });
});

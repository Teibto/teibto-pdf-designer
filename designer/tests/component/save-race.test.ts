// @vitest-environment jsdom
/**
 * Save completion must not discard newer recovery data.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => {}), del: vi.fn(async () => {}), keys: vi.fn(async () => []) }));
import { del, set } from 'idb-keyval';
import { mount } from './_harness';
import { addElementToNewBand } from '../../src/state/actions';

afterEach(() => {
  document.querySelector('pld-app-shell')?.remove();
  vi.clearAllMocks();
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
    expect(del).toHaveBeenCalledTimes(edit ? 0 : 1);
    expect(store.state.template.isDirty).toBe(edit);
  });
});

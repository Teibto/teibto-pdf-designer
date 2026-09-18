// @vitest-environment jsdom
/**
 * The insertion-destination <select> must agree with the state used for the
 * add-element buttons' title/aria on first render (#217) — previously the
 * select's `.value` binding was set before its <option> children existed, so
 * the browser defaulted to the first option ("header") while `this.destination`
 * stayed at its own default ("content"), silently disagreeing.
 *
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AppStore } from '../../src/state/store';
import '../../src/components/layout/sidebar-left';

async function mount(store = new AppStore()) {
  const sidebar = document.createElement('pld-sidebar-left') as any;
  sidebar.store = store;
  document.body.append(sidebar);
  await sidebar.updateComplete;
  return { sidebar, store };
}
afterEach(() => { document.body.replaceChildren(); });

describe('destination select vs. add-element button title (#217)', () => {
  it('select value matches this.destination on first render', async () => {
    const { sidebar } = await mount();
    const select = sidebar.shadowRoot.querySelector('#insert-destination') as HTMLSelectElement;
    expect(select.value).toBe((sidebar as any).destination);
    expect(select.value).toBe('content');
  });

  it('the matching button title/aria use the same destination as the select', async () => {
    const { sidebar } = await mount();
    const select = sidebar.shadowRoot.querySelector('#insert-destination') as HTMLSelectElement;
    const textButton = Array.from(sidebar.shadowRoot.querySelectorAll('.element-item'))
      .find((btn) => (btn as HTMLElement).textContent?.includes('Text')) as HTMLElement;
    expect(select.value).toBe('content');
    expect(textButton.title).toContain('เนื้อหา');
    expect(textButton.getAttribute('aria-label')).toContain('เนื้อหา');
  });
});

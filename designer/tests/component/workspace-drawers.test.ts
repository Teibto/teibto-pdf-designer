// @vitest-environment jsdom
/**
 * Drawer host lifecycle and media-query listener cleanup.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, expect, it, vi } from 'vitest';
import '../../src/components/app-shell';
import { addElementToNewBand } from '../../src/state/actions';

vi.mock('../../src/services/template.service', async (original) => ({
  ...await original<typeof import('../../src/services/template.service')>(),
  getDraft: async () => null,
}));

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('each drawer toggle fires once after 100 reconnects and resize listeners detach', async () => {
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = true;
  const add = vi.spyOn(media, 'addEventListener');
  const remove = vi.spyOn(media, 'removeEventListener');
  vi.stubGlobal('matchMedia', () => media);
  const shell = document.createElement('pld-app-shell');
  document.body.append(shell);
  await shell.updateComplete;
  for (let i = 0; i < 100; i++) {
    shell.remove(); document.body.append(shell); await shell.updateComplete;
  }
  shell.dispatchEvent(new CustomEvent('pld-toggle-left-panel'));
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector('[slot="tools-toggle"]')!.getAttribute('aria-expanded')).toBe('true');
  shell.dispatchEvent(new CustomEvent('pld-toggle-left-panel'));
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector('#tools-panel')!.hasAttribute('inert')).toBe(true);
  shell.dispatchEvent(new CustomEvent('pld-toggle-right-panel'));
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector('#properties-panel')!.hasAttribute('inert')).toBe(false);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector('#tools-panel')!.hasAttribute('inert')).toBe(false);
  expect(shell.shadowRoot!.querySelector('[slot="properties-toggle"]')!.getAttribute('aria-expanded')).toBe('false');
  shell.remove();
  expect(add).toHaveBeenCalledTimes(101);
  expect(remove).toHaveBeenCalledTimes(101);
});

it('detaching a palette during an active drag clears its transient state without undoing content', async () => {
  const shell = document.createElement('pld-app-shell');
  document.body.append(shell);
  await shell.updateComplete;
  const palette = shell.shadowRoot!.querySelector('pld-sidebar-left')!;
  await palette.updateComplete;
  const button = palette.shadowRoot!.querySelector<HTMLElement>('[aria-label="เพิ่ม List ใน content"]')!;
  button.dispatchEvent(new Event('dragstart', { bubbles: true }));
  expect(shell.store.state.dragType).toBe('list');
  palette.remove();
  expect(shell.store.state.dragType).toBeNull();
  expect(shell.store.state.elements).toHaveLength(0);
});


it('drawer Escape preserves single/multiple selection after 100 reconnects and respects handled events', async () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal('matchMedia', () => media);
  const shell = document.createElement('pld-app-shell');
  document.body.append(shell);
  await shell.updateComplete;
  const first = addElementToNewBand(shell.store, 'text', 'content')!;
  const second = addElementToNewBand(shell.store, 'text', 'content')!;
  for (let i = 0; i < 100; i++) {
    shell.remove(); document.body.append(shell); await shell.updateComplete;
  }
  for (const multiSelect of [[], [first, second]]) {
    shell.store.dispatch(d => { d.selectedId = second; d.multiSelect = multiSelect; });
    for (const side of ['left', 'right']) {
      shell.dispatchEvent(new CustomEvent(`pld-toggle-${side}-panel`));
      await shell.updateComplete;
      const panel = shell.shadowRoot!.querySelector<HTMLElement>(side === 'left' ? '#tools-panel' : '#properties-panel')!;
      const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true, composed: true });
      handled.preventDefault();
      panel.dispatchEvent(handled);
      await shell.updateComplete;
      expect(panel.hasAttribute('inert')).toBe(false);
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true, composed: true }));
      await shell.updateComplete;
      expect(panel.hasAttribute('inert')).toBe(true);
      expect(shell.store.state.selectedId).toBe(second);
      expect(shell.store.state.multiSelect).toEqual(multiSelect);
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(shell.store.state.selectedId).toBeNull();
    expect(shell.store.state.multiSelect).toEqual([]);
  }
});

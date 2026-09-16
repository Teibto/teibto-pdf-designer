// @vitest-environment jsdom
/**
 * Accessible Redwood inspector, pagination and layer actions.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'lit';
import { AppStore } from '../../src/state/store';
import { icon } from '../../src/components/shared/icon';
import '../../src/components/panels/pagination-panel';
import '../../src/components/panels/layers-panel';
import '../../src/components/layout/sidebar-right';

const text = (id: string, zIndex: number) => ({
  id, type: 'text' as const, name: id, role: 'content' as const,
  x: 0, y: 0, w: 100, h: 20, zIndex, locked: false, visible: true,
  content: 'synthetic', fontSize: 12, fontWeight: 'normal' as const,
  color: '#000000', textAlign: 'left' as const,
});

async function mount(tag: string, store = new AppStore()) {
  const component = document.createElement(tag) as HTMLElement & { store: AppStore; updateComplete: Promise<boolean> };
  component.store = store;
  document.body.append(component);
  await component.updateComplete;
  return { component, root: component.shadowRoot!, store };
}

afterEach(() => { document.body.replaceChildren(); });

describe('Redwood system accessibility', () => {
  it('renders decorative SVG with grid and dimensions independent of icon fonts', () => {
    render(icon('settings'), document.body);
    const svg = document.querySelector('svg')!;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('associates inspector labels with real editable controls and preserves edit routing', async () => {
    const store = new AppStore();
    store.dispatch((draft) => { draft.elements = [text('a', 1)]; draft.selectedId = 'a'; });
    const { root, component } = await mount('pld-sidebar-right', store);
    const labels = [...root.querySelectorAll<HTMLLabelElement>('label[for]')];
    expect(labels.length).toBeGreaterThan(10);
    for (const label of labels) expect(root.getElementById(label.htmlFor)).not.toBeNull();
    const nameLabel = labels.find((label) => label.textContent?.includes('(Name)'))!;
    const input = root.getElementById(nameLabel.htmlFor) as HTMLInputElement;
    input.value = 'renamed'; input.dispatchEvent(new Event('change'));
    await component.updateComplete;
    expect(store.state.elements[0].name).toBe('renamed');
    expect(store.state.elements[0].color).toBe('#000000');
  });

  it('uses real disclosure buttons and removes collapsed fields from keyboard navigation', async () => {
    const { root, component } = await mount('pld-pagination-panel');
    const trigger = root.querySelector<HTMLButtonElement>('[aria-controls="breaks-options"]')!;
    const panel = root.getElementById('breaks-options')!;
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    trigger.click(); await component.updateComplete;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    for (const label of root.querySelectorAll<HTMLLabelElement>('label[for]')) {
      expect(root.getElementById(label.htmlFor)).not.toBeNull();
    }
  });

  it('keeps copy labels distinct and editable after removing an earlier copy', async () => {
    const store = new AppStore();
    store.dispatch((draft) => { draft.copies = [{ th: 'A', en: 'A' }, { th: 'B', en: 'B' }]; });
    const { root, component } = await mount('pld-pagination-panel', store);
    const input = root.getElementById('copy-th-1') as HTMLInputElement;
    expect(root.querySelector('label[for="copy-th-1"]')?.textContent).toContain('2');
    input.value = 'changed'; input.dispatchEvent(new Event('change'));
    expect(store.state.copies?.[1].th).toBe('changed');
    root.querySelector<HTMLButtonElement>('[aria-label="ลบสำเนา 1"]')!.click();
    await component.updateComplete;
    expect((root.getElementById('copy-th-0') as HTMLInputElement).value).toBe('changed');
    expect(root.getElementById('copy-th-1')).toBeNull();
  });

  it('reorders actual band references and restores keyboard focus on the moved layer', async () => {
    const store = new AppStore();
    store.dispatch((draft) => {
      draft.elements = [text('a', 3), text('b', 2), text('c', 1)];
      draft.bands = [{ role: 'content', rows: [{ id: 'row', columns: [{ id: 'cell', widthPct: 100, elementIds: ['a', 'b', 'c'] }] }] }];
    });
    const { root, component } = await mount('pld-layers-panel', store);
    const select = root.querySelector<HTMLButtonElement>('[data-select-id="b"]')!;
    select.click(); await component.updateComplete;
    expect(store.state.selectedId).toBe('b');
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    await component.updateComplete;
    expect([...root.querySelectorAll<HTMLElement>('[data-layer-id]')].map((el) => el.dataset.layerId)).toEqual(['b', 'a', 'c']);
    expect(store.state.bands[0].rows[0].columns[0].elementIds).toEqual(['b', 'a', 'c']);
    expect(store.state.elements.map((el) => el.zIndex)).toEqual([3, 2, 1]);
    expect((root.activeElement as HTMLElement).dataset.selectId).toBe('b');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('1 / 3');
    root.querySelector<HTMLButtonElement>('[aria-label="ล็อก b (Lock)"]')!.click();
    await component.updateComplete;
    expect(store.state.elements.find((el) => el.id === 'b')?.locked).toBe(true);
    expect(root.querySelector('[aria-label="ปลดล็อก b (Unlock)"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});

// @vitest-environment jsdom
/**
 * Modal control labels remain usable after decorative SVG migration.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import { AppStore } from '../../src/state/store';
import '../../src/components/modals/bfo-export-modal';
import '../../src/components/modals/column-config-modal';
import '../../src/components/modals/shortcuts-modal';

function renderModal(tag: string) {
  const modal = document.createElement(tag) as any;
  modal.store = new AppStore();
  modal.open = true;
  const container = document.createElement('div');
  render(modal.render(), container);
  return { modal, container };
}

describe('Redwood modal chrome', () => {
  it('links the BFO record label and preserves the selector change handler', () => {
    const { modal, container } = renderModal('pld-bfo-export-modal');
    const generate = vi.spyOn(modal, '_generatePreview').mockImplementation(() => {});
    const label = container.querySelector('label[for="bfo-export-record-type"]') as HTMLLabelElement;
    const select = container.querySelector(`#${label.htmlFor}`) as HTMLSelectElement;
    expect(label.textContent).toBe('NetSuite Record Type');
    select.value = 'invoice'; select.dispatchEvent(new Event('change'));
    expect(modal.recordType).toBe('invoice');
    expect(generate).toHaveBeenCalledOnce();
    generate.mockRestore();
  });

  it.each([
    ['pld-bfo-export-modal', 'Download .xml'],
    ['pld-column-config-modal', 'Apply'],
  ])('keeps %s action text alongside a decorative SVG', (tag, text) => {
    const { container } = renderModal(tag);
    const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!;
    expect(button).toBeDefined();
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses a plain keyboard dialog title while retaining keyboard key notation', () => {
    const { container } = renderModal('pld-shortcuts-modal');
    expect(container.querySelector('pld-modal')?.getAttribute('modalTitle')).toBe('คีย์ลัด (Keyboard Shortcuts)');
    expect(container.querySelectorAll('kbd').length).toBeGreaterThan(0);
  });
});

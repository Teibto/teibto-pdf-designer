// @vitest-environment jsdom
/**
 * jsdom component harness — mount the real app + drive/inspect the Lit tree.
 *
 * Primary QA loop (#123): fast, deterministic, repeatable. Mounts pld-app-shell
 * (which owns the store) and drives real components through their own shadow DOM
 * so button/field wiring is exercised, not mocked. HTML5 drag is simulated with
 * plain events — the handlers read store.dragType (not dataTransfer) for the
 * palette→band path, so this faithfully drives the real code.
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { expect } from 'vitest';
import '../../src/components/app-shell';

export interface Harness {
  shell: any;
  store: any;
  /** A child component element by tag, e.g. comp('pld-sidebar-right'). */
  comp(tag: string): any;
  flush(ms?: number): Promise<void>;
}

export async function flushEl(el?: any, ms = 30): Promise<void> {
  if (el?.updateComplete) await el.updateComplete;
  await new Promise((r) => setTimeout(r, ms));
}

/** Mount a fresh app-shell and wait for the first render. */
export async function mount(): Promise<Harness> {
  // Fully tear down any prior shell first so its disconnectedCallback runs and
  // its window/context listeners are gone before a new store/context is provided
  // (jsdom keeps one document across a file → stale providers otherwise linger).
  document.querySelectorAll('pld-app-shell').forEach((el) => el.remove());
  document.body.innerHTML = '';
  await new Promise((r) => setTimeout(r, 0));
  const shell = document.createElement('pld-app-shell') as any;
  document.body.appendChild(shell);
  await customElements.whenDefined('pld-app-shell');
  await flushEl(shell, 60);

  const flush = async (ms = 40) => {
    await flushEl(shell, 0);
    // let child components settle too
    await new Promise((r) => setTimeout(r, ms));
  };

  return {
    shell,
    store: shell.store,
    comp: (tag: string) => shell.shadowRoot.querySelector(tag),
    flush,
  };
}

/** querySelector within a component's own shadow root. */
export function inShadow(el: any, sel: string): any {
  return el?.shadowRoot?.querySelector(sel) ?? null;
}
export function allInShadow(el: any, sel: string): any[] {
  return el?.shadowRoot ? Array.from(el.shadowRoot.querySelectorAll(sel)) : [];
}

/** Find the first descendant matching sel, piercing every open shadow root. */
export function deepQuery(root: any, sel: string): any {
  const seen = new Set<any>();
  const walk = (node: any): any => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (node.querySelector) {
      const hit = node.querySelector(sel);
      if (hit) return hit;
    }
    // descend into shadow roots
    const kids: any[] = [];
    if (node.shadowRoot) kids.push(node.shadowRoot);
    if (node.children) kids.push(...Array.from(node.children));
    if (node.childNodes) kids.push(...Array.from(node.childNodes).filter((n: any) => n.shadowRoot));
    for (const k of kids) {
      const hit = walk(k);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

/** Click an element (dispatches a real click event its @click handler receives). */
export function click(el: any): void {
  if (!el) throw new Error('click: element not found');
  el.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
}

/** Set an input/select/textarea value and dispatch input + change. */
export function setValue(el: any, value: string): void {
  if (!el) throw new Error('setValue: element not found');
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/** Toggle a checkbox and dispatch change. */
export function setChecked(el: any, checked: boolean): void {
  if (!el) throw new Error('setChecked: element not found');
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/**
 * Simulate a palette element drag onto an empty role band.
 * Step 1 fires dragstart on the palette tile (sets store.dragType — the handler
 * uses optional chaining on dataTransfer, so a plain event is fine).
 * Step 2 fires drop on the matching empty-slot band (reads store.dragType).
 */
export async function dragPaletteToRole(h: Harness, paletteLabel: string, roleLabel: string): Promise<void> {
  const left = h.comp('pld-sidebar-left');
  const tile = allInShadow(left, '.element-item').find((t) => t.textContent?.includes(paletteLabel));
  if (!tile) throw new Error(`palette tile not found: ${paletteLabel}`);
  tile.dispatchEvent(new Event('dragstart', { bubbles: true, composed: true }));

  const band = h.comp('pld-band-view');
  const slot = allInShadow(band, '.empty-slot').find((s) => s.textContent?.includes(roleLabel));
  if (!slot) throw new Error(`empty role slot not found: ${roleLabel}`);
  const drop = new Event('drop', { bubbles: true, composed: true }) as any;
  drop.dataTransfer = null;
  slot.dispatchEvent(drop);
  await h.flush();
}

/** All element chips currently in band-view. */
export function chips(h: Harness): any[] {
  return allInShadow(h.comp('pld-band-view'), '.chip');
}

export { expect };

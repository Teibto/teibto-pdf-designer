// @vitest-environment jsdom
/**
 * jsdom component harness — smoke test.
 * Confirms the real Lit component tree mounts and renders in jsdom so the
 * per-button/per-field harness can drive it deterministically.
 *
 * @author Wichit Wongta
 * @since 2026-07-23
 */
import { describe, it, expect } from 'vitest';
import '../../src/components/app-shell';

async function flush(el: any, ms = 60) {
  if (el?.updateComplete) await el.updateComplete;
  await new Promise((r) => setTimeout(r, ms));
}

describe('smoke: app-shell mounts in jsdom', () => {
  it('renders header, both sidebars and the band view', async () => {
    const el = document.createElement('pld-app-shell') as any;
    document.body.appendChild(el);
    await customElements.whenDefined('pld-app-shell');
    await flush(el);

    const sr = el.shadowRoot as ShadowRoot;
    expect(sr).toBeTruthy();
    expect(sr.querySelector('pld-header')).toBeTruthy();
    expect(sr.querySelector('pld-template-bar')).toBeTruthy();
    expect(sr.querySelector('pld-sidebar-left')).toBeTruthy();
    expect(sr.querySelector('pld-band-view')).toBeTruthy();
    expect(sr.querySelector('pld-sidebar-right')).toBeTruthy();

    // store is reachable for driving/asserting
    expect(el.store?.state).toBeTruthy();
    expect(Array.isArray(el.store.state.bands)).toBe(true);
  });
});

// @vitest-environment jsdom
/**
 * Thai-font configuration signal + the warning it drives (#156).
 *
 * The exported XML binds ${company.fontRegular} instead of a baked URL, so a
 * missing font in the account config no longer shows up as a broken template —
 * it shows up as a PDF with no Thai text and no error anywhere. These tests pin
 * the one thing that tells the user: the warning.
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect, afterEach } from 'vitest';
import { hasThaiFontConfigured } from '../../src/services/netsuite-adapter.service';
import { AppStore } from '../../src/state/store';
import '../../src/components/modals/bfo-export-modal';

type NsWindow = typeof window & { __NS_CONTEXT__?: unknown };

function setContext(ctx: unknown) {
  (window as NsWindow).__NS_CONTEXT__ = ctx;
}

afterEach(() => {
  delete (window as NsWindow).__NS_CONTEXT__;
  document.body.innerHTML = '';
});

describe('hasThaiFontConfigured', () => {
  it('false outside NetSuite (no injected context)', () => {
    expect(hasThaiFontConfigured()).toBe(false);
  });

  it('false when neither the script parameter nor the config record supplies a font', () => {
    setContext({ userName: 'QA', fontRegularUrl: null, fontBoldUrl: null });
    expect(hasThaiFontConfigured()).toBe(false);
  });

  it('true once a font URL is resolved server-side', () => {
    setContext({ userName: 'QA', fontRegularUrl: '/core/media/media.nl?id=101&h=abc' });
    expect(hasThaiFontConfigured()).toBe(true);
  });
});

describe('BFO export modal — missing Thai font warning', () => {
  async function openModal() {
    const el = document.createElement('pld-bfo-export-modal') as HTMLElement & {
      open: boolean; store: AppStore; updateComplete: Promise<unknown>;
    };
    // no context provider in this test — hand the modal a store directly so its
    // XML preview can generate (the warning itself doesn't read the store)
    el.store = new AppStore();
    el.open = true;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('warns when the account has no Thai font configured', async () => {
    setContext({ userName: 'QA', recordType: 'invoice', fontRegularUrl: null });
    const el = await openModal();

    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('ยังไม่ได้ตั้งฟอนต์ไทย');
    expect(text).toContain('customrecord_pld_config');
  });

  it('stays quiet when a font is configured', async () => {
    setContext({ userName: 'QA', recordType: 'invoice', fontRegularUrl: '/core/media/media.nl?id=101' });
    const el = await openModal();

    expect(el.shadowRoot?.textContent ?? '').not.toContain('ยังไม่ได้ตั้งฟอนต์ไทย');
  });

  it('stays quiet outside NetSuite — there is no config record to read', async () => {
    const el = await openModal();

    expect(el.shadowRoot?.textContent ?? '').not.toContain('ยังไม่ได้ตั้งฟอนต์ไทย');
  });
});

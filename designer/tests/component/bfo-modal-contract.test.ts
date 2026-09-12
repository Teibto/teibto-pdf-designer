// @vitest-environment jsdom
/**
 * กล่อง BFO Export ต้องมี binding contract ก่อนถึงจะเตือนฟิลด์นอกสัญญาได้ (#193)
 *
 * คำเตือน "ฟิลด์นี้ engine ไม่ได้จ่าย" อ่านจาก contract ที่ engine ส่งมา เดิม contract
 * ถูกเติมเฉพาะตอนผู้ใช้กดโหลดข้อมูลตัวอย่าง คำเตือนจึงขึ้นบ้างไม่ขึ้นบ้างโดยผู้ใช้ไม่รู้
 * ว่าทำไม — เอกสารคู่มือเขียนไว้ว่ามันขึ้นเสมอ เทสนี้ยึดให้ตรงกับที่เขียน
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from './_harness';

const seen: string[] = [];

beforeEach(() => {
  seen.length = 0;
  (window as any).__NS_CONTEXT__ = { userId: 1, userName: 'QA', recordType: 'invoice' };
  (window as any).__NS_RENDER_URL__ = 'https://sb2.example.com/app/render.nl';
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const action = new URL(String(input), 'https://sb2.example.com').searchParams.get('action') || '';
    seen.push(action);
    if (action === 'sample-data') {
      return new Response(JSON.stringify({
        rectype: 'invoice',
        curated: true,
        data: { tranid: 'SAMPLE-0001' },
        contract: { record: ['tranid'], line: ['amountText'], copy: ['th', 'en', 'label'] },
      }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  delete (window as any).__NS_CONTEXT__;
  delete (window as any).__NS_RENDER_URL__;
  vi.restoreAllMocks();
});

describe('BFO export modal — binding contract (#193)', () => {
  it('เปิดกล่องแล้วดึง contract จาก engine เอง ไม่ต้องรอให้ผู้ใช้กดโหลดตัวอย่างก่อน', async () => {
    const h = await mount();

    h.shell.dispatchEvent(new CustomEvent('pld-show-bfo-export', { bubbles: true, composed: true }));
    await h.flush(120);

    expect(seen).toContain('sample-data');
  });

  it('shows canonical XML unchanged and removes generator-only options in raw mode', async () => {
    const h = await mount();
    const canonical = '<?xml version="1.0"?>\n<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n<pdf><body>${record.tranid!""?xml}</body></pdf>\n';
    h.store.dispatch((draft: any) => {
      draft.editorMode = 'xml';
      draft.rawXml = canonical;
    });

    h.shell.dispatchEvent(new CustomEvent('pld-show-bfo-export', { bubbles: true, composed: true }));
    await h.flush(120);

    const modal = h.comp('pld-bfo-export-modal');
    expect(modal.shadowRoot.querySelector('.xml-code').textContent).toBe(canonical);
    expect(modal.shadowRoot.querySelectorAll('.config-section input')).toHaveLength(0);
    expect(modal.shadowRoot.textContent).toContain('exported exactly as edited');
  });
});

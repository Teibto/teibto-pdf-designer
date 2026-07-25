/**
 * Tests: ด่าน lint ก่อนบันทึกเข้า NetSuite + พรีวิวด้วยข้อมูลตัวอย่าง (#191)
 *
 * lint จะมีประโยชน์ก็ต่อเมื่อมันอยู่บน **ทาง** ที่ XML เดินเข้า account จริง — ไม่ใช่
 * แค่มีฟังก์ชันตรวจไว้เฉย ๆ เทสชุดนี้จึงยึดสองอย่าง: เทมเพลตที่จะพิมพ์ไม่ออกต้องถูก
 * ปฏิเสธ **ก่อน** ยิง POST (ของเดิมบน account ยังไม่ถูกทับ) และคำขอพรีวิวแบบไม่มี
 * record ต้องบอก engine ให้ใช้ข้อมูลตัวอย่าง
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('idb-keyval', () => {
  const mem = new Map<string, unknown>();
  return {
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => { mem.set(k, v); },
    del: async (k: string) => { mem.delete(k); },
    keys: async () => [...mem.keys()],
  };
});

/** XML ที่ผิดกฎแน่ ๆ — binding ข้อมูลที่ไม่ผ่าน ?xml ทำให้ทั้งใบพิมพ์ไม่ออก (#184) */
const BROKEN_XML = '<pdf><body><p>${record.entity!""}</p></body></pdf>';
let exported = BROKEN_XML;
vi.mock('../../src/services/bfo-export.service', () => ({
  exportBfoXml: () => exported,
}));

import { AppStore } from '../../src/state/store';
import { saveTemplateToNetSuite } from '../../src/services/template.service';
import { renderLivePreview, fetchNsSampleData, getCachedBindingContract } from '../../src/services/netsuite-adapter.service';

const originalWindow = (globalThis as { window?: unknown }).window;
let calls: Array<{ action: string; body: unknown }> = [];

/** body ของคำขอ preview-live ที่ถูกยิงออกไป */
function previewBody(): Record<string, unknown> {
  return calls.find((c) => c.action === 'preview-live')!.body as Record<string, unknown>;
}

function mockNs(ctx: Record<string, unknown> = { userId: 1, recordType: 'invoice' }) {
  (globalThis as unknown as { window: unknown }).window = {
    __NS_CONTEXT__: ctx,
    __NS_RENDER_URL__: 'https://sb2.example.com/app/render.nl',
    location: { origin: 'https://sb2.example.com' },
  };
}

beforeEach(() => {
  calls = [];
  mockNs();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const action = url.searchParams.get('action') || '';
    calls.push({ action, body: init?.body ? JSON.parse(String(init.body)) : null });

    if (action === 'save') return new Response(JSON.stringify({ id: '42', success: true }), { status: 200 });
    if (action === 'sample-data') {
      return new Response(JSON.stringify({
        rectype: 'invoice',
        curated: true,
        data: { tranid: 'SAMPLE-0001' },
        contract: { record: ['tranid'], line: ['amountText'], copy: ['th', 'en', 'label'] },
      }), { status: 200 });
    }
    if (action === 'preview-live') {
      return new Response(new Blob(['%PDF']), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    }
    throw new Error(`unexpected action: ${action}`);
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  vi.restoreAllMocks();
  exported = BROKEN_XML;
});

describe('ด่าน lint ก่อนบันทึก (#191)', () => {
  it('เทมเพลตที่จะพิมพ์ไม่ออก ถูกปฏิเสธก่อนยิง POST — ของเดิมบน account ไม่ถูกทับ', async () => {
    const store = new AppStore();

    await expect(saveTemplateToNetSuite(store)).rejects.toThrow(/บันทึกไม่ได้/);
    expect(calls.filter((c) => c.action === 'save')).toHaveLength(0);
  });

  it('ข้อความที่ผู้ใช้เห็นบอกอาการ จำนวนข้อ และที่ดูรายการเต็ม', async () => {
    const store = new AppStore();

    await expect(saveTemplateToNetSuite(store)).rejects.toThrow(/พิมพ์ไม่ออกหรือพิมพ์ออกมาว่าง \(1 ข้อ\)/);
    await expect(saveTemplateToNetSuite(store)).rejects.toThrow(/NetSuite BFO/);
  });

  it('เทมเพลตที่สะอาดบันทึกได้ตามปกติ', async () => {
    exported = '<pdf><body><p>${(record.entity!"")?xml}</p></body></pdf>';
    const store = new AppStore();

    const result = await saveTemplateToNetSuite(store);

    expect(result.id).toBe('42');
    expect(calls.filter((c) => c.action === 'save')).toHaveLength(1);
  });
});

describe('ข้อมูลตัวอย่าง + พรีวิวไร้ record (#191)', () => {
  it('fetchNsSampleData ยิง action=sample-data และเก็บ contract ไว้ให้ lint ใช้', async () => {
    const sample = await fetchNsSampleData('invoice');

    expect(calls[0].action).toBe('sample-data');
    expect(sample.data.tranid).toBe('SAMPLE-0001');
    expect(getCachedBindingContract()).toEqual({
      record: ['tranid'], line: ['amountText'], copy: ['th', 'en', 'label'],
    });
  });

  it('พรีวิวแบบไม่มี record บอก engine ให้ใช้ข้อมูลตัวอย่าง และไม่ส่ง recid', async () => {
    await renderLivePreview({ xml: '<pdf/>', rectype: 'invoice', sample: true });

    expect(previewBody().sample).toBe(true);
    expect(previewBody().recid).toBeUndefined();
  });

  it('พรีวิวที่มี record ยังส่ง recid เหมือนเดิม และไม่ใช่โหมดตัวอย่าง', async () => {
    await renderLivePreview({ xml: '<pdf/>', rectype: 'invoice', recid: '1241568' });

    expect(previewBody().recid).toBe('1241568');
    expect(previewBody().sample).toBe(false);
  });
});

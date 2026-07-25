/**
 * Tests: ฝั่ง SPA ของ template governance (#189)
 *
 * ด่านจริงอยู่ที่ engine — ฝั่งนี้มีหน้าที่ (1) ไม่ชวนให้ผู้ใช้ทำสิ่งที่จะถูกปฏิเสธอยู่ดี
 * (2) แปลคำปฏิเสธเป็นข้อความที่อ่านรู้เรื่อง ไม่ใช่ "true" (3) เรียก history/rollback
 * ให้ถูก action
 *
 * ข้อ (2) เป็น bug ที่มีอยู่จริงตั้งแต่ #157: engine เปลี่ยน body ของ error เป็น
 * `{error: true, message}` แต่ adapter ยัง `throw new Error(result.error)` ผู้ใช้จึงเห็น
 * ข้อความว่า "true" ทุกครั้งที่ save ล้มเหลว
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  canEditNsTemplates,
  getNsTemplateHistory,
  rollbackNsTemplate,
  saveNsTemplate,
  deleteNsTemplate,
  PermissionDeniedError,
} from '../../src/services/netsuite-adapter.service';

const originalWindow = (globalThis as { window?: unknown }).window;

function mockNs(ctx: Record<string, unknown> = {}) {
  (globalThis as unknown as { window: unknown }).window = {
    __NS_CONTEXT__: { userId: 1, ...ctx },
    __NS_RENDER_URL__: 'https://sb2.example.com/app/render.nl',
    location: { origin: 'https://sb2.example.com' },
  };
}

/** ตอบ JSON ก้อนเดียวให้ทุก fetch แล้วคืน URL/method ที่เห็น */
function stubFetch(body: unknown) {
  const seen: { url?: URL; method?: string } = {};
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.url = new URL(String(input));
    seen.method = init?.method;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return seen;
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  vi.restoreAllMocks();
});

describe('canEditNsTemplates (#189)', () => {
  it('นอก NetSuite แก้ได้เสมอ — เทมเพลตอยู่ใน localStorage ไม่มีอะไรให้กัน', () => {
    (globalThis as unknown as { window: unknown }).window = { location: { origin: 'http://localhost' } };
    expect(canEditNsTemplates()).toBe(true);
  });

  it('engine บอกว่าแก้ไม่ได้ = UI เข้าโหมดอ่านอย่างเดียว', () => {
    mockNs({ canEditTemplates: false });
    expect(canEditNsTemplates()).toBe(false);
  });

  it('engine เก่าที่ยังไม่ส่งค่ามา ทำงานเหมือนเดิม — server ยังเป็นคนตัดสินจริง', () => {
    mockNs();
    expect(canEditNsTemplates()).toBe(true);
  });
});

describe('คำปฏิเสธจาก engine (#189)', () => {
  beforeEach(() => mockNs({ canEditTemplates: false }));

  it('save ที่ถูกปฏิเสธโยน PermissionDeniedError พร้อมข้อความจริง ไม่ใช่ "true"', async () => {
    stubFetch({ error: true, denied: true, message: 'บทบาทของคุณไม่มีสิทธิ์แก้ไขเทมเพลตเอกสาร (role 1042)' });

    await expect(saveNsTemplate({ name: 'x', data: '{}', xml: '<pdf/>' }))
      .rejects.toThrow(PermissionDeniedError);
    await expect(saveNsTemplate({ name: 'x', data: '{}', xml: '<pdf/>' }))
      .rejects.toThrow(/role 1042/);
  });

  it('delete ที่ถูกปฏิเสธก็เป็น PermissionDeniedError เหมือนกัน', async () => {
    stubFetch({ error: true, denied: true, message: 'ไม่มีสิทธิ์' });
    await expect(deleteNsTemplate('21')).rejects.toThrow(PermissionDeniedError);
  });

  it('error ทั่วไป (#157) ยังเป็น Error ธรรมดา แต่ข้อความต้องมาจาก message', async () => {
    stubFetch({ error: true, errorId: 'PLD-x-1', message: 'No template found' });

    await expect(deleteNsTemplate('21')).rejects.toThrow('No template found');
    await expect(deleteNsTemplate('21')).rejects.not.toThrow(PermissionDeniedError);
  });
});

describe('ประวัติเวอร์ชัน + กู้คืน (#189)', () => {
  beforeEach(() => mockNs({ canEditTemplates: true }));

  it('getNsTemplateHistory ยิง action=history พร้อม tplid และคืนรายการเวอร์ชัน', async () => {
    const seen = stubFetch({
      tplid: '7',
      canEdit: true,
      keepPayload: 20,
      versions: [
        { id: '501', version: 2, action: 'update', name: 'ใบแจ้งหนี้', rectype: 'invoice', userId: '9', userName: 'สมชาย', roleId: '1017', note: '', hasPayload: true, created: '25/7/2026 10:02' },
        { id: '500', version: 1, action: 'baseline', name: 'ใบแจ้งหนี้', rectype: 'invoice', userId: '9', userName: 'สมชาย', roleId: '1017', note: 'สถานะก่อนเริ่มเก็บประวัติเวอร์ชัน', hasPayload: false, created: '25/7/2026 10:01' },
      ],
    });

    const history = await getNsTemplateHistory('7');

    expect(seen.url!.searchParams.get('action')).toBe('history');
    expect(seen.url!.searchParams.get('tplid')).toBe('7');
    expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(history.versions[1].hasPayload).toBe(false);
  });

  it('rollbackNsTemplate POST พร้อม version และรายงานว่าเป็น record ที่ถูกสร้างใหม่หรือไม่', async () => {
    const seen = stubFetch({ success: true, id: '31', version: 3, restoredFrom: 1, recreated: true });

    const res = await rollbackNsTemplate('7', 1);

    expect(seen.method).toBe('POST');
    expect(seen.url!.searchParams.get('action')).toBe('rollback');
    expect(seen.url!.searchParams.get('version')).toBe('1');
    expect(res).toEqual({ success: true, id: '31', version: 3, restoredFrom: 1, recreated: true });
  });

  it('กู้คืนเวอร์ชันที่เนื้อถูกตัดแล้ว ล้มพร้อมเหตุผล ไม่ใช่เงียบ (R4)', async () => {
    stubFetch({ error: true, message: 'เวอร์ชัน 1 ของเทมเพลต 7 ไม่มีเนื้อไฟล์ให้กู้คืนแล้ว' });
    await expect(rollbackNsTemplate('7', 1)).rejects.toThrow(/ไม่มีเนื้อไฟล์ให้กู้คืน/);
  });
});

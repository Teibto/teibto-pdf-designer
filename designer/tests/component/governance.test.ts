// @vitest-environment jsdom
/**
 * โหมดอ่านอย่างเดียวเมื่อบทบาทแก้เทมเพลตไม่ได้ (#189)
 *
 * engine ปฏิเสธคำขอที่ไม่มีสิทธิ์อยู่แล้ว เทสชุดนี้กันอาการที่แย่กว่านั้นในเชิงประสบการณ์:
 * ผู้ใช้ออกแบบไปครึ่งชั่วโมงแล้วเพิ่งรู้ตอนกดบันทึกว่าตัวเองแก้ไม่ได้ — ปุ่มต้องปิด
 * ตั้งแต่เปิดหน้าจอ พร้อมบอกเหตุผล
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, inShadow } from './_harness';

/** ปุ่มในแถบ actions ที่ข้อความตรงกับที่ส่งมา */
function actionButton(header: any, text: string): HTMLButtonElement | null {
  const buttons = [...header.shadowRoot.querySelectorAll('.actions .btn')] as HTMLButtonElement[];
  return buttons.find((b) => (b.textContent || '').includes(text)) ?? null;
}

function withNsContext(ctx: Record<string, unknown>) {
  (window as any).__NS_CONTEXT__ = { userId: 1, userName: 'QA Tester', ...ctx };
}

afterEach(() => {
  delete (window as any).__NS_CONTEXT__;
});

describe('read-only mode (#189)', () => {
  it('บทบาทที่แก้ไม่ได้ เห็นป้ายล็อกและปุ่มบันทึกถูกปิดพร้อมเหตุผล', async () => {
    withNsContext({ canEditTemplates: false });
    const h = await mount();
    const header = h.comp('pld-header');

    const badge = inShadow(header, '.read-only-badge');
    expect(badge, 'ต้องมีป้ายบอกว่าเปิดอยู่ในโหมดอ่านอย่างเดียว').toBeTruthy();
    expect(badge.getAttribute('title')).toMatch(/Template Editor Roles/);

    const save = actionButton(header, 'บันทึก');
    expect(save?.disabled).toBe(true);
    expect(save?.getAttribute('title')).toMatch(/แก้ไขเทมเพลตไม่ได้/);

    const saveSettings = actionButton(header, 'ตั้งค่าการบันทึก');
    expect(saveSettings?.disabled).toBe(true);
  });

  it('บทบาทที่แก้ได้ ใช้งานได้เหมือนเดิม ไม่มีป้ายล็อก', async () => {
    withNsContext({ canEditTemplates: true });
    const h = await mount();
    const header = h.comp('pld-header');

    expect(inShadow(header, '.read-only-badge')).toBeNull();
    expect(actionButton(header, 'บันทึก')?.disabled).toBe(false);
    expect(actionButton(header, 'ตั้งค่าการบันทึก')?.disabled).toBe(false);
  });

  it('นอก NetSuite ไม่มีอะไรถูกปิด — เทมเพลตอยู่ในเครื่องผู้ใช้เอง', async () => {
    const h = await mount();
    const header = h.comp('pld-header');

    expect(inShadow(header, '.read-only-badge')).toBeNull();
    expect(actionButton(header, 'บันทึก')?.disabled).toBe(false);
  });
});

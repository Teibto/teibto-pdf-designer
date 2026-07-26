// @vitest-environment jsdom
/**
 * Tests: bfo-lint.service.ts (#191)
 *
 * ด่านนี้มีค่าก็ต่อเมื่อสองอย่างจริงพร้อมกัน: (1) มันจับกับดักที่เคยทำให้เอกสารพังจริง
 * และ (2) มันไม่ร้องใส่ผลงานปกติของ generator เอง — ไม่งั้นผู้ใช้จะเรียนรู้ที่จะเมินมัน
 * เทสจึงยิงกฎทีละข้อ **และ** lint เทมเพลตตัวอย่างทุกใบใน repo ว่าต้องไม่มี error เลย
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect } from 'vitest';
import { lintBfoXml, summarizeLint } from '../../src/services/bfo-lint.service';
import { exportBfoXml } from '../../src/services/bfo-export.service';
import { getSampleTemplates } from '../../src/constants/sample-templates';
import { elementsToBands } from '../../src/services/band-layout.service';
import { createDefaultPage } from '../../src/models/page';
import { createDefaultPagination } from '../../src/models/template';
import type { AppState } from '../../src/state/app-state';
import type { DocumentTemplate } from '../../src/models/template';

/** เปลือก XML ที่ผ่านทุกกฎ — เทสแต่ละข้อแทรกเฉพาะสิ่งที่อยากให้ผิด */
function wrap(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
<link name="THSarabunNew" type="font" subtype="truetype" src="\${(company.fontRegular!'')?xml}" bytes="2" />
</head>
<body size="A4">
${inner}
</body>
</pdf>`;
}

const rules = (xml: string) => lintBfoXml(xml).findings.map((f) => f.rule);

describe('กฎที่จับกับดักซึ่งทำให้พิมพ์ไม่ออกทั้งใบ', () => {
  it('เปลือกเปล่า ๆ ผ่านสะอาด', () => {
    const report = lintBfoXml(wrap('<p>สวัสดี</p>'));
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('C-ternary (#1)', () => {
    const report = lintBfoXml(wrap('<p>${record.a > 0 ? "x" : "y"}</p>'));
    expect(report.errors.map((f) => f.rule)).toContain('c-ternary');
    expect(report.ok).toBe(false);
  });

  it('binding ไม่ null-safe (#2)', () => {
    expect(rules(wrap('<p>${record.tranid}</p>'))).toContain('binding-not-null-safe');
  });

  it('binding ที่ถูก guard ไว้ที่อื่นในไฟล์ ไม่ถูกฟ้องซ้ำ', () => {
    const xml = wrap('<#if (record.tranid!"") != ""><p>${record.tranid}</p></#if>');
    expect(rules(xml)).not.toContain('binding-not-null-safe');
  });

  it('binding ข้อมูลที่ไม่ผ่าน ?xml (#184)', () => {
    const report = lintBfoXml(wrap('<p>${record.entity!""}</p>'));
    expect(report.errors.map((f) => f.rule)).toContain('binding-not-xml-escaped');
    expect(report.errors[0].hint).toContain('?xml');
  });

  it('binding ที่ผ่าน ?xml แล้วไม่ถูกฟ้อง', () => {
    expect(rules(wrap('<p>${(record.entity!"")?xml}</p>'))).toEqual([]);
  });

  it('นิพจน์ที่ไม่ใช่ข้อมูล (line_index) ไม่ต้องผ่าน ?xml', () => {
    expect(rules(wrap('<p>${line_index + 1}</p>'))).toEqual([]);
  });

  it('จัดรูปแบบตัวเลขจากค่าที่ยังเป็นข้อความ (#165)', () => {
    expect(rules(wrap('<p>${(record.total!0)?string("#,##0.00")}</p>')))
      .toContain('number-format-in-template');
    expect(rules(wrap('<p>${pldBahtText(record.total)}</p>')))
      .toContain('number-format-in-template');
  });

  it('แปลงเป็นตัวเลขก่อนแล้วจัดรูปแบบ = ใช้ได้จริง ไม่ฟ้อง (path ของ generator)', () => {
    const coerced = wrap('<#assign _cn = line.amount?trim?number><p>${_cn?string("#,##0.00")}</p>');
    expect(rules(coerced)).not.toContain('number-format-in-template');
    const guarded = wrap('<#if _cv?is_number><p>${_cv?string("#,##0.##")}</p></#if>');
    expect(rules(guarded)).not.toContain('number-format-in-template');
  });

  it('<div> ที่ครอบ element ปกติ ไม่ถูกฟ้อง — BFO วาดเป็นกล่อง block ตามปกติ (#195)', () => {
    expect(rules(wrap('<div><p>x</p></div>'))).toEqual([]);
    expect(rules(wrap('<div style="border: 1pt solid #000"><div><p>x</p></div></div>'))).toEqual([]);
  });

  it('ข้อความเปล่าใน <div> บล็อกการบันทึก — เนื้อหาหายจริงจากเอกสาร (#195)', () => {
    const bare = lintBfoXml(wrap('<div>ข้อความนี้จะหาย</div>'));
    expect(bare.errors.map((f) => f.rule)).toContain('div-bare-text');
    expect(bare.ok).toBe(false);

    // ข้อความที่คั่นระหว่าง element ก็หายเหมือนกัน
    const tail = lintBfoXml(wrap('<div><p>ok</p> ต่อท้ายแบบเปล่า</div>'));
    expect(tail.errors.map((f) => f.rule)).toContain('div-bare-text');
  });

  it('CSS ที่ BFO เมินเป็นคำเตือน — เอกสารยังพิมพ์ออก (#5/#195)', () => {
    const report = lintBfoXml(wrap('<p style="text-overflow: ellipsis">x</p>'));
    expect(report.warnings.map((f) => f.rule)).toContain('unsupported-css');
    expect(report.ok).toBe(true);
    // ข้อความต้องบอกความจริงว่าอะไรทำงานอะไรไม่ทำงาน ไม่ใช่แค่ว่า "ไม่รองรับ"
    expect(report.warnings.find((f) => f.rule === 'unsupported-css')!.message)
      .toMatch(/ตัดห้วน/);
    expect(rules(wrap('<p style="object-fit: cover">x</p>'))).toContain('unsupported-css');
  });

  it('เลขหน้าแบบ CSS บล็อก — เอกสารจะไม่มีเลขหน้าเลย (#3)', () => {
    const report = lintBfoXml(wrap('<p>${counter(page)}</p>'));
    expect(report.errors.map((f) => f.rule)).toContain('page-counter-css');
    expect(report.errors.find((f) => f.rule === 'page-counter-css')!.hint).toContain('<pagenumber/>');
  });

  it('ฟอนต์ที่ฝัง URL ไว้ (#32/#156)', () => {
    const baked = wrap('<p>x</p>').replace(
      /src="[^"]*"/,
      'src="https://acct.app.netsuite.com/core/media/media.nl?id=1&amp;h=abc"',
    );
    expect(rules(baked)).toContain('font-link-baked');
  });

  it('ไม่มี font link เลย = เตือน (ไทยหายเงียบ) แต่ไม่บล็อก', () => {
    const noFont = wrap('<p>x</p>').replace(/<link[^>]*>/, '');
    const report = lintBfoXml(noFont);
    expect(report.warnings.map((f) => f.rule)).toContain('font-link-missing');
    expect(report.ok).toBe(true);
  });

  it('รูปที่กำหนดขนาดด้านเดียว (#178)', () => {
    expect(rules(wrap('<img src="x.png" style="width: 64pt" />'))).toContain('img-one-dimension');
    expect(rules(wrap('<img src="x.png" style="max-width: 100%" />'))).toContain('img-one-dimension');
    expect(rules(wrap('<img src="x.png" style="width: 150pt; height: 40pt" />'))).toEqual([]);
  });

  it('XML ที่ไม่ well-formed', () => {
    const broken = '<pdf><body><p>ไม่ปิดแท็ก</body></pdf>';
    expect(rules(broken)).toContain('xml-not-well-formed');
  });

  it('comment ไม่ถูกนับเป็น binding', () => {
    expect(rules(wrap('<!-- ตัวอย่าง: ${record.tranid} --><p>ok</p>'))).toEqual([]);
  });

  it('กฎเดียวกันที่จุดเดียวกันรายงานครั้งเดียว', () => {
    const many = wrap('<p>${record.entity!""}</p>'.repeat(5));
    const report = lintBfoXml(many);
    expect(report.errors.filter((f) => f.rule === 'binding-not-xml-escaped')).toHaveLength(1);
  });
});

describe('binding contract จาก engine', () => {
  const contract = { record: ['tranid', 'totalText'], line: ['amountText'], copy: ['th', 'en', 'label'] };

  it('key ที่ engine ไม่จ่ายเป็น warning ไม่ใช่ error — มันพิมพ์ว่าง ไม่ได้พัง', () => {
    const report = lintBfoXml(wrap('<p>${(record.nosuchfield!"")?xml}</p>'), contract);
    expect(report.warnings.map((f) => f.rule)).toContain('binding-not-in-contract');
    expect(report.ok).toBe(true);
  });

  it('key ที่อยู่ใน contract และ custbody_* ไม่ถูกเตือน', () => {
    const xml = wrap('<p>${(record.tranid!"")?xml}${(record.custbody_x!"")?xml}</p>');
    expect(lintBfoXml(xml, contract).warnings).toEqual([]);
  });

  it('ไม่ส่ง contract มา = ไม่ตรวจข้อนี้', () => {
    expect(rules(wrap('<p>${(record.nosuchfield!"")?xml}</p>'))).toEqual([]);
  });
});

describe('เทมเพลตตัวอย่างทุกใบใน repo ต้อง lint ผ่าน', () => {
  function stateFor(tpl: DocumentTemplate): AppState {
    return {
      elements: tpl.elements,
      bands: tpl.bands?.length ? tpl.bands : elementsToBands(tpl.elements),
      selectedId: null,
      multiSelect: [],
      zoom: 100,
      clipboard: [],
      page: tpl.page ?? createDefaultPage(),
      jsonData: null,
      jsonKeys: [],
      pagination: tpl.pagination ?? createDefaultPagination(),
      currentPage: 1,
      totalPages: 1,
      template: { id: null, name: tpl.name, isDirty: false },
      view: 'design' as const,
      dragType: null,
      isExporting: false,
      grid: { enabled: true, size: 10, snapToGrid: false, showRulers: true, showGuides: true },
      contextMenu: { show: false, x: 0, y: 0, elementId: null },
      copies: tpl.copies,
    } as AppState;
  }

  for (const tpl of getSampleTemplates()) {
    it(`"${tpl.name}" ออกมาแล้วไม่มี error`, () => {
      const xml = exportBfoXml(stateFor(tpl), { useBands: true, useFreeMarker: true, includePageHeaders: true });
      const report = lintBfoXml(xml);
      // generator เป็นคนสร้าง XML นี้ — ผิดกฎเมื่อไหร่แปลว่า generator มีบั๊ก
      // ไม่ใช่ว่ากฎเข้มไป (ห้ามผ่อนกฎเพื่อให้เทสเขียว)
      expect(report.errors.map((f) => `${f.rule}: ${f.message} ${f.sample ?? ''}`)).toEqual([]);
      // และต้องไม่เตือนเรื่อง CSS ที่ BFO เมินด้วย (#195) — ปล่อยให้เตือนทุกครั้งที่ export
      // คือการสอนผู้ใช้ให้เลิกอ่านคำเตือน แล้วข้อที่สำคัญจริงก็จะถูกมองข้ามไปด้วย
      expect(report.warnings.filter((f) => f.rule === 'unsupported-css')).toEqual([]);
    });
  }
});

describe('summarizeLint', () => {
  it('ย่อผลตรวจให้อ่านได้ในข้อความเดียว และบอกว่ายังมีอีกกี่ข้อ', () => {
    const report = lintBfoXml(wrap('<p>${record.a}${record.b}${record.c}${record.d}</p>'));
    const text = summarizeLint(report, 2);
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toMatch(/และอีก \d+ ข้อ/);
  });
});

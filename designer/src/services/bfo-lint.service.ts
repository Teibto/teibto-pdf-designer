/**
 * BFO / FreeMarker lint สำหรับ XML ที่ดีไซเนอร์สร้าง (#191)
 *
 * `scripts/validate-templates.sh` บังคับกับดักชุดนี้กับ `templates/master/` ตั้งแต่ CI
 * แต่ XML ที่ผู้ใช้ออกแบบเองแล้ว save ตรงเข้า `customrecord_pld_template` ของ account
 * ไม่เคยผ่านกฎเหล่านี้เลยสักข้อ — กับดักที่ทีมจ่ายบทเรียนมาแล้วทุกข้อจึงกลับมาเกิดใหม่ได้
 * ทุกครั้งที่มีคนออกแบบเอง แล้วไปโผล่ตอนกดพิมพ์ที่หน้างานลูกค้า ไฟล์นี้ย้ายด่านนั้นมาไว้
 * ในดีไซเนอร์.
 *
 * ทุกกฎมาจากบั๊กที่เกิดจริง เลข # ท้ายข้อความคือ issue ที่จ่ายค่าบทเรียนไปแล้ว —
 * เพิ่มกฎใหม่เมื่อไหร่ ให้เพิ่มที่ `scripts/validate-templates.sh` ด้วยเสมอ ทั้งสองที่
 * คุมทางเข้าคนละทางของ XML ก้อนเดียวกัน
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */

export type LintSeverity = 'error' | 'warning';

export interface LintFinding {
  /** รหัสกฎ — ใช้อ้างในเอกสาร/บั๊กรีพอร์ต */
  rule: string;
  severity: LintSeverity;
  /** อาการที่จะเกิดถ้าปล่อยไว้ (ภาษาไทย, ผู้ใช้อ่านรู้เรื่อง) */
  message: string;
  /** ทางแก้ */
  hint: string;
  /** ตัวอย่างจุดที่เจอในไฟล์ */
  sample?: string;
}

export interface LintReport {
  findings: LintFinding[];
  errors: LintFinding[];
  warnings: LintFinding[];
  /** ไม่มี error — บันทึกเข้า NetSuite ได้ */
  ok: boolean;
}

/** binding contract ที่ engine ประกาศ (มาจาก ?action=sample-data) */
export interface BindingContract {
  record: string[];
  line: string[];
  copy: string[];
}

const INTERP = /\$\{[\s\S]*?\}/g;
/** binding ที่ค่ามาจากข้อมูล — ต้องผ่าน ?xml ทุกตัว (#184) */
const DATA_BINDING = /(^|[^A-Za-z0-9_.])(record|line|company|copy)\./;
/** `${record.x}` ตรง ๆ (ไม่มี builtin/ตัวดำเนินการ) — ต้องมี ! (#2) */
const FIELD_BINDING = /^\s*(record|line|company)\.[A-Za-z0-9_]+\s*$/;
const FONT_LINK = /<link\b[^>]*type\s*=\s*"font"[^>]*>/gi;

/**
 * ความรุนแรงของกฎแบ่งตาม **น้ำหนักหลักฐาน** ไม่ใช่ตามความน่ากลัวของชื่อกฎ:
 *
 * - `error` = พิสูจน์แล้วว่าทำให้เอกสารพิมพ์ไม่ออกหรือพิมพ์ว่าง (มี issue กำกับทุกข้อ)
 * - `warning` = เอกสารพิมพ์ออก แต่หน้าตาบนกระดาษอาจไม่ตรงกับที่เห็นในดีไซเนอร์
 *
 * `scripts/validate-templates.sh` เข้มกว่าไฟล์นี้ในบางข้อโดยตั้งใจ — master pack
 * เขียนด้วยมือและผ่านการรีวิว จึงยึดกฎที่เข้มที่สุดได้ ส่วนที่นี่ต้องไม่ฟ้องผลงานปกติ
 * ของ generator เอง ไม่งั้นผู้ใช้จะเรียนรู้ที่จะกดข้ามทุกครั้งแล้วด่านนี้ก็ไร้ค่า
 */
const IGNORED_CSS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'object-fit', pattern: /object-fit/i },
  { label: 'text-overflow', pattern: /text-overflow/i },
  { label: '-webkit-*', pattern: /-webkit-/i },
];

/** เลขหน้าที่ BFO ไม่รู้จัก — พิมพ์ออกแต่ไม่มีเลขหน้าเลย (#3) */
const PAGE_COUNTER_CSS: Array<{ label: string; pattern: RegExp }> = [
  { label: '@page margin box', pattern: /@page\b[^{]*\{[^}]*@(?:top|bottom|left|right)-/i },
  { label: 'counter(page)', pattern: /counter\s*\(\s*page\s*\)/i },
];

/** ตัด comment ทั้ง XML และ FreeMarker — ตัวอย่างโค้ดใน comment ไม่ใช่ binding จริง */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->|<#--[\s\S]*?-->/g, '');
}

/** ตัด FreeMarker ออกให้เหลือ XML ล้วน สำหรับเช็ค well-formed */
function maskFreeMarker(src: string): string {
  return src
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/\$\{[\s\S]*?\}/g, 'X')
    .replace(/<\/?#[^>]*>/g, '')
    .replace(/<\/?@[^>]*>/g, '');
}

/**
 * `${cond ? a : b}` ไม่ใช่ syntax ของ FreeMarker (#1) — builtin คือ `?` ตามด้วย
 * ตัวอักษรเสมอ ดังนั้น `?` ที่ตามด้วยอย่างอื่นแล้วมี `:` ต่อท้ายใน `${}` เดียวกัน
 * คือ C-ternary ซึ่งทำให้ทั้งเทมเพลต parse ไม่ผ่าน
 */
function isCTernary(interp: string): boolean {
  const body = interp.slice(2, -1);
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '?') continue;
    const next = body[i + 1] || '';
    if (/[A-Za-z]/.test(next)) continue;
    if (body.indexOf(':', i + 1) !== -1) return true;
  }
  return false;
}

/** `<img>` ต้องได้กล่องครบสองแกน ไม่งั้น BFO วาดขนาดจริงแล้วล้นหน้า (#178) */
function imgMissingBox(tag: string): boolean {
  const hasWidth = /(?:^|[\s;"'{])width\s*[:=]/i.test(tag);
  const hasHeight = /(?:^|[\s;"'{])height\s*[:=]/i.test(tag);
  const hasMaxOnly = /max-width\s*:/i.test(tag) && !hasHeight;
  return hasMaxOnly || hasWidth !== hasHeight;
}

/**
 * ตัวแปรที่ถูกแปลงเป็นตัวเลขแล้วในไฟล์ — `<#assign x = …?number>` หรือกิ่งที่
 * ป้องกันด้วย `x?is_number` · `?string("…")` บนตัวแปรพวกนี้ทำงานจริง (#165)
 */
function numericSafeVars(body: string): Set<string> {
  const safe = new Set<string>();
  for (const m of body.matchAll(/<#assign\s+([A-Za-z_][A-Za-z0-9_]*)\s*=[^>]*\?number/g)) {
    safe.add(m[1]);
  }
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\?is_number/g)) {
    safe.add(m[1]);
  }
  return safe;
}

/** ตัวอย่างสั้น ๆ ของจุดที่เจอ — ยาวเกินไปทำให้อ่านไม่ออกในโมดัล */
function snippet(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * ตรวจ XML ที่ `bfo-export.service.ts` สร้าง
 *
 * @param xml       BFO XML เต็มไฟล์
 * @param contract  binding contract จาก engine (ถ้ามี) — ใช้เตือน key ที่ engine ไม่จ่าย
 */
export function lintBfoXml(xml: string, contract?: BindingContract | null): LintReport {
  const findings: LintFinding[] = [];
  const seen = new Set<string>();

  const add = (f: LintFinding) => {
    // กฎเดียวกันที่จุดเดียวกัน รายงานครั้งเดียว — เทมเพลตหนึ่งใบมี binding เป็นร้อยจุด
    const key = `${f.rule}|${f.sample ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  const body = stripComments(xml);
  const interps = body.match(INTERP) ?? [];

  // ── 1) XML well-formed หลัง mask FreeMarker ────────────────────────────────
  // BFO parse ผลลัพธ์ของ FreeMarker เป็น XML อีกที ไฟล์ที่ไม่ well-formed จึงพิมพ์
  // ไม่ออกทั้งใบ ไม่ใช่แค่ส่วนที่ผิด
  const wellFormedError = parseError(maskFreeMarker(xml));
  if (wellFormedError) {
    add({
      rule: 'xml-not-well-formed',
      severity: 'error',
      message: 'ไฟล์ XML ไม่ well-formed — BFO จะพิมพ์ไม่ออกทั้งใบ',
      hint: 'ตรวจแท็กที่เปิดแล้วไม่ปิด หรือเครื่องหมาย < > ในข้อความที่ยังไม่ถูก escape',
      sample: snippet(wellFormedError),
    });
  }

  // ── 2) C-ternary (#1) ─────────────────────────────────────────────────────
  for (const interp of interps) {
    if (!isCTernary(interp)) continue;
    add({
      rule: 'c-ternary',
      severity: 'error',
      message: 'ใช้ `a ? b : c` ซึ่งไม่ใช่ syntax ของ FreeMarker — ทั้งเทมเพลตจะ parse ไม่ผ่าน',
      hint: 'ใช้ `?then(a, b)` หรือ `<#if>` แทน',
      sample: snippet(interp),
    });
  }

  // ── 3) binding ต้อง null-safe (#2) ────────────────────────────────────────
  for (const interp of interps) {
    const inner = interp.slice(2, -1);
    if (!FIELD_BINDING.test(inner)) continue;
    // field เดียวกันถูก guard ไว้ที่อื่นในไฟล์ = ตั้งใจและปลอดภัย (กฎเดียวกับ validator)
    if (body.includes(`${inner.trim()}!`)) continue;
    add({
      rule: 'binding-not-null-safe',
      severity: 'error',
      message: 'binding ไม่มีค่าสำรอง — ฟิลด์ที่ว่างบนเอกสารจริงจะทำให้ render ล้ม',
      hint: 'เขียนเป็น ${' + inner.trim() + '!""} เสมอ',
      sample: snippet(interp),
    });
  }

  // ── 4) binding ของข้อมูลต้องผ่าน ?xml (#184) ───────────────────────────────
  for (const interp of interps) {
    const inner = interp.slice(2, -1).trim();
    if (!DATA_BINDING.test(inner)) continue;      // ${line_index + 1} ฯลฯ ไม่ใช่ข้อมูล
    if (/\?xml\s*$/.test(inner)) continue;
    add({
      rule: 'binding-not-xml-escaped',
      severity: 'error',
      message: 'binding ไม่ผ่าน ?xml — ข้อมูลที่มี & หรือ < (เช่นชื่อสินค้า "Laser & Inkjet") ทำให้พิมพ์ไม่ออกทั้งใบ',
      hint: 'เขียนเป็น ${(' + snippet(inner, 40) + ')?xml}',
      sample: snippet(interp),
    });
  }

  // ── 5) จัดรูปแบบตัวเลขจากค่าที่ยังไม่ถูกแปลงเป็นตัวเลข (#165) ──────────────
  // ทุกค่าที่ข้าม data source ถึง FreeMarker เป็น "ข้อความ" เสมอ (พิสูจน์บน SB2)
  // `?string("#,##0.00")` บนข้อความจึงคืนค่าว่างโดยไม่ error → ช่องเงินว่างเงียบ ๆ
  // แต่การแปลงเป็นตัวเลขก่อน (`?number` / กิ่ง `?is_number`) ใช้ได้จริง — เป็น
  // path ที่ generator ใช้อยู่และพิสูจน์แล้วว่าเลขขึ้น กฎนี้จึงดูที่ "แปลงหรือยัง"
  const numericSafe = numericSafeVars(body);
  for (const interp of interps) {
    const at = interp.search(/\?string\s*[[(]/);
    if (at < 0) continue;
    const operand = interp.slice(2, at);
    if (/\?number/.test(operand)) continue;
    const ids = operand.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    if (ids.some((id) => numericSafe.has(id))) continue;
    add({
      rule: 'number-format-in-template',
      severity: 'error',
      message: 'จัดรูปแบบตัวเลขจากค่าที่ยังเป็นข้อความ — `?string(...)` จะคืนค่าว่างโดยไม่มี error ช่องนั้นจะพิมพ์ออกมาว่าง',
      hint: 'พิมพ์ค่าที่ engine จัดรูปแบบมาแล้ว (${record.totalText} / ${line.amountText}) หรือแปลงเป็นตัวเลขด้วย ?number ก่อน',
      sample: snippet(interp),
    });
  }
  if (body.includes('pldBahtText(')) {
    add({
      rule: 'number-format-in-template',
      severity: 'error',
      message: 'เรียก pldBahtText() ในเทมเพลต — ทำเลขคณิตกับค่าที่เป็นข้อความ จึงคืนค่าว่างเสมอ',
      hint: 'ใช้ ${record.bahtText} ที่ engine คำนวณมาให้',
    });
  }

  // ── 6) <div> (#10) ────────────────────────────────────────────────────────
  // กฎของ repo บอกให้เลี่ยง <div> เพราะ BFO เคยทิ้งทั้ง element เงียบ ๆ — แต่
  // generator ใช้ <div> เป็นกล่องจัดวางของ header/content/summary/footer และ
  // เทมเพลตเหล่านั้นพิมพ์ออกจริงบน SB2 มาตลอด จึงเป็นคำเตือน ไม่ใช่ตัวบล็อก
  // (ดู PR ของ #191 — ข้อนี้รอผลตรวจสดเพื่อชี้ขาดว่ากฎเดิมแคบกว่าที่เขียนไว้แค่ไหน)
  if (/<div\b/i.test(body)) {
    add({
      rule: 'div-element',
      severity: 'warning',
      message: '<div> — กฎของ repo ให้เลี่ยง เพราะ BFO เคยทิ้งทั้ง element เงียบ ๆ',
      hint: 'กล่องที่พิสูจน์แล้วว่าปลอดภัยคือ <p> และ <table>',
    });
  }

  // ── 7) CSS ที่ BFO เมินเงียบ (#5) ─────────────────────────────────────────
  for (const { label, pattern } of IGNORED_CSS) {
    if (!pattern.test(body)) continue;
    add({
      rule: 'unsupported-css',
      severity: 'warning',
      message: `CSS \`${label}\` — เอกสารยังพิมพ์ออก แต่ BFO เมินคุณสมบัตินี้ ผลบนกระดาษจะไม่ตรงกับที่เห็นในดีไซเนอร์`,
      hint: 'คุมขนาดด้วยความกว้าง/ความสูงของกล่อง และตัดข้อความด้วยความกว้างคอลัมน์แทน',
    });
  }

  // ── 8) เลขหน้าแบบ CSS (#3) — พิมพ์ออกแต่ไม่มีเลขหน้าเลย ─────────────────
  for (const { label, pattern } of PAGE_COUNTER_CSS) {
    if (!pattern.test(body)) continue;
    add({
      rule: 'page-counter-css',
      severity: 'error',
      message: `\`${label}\` — BFO ไม่รองรับ เลขหน้าจะไม่ขึ้นเลยบนเอกสารที่พิมพ์ออกมา`,
      hint: 'ใช้ <pagenumber/> และ <totalpages/> ใน <macrolist> แทน',
    });
  }

  // ── 8) ฟอนต์ต้องมาจาก config ของ account (#32/#156) ────────────────────────
  const fontLinks = body.match(FONT_LINK) ?? [];
  if (fontLinks.length === 0) {
    add({
      rule: 'font-link-missing',
      severity: 'warning',
      message: 'ไม่มี <link type="font"> ในไฟล์ — ตัวอักษรไทยจะหายไปจาก PDF โดยไม่มี error',
      hint: 'ฟอนต์ต้องมาจาก ${company.fontRegular} ของ config record',
    });
  }
  for (const link of fontLinks) {
    if (!link.includes('company.fontRegular')) {
      add({
        rule: 'font-link-baked',
        severity: 'error',
        message: 'ฟอนต์ถูกฝัง URL ไว้ในเทมเพลต — URL ของ File Cabinet มี token ที่หมดอายุ แล้วภาษาไทยจะหายเงียบ ๆ ทีหลัง',
        hint: 'bind ${(company.fontRegular!\'\')?xml} ให้ config record เป็นคนจ่ายฟอนต์',
        sample: snippet(link),
      });
    } else if (!link.includes('?xml')) {
      add({
        rule: 'font-link-baked',
        severity: 'error',
        message: 'ค่า src ของฟอนต์ไม่ผ่าน ?xml — URL ที่มี & ดิบทำให้ BFO parse ไม่ผ่าน',
        hint: 'ครอบด้วย ?xml เช่น ${(company.fontRegular!\'\')?xml}',
        sample: snippet(link),
      });
    }
  }

  // ── 9) <img> ต้องมีกล่องครบสองแกน (#178) ──────────────────────────────────
  for (const tag of body.match(/<img\b[^>]*>/gi) ?? []) {
    if (!imgMissingBox(tag)) continue;
    add({
      rule: 'img-one-dimension',
      severity: 'error',
      message: 'รูปกำหนดขนาดด้านเดียว — BFO ย่อรูปก็ต่อเมื่อได้ทั้งกว้างและสูง มิฉะนั้นจะวาดขนาดจริงแล้วล้นหน้า ดันเนื้อหาตกหน้า',
      hint: 'กำหนด width และ height คู่กันเสมอ',
      sample: snippet(tag),
    });
  }

  // ── 10) key ที่ engine ไม่ได้จ่าย (#155) ──────────────────────────────────
  if (contract) {
    checkContract(body, contract, add);
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  return { findings, errors, warnings, ok: errors.length === 0 };
}

/**
 * key ที่หลุด contract ไม่ error — มันพิมพ์ออกมาว่างเงียบ ๆ เพราะ binding null-safe
 * กลืนไว้ (#155) จึงเป็น warning ที่ต้องเห็น ไม่ใช่ error ที่บล็อก: contract รู้จัก
 * เฉพาะ rectype ที่ engine curate และ template อาจตั้งใจ bind `custbody_*` ของ account
 */
function checkContract(
  body: string,
  contract: BindingContract,
  add: (f: LintFinding) => void,
): void {
  const scan = (
    pattern: RegExp,
    allowed: string[],
    alias: 'record' | 'line' | 'copy',
    consequence: string,
  ) => {
    if (!allowed.length) return;
    const known = new Set(allowed);
    for (const match of body.matchAll(pattern)) {
      const key = match[1];
      // `custbody_*` ของ account ถูก republish ไว้ที่ระดับบนสุดอยู่แล้ว
      if (alias === 'record' && key.startsWith('custbody_')) continue;
      if (known.has(key)) continue;
      add({
        rule: 'binding-not-in-contract',
        severity: 'warning',
        message: `\${${alias}.${key}} ไม่อยู่ในรายการที่ engine จ่ายให้ — ${consequence}`,
        hint: 'เลือกฟิลด์จากรายการที่มีให้ หรือแจ้งทีมให้เพิ่มฟิลด์นี้ใน engine',
        sample: `${alias}.${key}`,
      });
    }
  };

  scan(/(?:^|[^A-Za-z0-9_.])record\.([A-Za-z_][A-Za-z0-9_]*)/g, contract.record, 'record',
    'ช่องนี้จะพิมพ์ออกมาว่างโดยไม่มี error');
  scan(/(?:^|[^A-Za-z0-9_.])line\.([A-Za-z_][A-Za-z0-9_]*)/g, contract.line, 'line',
    'คอลัมน์นี้ในตารางจะว่างทุกแถว');
  scan(/(?:^|[^A-Za-z0-9_.])copy\.([A-Za-z_][A-Za-z0-9_]*)/g, contract.copy, 'copy',
    'ป้ายชุดเอกสารจะไม่ขึ้น');
}

/**
 * ข้อความ error ของ parser ถ้า XML ไม่ well-formed, `null` ถ้าผ่าน
 * ใช้ DOMParser ที่มีอยู่แล้วทั้งในเบราว์เซอร์และ jsdom — ไม่ต้องเพิ่ม dependency
 */
function parseError(masked: string): string | null {
  // ดีไซเนอร์รันในเบราว์เซอร์เสมอ จึงมี DOMParser เสมอ · ที่ยอมข้ามได้คือบริบทที่ไม่มี
  // DOM (เช่น unit test ที่รันบน node ล้วน) ซึ่งไม่ใช่ทางที่ผู้ใช้เดิน — กฎที่เหลือ
  // ทั้งหมดยังตรวจตามปกติ และ engine ยังล้มดัง ๆ อยู่ดีถ้า XML ไม่ well-formed
  if (typeof DOMParser === 'undefined') return null;

  const start = masked.indexOf('<pdf');
  const doc = new DOMParser().parseFromString(
    start >= 0 ? masked.slice(start) : masked,
    'application/xml',
  );
  const err = doc.querySelector('parsererror');
  return err ? err.textContent || 'XML parse error' : null;
}

/**
 * สรุปผลตรวจเป็นข้อความบรรทัดเดียวสำหรับ toast/error ตอนบันทึก
 * แสดงไม่เกิน `max` ข้อ — รายการเต็มอยู่ในโมดัล BFO Export
 */
export function summarizeLint(report: LintReport, max = 3): string {
  const shown = report.errors.slice(0, max)
    .map((f) => `• ${f.message}${f.sample ? ` (${f.sample})` : ''}`)
    .join('\n');
  const rest = report.errors.length - Math.min(max, report.errors.length);
  return rest > 0 ? `${shown}\n• …และอีก ${rest} ข้อ` : shown;
}

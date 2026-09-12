# CLAUDE.md — teibto-pdf-designer

@AGENTS.md

## Repo นี้คืออะไร

NetSuite PDF Template Product ของ Teibto (internal, classification: **Internal**) — 3 ชั้น:

1. `engine/` — SuiteScript render engine: Suitelet `pld_sl_render_pdf.js` โหลด BFO XML จาก custom record `customrecord_pld_template` แล้ว render ผ่าน `N/render` (FreeMarker), Suitelet `pld_sl_designer.js` host SPA + CRUD template, UE `pld_ue_button.js` เพิ่มปุ่มบน transaction
2. `templates/` — Standard Template Pack: master BFO XML ต่อประเภทเอกสาร (ใบกำกับภาษี, Invoice, PO, …) — **นี่คือ source of truth** ไม่ใช่ designer JSON
3. `designer/` — Lit 3 + TypeScript SPA (Vite): visual designer, export BFO XML ผ่าน `src/services/bfo-export.service.ts`

## กติกากลาง

ทุก golden rule อยู่ที่ [teibto-dev-standards](https://github.com/Teibto/teibto-dev-standards) — **applied version: tag `v0.14.0`** — ห้าม copy rules มาไว้ที่นี่ (R10)

Rules ที่เจอบ่อยใน repo นี้:
- **R6**: รัน `bash scripts/secret-scan.sh` ก่อน commit เสมอ — ห้ามแก้ script นี้ (canonical อยู่ repo กลาง)
- **R1**: ไฟล์ source ใหม่/rewrite ใส่ `@author <ชื่อจริงผู้รับผิดชอบ>` + `@since YYYY-MM-DD` — ห้ามเดาชื่อ
- **R4**: engine ห้าม silent fallback — render ล้มเหลวต้อง error ให้เห็น ไม่คืน PDF เปล่า
- **Data classification (Internal)**: ห้าม commit ข้อมูลจริงจาก account ลูกค้า — `templates/samples/` ใช้ข้อมูลสังเคราะห์เท่านั้น
- CLI ที่ข้าม template (`gh issue create`, `gh pr create`) ต้อง mirror โครง issue form / PR template เองครบทุกหัวข้อ

## หลักสถาปัตยกรรมที่ห้ามละเมิด

- **BFO เป็น render engine เดียว** — ห้ามเพิ่ม render path ใหม่ที่ให้ผลต่างจาก `N/render` (บทเรียน: เคยมี 3 engines — jsPDF, client BFO generator, Suitelet fallback generator — ผลไม่ตรงกัน)
- **Template XML คือ source of truth** — visual designer สร้าง XML ผ่าน generator เดียว; โหมด XML ที่ผู้ใช้ร้องขอใน #207 แก้ BFO/FreeMarker โดยตรงและใช้ Preview/Save เดิม. ห้ามแปลง XML เป็น visual state แบบสูญเสียข้อมูล. การปรับ canonical pack ต้องนำ XML กลับเข้า `templates/master/` ผ่าน PR ไม่ปล่อยให้ source ใน account ต่างจาก repository โดยไม่มีการตามเก็บ
- **BFO generator มีที่เดียว** คือ `designer/src/services/bfo-export.service.ts` — ห้ามเพิ่ม generator ซ้ำใน Suitelet
- FreeMarker: ห้าม ternary `${a ? b : c}` (ไม่ใช่ syntax FreeMarker — ใช้ `?then()` หรือ `<#if>`), binding ทุกตัวต้อง null-safe `${record.field!""}`
- CSS ที่ BFO ไม่รองรับ (เช่น `object-fit`, `text-overflow: ellipsis`, CSS `@page` margin boxes + `counter()`) — header/footer ซ้ำทุกหน้าใช้ `<macrolist>` + `<pagenumber/>`/`<totalpages/>`
- ฟอนต์ไทยฝั่ง server ต้อง `<link name="..." type="font">` จาก File Cabinet — ฟอนต์ระบบอย่าง Tahoma ไม่มีใน BFO

## Workflow แนะนำ (token-saving)

- อ่าน `docs/architecture/OVERVIEW.md` ก่อนเริ่มงานใหม่ — มี map ของ services/components ทั้งหมด
- `designer/src/` มี 60+ ไฟล์ — เปิดเฉพาะไฟล์ที่เกี่ยว อย่าโหลดทั้งโฟลเดอร์; จุดศูนย์กลาง: `state/store.ts` (Lit Context + Immer), `state/actions.ts`, `services/bfo-export.service.ts`
- งาน NetSuite deploy/QA ใช้ skill: `netsuite-qa-browser`, `netsuite-suiteql`, `netsuite-suitelet`

## ห้ามทำใน repo นี้

- ห้าม commit `project.json` ที่มี authid จริง, `.env`, `.qa-profiles/`
- ห้ามใส่ตัวเลขเงิน/ชื่อคู่ค้าจริงของลูกค้าใน template samples, test, screenshot ใน Issue/PR
- ห้าม push ตรงเข้า `main` (ยกเว้น docs-only ตามที่ CONTRIBUTING อนุญาต — ไฟล์กติกาต้องผ่าน PR เสมอ)

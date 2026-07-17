# templates/ — Standard Template Pack

**Source of truth ของ product** — master BFO XML ต่อประเภทเอกสาร แก้ผ่าน PR เท่านั้น

```
master/    BFO XML ต้นแบบ: tax-invoice, invoice, purchase-order, delivery-note, receipt, quotation
samples/   sample data สังเคราะห์ (JSON) สำหรับ preview/QA — ห้ามใช้ข้อมูลจริงจาก account ลูกค้า
```

กติกา template ทุกไฟล์ (ดูรายละเอียด `docs/TOOLSTACK.md` §กับดัก) — บังคับใน CI ด้วย `scripts/validate-templates.sh`:
- binding ทุกตัว null-safe: `${record.field!""}`
- header/footer ผ่าน `<macrolist>` + `<pagenumber/>`/`<totalpages/>` — ไม่ใช้ CSS `@page` margin boxes
- ฟอนต์ไทยผ่าน `<link type="font">` src `${(company.fontRegular!'')?xml}` (ตัวฟอนต์ต้องเป็น **THSarabunPSK** — THSarabunNew ทำวรรณยุกต์ลอยเพราะ BFO ไม่ apply GPOS, #32)
- จุดที่ลูกค้าต่างกัน (โลโก้ สี ที่อยู่) parameterize ผ่าน `${company.*}` / `<#if>` — ไม่ fork ไฟล์ต่อลูกค้าใน repo นี้

ก่อน push: `bash scripts/validate-templates.sh` — จับ XML ไม่ well-formed, C-ternary, binding ไม่ null-safe, font ที่ bake URL, CSS ที่ BFO ไม่รองรับ, `<div>`, sample JSON เสีย

ค่าเฉพาะ account ทั้งหมด — รวม URL ฟอนต์ไทย (มี `h=` token จึง commit ไม่ได้) — มาจาก config
record `customrecord_pld_config` ผ่าน `${company.*}` (#9): ไฟล์ master save เข้า account ได้ตรง ๆ
โดยไม่ต้องแก้ไฟล์ · ตั้งค่า config ตาม `engine/DEPLOYMENT.md` §Company Config

- URL ใน attribute (font `src`, logo `src`) ต้องผ่าน `?xml` เสมอ — ค่า config มี `&` ดิบ
  ไม่ escape = BFO parse พังหลัง FreeMarker แทนค่า
- ⚠️ พิสูจน์บน SB2 (2026-07-17): font URL ว่าง/เสีย BFO **ไม่ error** — ฟอนต์ถูกเมินเงียบ ๆ
  แล้ว glyph ไทยหายทั้งใบ ตรวจง่ายสุดจากขนาด PDF: embed สำเร็จ = โตขึ้นหลายสิบ KB ต่อ subset

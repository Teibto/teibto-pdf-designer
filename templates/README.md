# templates/ — Standard Template Pack

**Source of truth ของ product** — master BFO XML ต่อประเภทเอกสาร แก้ผ่าน PR เท่านั้น

```
master/    BFO XML ต้นแบบ: tax-invoice, invoice, purchase-order, delivery-note, receipt, quotation
samples/   sample data สังเคราะห์ (JSON) สำหรับ preview/QA — ห้ามใช้ข้อมูลจริงจาก account ลูกค้า
```

กติกา template ทุกไฟล์ (ดูรายละเอียด `docs/TOOLSTACK.md` §กับดัก):
- binding ทุกตัว null-safe: `${record.field!""}`
- header/footer ผ่าน `<macrolist>` + `<pagenumber/>`/`<totalpages/>` — ไม่ใช้ CSS `@page` margin boxes
- ฟอนต์ไทยผ่าน `<link type="font">` (THSarabunNew ใน File Cabinet)
- จุดที่ลูกค้าต่างกัน (โลโก้ สี ที่อยู่) parameterize ผ่าน `${company.*}` / `<#if>` — ไม่ fork ไฟล์ต่อลูกค้าใน repo นี้

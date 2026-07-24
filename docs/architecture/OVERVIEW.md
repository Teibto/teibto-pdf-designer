# Architecture Overview — teibto-pdf-designer

> อัปเดตล่าสุด: 2026-07-16 · สรุปจาก code review ตั้งต้นของ codebase `pdf-layout-designer-v3.2`
>
> จะลงมือแก้โค้ด (ลูป PR + verify gate + กับดักเฉพาะ repo): อ่าน [`docs/RUNBOOK.md`](../RUNBOOK.md)

## หลักการออกแบบ (ตัดสินแล้ว — เปลี่ยนต้องคุยใน Issue)

1. **BFO (`N/render`) เป็น render engine เดียว** — preview ต้องมาจาก engine เดียวกับที่ print จริง
2. **Template XML (`templates/master/`) คือ source of truth** — designer เป็นเครื่อง scaffold ร่างแบบครั้งแรก (hybrid model); แก้รอบหลังแก้ที่ XML ผ่าน PR
3. **BFO generator มีที่เดียว** — `designer/src/services/bfo-export.service.ts`; Suitelet ทำหน้าที่เก็บ + render เท่านั้น
4. ที่ scale 100+ account: **ต้นทุนใหญ่คือ fleet maintenance ไม่ใช่การสร้าง template** — ทุกการตัดสินใจให้ถามก่อนว่า "deploy/อัปเดต 100 account แล้วเป็นยังไง"

## 3 ชั้นของ product

```
┌─ ชั้น 3: designer/ ─────────────────────────────────────────┐
│ Lit 3 SPA — visual canvas, data binding {{path}},           │
│ export BFO XML → ใช้โดย consultant (ไม่ใช่ end user)         │
└──────────────────────────┬──────────────────────────────────┘
                           │ export (one-way)
┌─ ชั้น 2: templates/ ─────▼──────────────────────────────────┐
│ master/  = BFO XML ต่อประเภทเอกสาร (source of truth, PR)     │
│ samples/ = sample data สังเคราะห์สำหรับ preview/QA           │
└──────────────────────────┬──────────────────────────────────┘
                           │ deploy (custom record / File Cabinet)
┌─ ชั้น 1: engine/ ────────▼──────────────────────────────────┐
│ pld_sl_render_pdf.js  Suitelet: load XML → N/render → PDF   │
│ pld_sl_designer.js    Suitelet: host SPA + template CRUD    │
│ pld_ue_button.js      UE: ปุ่ม Print/Download/Design PDF     │
│ customrecord_pld_template: name, xml, rectype, is_default   │
└─────────────────────────────────────────────────────────────┘
```

## แผนที่ designer/src (จุดเข้าอ่านหลัก)

| พื้นที่ | ไฟล์ศูนย์กลาง | หน้าที่ |
|---|---|---|
| State | `state/store.ts`, `state/actions.ts` | Lit Context + Immer, 50+ actions |
| BFO export | `services/bfo-export.service.ts` | **หัวใจ product** — state → BFO XML + FreeMarker |
| Data binding | `services/binding.service.ts` | resolve `{{path}}` |
| Pagination | `services/pagination.service.ts` | row/height-based, role-aware |
| PDF client | `services/pdf-export.service.ts` + worker | jsPDF preview (แผน: แทนด้วย server-side preview — ดู Issue) |
| Canvas | `components/canvas/`, `components/elements/` | design surface |
| Models | `models/element.ts`, `models/template.ts` | 8 element types, 6 roles |

## Known gaps จาก review ตั้งต้น (2026-07-16) — ติดตามใน GitHub Issues

1. **WYSIWYG gap**: canvas เป็น x/y อิสระ แต่ BFO export ทิ้งพิกัด → ผลพิมพ์จริงไม่ตรง preview ฝั่ง jsPDF (แผนระยะยาว: band-based layout model)
2. **BFO ที่ generate มีจุด render ไม่ได้**: CSS `@page` margin boxes + `counter()` (ต้องใช้ `<macrolist>` + `<pagenumber/>`), FreeMarker ternary `${a ? b : c}` ใน fallback generator (invalid syntax), `action=preview` ปล่อย `${line.x}` ค้างหลัง strip `<#list>`, ไม่มี null-safety `!""`
3. **ฟอนต์ไทยฝั่ง server ยังไม่มี**: BFO ไม่มี Tahoma/Sarabun — ต้อง `<link type="font">` จาก File Cabinet
4. **Generator ซ้ำ 2 ชุด**: client TS + Suitelet fallback (`generateXmlFromDesignerData`) — ต้องลบ fallback
5. CSS ที่ BFO ไม่รองรับหลุดเข้า palette ได้: `object-fit`, `text-overflow: ellipsis`

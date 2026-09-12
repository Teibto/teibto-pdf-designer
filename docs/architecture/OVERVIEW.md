# Architecture Overview — teibto-pdf-designer

> อัปเดตล่าสุด: 2026-09-11 · ตรวจเทียบกับ architecture ของ branch ปัจจุบัน
>
> จะลงมือแก้โค้ด (ลูป PR + verify gate + กับดักเฉพาะ repo): อ่าน [`docs/RUNBOOK.md`](../RUNBOOK.md)

## หลักการออกแบบ (ตัดสินแล้ว — เปลี่ยนต้องคุยใน Issue)

1. **BFO (`N/render`) เป็น render engine เดียว** — preview ต้องมาจาก engine เดียวกับที่ print จริง
2. **Template XML (`templates/master/`) คือ source of truth** — visual designer สร้าง XML ผ่าน generator เดียว ส่วนโหมด XML แก้ BFO/FreeMarker โดยตรงและส่งข้อความเดิมไป Preview/Save โดยไม่แปลงกลับเป็นองค์ประกอบ. การปรับ canonical pack ยังคงต้องนำ XML กลับเข้า repository ผ่าน PR.
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
│ pld_sl_render_pdf.js  Print/live preview + template CRUD     │
│ pld_sl_designer.js    host SPA + read-only bootstrap         │
│ pld_sl_batch_print.js queue/status/download/recovery         │
│ pld_mr_batch_*        durable PART → bounded CHUNK pipeline  │
│ pld_ue_button.js      UE: ปุ่ม Print/Download/Design PDF      │
│ custom records        template/config/history/job/artifact   │
└─────────────────────────────────────────────────────────────┘
```

## แผนที่ designer/src (จุดเข้าอ่านหลัก)

| พื้นที่ | ไฟล์ศูนย์กลาง | หน้าที่ |
|---|---|---|
| State | `state/store.ts`, `state/actions.ts` | Lit Context + Immer, 50+ actions |
| BFO export | `services/bfo-export.service.ts` | **หัวใจ product** — state → BFO XML + FreeMarker |
| Data binding | `services/binding.service.ts` | resolve `{{path}}` |
| Pagination | `services/pagination.service.ts` | row/height-based, role-aware |
| Server preview | `services/netsuite-adapter.service.ts`, `components/modals/preview-modal.ts` | ส่ง XML ปัจจุบันไป `preview-live` และแสดง PDF blob ที่ BFO render จริง |
| Editor | `components/canvas/band-view.ts`, `components/flow/flow-view.ts` | band/flow design surface |
| UX system | `tokens/`, `components/layout/`, [`REDWOOD-UX.md`](REDWOOD-UX.md) | Oracle Redwood tokens, workspace shell, responsive rails and accessibility contract |
| Models | `models/element.ts`, `models/template.ts` | 8 element types, 6 roles |

## สถานะ architecture ปัจจุบันและหลักฐานที่ยังขาด

1. **Preview และ Print ใช้ BFO pipeline เดียวกันแล้ว**: designer ส่ง XML ที่ยังไม่บันทึกผ่าน
   `preview-live`; engine ใช้ `pld_lib_render.js` ร่วมกับ Print และ batch. ยังต้องพิสูจน์
   save/reload/preview/download/print parity บน NetSuite sandbox ก่อน release.
2. **มี BFO generator ชุดเดียว**: `bfo-export.service.ts` เป็นผู้สร้าง XML; Suitelet รับ เก็บ
   และ render เท่านั้น. Engine test ป้องกันไม่ให้มีจุด bind/render pipeline ที่สอง.
3. **Layout ใช้ band/flow model** และ live preview แสดงผลจาก BFO จริงแทน client PDF engine.
   ความเท่ากันของ Thai glyph, multipage table, header/footer และ spacing ยังเป็น connected QA gate.
4. **ฟอนต์ไทย resolve ตอน runtime** ผ่าน File Cabinet URL ใน company config; package มีไฟล์
   THSarabunPSK แต่ทุก account ยังต้องตั้งค่า/ตรวจสิทธิ์และ render glyph จริง. ห้ามอาศัย host font.
5. **ข้อจำกัด BFO ถูกกันที่ exporter/lint/validator**: ห้าม C-ternary, binding ที่ไม่ null-safe
   หรือไม่ escape, `counter(page)`, `object-fit` และ `text-overflow`. การผ่าน local test ไม่แทน
   FreeMarker/BFO render จริงบน sandbox.
6. **Designer UX ใช้ Oracle Redwood contract**: light theme เป็นค่าเริ่มต้น, shell แยก top bar /
   context bar / tool rail / canvas / inspector และจอ `1023px` ลงไปเปลี่ยน rail เป็น drawer.
   Lit + shadow DOM ยังเป็น runtime เดิมและไม่มีการนำ generator หรือ render path ใหม่เข้ามา.

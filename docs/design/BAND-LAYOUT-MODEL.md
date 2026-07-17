# Band-based Layout Model — design

เอกสารนี้สำหรับ maintainer ของ `designer/` อ่านก่อน review #13 แล้วตัดสินใจว่า refactor layout
model ไปทาง band ตามนี้ได้ไหม และอนุมัติให้แตกเป็น sub-issues เริ่มโค้ด. ยังไม่มีโค้ดในรอบนี้ —
deliverable คือแบบ + migration path + รายการ sub-issue สำหรับ review (เกณฑ์ epic #13).

เอกสารนี้อยู่ใต้หลักการใน `docs/architecture/OVERVIEW.md` (BFO เป็น engine เดียว · template XML
เป็น source of truth · generator ที่เดียวใน `bfo-export.service.ts` · ต้นทุนใหญ่คือ fleet
maintenance) และแก้ Known gap #1 ของไฟล์นั้นโดยตรง.

---

## 1. ปัญหา

canvas เป็น free x/y แต่ BFO export **ทิ้งพิกัด** — พิสูจน์จากโค้ด ไม่ใช่แค่ข้อสังเกต:

- canvas วาง element ด้วย absolute x/y จริง (`components/elements/canvas-element.ts:352` — `left:${el.x}px; top:${el.y}px`)
- `bfo-export.service.ts` **ไม่อ่าน `el.x` เลย** และอ่าน `el.y` ที่เดียวคือ `roleHeight()` (`:142`)
  เพื่อคำนวณความสูง band header/footer — ไม่เคยใช้วาง element
- แต่ละ element emit เป็น block flow: `textToHtml` (`:302`) ได้ `<p style="font-size…;width:${el.w}pt">`
  **ไม่มี left/top/position** · element ทุกชนิดเหมือนกัน (image/table/shape/line/barcode/list)
- ภายใน section ลำดับ = ลำดับใน array (insertion order) **ไม่ sort ด้วย y** — วาง header 2 ชิ้น
  สลับที่บน canvas แต่พิมพ์ตามลำดับที่สร้าง

ผลลัพธ์: สิ่งที่ consultant จัดบน canvas ≠ สิ่งที่ BFO พิมพ์ ทุกมิติที่เป็นแนวนอนและลำดับแนวตั้ง.
ตราบใดที่ canvas สัญญา x/y อิสระที่ engine ให้ไม่ได้ WYSIWYG gap อยู่ถาวร และเปิดให้
non-consultant/ลูกค้าออกแบบเองไม่ได้ (self-service = feature ที่ขายได้ — เหตุผลของ epic).

## 2. เป้าหมาย: band model ที่ map ตรง BFO

เลิก free x/y ใน body. จัด layout เป็น **band แนวตั้ง** (ลำดับ = ลำดับ flow ของ BFO) และ
**ภายใน band จัดด้วย row → column** (map ตรงกับ `<table>/<tr>/<td>` ที่ BFO render เป๊ะ):

| band | BFO ปลายทาง | ซ้ำทุกหน้า | paginate |
|---|---|---|---|
| Header | `<macrolist>` macro `nlheader` | ใช่ | — |
| Body (content) | `<div id="content">` flow | ไม่ (first/all) | — |
| Item table | `<table>` + `<#list>` | หัวตารางซ้ำ | ใช่ (แตกแถวข้ามหน้า) |
| Summary | `<div id="summary">` (หน้าสุดท้าย) | ไม่ | — |
| Footer | `<macrolist>` macro `nlfooter` + `<pagenumber/>` | ใช่ | — |
| Watermark | block เดี่ยว opacity ต่ำ | ใช่ | — |

band ทั้ง 6 = role 6 ตัวที่มีอยู่แล้ว (`constants/roles.ts` header/content/table/summary/footer/
watermark) — band model แค่ทำให้ role กลายเป็น **โครงหลักที่มองเห็นและแก้ได้** แทนที่จะเป็น
metadata ซ่อนหลัง free canvas.

### layout ภายใน band

แต่ละ band = stack ของ **row** แนวตั้ง. แต่ละ row = **column** แนวนอน 1–N ช่อง (กำหนดสัดส่วน
กว้างเป็น %). element อยู่ในเซลล์ (row × column):

```
Header band
 ├─ row 1: [ โลโก้ (30%) ] [ ชื่อบริษัท + ที่อยู่ (70%) ]
 └─ row 2: [ ชื่อเอกสาร "ใบแจ้งหนี้" (100%) ]
Body band
 ├─ row 1: [ ลูกค้า (60%) ] [ เลขที่/วันที่ (40%) ]
 └─ row 2: [ ที่อยู่จัดส่ง (100%) ]
```

เหตุผลที่ **row→column map เป็น `<table>`**: BFO honor `<table>` + `<td width="%">` แม่นยำ
(ต่างจาก absolute position หรือ CSS flex ที่ BFO ไม่รับประกัน). วางแนวนอนผ่าน column width จึงเป็น
"ตำแหน่งที่ engine ให้ได้จริง". แนวตั้ง = ลำดับ row = flow. **ทุกอย่างที่ UI ให้วาง map เป็น BFO
ที่ render ตรง — ไม่มี option ที่ BFO ทำไม่ได้** (เกณฑ์ตรวจรับ #13).

## 3. การ map เป็น BFO (design = print โดยโครงสร้าง)

| สิ่งที่ผู้ใช้จัด | เก็บใน model | emit เป็น BFO |
|---|---|---|
| ลำดับ band | fixed 6 band | header/footer → macro · ที่เหลือ → `<div>` ตามลำดับ |
| ลำดับ row ใน band | `band.rows[]` | `<table>` ต่อ row เรียงตาม array |
| column ใน row | `row.cols[]` + `widthPct` | `<tr><td width="${widthPct}%">` |
| element ในเซลล์ | `cell.elements[]` | reuse `elementToHtml` เดิม (text/table/image/…) |
| ความสูง band header/footer | derive จากเนื้อ band | `header-height`/`footer-height` (มี `roleHeight` อยู่แล้ว) |

generator ยังมีที่เดียว (`bfo-export.service.ts`, กติกา OVERVIEW ข้อ 3) — เปลี่ยน `buildBfoBody`
จาก "filter by role แล้ว flow" เป็น "เดิน band → row → col → cell แล้ว emit `<table>`". `elementToHtml`
ต่อชนิด (null-safe `!''`, ไม่มี ternary, ไม่มี CSS ที่ BFO เมิน) **คงเดิม** — เปลี่ยนแค่โครงที่ห่อ.

## 4. การเปลี่ยน data model

ปัจจุบัน element ถือ `x, y, w, h, role, zIndex` (`models/element.ts:40`). band model:

- element **เลิกถือ `x, y, zIndex`** ใน body — ตำแหน่งมาจากที่อยู่ใน band/row/col
- เพิ่มโครง `Template.bands: Band[]` โดย `Band = { role, rows: Row[] }`,
  `Row = { cols: Col[] }`, `Col = { widthPct, elements: CanvasElement[] }`
- `w/h` คงไว้เท่าที่จำเป็น (เช่น ความสูงโลโก้) — ความกว้างมาจาก column
- `role` กลายเป็น property ของ band (element รู้ role จาก band ที่มันอยู่)

state/actions (`state/store.ts`, `state/actions.ts` — 50+ action) ต้องมี action ชุดใหม่:
add/remove/reorder row, split/merge column, ปรับ widthPct, ย้าย element ข้ามเซลล์. Immer เดิมรองรับ.

## 5. Migration path

มี 2 ชั้นที่ต้องคิดแยก:

**Template ที่ save แล้วบน account (`customrecord_pld_template.custrecord_pld_tpl_xml`)** — ไม่กระทบ:
BFO XML ที่เก็บไว้เป็น flow อยู่แล้ว (export เดิมก็ flow) จึง render ต่อได้ปกติ. band model เปลี่ยน
**วิธีแก้ในดีไซเนอร์** ไม่ใช่ format ผลลัพธ์. เปิด template เดิมมาแก้ = ผ่าน migration ด้านล่าง.

**Designer state เดิม (free canvas JSON ใน `custrecord_pld_tpl_data`)** — auto-migrate best-effort:
1. bucket element ตาม `role` → band (มี `role` อยู่แล้วทุกชิ้น)
2. เรียงในแต่ละ band ตาม `y` → เป็น row (element ที่ y ใกล้กันภายใน threshold = row เดียวกัน)
3. ในแต่ละ row เรียงตาม `x` → เป็น column, ประมาณ widthPct จาก `x/w` เทียบความกว้างหน้า
4. เปิดใน designer ให้ consultant ปรับ row/column ที่เพี้ยนด้วยมือ (best-effort ไม่ใช่ pixel-perfect)

migration นี้อยู่ใน `services/migration.service.ts` (มี migration รุ่นก่อนอยู่แล้ว) + เพิ่ม schema
version ใน template. เก่ากว่า schema นี้ = รัน migrate ตอนโหลด.

## 6. แตกเป็น sub-issues (ลำดับทำ)

| # | sub-issue | จุดหลัก | พึ่ง |
|---|---|---|---|
| 1 | band data model + state/actions | `models/element.ts`, `models/template.ts`, `state/` — Band/Row/Col + schema version | — |
| 2 | bfo-export: band → `<table>` row/col | `services/bfo-export.service.ts` `buildBfoBody` เขียนใหม่ · reuse `elementToHtml` · render-verify SB2 | 1 |
| 3 | migration free-canvas → band | `services/migration.service.ts` bucket+sort+widthPct + manual-fix flow | 1 |
| 4 | canvas UI เป็น band editor | `components/canvas/`, `components/elements/` — เลิก free-drag ใช้ band+row+col + insert/reorder | 1 |
| 5 | column/row layout controls | ปรับ widthPct, split/merge column, drag element ข้ามเซลล์ | 4 |
| 6 | property/palette ตาม band context | palette เสนอ element ที่ band รับ · property panel รู้ตำแหน่ง band/row/col | 4 |
| 7 | guardrail: ไม่มี option ที่ BFO render ไม่ได้ | validate + `scripts/validate-templates.sh` เพิ่ม check band→BFO ครบ | 2 |

ลำดับวิกฤต: #1 → #2 (พิสูจน์ output ก่อน) → #3/#4 ขนานได้. ประเมินรวม 3–6 สัปดาห์ (ตาม epic).

## 7. คำถามเปิดสำหรับ review (ต้องเคาะก่อนเริ่ม #1)

1. **Big-bang หรือ mode คู่**: เลิก free canvas ทันที หรือเก็บ free canvas ไว้เป็น mode เดิม +
   เพิ่ม band mode (ปลอดภัยกว่า แต่ maintain 2 model)? — แนะนำ big-bang (free canvas พิมพ์ไม่ตรงอยู่แล้ว
   การเก็บไว้คือเก็บ WYSIWYG gap ไว้)
2. **row primitive**: `<table>` (แนะนำ — BFO honor แม่น) ยืนยันว่ารับ nested table ในเซลล์ได้
   (item table อยู่ใน band — table ซ้อน table) — ต้อง render-verify บน SB2 ตั้งแต่ #2
3. **Migration ครอบแค่ template ในทีม หรือรวมของลูกค้า**: template ลูกค้าที่แก้ใน account
   (นอก repo) จะ migrate ยังไง — หรือบังคับ re-scaffold จาก master

---

Ownership: เอกสารนี้เป็น design ของ #13. ขัดกับโค้ดจริงเมื่อไหร่ (เช่น export เปลี่ยนวิธี map)
แก้ที่นี่ผ่าน PR ที่อ้าง #13 หรือ sub-issue ที่เกี่ยวข้อง. เริ่มโค้ดได้เมื่อ maintainer อนุมัติ
คำถามข้อ 7 และ sub-issue #1 ถูกเปิด.

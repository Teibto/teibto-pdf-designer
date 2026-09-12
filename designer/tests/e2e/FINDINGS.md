# E2E findings — band-model designer (#123)

> รอบทดสอบ end-to-end ทุกปุ่ม/ทุกฟิลด์/ทุก action ของ designer หลัง band-model cutover
> (#13/#47/#107). วันที่: 2026-07-23 · ผู้ทำ: Wichit Wongta

การรัน: `cd designer && npx playwright test` (auto-start dev server ที่ :5173)

สถานะปัจจุบัน (2026-09-12): **91 passed** — บั๊กเดิมทั้ง 7 รายการแก้แล้ว และไม่มี
`test.fail()` ค้างอยู่ในชุด Chromium. จำนวนนี้เป็น local browser evidence; ไม่แทน live
NetSuite save/render parity.

---

## บั๊กที่ยืนยันแล้ว (reproduce ได้ทุกครั้ง)

ทั้งหมดมาจากรากเดียวกัน: หลัง cutover **`state.bands` เป็น source of truth ของ layout**
แต่หลาย action ยังไปยุ่งกับ `state.elements` (pool) อย่างเดียว ทำให้สอง store ไม่ sync กัน

| Issue | อาการ | ไฟล์/จุด | สถานะ | เทสต์ |
|-------|-------|----------|-------|-------|
| **#125** | **Duplicate สร้าง element กำพร้า** — "⧉ ทำสำเนา" push clone เข้า pool + select แต่ไม่ใส่ id ลง band cell → มองไม่เห็นใน editor/preview/export | `state/actions.ts` `duplicateElement` | ✅ แก้แล้ว (insert clone.id ต่อท้าย cell ต้นทาง) | `inspector.spec.ts` |
| **#126** | **Delete ทิ้ง band ref ค้าง** — "✕ ลบ" เรียก `removeElement` ที่ลบจาก pool แต่ไม่ลบ id จาก `bands[].elementIds` → id ผีค้าง ติดไปกับ save/undo | `state/actions.ts` `removeElement` | ✅ แก้แล้ว (เคลียร์ band cell ด้วย เหมือน `removeBandElement`) | `inspector.spec.ts` |
| **#127** | **Role selector desync** — "ส่วนของหน้า (Band)" เรียก `updateElement('role')` เปลี่ยนแค่ `el.role` ไม่ย้าย chip ข้าม band → role กับตำแหน่งไม่ตรงกัน | `sidebar-right.ts` + `actions.ts` | ✅ แก้แล้ว (เปลี่ยน role แล้วย้าย chip ไป band ที่ตรงกัน) | `inspector.spec.ts` |
| **#128** | **visibleIf เป็น dead control** — ช่อง "แสดงเมื่อฟิลด์มีค่า" (#90) เขียนไม่ติด เพราะ `ALLOWED_KEYS._base` ไม่มี `'visibleIf'` | `services/validation.service.ts:276` | ✅ แก้แล้ว (เพิ่ม `'visibleIf'`) | `inspector.spec.ts` |
| **#129** | **Undo เชื่อถือไม่ได้** — Ctrl+Z ครั้งแรกหลัง drop เป็น no-op; undo ถัดไปทำ elements/bands คนละ snapshot | `canvas/band-view.ts` (`dragType` untagged) + `history.service` | ✅ แก้แล้ว (`dragType` dispatch ไม่เข้า undo history) | `history.spec.ts` |
| **#130** | **Flow view ไม่ init จาก state** — `connectedCallback` subscribe อย่างเดียว ไม่อ่าน `store.state` ตอน connect → ขึ้น "No data bindings" ผิด | `flow/flow-view.ts:144` | ✅ แก้แล้ว (seed จาก store ตอน connect) | `flow.spec.ts` |
| **#131** | **ปุ่ม 💾 บันทึก save ซ้ำ 2 ครั้ง** — header dispatch bubbles+composed; app-shell ฟังทั้ง `this`+`window` → `_saveTemplate` ยิงสองรอบ | `app-shell.ts` | ✅ แก้แล้ว (เหลือ window listener ตัวเดียว) | `templates.spec.ts` |

## ประเด็น UX / ความง่ายต่อผู้ใช้ (ไม่ใช่บั๊ก แต่ควรพิจารณา)

- **สอง "★ ตัวอย่าง" คนละความหมาย**: ปุ่มบน header โหลด *เทมเพลตทั้งใบ* (elements+bands); ปุ่มในแท็บข้อมูลโหลด *ข้อมูล JSON ตัวอย่าง* เท่านั้น — ป้ายเหมือนกันแต่ทำคนละอย่าง ชวนสับสน
- **หัวข้อ palette ยังเขียน "Drag to Canvas"** ทั้งที่ไม่มี canvas อิสระแล้ว (เป็น band) — copy ค้างจากก่อน cutover
- **Size (Width/Height) ใน inspector** ส่วนใหญ่ไม่มีผลเห็นได้ใน band flow (ความกว้างคุมด้วย `col.widthPct`, ความสูง header/footer คุมด้วย row height) — เป็น legacy field ตาม #107 แต่ผู้ใช้ไม่รู้ว่ากดแล้วไม่เปลี่ยนอะไร ควรมี hint หรือซ่อนตามชนิด/บทบาท

---

## แผนที่ความครอบคลุม (coverage map)

| พื้นที่ | ไฟล์เทสต์ | ครอบคลุม |
|--------|-----------|----------|
| App shell, view switch, theme, page size/orientation, tabs | `app.spec.ts` | ✓ |
| Palette → band drop, acceptance matrix (#49), chip select/delete, cell move, row add/remove | `elements.spec.ts` | ✓ |
| Barcode/List/Image drops + reject | `barcode-list.spec.ts` | ✓ |
| Inspector: name, size, binding, visibleIf, text/barcode/list props, duplicate, delete, role | `inspector.spec.ts` | ✓ (+4 bug) |
| Column split/merge/width, row add/reorder/remove/height | `grouping.spec.ts` | ✓ |
| Column config modal CRUD: add/remove/edit/presets/apply/cancel | `column-config.spec.ts` | ✓ |
| Layers: list/select/visibility/lock/rename | `tables-layers.spec.ts` | ✓ |
| Data tab: sample, form↔json, validation, clear, array add/remove | `data.spec.ts` | ✓ |
| Settings tab: mode, rows/page, watermark, copies, checkboxes, collapsibles, header mode, force-break | `pagination.spec.ts` | ✓ |
| Flow map: empty state + binding map | `flow.spec.ts` | ✓ (+1 bug) |
| Preview modal (nav/zoom/render), BFO export, JSON copy | `export.spec.ts` | ✓ |
| Save (button/Ctrl+S), dirty, template manager, rename | `templates.spec.ts` | ✓ (bug #7 note) |
| Undo/redo | `history.spec.ts` | ✓ (+1 bug) |
| Dev startup smoke, 10,000-row form, 500-element resize, 100-switch exact-listener/forced-GC lifecycle | `performance.spec.ts` | ✓ (fixed Chromium) |

Production startup has a separate serial gate in `tests/performance/startup.spec.ts`: fresh build/server,
one worker, retries disabled, 20 cold contexts and 30 warm samples. It is not included in the 91 E2E count.

### ยังไม่ได้ครอบคลุม (ต้องมี env จริง / เสี่ยง flaky)
- Server-side preview (#12) และ Save-to-NetSuite — ต้องรันใน NetSuite + record จริง (skill `netsuite-qa-browser`)
- Image upload (เปิด file picker ของ OS)
- Column drag-reorder และ layers drag-reorder z-index ยังเป็น DnD ระดับ pointer ที่เสี่ยง flaky; column resize มีทั้ง component scheduling regression และ fixed-Chromium 500-element pointer-to-paint benchmark แล้ว ส่วน data-form benchmark ครอบ 10,000 rows
- Multi-select (shift-click) ใน layers
- beforeunload dirty warning

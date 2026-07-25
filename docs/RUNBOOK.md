# คู่มือลงมือแก้โค้ด — teibto-pdf-designer

เอกสารนี้สำหรับคนที่จะแก้โค้ด repo นี้ (engine / designer / templates) อ่านแล้วส่ง PR ได้ถูกลูป ผ่าน CI รอบเดียว และไม่พลาดกับดักที่เคยจ่ายบทเรียนมาแล้ว. กติกากลาง (branch / commit / PR / label) อยู่ที่ [`CONTRIBUTING.md`](../CONTRIBUTING.md) และ [teibto-dev-standards](https://github.com/Teibto/teibto-dev-standards) — ที่นี่เก็บเฉพาะลูปการทำงานจริงกับกับดักเฉพาะ repo นี้ ไม่ทำซ้ำกติกากลาง (R10).

---

## 🔁 ลูปลงมือแก้ (ทำตามนี้ทุกครั้ง)

1. เปิดหรือหยิบ GitHub Issue ก่อนเสมอ — repo มี remote github จึงบังคับ issue-first (skill `github-issue-first`)
2. `git checkout -b <type>/<issue>-<slug>` — ห้าม push ตรง `main` ยกเว้น docs-only (CONTRIBUTING §19)
3. แก้โค้ด แล้วเขียนหรืออัปเดต test ที่พิสูจน์การแก้ในคอมมิตเดียวกัน
4. รัน verify gate ให้เขียวครบก่อน commit (ตารางข้างล่าง)
5. อัปเดต `CHANGELOG.md` ใต้ `Added` / `Changed` / `Fixed` ถ้าเป็น change ที่ผู้ใช้เห็น
6. `bash scripts/secret-scan.sh` — R6 ห้ามแก้ script นี้ (canonical อยู่ repo กลาง)
7. `gh pr create` โดย mirror หัวข้อใน `.github/PULL_REQUEST_TEMPLATE.md` ให้ครบ (What & Why + checklist)
8. รอ CI `quality-gate` เขียว
9. merge — branch protection = REVIEW_REQUIRED และ author อนุมัติ PR ตัวเองไม่ได้ จึงต้องให้เจ้าของ repo รัน `gh pr merge <n> --squash --admin --delete-branch`
10. `git checkout main && git pull` แล้วเริ่มงานถัดไปจาก main สะอาด

แตกงานใหญ่เป็น PR ย่อยต่อ issue เดียวได้ (ใช้ `Refs #n` ระหว่างทาง แล้ว `Closes #n` ที่ PR สุดท้าย) — เช่น #124 แตกเป็น 4 PR.

## ✅ Verify gate (รันจาก `designer/`)

| เช็ค | คำสั่ง | baseline |
|---|---|---|
| Type | `npx tsc --noEmit` | 0 error |
| Unit + component | `npx vitest run` | 544 passed |
| E2E | `npx playwright test` | 83 passed |
| Lint | `npm run lint` | 0 error (warning `any` เดิม ~46 ไม่นับ) |
| Secret (จาก repo root) | `bash scripts/secret-scan.sh` | no leaks |
| Engine unit (จาก repo root) | `node --test "engine/tests/**/*.test.js"` | 97 passed |
| Template pack (จาก repo root) | `bash scripts/validate-templates.sh` | ✅ ผ่านทุกไฟล์ |

CI `quality-gate` รัน lint + vitest + e2e + template validator + engine unit test + secret-scan — ตั้งแต่ #155 **ครอบ `engine/` ด้วย** (`node --check` ทุกไฟล์ + `node --test`) ไม่ต้องเช็ค syntax มือแล้ว แต่ change ที่แตะ BFO output ยังต้อง QA สดบน SB2 เหมือนเดิม

## 🧩 กับดัก designer (SPA)

- e2e กับ component test เลือก element ด้วย **ข้อความ label** — แก้ข้อความ UI แล้วต้องแก้ selector ใน spec ตามด้วย (`inspector.spec.ts` `pagination.spec.ts` `features.test.ts` `edge.test.ts` `data.spec.ts` `app.spec.ts`) ลืมแล้ว e2e แดง
- แปล UI เป็นไทยใช้รูปแบบ **`ไทย (English)`** เช่น `ความกว้าง (Width)` — คง substring อังกฤษไว้ให้ selector เดิม (`.filter({ hasText: 'Width' })`) ยัง match จึงแก้โค้ดได้โดยไม่ต้องรื้อ test (พิสูจน์ตอน #124)
- `<option>` ใน test เลือกด้วย `value` ไม่ใช่ข้อความ · ข้อความที่แสดงจึงเปลี่ยนเป็นไทยล้วนได้ไม่กระทบ test
- ชื่อ custom element ไม่ตรงชื่อไฟล์ — header คือ `pld-header` (ไม่ใช่ `pld-app-header`) · editor เดียวคือ `pld-band-view` (canvas เก่าถอดแล้ว) · band ที่ element อยู่คือ role ของมัน ดังนั้นเปลี่ยน role = ย้าย chip ข้าม band (#127)
- flag ชั่วคราวห้ามอยู่ใน undoable state — `dragType` เคยเขียนแบบ untagged ทำให้ history middleware เก็บ snapshot เกิน แล้ว Ctrl+Z แรกเป็น no-op (#129) แก้โดยเขียนผ่าน action ที่ `tagAction(..., { undoable: false })`
- **ฟอนต์ไทยใน XML ที่ designer สร้าง ห้าม bake URL (#156)** — `buildFontLink()` ปล่อย `<link>` ที่ bind `${(company.fontRegular!'')?xml}` ทุกครั้ง (เหมือน master pack, กฎ #32) ไม่มี path ที่ export ออกมาโดยไม่มี font link · URL File Cabinet มี token `h=` ที่หมดอายุเมื่อ re-save ไฟล์ฟอนต์ → bake ไว้แล้วภาษาไทยหายเงียบทีหลัง · account ที่ config ยังไม่มีฟอนต์ designer เตือนเองตอน save + ในโมดัล BFO (`hasThaiFontConfigured()`)
- ไฟล์ source ใหม่หรือ rewrite ใส่ `@author <ชื่อจริง>` + `@since YYYY-MM-DD` (R1) ห้ามเดาชื่อ

## ⚙️ กับดัก engine (SuiteScript / SDF)

- render engine ต้องไม่พังเงียบ (R4) — fail ต้อง error ให้เห็น ไม่คืน PDF เปล่า · เวลาเพิ่ม log ใช้ structured `N/log` + `errorId` correlation (fail ยิง `log.error` พร้อม context ครบ และแนบ `errorId` ใน response · success ยิง `log.audit` ครั้งเดียว) ดู `pld_sl_render_pdf.js` (#149)
- **รูปร่างของ error ขึ้นกับคนอ่าน (#157)**: action ที่เบราว์เซอร์เปิดเอง (`render`, `preview`, ไม่ระบุ action) คืนหน้า HTML ไทย + `errorId` · action ที่ designer เรียกผ่าน fetch (`list` `get` `save` `delete` `preview-live` `version`) คืน JSON · **ห้ามส่ง `stack` กลับ client ทั้งสองทาง** — stack อยู่ใน Script Execution Log อย่างเดียว · เพิ่ม action ใหม่ที่เบราว์เซอร์เปิดตรง ต้องใส่ใน `BROWSER_ACTIONS` ไม่งั้นผู้ใช้เจอ JSON
- **render core อยู่ที่ `pld_lib_render.js` ที่เดียว (#181)** — โหลด template + ตีความชุดสำเนา + ประกอบ renderer (data source `record`/`copy`/`company`/`context`) + รวม `<pdfset>` · Suitelet พิมพ์ทีละใบ, live preview และการพิมพ์เป็นชุด เรียก lib ตัวนี้ทั้งหมด · **ห้ามเรียก `addCustomDataSource` จากไฟล์อื่น** — unit test `render-core.test.js` fail ทันทีถ้ามีไฟล์ที่สองเริ่ม bind เอง (กันไม่ให้ product กลับไปมีหลาย render path อีก)
- **พิมพ์เป็นชุดถูกจำกัดด้วย governance ไม่ใช่ด้วยตัวเลขที่ตั้งไว้ (#181)** — `pld_sl_batch_print.js` วัด `getRemainingUsage()` คร่อมการ render แต่ละใบ แล้วใช้ต้นทุนที่แพงที่สุดที่วัดได้ตัดสินใจว่าจะขึ้นใบถัดไปไหว (กันไว้ 100 units ให้ขั้นตอนรวมไฟล์) · ผลลัพธ์มีสองแบบเท่านั้น: **ครบทุกใบ → PDF** หรือ **ไม่ครบ → หน้าสรุป** ที่บอกว่าใบไหนสำเร็จ/ล้มเหลว/ยังไม่ได้พิมพ์ ห้ามส่งไฟล์ที่ขาดใบไปเงียบ ๆ (R4) · หน้าจอนี้ค้นเอกสารด้วย **saved-search API ไม่ใช่ SuiteQL** เพราะ search รู้จัก record type ตรง ๆ ไม่ต้องแปลงเป็น type code เอง (บทเรียน #174)
- **ชุดใหญ่วิ่งบน Map/Reduce หนึ่งเอกสารต่อหนึ่ง key (#181)** — `pld_mr_batch_print.js` ได้ 1,000 units **ต่อ map invocation** ชุด 500 ใบจึงไม่ชนโควตา · การรวมเป็น `<pdfset>` ต้องใช้ XML ที่ resolve แล้วของทุกใบพร้อมกัน ซึ่งใหญ่เกินกว่าจะส่งผ่าน key/value ของ MR — map จึงเขียนเป็นไฟล์ชั่วคราวแล้วส่งต่อแค่ file id ส่วน summarize โหลดกลับมาต่อกันครั้งเดียวแล้วลบทิ้ง · รายการเอกสารส่งผ่าน **ไฟล์ job spec** ไม่ใช่ script parameter (ชุด 300 ใบยาวเกินกว่าจะยัดลง parameter) · โฟลเดอร์ปลายทางหาจาก `pld_version.txt` ที่ `deploy.sh` stamp ไว้เสมอ จึงไม่ต้องตั้ง folder id ต่อ account
- **SDF: script parameter ของ Map/Reduce ห้ามมี `<setting>SCRIPT</setting>`** — server validation ตอบ "The setting field for the … (scriptcustomfield) subrecord must not be SCRIPT" ให้ตัด tag นี้ทิ้งไปเลย (ของ Suitelet ใช้ได้ ของ MR ใช้ไม่ได้ — เจอตอน #181)
- SDF partial deploy เมื่อแก้ 1-2 ไฟล์ — backup `engine/src/deploy.xml` → เขียน minimal → `suitecloud project:validate --server` → `project:deploy` (รันผ่าน **Bash** ไม่ใช่ PowerShell foreground) → **restore `deploy.xml` เต็มเสมอ** · `project.json` (authid) gitignore ไว้
- full deploy คือ `scripts/deploy.sh` — stamp version แล้ว build กับ stage bundle แล้ว loop `defaultAuthId` ต่อ account พร้อมสรุป PASS/FAIL · ดู version ที่ deploy จาก account ผ่าน `?action=version`
- อ่าน Script Execution Log บน account — เปิด `script.nl?id=<scriptid>` (ไม่ใช่ `scriptrecord.nl` ที่จะขึ้น "Record does not exist") แล้วคลิก subtab `#executionlogtxt` log จะขึ้น inline
- data classification (Internal) — account ลูกค้าห้ามแตะแม้ dryrun · deploy เฉพาะ Teibto sandbox เท่านั้น
- verify engine change — `node --check` + `node --test "engine/tests/**/*.test.js"` + review + QA สดบน SB2 (skill `netsuite-qa-browser`)
- **unit test พิสูจน์ SuiteQL ไม่ได้ — แตะ SQL เมื่อไหร่ต้อง render จริงเมื่อนั้น (#174)** · `queryStub` match SQL ด้วย substring แล้วคืน fixture มันจึง**แยกคอลัมน์ที่มีจริงบน account กับคอลัมน์ที่กุขึ้นไม่ได้โดยธรรมชาติ** ไม่ใช่ข้อบกพร่องของ stub. บทเรียนจริง: เติม `BUILTIN.DF(createdfrom)` เข้า header query ผ่าน CI ทุกด่าน (48 test เขียว + validator + secret-scan) แล้วไปล้มบน SB2 ว่า `Unknown identifier 'createdfrom'` — query ก้อนนั้นใช้ร่วมทุก rectype **ทั้ง account จึงพิมพ์เอกสารไม่ได้เลย** ไม่ใช่แค่ rectype ที่ตั้งใจแก้
  - กฎที่ได้: body field อ่านจาก **record ที่โหลดอยู่แล้ว** (`fieldDisplay` — เหมือน `terms`/`salesrep`/`employee`) อย่าเพิ่มคอลัมน์เข้า SELECT เพื่อเอาค่าที่ record มีอยู่แล้ว
  - แถวของเอกสารบาง rectype ก็ไม่ได้อยู่ใน `transactionline` — ใบเสร็จอ่าน sublist `apply` ใบส่งสินค้าอ่าน sublist `item` (#170/#176) ก่อนเขียน SQL ใหม่ ให้ถามก่อนว่า record มี sublist ที่ให้คำตอบตรง ๆ อยู่แล้วไหม
  - อยากรู้ว่า sublist มี field อะไรบ้าง → deploy diagnostic ชั่วคราวที่ dump `rec.getSublistFields({sublistId})` แล้ว render probe template อ่านผล (วิธีที่ไข #176 — ได้ชื่อจริงอย่าง `unitsdisplay` ที่เดาไม่ถูก) แล้วค่อยถอด diagnostic ออกก่อน commit
  - test ที่กันการถอยกลับได้จริงคือ test ที่ assert บน **ตัว SQL ที่ engine ยิงออกไป** (`query.seen`) ไม่ใช่ผลลัพธ์ที่ stub คืนมา — ดู `invoice-data.test.js` เคส "no query asks the transaction table for createdfrom"
- **ทุกค่าที่ข้าม `render.DataSource.OBJECT` ถึง FreeMarker เป็น string เสมอ (#165)** — พิสูจน์บน SB2: ส่ง `5350` (number) จาก JS แล้ว `${record.total?is_number}` = `NO`, `?string("#,##0.00")` คืน **ค่าว่างโดยไม่ error** ดังนั้น engine ต้อง format money/qty ให้เสร็จก่อนส่ง (`money()` / `pld_lib_baht_text`) แล้ว template พิมพ์ตรง ๆ · ฝั่ง designer ไม่โดนเพราะ `bfo-export.service.ts` coerce `?trim?number` ใน `<#attempt>` ก่อน format อยู่แล้ว (นั่นคือเหตุที่เทมเพลตจาก designer โชว์เลข แต่ master pack ว่าง) · validator ban `?string(`/`?string[`/`pldBahtText(` ใน master ทุกไฟล์แล้ว
- **ป้ายชุดเอกสาร (#159)**: `${copy.th}` / `${copy.en}` / `${copy.label}` มาจาก data source ที่ `pld_sl_render_pdf` ใส่ให้ทุก render pass — ใช้ได้ทั้ง curated และ raw record · ชุดสำเนามาจาก `copies` ใน designer JSON ของ template record (invoice default = ต้นฉบับ+สำเนา) และใช้กับ **ทุก** rectype แล้ว
- **binding contract (#155)**: rectype ที่อยู่ใน `DOC_TITLES` bind object จาก `pld_lib_invoice_data.js` แทน record ดิบ ดังนั้น key ที่ template อ้างต้องอยู่ใน `CURATED_KEYS` / `RAW_ALIAS_KEYS` / `ITEM_BINDING_KEYS` — เพิ่ม/ลบ key ต้องแก้ทั้ง list กับ object ที่ return (unit test บังคับให้ตรงกัน) · key ที่หลุด contract ไม่ error แต่พิมพ์ว่าง เพราะ binding null-safe (#2) กลืนไว้
- เขียน unit test ของ engine — `engine/tests/` ใช้ AMD shim (`helpers/amd.js`) mount โมดูลจริงโดย stub เฉพาะ `N/*` (`helpers/ns-stubs.js`); sibling lib (`./pld_lib_*`) โหลดของจริง จะ override ก็ใส่ key ชื่อเดียวกันใน stubs

## 📄 เขียนหรือแก้ BFO template

master XML อยู่ที่ `templates/master/<doc>.xml` คือ source of truth (ไม่ใช่ designer JSON) · sample คู่กันที่ `templates/samples/<doc>.sample.json` ใช้ข้อมูลสังเคราะห์เท่านั้น (Internal). designer เป็นเครื่อง scaffold ร่างแรก · แก้รอบหลังที่ XML ผ่าน PR ไม่แก้ใน UI ของ account ลูกค้า.

Skeleton บังคับ copy จาก `templates/master/tax-invoice.xml` ที่พิสูจน์แล้ว:

- `<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">`
- ฟอนต์ไทยจาก config layer เท่านั้น: `<link name="THSarabunNew" type="font" subtype="truetype" src="${(company.fontRegular!'')?xml}" src-bold="${(company.fontBold!'')?xml}" bytes="2" />` — `name` เป็นแค่ identifier · URL จริงต้องชี้ THSarabunPSK (ดู recipe company config)
- header/footer ซ้ำทุกหน้าใช้ `<macrolist>` + `<macro id="nlheader">` กับ `nlfooter` · เลขหน้าใช้ `<pagenumber/> / <totalpages/>` (BFO ไม่รองรับ CSS `@page` counter)
- `<body header="nlheader" header-height="120pt" footer="nlfooter" footer-height="26pt" size="A4" padding="0.35in">`
- binding ทุกตัวมาจาก `${company.*}` (config record `customrecord_pld_config` ต่อ account) จึง save เข้า account ได้ตรง ๆ ไม่ต้องแก้ต่อ account

กฎที่ `scripts/validate-templates.sh` บังคับ (จับตั้งแต่ PR):

| ห้าม | ใช้แทน | # |
|---|---|---|
| C-ternary `${a ? b : c}` | `?then(a,b)` หรือ `<#if>` | 1 |
| binding ไม่ null-safe `${record.x}` | `${record.x!""}` ทุกตัว | 2 |
| bake URL หรือฟอนต์ต่อ template | `${company.fontRegular}` ผ่าน `?xml` — BFO ไม่ apply GPOS ฟอนต์ผิดพังเงียบ | 32 |
| CSS `object-fit` `text-overflow` `@page` margin box `counter(page)` | หลีกเลี่ยง (BFO เมินเงียบ) | 3, 5 |
| `<div>` ระดับ body | `<p>` หรือ `<table>` (BFO ทิ้ง div ทั้ง element เงียบ) | 10 |
| สตริงไทยยาวตัดกลางคำ | แทรก ZWSP `\x200B` ระหว่างหน่วย (BFO ไม่มี Thai word-break) | 35 |
| `<img>` ที่กำหนดขนาดด้านเดียว (`width` อย่างเดียว · `height` อย่างเดียว · `max-width`) | ระบุ **`width` และ `height` คู่กันเสมอ** — BFO ย่อภาพก็ต่อเมื่อได้กล่องครบสองแกน ให้ค่าด้านเดียวมันเมินแล้ววาดขนาดจริง แล้วโดนตัดตามขอบ cell/หน้าเงียบ ๆ (โลโก้ของ account จึงล้นหน้าและดันเนื้อหาตกหน้า) | 178 |
| ไม่มี marker `pld:rectype <recordtype>` ใน comment หัวไฟล์ | ใส่เสมอ — บอกว่า template ผูกกับ record type ไหน (validator ใช้เลือกว่าจะเทียบ binding contract แบบ curated หรือข้าม) | 155 |
| bind key ที่ engine ไม่ได้จ่ายสำหรับ rectype นั้น | ใช้ key ใน contract หรือเพิ่ม alias ที่ `pld_lib_invoice_data.js` — ไม่งั้นพิมพ์ว่างเงียบ | 155 |
| **format ตัวเลขใน template** — `?string("#,##0.00")` / `?string["#,##0.00"]` | พิมพ์ค่าที่ engine format มาแล้ว (`${record.totalText}` `${line.amountText}` `${record.bahtText}`) | 165 |
| เลขคณิตกับ binding (`a + b`, `?abs`, `pldBahtText(x)`) | ให้ engine คำนวณแล้วส่งเป็น text · เงื่อนไขให้เทียบ string (`<#if (record.discounttotalText!"") != "">`) ไม่เทียบตัวเลข | 165 |

Validate แล้ว smoke-test:

- local + CI: `bash scripts/validate-templates.sh`
- render จริง: save XML เข้า `customrecord_pld_template` แล้วเปิด `?action=render&rectype=<doc>&recid=<n>&tplid=<id>` · ตรวจฟอนต์ไทยไม่เป็น □ และ header/footer ซ้ำทุกหน้า
- **สงสัยว่า binding มาถึงเป็นชนิดอะไร → ถาม FreeMarker ตรง ๆ ด้วย probe template** (เทคนิคที่ไขปม #165): POST `?action=preview-live` ด้วย XML สั้น ๆ ที่พิมพ์ `${x!"MISSING"}` · `${x?is_number?string("YES","NO")}` · `${x?string("#,##0.00")}` เทียบกัน แล้วเปิด blob ที่ได้ดู — ไม่ต้อง save template, ไม่ต้องมี test data, เห็นคำตอบในหน้าเดียว (PDF ที่ embed ฟอนต์ไทยอ่าน text ไม่ได้ ใช้ probe แบบ ASCII แล้วดูจาก screenshot)

facts เต็มเรื่อง BFO/FreeMarker (font embedding · `?then` vs ternary · macrolist multi-page · zero-test-data smoke) อยู่ที่ skill `netsuite-bfo-pdf` และ `docs/TOOLSTACK.md` ไม่ทำซ้ำที่นี่.

## 🧰 Recipe ต่อ account และ onboarding

### ตั้ง company config ต่อ account

config record `customrecord_pld_config` คือจุดตั้งค่า per-account จุดเดียว จ่าย `${company.*}` ให้ทุก template.

1. สร้าง 1 record ต่อ subsidiary หรือ 1 record global (เว้น `custrecord_pld_cfg_subsidiary` ว่าง = fallback) · field: `_name` `_name_en` `_taxid` `_branch` `_address` `_address_en` `_phone` `_email` `_logo_url` `_theme_color` `_font_regular` `_font_bold` `_subsidiary`
2. ฟอนต์ไทยต้องชี้ไป **THSarabunPSK เท่านั้น ห้าม THSarabunNew (#32)** — BFO ไม่ apply GPOS จึงทำวรรณยุกต์/สระของ THSarabunNew ลอยหลุดฐาน · ฟอนต์ที่ไม่ embed (Noto/Tahoma) glyph ไทย drop เงียบใน PDF
3. **ใส่ `file id` ไม่ใช่ URL (#167)** — ช่อง font/logo รับ file id ได้แล้ว แล้ว engine resolve URL สดตอน render (`N/file.load(id).url`) · URL เก่าที่ตั้งไว้ยังใช้ได้ engine ดึง `id=` จาก URL มา resolve ใหม่ให้เอง · token `h=` ในค่าที่เก็บไว้จึงหมดอายุได้ไม่กระทบใคร (อาการเดิม: token เพี้ยน = ไทยหายทั้งบรรทัดแบบไม่มี error)
4. `load()` เลือก config 3-tier: subsidiary ตรง → global (subsidiary ว่าง) → record แรก · เต็ม: `engine/DEPLOYMENT.md §Company Config`

### เพิ่ม document type ใหม่ end-to-end

1. engine — เพิ่ม rectype ใน `DOC_TITLES` (`pld_lib_invoice_data.js`) เป็น `{th, en}` · rectype ที่ `transactionline` เก็บจำนวนเป็นเครื่องหมายที่พิมพ์อยู่แล้วเพิ่มใน `KEEP_LINE_SIGN` (เดิมชื่อ `PURCHASE_SIDE` — เปลี่ยนชื่อที่ #176 เพราะ `returnauthorization` ก็ต้องอยู่ในนี้ทั้งที่เป็นฝั่งขาย ชื่อใหม่บอกว่า flag **ทำอะไร** ไม่ใช่ว่าเอกสารอยู่ฝั่งไหนของธุรกิจ) · rectype ที่ `transactionline` คืนคู่บัญชีต่อสินค้าหนึ่งตัวเพิ่มใน `SUBLIST_ITEMS` แล้วอ่านบรรทัดจาก sublist `item` ของ record แทน (ใบส่งสินค้า — จำนวนมาเป็นหน่วยแสดงผลพร้อม `unitsdisplay` อยู่แล้ว, #176) · เอกสารที่ไม่มี VAT breakdown ตามกฎหมายเพิ่มใน `NO_TOTALS` (ยอด/VAT/ตัวอักษรเป็น **ค่าว่าง** ไม่ใช่ `0.00` และ `totals.summaryRows` เป็น array ว่างให้กล่องสรุปหายไปทั้งกล่อง — #170) · เอกสารที่แถวไม่ได้มาจาก `transactionline` เพิ่มใน `APPLY_SOURCE` (ใบเสร็จรับเงินอ่าน sublist `apply` ของ record เอง เฉพาะบรรทัดที่ติ๊กตัดชำระจริง — บรรทัดที่ไม่ติ๊กคือใบเปิดค้างใบอื่นของลูกค้ารายนั้น พิมพ์ออกไปเท่ากับบอกผู้จ่ายว่าตัดใบที่เขาไม่ได้จ่าย) · curated ตอนนี้: **ทุก rectype ที่มีปุ่ม Print** (`invoice` `creditmemo` `estimate` `salesorder` `purchaseorder` `cashsale` `vendorbill` `returnauthorization` `itemfulfillment` `customerpayment`) · rectype ที่ไม่อยู่ในลิสต์ยังพิมพ์ได้ผ่าน raw record binding (ชุดสำเนาทำงานครบตั้งแต่ #159) แต่ไม่มีชื่อเอกสารไทย/VAT breakdown/ตัวอักษรไทย
   · แก้ลิสต์แล้วต้องอัปเดต `RAW_PATH_TYPES` ใน `engine/tests/rectype-coverage.test.js` ให้ตรง (test บังคับว่า ปุ่ม/curated/dropdown ต้องสอดคล้องกัน — #159)
   · **การย้าย rectype จาก raw มา curated เป็น breaking change ต่อ template ที่ deploy ไปแล้ว** (#170) — binding เปลี่ยนจาก record ดิบเป็น object ของ engine ทั้งก้อน `${record.<key>}` ที่ไม่อยู่ใน `RAW_ALIAS_KEYS` จึงพิมพ์ว่างเงียบ ๆ · `custbody_*` ปลอดภัยแล้ว (builder republish ให้ที่ระดับบนสุด) แต่ field มาตรฐานนอกลิสต์ไม่ปลอดภัย — ก่อนเพิ่ม rectype ให้กวาด master + template บน account ว่า bind key อะไรบ้าง แล้วเติม alias พร้อม**จ่ายค่าจริง** ไม่ใช่แค่ประกาศชื่อ
2. designer — เพิ่มใน `RECORD_TYPES` (`designer/src/constants/record-types.ts`) โดย `value` = **record type id จริงของ NetSuite** เท่านั้น (engine filter ตรงตัว — ค่า pseudo แบบ `transaction` ทำให้ Print ขึ้น `No template found` ตลอดไป #158); unit test คุมว่า rectype ที่ปุ่มโผล่ต้องมีในลิสต์ครบ
3. template — `templates/master/<doc>.xml` (copy skeleton) + `templates/samples/<doc>.sample.json` สังเคราะห์
4. ตั้ง default template ต่อ rectype บน account ผ่านปุ่ม `⚙ ตั้งค่าการบันทึก` ไม่งั้น Print คืน `No template found` (R4)

### deploy ไฟล์เดียวเข้า account (hotfix File Cabinet)

- SuiteScript หรือ HTML ไฟล์เดียว: skill `netsuite-qa-browser` → `references/deploy.md` (`ns-deploy-lib.sh` upload + hash-verify)
- engine เต็มชุด (script + object + version stamp): `scripts/deploy.sh` — **ข้ามไฟล์ฟอนต์โดยค่าเริ่มต้น (#167)**; ติดตั้งครั้งแรกหรือเปลี่ยนไฟล์ฟอนต์ใช้ `scripts/deploy.sh --with-fonts` (script เขียน `deploy.xml` ชั่วคราวแล้วคืนไฟล์เดิมให้เสมอผ่าน trap)
- ห้าม hotfix ตรงบน account โดยไม่ sync กลับ repo — repo คือ source of truth

### onboarding วิศวกรใหม่

```bash
git clone <repo> && cd teibto-pdf-designer
cd designer && npm install && npx playwright install chromium
npm run dev            # http://localhost:5173
npm test               # vitest · npx playwright test = e2e
```

- secret-scan ก่อน commit แรก: `bash scripts/secret-scan.sh`
- อ่าน `CLAUDE.md` (กติกา repo) + ลูปลงมือแก้ด้านบนของไฟล์นี้
- engine deploy ต้องมี suitecloud authid (Teibto sandbox เท่านั้น): `suitecloud account:setup` (skill `netsuite-sdf-authoring`)
- ห้าม commit `project.json` (authid จริง) · `.env` · `.qa-profiles/` · ข้อมูลจริงของลูกค้า

## 🧭 หลักสถาปัตยกรรมที่ห้ามละเมิด

- BFO เป็น render engine เดียว · template XML ใน `templates/master/` คือ source of truth · BFO generator มีที่เดียวคือ `designer/src/services/bfo-export.service.ts` — รายละเอียดเต็มและเหตุผลอยู่ใน `CLAUDE.md`

---

เอกสารนี้ขัดกับความจริงเมื่อไหร่ (คำสั่งเปลี่ยน · baseline เลื่อน · กับดักหมดอายุ) แก้ที่ไฟล์นี้ผ่าน PR docs แล้วอัปเดต baseline ให้ตรงรอบล่าสุด.

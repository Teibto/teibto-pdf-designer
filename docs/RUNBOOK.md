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
| Unit + component | `npx vitest run` | 538 passed |
| E2E | `npx playwright test` | 83 passed |
| Lint | `npm run lint` | 0 error (warning `any` เดิม ~46 ไม่นับ) |
| Secret (จาก repo root) | `bash scripts/secret-scan.sh` | no leaks |

CI `quality-gate` รัน lint + vitest + e2e + template validator + secret-scan แต่ **ไม่ครอบ `engine/`** — SuiteScript ตรวจเองด้วย `node --check <file>.js` ก่อน commit.

## 🧩 กับดัก designer (SPA)

- e2e กับ component test เลือก element ด้วย **ข้อความ label** — แก้ข้อความ UI แล้วต้องแก้ selector ใน spec ตามด้วย (`inspector.spec.ts` `pagination.spec.ts` `features.test.ts` `edge.test.ts` `data.spec.ts` `app.spec.ts`) ลืมแล้ว e2e แดง
- แปล UI เป็นไทยใช้รูปแบบ **`ไทย (English)`** เช่น `ความกว้าง (Width)` — คง substring อังกฤษไว้ให้ selector เดิม (`.filter({ hasText: 'Width' })`) ยัง match จึงแก้โค้ดได้โดยไม่ต้องรื้อ test (พิสูจน์ตอน #124)
- `<option>` ใน test เลือกด้วย `value` ไม่ใช่ข้อความ · ข้อความที่แสดงจึงเปลี่ยนเป็นไทยล้วนได้ไม่กระทบ test
- ชื่อ custom element ไม่ตรงชื่อไฟล์ — header คือ `pld-header` (ไม่ใช่ `pld-app-header`) · editor เดียวคือ `pld-band-view` (canvas เก่าถอดแล้ว) · band ที่ element อยู่คือ role ของมัน ดังนั้นเปลี่ยน role = ย้าย chip ข้าม band (#127)
- flag ชั่วคราวห้ามอยู่ใน undoable state — `dragType` เคยเขียนแบบ untagged ทำให้ history middleware เก็บ snapshot เกิน แล้ว Ctrl+Z แรกเป็น no-op (#129) แก้โดยเขียนผ่าน action ที่ `tagAction(..., { undoable: false })`
- ไฟล์ source ใหม่หรือ rewrite ใส่ `@author <ชื่อจริง>` + `@since YYYY-MM-DD` (R1) ห้ามเดาชื่อ

## ⚙️ กับดัก engine (SuiteScript / SDF)

- render engine ต้องไม่พังเงียบ (R4) — fail ต้อง error ให้เห็น ไม่คืน PDF เปล่า · เวลาเพิ่ม log ใช้ structured `N/log` + `errorId` correlation (fail ยิง `log.error` พร้อม context ครบ และแนบ `errorId` ใน response · success ยิง `log.audit` ครั้งเดียว) ดู `pld_sl_render_pdf.js` (#149)
- SDF partial deploy เมื่อแก้ 1-2 ไฟล์ — backup `engine/src/deploy.xml` → เขียน minimal → `suitecloud project:validate --server` → `project:deploy` (รันผ่าน **Bash** ไม่ใช่ PowerShell foreground) → **restore `deploy.xml` เต็มเสมอ** · `project.json` (authid) gitignore ไว้
- full deploy คือ `scripts/deploy.sh` — stamp version แล้ว build กับ stage bundle แล้ว loop `defaultAuthId` ต่อ account พร้อมสรุป PASS/FAIL · ดู version ที่ deploy จาก account ผ่าน `?action=version`
- อ่าน Script Execution Log บน account — เปิด `script.nl?id=<scriptid>` (ไม่ใช่ `scriptrecord.nl` ที่จะขึ้น "Record does not exist") แล้วคลิก subtab `#executionlogtxt` log จะขึ้น inline
- data classification (Internal) — account ลูกค้าห้ามแตะแม้ dryrun · deploy เฉพาะ Teibto sandbox เท่านั้น
- verify engine change — `node --check` + review + QA สดบน SB2 (skill `netsuite-qa-browser`)

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

Validate แล้ว smoke-test:

- local + CI: `bash scripts/validate-templates.sh`
- render จริง: save XML เข้า `customrecord_pld_template` แล้วเปิด `?action=render&rectype=<doc>&recid=<n>&tplid=<id>` · ตรวจฟอนต์ไทยไม่เป็น □ และ header/footer ซ้ำทุกหน้า

facts เต็มเรื่อง BFO/FreeMarker (font embedding · `?then` vs ternary · macrolist multi-page · zero-test-data smoke) อยู่ที่ skill `netsuite-bfo-pdf` และ `docs/TOOLSTACK.md` ไม่ทำซ้ำที่นี่.

## 🧰 Recipe ต่อ account และ onboarding

### ตั้ง company config ต่อ account

config record `customrecord_pld_config` คือจุดตั้งค่า per-account จุดเดียว จ่าย `${company.*}` ให้ทุก template.

1. สร้าง 1 record ต่อ subsidiary หรือ 1 record global (เว้น `custrecord_pld_cfg_subsidiary` ว่าง = fallback) · field: `_name` `_name_en` `_taxid` `_branch` `_address` `_address_en` `_phone` `_email` `_logo_url` `_theme_color` `_font_regular` `_font_bold` `_subsidiary`
2. ฟอนต์ไทยต้องชี้ URL ไป **THSarabunPSK เท่านั้น ห้าม THSarabunNew (#32)** — BFO ไม่ apply GPOS จึงทำวรรณยุกต์/สระของ THSarabunNew ลอยหลุดฐาน · ฟอนต์ที่ไม่ embed (Noto/Tahoma) glyph ไทย drop เงียบใน PDF
3. font URL มี token `h=...` ที่หมดอายุเมื่อ re-save ไฟล์ฟอนต์ใน File Cabinet → refresh แล้วอัปเดต config
4. `load()` เลือก config 3-tier: subsidiary ตรง → global (subsidiary ว่าง) → record แรก · เต็ม: `engine/DEPLOYMENT.md §Company Config`

### เพิ่ม document type ใหม่ end-to-end

1. engine — เพิ่ม rectype ใน `DOC_TITLES` (`pld_lib_invoice_data.js`) เป็น `{th, en}` · ฝั่งซื้อเพิ่มใน `PURCHASE_SIDE` (คุมเครื่องหมายจำนวนเงิน) · รองรับตอนนี้: `invoice` `creditmemo` `estimate` `salesorder` `purchaseorder`
2. designer — เพิ่มใน `RECORD_TYPES` (`designer/src/constants/record-types.ts`) โดย `value` = **record type id จริงของ NetSuite** เท่านั้น (engine filter ตรงตัว — ค่า pseudo แบบ `transaction` ทำให้ Print ขึ้น `No template found` ตลอดไป #158); unit test คุมว่า rectype ที่ปุ่มโผล่ต้องมีในลิสต์ครบ
3. template — `templates/master/<doc>.xml` (copy skeleton) + `templates/samples/<doc>.sample.json` สังเคราะห์
4. ตั้ง default template ต่อ rectype บน account ผ่านปุ่ม `⚙ ตั้งค่าการบันทึก` ไม่งั้น Print คืน `No template found` (R4)

### deploy ไฟล์เดียวเข้า account (hotfix File Cabinet)

- SuiteScript หรือ HTML ไฟล์เดียว: skill `netsuite-qa-browser` → `references/deploy.md` (`ns-deploy-lib.sh` upload + hash-verify)
- engine เต็มชุด (script + object + version stamp): `scripts/deploy.sh`
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

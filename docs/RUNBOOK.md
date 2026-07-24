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
| Unit + component | `npx vitest run` | 529 passed |
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

## 🧭 หลักสถาปัตยกรรมที่ห้ามละเมิด

- BFO เป็น render engine เดียว · template XML ใน `templates/master/` คือ source of truth · BFO generator มีที่เดียวคือ `designer/src/services/bfo-export.service.ts` — รายละเอียดเต็มและเหตุผลอยู่ใน `CLAUDE.md`

---

เอกสารนี้ขัดกับความจริงเมื่อไหร่ (คำสั่งเปลี่ยน · baseline เลื่อน · กับดักหมดอายุ) แก้ที่ไฟล์นี้ผ่าน PR docs แล้วอัปเดต baseline ให้ตรงรอบล่าสุด.

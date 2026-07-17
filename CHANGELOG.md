# Changelog

รูปแบบตาม [Keep a Changelog](https://keepachangelog.com/) · วันที่ `YYYY-MM-DD` · SemVer ต่อ repo (R7)

## [Unreleased]

### Added
- Multi-account deploy pipeline `scripts/deploy.sh` — deploy SDF engine เข้าหลาย sandbox ด้วยคำสั่งเดียว (วน authid จาก `engine/deploy-targets.txt` เขียน `defaultAuthId` ต่อ account เพราะ `project:deploy` ไม่มี `--authid`, สรุปผล PASS/FAIL ต่อ account, คืน `project.json` เสมอ) + version stamp (`engine/VERSION` + git sha + UTC → `pld_version.txt` ใน File Cabinet) ตรวจได้จาก account ผ่าน `?action=version` — พิสูจน์สดบน Teibto SB2 (deploy จริง + endpoint คืน stamp ตรง) (#11)
- Master templates อีก 5 ฟอร์มครบชุด Standard Template Pack: `invoice`, `purchase-order`, `delivery-note`, `receipt`, `quotation` ใน `templates/master/` + sample สังเคราะห์ต่อฟอร์มใน `templates/samples/` — โครง/CSS/macro/font pattern เดียวกับ `tax-invoice.xml` ทุกไฟล์ ทั้ง 5 ฟอร์ม render จริงผ่านบน Teibto SB2 (#8)
- Template validator `scripts/validate-templates.sh` + step ใน quality-gate CI — จับกับดัก BFO/FreeMarker ตั้งแต่ PR: XML ไม่ well-formed, C-ternary (#1), binding ไม่ null-safe (#2), font ที่ไม่ผ่าน config layer (#32), CSS ที่ BFO เมินเงียบ (object-fit/text-overflow/@page/counter), `<div>` ระดับ body (#10), sample JSON parse ไม่ได้ — รัน local ได้ `bash scripts/validate-templates.sh` (#10)
- ESLint flat config `designer/eslint.config.js` (typescript-eslint) + script `lint` — quality-gate รัน `npm run lint` กลับมาแล้ว (จับ bug เป็น error, noise เชิงสไตล์เป็น warn); แก้ 3 error เดิม (`{}` type, `@ts-ignore` stale 2 จุด) (#17)

### Fixed
- secret-scan false positive จาก `.qa-profiles/` (Chrome QA profile ที่ gitignore) — เพิ่ม `.gitleaks.toml` allowlist path นี้ (gitleaks auto-detect ที่ root, ไม่ต้องแตะ canonical `secret-scan.sh`); ยืนยันด้วย canary ว่า secret จริงนอก path ยังถูกจับ (#25)
- วรรณยุกต์/สระไทยลอยหลุดจากฐานในทุก PDF (เห็นชัดบนฐานเตี้ย เช่น น้ำ ค่า) — เปลี่ยนฟอนต์ฝังจาก `THSarabunNew` เป็น `THSarabunPSK`. BFO ของ NetSuite ไม่ apply GPOS mark positioning; THSarabunNew พึ่ง GPOS ดึง mark ลง THSarabunPSK วาง mark ถูกใน glyph outline เอง. แก้ที่ไฟล์ฟอนต์ bundled (`engine/src/.../fonts/`) + DEPLOYMENT.md; template ไม่แตะ (อ้าง `${company.fontRegular/fontBold}` จาก config อยู่แล้ว) — พิสูจน์ด้วย render จริงบน SB2 (#32)

## [0.2.0] - 2026-07-17

Phase 1 (render-correct engine) จบครบ + master template แรกของ Standard Template Pack
ทุกข้อที่แตะ BFO output พิสูจน์ด้วย render จริงบน Teibto SB2 ไม่ใช่ unit test อย่างเดียว

### Added
- Master template ใบกำกับภาษี/ใบแจ้งหนี้เต็มรูป `templates/master/tax-invoice.xml` + sample สังเคราะห์ `templates/samples/tax-invoice.sample.json` — macrolist header/footer, VAT breakdown, ช่องลายเซ็น, ฟังก์ชัน FreeMarker แปลงยอดเป็นตัวอักษรไทย (#7, PR #24)
- Company config layer: custom record `customrecord_pld_config` (13 field: ชื่อ/ที่อยู่ 2 ภาษา, เลขผู้เสียภาษี+สาขา, โลโก้, สี theme, font URL ไทย, feature flags) + loader ร่วม `pld_lib_company_config.js` — template กลางอ้าง `${company.*}` แล้วจบที่ config 1 record ต่อ account (#9, PR #28)
- Thai font embedding ใน generator: `<link type="font">` THSarabunNew + `bytes="2"` + `src-bold` (#5, PR #19)
- Header/footer ซ้ำทุกหน้าผ่าน BFO macrolist + `<pagenumber/>`/`<totalpages/>` (#3, PR #18)
- SDF packaging (`engine/src`): deploy ทั้ง engine เข้า account ด้วย `suitecloud project:deploy` (#11 slice แรก, PR #23)
- Quality-gate CI รัน Vitest ของ `designer/` (PR #16)

### Changed
- Null-safety ทุก FreeMarker binding ที่ generator ผลิต: `!''` ทุก interpolation, `<#list (record.x)![]>`, barcode ครอบ `<#if ?has_content>` (value ว่าง = hard BFO error), image src ไม่ผ่าน escapeXml (#4, PR #26)
- Save template บังคับแนบ BFO XML ทั้งสอง Suitelet — reject พร้อม message ชัดเจนเมื่อไม่มี (#6, PR #27)
- `templates/master/tax-invoice.xml` อ้าง font URL จาก `${company.fontRegular/fontBold}` — ไฟล์ master save เข้า account ได้ตรง ๆ ไม่ต้อง bake URL ต่อ account (#9, PR #28)

### Removed
- Fallback XML generator ฝั่ง engine (~250 บรรทัดใน `pld_sl_render_pdf.js`) — generator มีที่เดียวคือ `designer/src/services/bfo-export.service.ts` (#6, PR #27)
- Script parameters `custscript_pld_company_*` — แทนด้วย config record (#9, PR #28)

### Fixed
- C-style ternary ใน fallback table row ทำ template parse error — เปลี่ยนเป็น `?then()` (#1, PR #14)
- Preview strip เฉพาะ `record.*` ทำ expression อื่นพัง render — strip ทุก `${...}` + `<#...>` (#2, PR #15)
- Custom record save ไม่ตั้ง built-in `name` ทำ save fail (#20–#22 smoke-test fixes, PR #23)

## [0.1.0] - 2026-07-16

### Added
- Initial scaffold: โครง 3 ชั้น (`engine/` + `templates/` + `designer/`), เอกสารมาตรฐานทีม (README, CLAUDE.md, CONTRIBUTING, SECURITY, LICENSE proprietary), quality-gate CI, secret-scan gate
- Import designer codebase จาก `pdf-layout-designer-v3.2` (Lit 3 SPA ~15,000 LOC, 229 unit tests) เข้า `designer/`
- Import SuiteScript engine (`pld_sl_render_pdf.js`, `pld_sl_designer.js`, `pld_ue_button.js` + DEPLOYMENT.md) เข้า `engine/`

# Changelog

รูปแบบตาม [Keep a Changelog](https://keepachangelog.com/) · วันที่ `YYYY-MM-DD` · SemVer ต่อ repo (R7)

## [0.1.0] - 2026-07-16

### Added
- Initial scaffold: โครง 3 ชั้น (`engine/` + `templates/` + `designer/`), เอกสารมาตรฐานทีม (README, CLAUDE.md, CONTRIBUTING, SECURITY, LICENSE proprietary), quality-gate CI, secret-scan gate
- Import designer codebase จาก `pdf-layout-designer-v3.2` (Lit 3 SPA ~15,000 LOC, 229 unit tests) เข้า `designer/`
- Import SuiteScript engine (`pld_sl_render_pdf.js`, `pld_sl_designer.js`, `pld_ue_button.js` + DEPLOYMENT.md) เข้า `engine/`

# Contributing — teibto-pdf-designer

กติกาการทำงานใน repo นี้ — กติกากลางของทีมดู [teibto-dev-standards](https://github.com/Teibto/teibto-dev-standards) (pinned `v0.14.0`)

## Flow 8 ขั้น

1. **Issue** — งานทุกชิ้นเริ่มจาก Issue (ใช้ issue form; เปิดจาก CLI ต้อง mirror โครงฟอร์มครบ) พร้อมเกณฑ์ตรวจรับ
2. **Assign** — assign = จองงาน · 1 issue = 1 PR · ก่อนแตะไฟล์ที่คนอื่น assign อยู่ ให้คุยกันก่อน
3. **Branch** — แตกจาก `main`: `feat/<name>` · `fix/<name>` · `docs/<name>`
4. **QA** — designer: `npm test` + E2E ที่เกี่ยว · engine/templates: render ผ่าน `N/render` บน sandbox ด้วย sample data สังเคราะห์ แนบหลักฐาน (screenshot PDF) ใน PR
5. **PR** — เข้า `main` ผ่าน PR template + reviewer ≥ 1 · doc ที่กระทบไปกับ PR เดียวกับโค้ด · รัน `bash scripts/secret-scan.sh` ก่อน push
6. **Squash** — squash merge เท่านั้น (ปิด merge commit/rebase ที่ระดับ repo แล้ว) · branch ถูกลบอัตโนมัติหลัง merge
7. **Deploy** — งานที่ merge แล้วแต่ยังไม่ deploy เข้า account ลูกค้า ต้องมี Issue ติด label `deployment` พร้อม checklist; deploy ด้วย `scripts/deploy.sh` (SDF หลาย account คำสั่งเดียว) แล้ว verify version ต่อ account ผ่าน `?action=version` — ดู `engine/DEPLOYMENT.md`
8. **Release** — tag `vMAJOR.MINOR.PATCH` + CHANGELOG entry · MAJOR bump เมื่อ template schema หรือ custom record schema เปลี่ยนแบบ breaking

## กติกาเฉพาะ repo

- **Branch ถาวรมีตัวเดียวคือ `main`** — เจอ branch ค้าง = ตรวจ PR ของมัน
- **Direct push อนุญาตเฉพาะ docs-only** — ไฟล์กติกา (CONTRIBUTING, CLAUDE.md, SECURITY) ต้องผ่าน PR เสมอ
- **`templates/master/` คือ source of truth** — การแก้ template ทุกครั้งผ่าน PR ที่นี่ ไม่แก้ใน UI ของ account ลูกค้า; ถ้าจำเป็นต้อง hotfix ที่ account ให้เปิด Issue ตามเก็บกลับเข้า repo ทันที
- **`scripts/secret-scan.sh` ห้ามแก้** — canonical อยู่ `teibto-dev-standards`; มีปัญหาเปิด issue ที่ repo กลาง
- ไฟล์ source ใหม่/rewrite: `@author <ชื่อจริง>` + `@since YYYY-MM-DD` (R1) · วันที่ `YYYY-MM-DD` ทุกที่ (R2)

## ความรู้อยู่ที่ไหน

| เรื่อง | ที่อยู่ |
|---|---|
| สถาปัตยกรรม 3 ชั้น + ผล code review ตั้งต้น | `docs/architecture/OVERVIEW.md` |
| ขั้นตอน deploy engine เข้า NetSuite | `engine/DEPLOYMENT.md` |
| Stack, เครื่องมือ, กับดัก BFO/FreeMarker | `docs/TOOLSTACK.md` |
| กติกา agent (Claude Code) | `CLAUDE.md` |
| มาตรฐานกลางทีม + playbook | [teibto-dev-standards](https://github.com/Teibto/teibto-dev-standards) |

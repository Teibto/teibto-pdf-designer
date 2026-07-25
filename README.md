**[📘 คู่มือผู้ใช้](docs/USER-GUIDE.md)** · **[🩺 แผนที่แก้ปัญหา](docs/TROUBLESHOOTING.md)** · **[🔄 Contributing](CONTRIBUTING.md)** · **[🏗️ Architecture](docs/architecture/OVERVIEW.md)** · **[🧰 Tech Stack & Tools](docs/TOOLSTACK.md)** · **[🔁 Playbook](https://github.com/Teibto/teibto-dev-standards/blob/main/REPO-SETUP-PLAYBOOK.md)**

# teibto-pdf-designer

NetSuite PDF Template Product — render engine + standard Thai template pack + visual designer สำหรับงาน implement ลูกค้า 100+ account

| | |
|---|---|
| **Project code** | `internal` (Teibto product — ไม่ผูกลูกค้ารายใด) |
| **Repo Owner** | @wichtking (Wichit Wongta) |
| **Data classification** | **Internal** — ห้าม export ข้อมูลจริงจาก account ลูกค้าเข้า repo, sample data สังเคราะห์เท่านั้น (ดู [Playbook §2.3](https://github.com/Teibto/teibto-dev-standards/blob/main/REPO-SETUP-PLAYBOOK.md)) |
| **Governance profile** | `standard` — secret scan บังคับ, PR + reviewer ≥ 1, quality-gate เปิด |

## ภาพรวม product (3 ชั้น)

```
teibto-pdf-designer/
├── engine/      ← ชั้น 1: SuiteScript render engine (Suitelet + UE) — deploy เข้าทุก account, version เดียว
├── templates/   ← ชั้น 2: Standard Template Pack — master BFO XML ต่อประเภทเอกสาร (asset หลักของ product)
└── designer/    ← ชั้น 3: Visual designer SPA (Lit 3 + TypeScript + Vite) — เครื่องมือของ consultant
```

หลักการ: **BFO (`N/render`) เป็น render engine เดียว** — designer/preview ต้องเห็นผลจาก engine ตัวเดียวกับที่ print จริง, template XML คือ source of truth ที่ version control ใน repo นี้

## Quick start

### Designer (local dev)

```bash
cd designer
npm install
npm run dev        # → http://localhost:5173
npm test           # Vitest unit tests
npm run build      # → dist/
```

### Engine (deploy เข้า NetSuite account)

ดูขั้นตอนเต็มใน [`engine/DEPLOYMENT.md`](engine/DEPLOYMENT.md) — สรุป: สร้าง custom record `customrecord_pld_template` → upload script 3 ตัว → สร้าง script record + deployment → กดปุ่ม Print PDF / Design PDF บน transaction

### Secret scan (ก่อน commit ทุกครั้ง)

```bash
bash scripts/secret-scan.sh
```

## โครงสร้าง

```
designer/    Visual designer SPA — src/, tests/ (Vitest + Playwright), .storybook/
engine/      SuiteScript 2.1 — pld_sl_render_pdf.js (render), pld_sl_designer.js (host SPA), pld_ue_button.js (ปุ่ม)
templates/   master/ = BFO XML ต้นแบบต่อประเภทเอกสาร · samples/ = sample data สังเคราะห์
docs/        architecture/OVERVIEW.md (สถาปัตยกรรม + ผล code review), TOOLSTACK.md
scripts/     secret-scan.sh (canonical จาก teibto-dev-standards — ห้ามแก้ใน repo นี้)
```

## Conventions

- Commit: Conventional Commits (`feat:` `fix:` `docs:` …) · Branch: `feat/<name>` · merge ผ่าน PR + squash เท่านั้น
- วันที่ `YYYY-MM-DD` ทุกที่ · ไฟล์ source ใหม่ใส่ `@author <ชื่อจริง>` + `@since YYYY-MM-DD`
- กติกากลางทั้งหมด: [teibto-dev-standards](https://github.com/Teibto/teibto-dev-standards) (pinned: `v0.14.0`)

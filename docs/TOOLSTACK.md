# Tech Stack & Tools — teibto-pdf-designer

> อัปเดตล่าสุด: 2026-07-16

## Runtime stack

| ชั้น | เทคโนโลยี |
|---|---|
| designer/ | Lit 3.x · TypeScript 5.5 · Tailwind CSS 4 · Immer · Vite 6 · jsPDF + AutoTable · bwip-js |
| engine/ | SuiteScript 2.1 — `N/render` (BFO + FreeMarker), Suitelet ×2, User Event ×1 |
| templates/ | BFO XML (`report-1.1.dtd`) + FreeMarker · ฟอนต์ THSarabunNew (File Cabinet) |

## Dev & Deploy

- Designer: `cd designer && npm run dev` (Vite :5173) · unit `npm test` (Vitest) · E2E `npx playwright test`
- Engine deploy: ตาม `engine/DEPLOYMENT.md` (upload File Cabinet + script records) — แผน SDF packaging อยู่ใน Issues
- Secret gate: `bash scripts/secret-scan.sh` (gitleaks ≥ 8.19) ก่อน commit ทุกครั้ง + รันใน CI

## QA toolchain

- ยิง render จริงบน sandbox ผ่าน Suitelet `?action=render&rectype=...&recid=...` — หลักฐานเป็น PDF จริงเท่านั้น (jsPDF preview ไม่นับ)
- Browser QA ใน NetSuite: Claude Code skills `netsuite-qa-browser`, `agent-browser-qa`

## Claude Code skills ที่เกี่ยว

`netsuite-suitelet` · `netsuite-suiteql` · `netsuite-qa-browser` · `teibto-doc-standard` · `teibto-setup-repo`

## Checklist ตั้งเครื่องใหม่

```bash
# 1. เครื่องมือ
node --version        # ≥ 20
gitleaks version      # ≥ 8.19
gh auth status        # login + เข้าถึง org Teibto

# 2. โปรเจกต์
git clone https://github.com/Teibto/teibto-pdf-designer.git
cd teibto-pdf-designer/designer && npm install && npm test
```

## Top กับดักที่ทีมเหยียบมาแล้วจริง (BFO / FreeMarker)

1. **FreeMarker ไม่มี C-ternary** — `${cond ? a : b}` = template error ทันที → ใช้ `${cond?then(a, b)}` หรือ `<#if>`
2. **Binding ไม่ null-safe ทำ PDF พังทั้งใบ** — field ว่าง 1 ตัว = error → ใช้ `${record.field!""}` เสมอ
3. **BFO ไม่รู้จัก CSS `@page` margin boxes / `counter(page)`** — header/footer ซ้ำทุกหน้าใช้ `<macrolist><macro id="nlheader">` + `<body header="nlheader">` + `<pagenumber/>`/`<totalpages/>`
4. **ภาษาไทยต้อง embed font เท่านั้น** (พิสูจน์บน SB2 2026-07-17, #22) — font-family ที่ไม่ embed (Tahoma, Sarabun, แม้แต่ NotoSansThai) ทำ **glyph ไทยหายเงียบ** ไม่มี error → ใช้ `<link name="THSarabunNew" type="font" subtype="truetype" src=... src-bold=... bytes="2">` โดยไฟล์ TTF ต้องติ๊ก **Available Without Login** และ src ต้องเป็น URL เต็มมี `h=` token + `_xt=.ttf` (token ออกใหม่ทุกครั้งที่ save ไฟล์ — เก็บใน script param ต้องอัปเดตตาม)
5. **CSS ที่ BFO เมินเงียบ ๆ** — `object-fit`, `text-overflow: ellipsis`, `-webkit-*` — อย่าให้ designer เสนอ option ที่พิมพ์ไม่ได้
6. **แก้ template ใน UI account ลูกค้าโดยไม่ commit กลับ = drift** — source of truth คือ `templates/master/` ใน repo นี้
7. **BFO justify ข้อความเปล่าใน `<td>` ที่ wrap หลายบรรทัด** (ช่องไฟยืด, cluster ไทยแตกเช่น "หน ้า") — `text-align` บน td หรือ `align` attr เอาไม่อยู่ → ห่อเนื้อหา cell ด้วย block `<p>` ที่ระบุ alignment เอง (พิสูจน์บน SB2 2026-07-17, #7)
8. **เลขคณิตใน N/render คืน double** — `1125 % 100` = `25.0` → `?c` ได้ `"25.0"` แล้ว `"."?number` พังเงียบ → ใส่ `?int` ทุกผลลัพธ์ `%`/`*` ก่อนแปลงเป็น string
9. **Field ที่ไม่มีบน record ผูกมาเป็น `''` ไม่ใช่ missing** — default ของ `!` เช่น `${record.x!"-"}` จะไม่โผล่ (ได้ค่าว่างแทน) และ expression ที่พังใน `${...}` ถูกกลืนเป็นค่าว่างเงียบ ๆ ไม่ error
10. **`<div>` ระดับ body ถูก BFO ทิ้งทั้ง element เงียบ ๆ** — ใช้ `<p>`/`<table>` เท่านั้น
11. **Font URL เสีย (เช่น placeholder ไม่ถูกแทน) ไม่ error** — BFO เมิน `<link type="font">` เงียบ ๆ แล้วไทยหายทั้งใบ · เช็คเร็วสุดจากขนาด PDF: embed สำเร็จโตขึ้น ~13KB+ ต่อ font subset

## สิ่งที่ repo นี้ *ไม่มี* (โดยเจตนา)

- ไม่มี per-customer template overrides — ของเฉพาะลูกค้าอยู่ repo ของ engagement นั้น (classification ต่างกัน — ที่นี่ Internal, ของลูกค้า Client Confidential)
- ไม่มีข้อมูลจริงจาก account ลูกค้า — sample สังเคราะห์เท่านั้น
- ไม่มี SDF auth (`project.json` ถูก gitignore) — auth เป็นค่าเฉพาะเครื่อง

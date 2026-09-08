# NetSuite Deployment Guide — PDF Layout Designer

เอกสารนี้สำหรับคนที่ติดตั้ง engine เข้า account. ผู้ใช้งานประจำวันและผู้ดูแล account อ่าน [`docs/USER-GUIDE.md`](../docs/USER-GUIDE.md) · อาการเสียกับทางแก้อยู่ที่ [`docs/TROUBLESHOOTING.md`](../docs/TROUBLESHOOTING.md).

## สถาปัตยกรรม

**ไม่ใช้ Advanced PDF/HTML Templates** — ระบบทำ PDF เองทั้งหมด

```
┌───────────────────────────────────────────────────────────────┐
│                      NetSuite                                 │
│                                                               │
│  [Transaction Form]                                           │
│       │                                                       │
│       ├── [Print PDF] ──► pld_sl_render_pdf.js (Suitelet)     │
│       │                     │                                 │
│       │                     ├── Load template from CR          │
│       │                     ├── Load record data               │
│       │                     ├── N/render (FreeMarker)          │
│       │                     └── Return PDF ──► Browser         │
│       │                                                       │
│       ├── [Download PDF] ──► (same, attachment mode)           │
│       │                                                       │
│       └── [Design PDF] ──► pld_sl_designer.js (Suitelet)      │
│                              │                                │
│                              ├── Serve SPA from File Cabinet   │
│                              ├── Inject NS context             │
│                              └── CRUD API for templates        │
│                                                               │
│  [Custom Record: customrecord_pld_template]                   │
│       ├── custrecord_pld_tpl_name    (Text)                   │
│       ├── custrecord_pld_tpl_data    (Long Text) ← Designer   │
│       ├── custrecord_pld_tpl_xml     (Long Text) ← BFO XML    │
│       ├── custrecord_pld_tpl_rectype (Text)                   │
│       └── custrecord_pld_tpl_default (Checkbox)               │
│                                                               │
│  [User Event: pld_ue_button.js]                               │
│       └── Adds buttons: Print / Download / Design PDF         │
│           + Template selector (if multiple templates)         │
└───────────────────────────────────────────────────────────────┘
```

## Flow

```
1. User เปิด Invoice → เห็นปุ่ม [Print PDF] [Download PDF] [Design PDF]
2. กด [Design PDF]  → เปิด Designer, โหลด record data อัตโนมัติ
3. Design layout    → Bind fields, configure tables, set roles
4. กด Save          → บันทึกลง Custom Record (JSON + BFO XML)
5. ปิด Designer     → กลับไปที่ Transaction
6. กด [Print PDF]   → Suitelet โหลด template, bind record data, render PDF → แสดงในเบราว์เซอร์
```

---

## Deploy ด้วย SDF — หลาย account ด้วยคำสั่งเดียว (#11)

engine/ เป็น SDF project (`src/manifest.xml`, `src/Objects/`, `src/FileCabinet/`) — custom record
และ script record/deployment ทั้งหมดสร้างอัตโนมัติผ่าน SDF **ไม่ต้องคลิกตาม Step 1–4 ด้านล่าง**
(Step 1–5 เก็บไว้เป็น reference อธิบายว่าแต่ละ object คืออะไร)

**ตั้งค่าครั้งเดียว:**
```bash
suitecloud account:manageauth --list          # ดู authid ที่มี (ต้อง account:setup ต่อ account ก่อน)
cp engine/deploy-targets.txt.example engine/deploy-targets.txt
# แก้ deploy-targets.txt ใส่ authid ของ sandbox ที่จะ deploy (หนึ่ง authid ต่อบรรทัด)
```

> `engine/deploy-targets.txt` และ `engine/project.json` **gitignore ไว้** — authid เป็นค่าเฉพาะเครื่อง
> + ข้อมูลอ่อนไหว (โดยเฉพาะ authid ลูกค้า) ห้าม commit

**Deploy:**
```bash
scripts/deploy.sh                    # deploy ทุก authid ใน deploy-targets.txt (ทีละตัว)
scripts/deploy.sh --dryrun           # preview ก่อน ไม่ deploy จริง
scripts/deploy.sh acc1-sb1 acc2-sb1  # เจาะจง authid (แทน targets file)
```

`deploy.sh` build และตรวจ manifest ก่อน stage/stamp แล้ววนทีละ account: เขียน `defaultAuthId` ใหม่ → `suitecloud project:deploy`
→ สรุปผล PASS/FAIL ต่อ account (account ที่พังไม่ทำให้ตัวอื่นหยุด) → คืน `project.json` เป็นค่าเดิมเสมอ

> `project:deploy` ไม่มี flag `--authid` — มันอ่าน `defaultAuthId` จาก `project.json` เท่านั้น
> นี่คือเหตุผลที่ต้อง loop เขียน `project.json` ใหม่ต่อ account

### Version stamp — ตรวจได้ว่า account ไหนรัน version อะไร

`engine/VERSION` เป็น source of truth. ทุกครั้งที่ `deploy.sh` รัน มัน stamp
`version + git short sha (+dirty ถ้า working tree ไม่ clean) + UTC` ลงไฟล์
`pld_version.txt` ใน File Cabinet (ไฟล์นี้เป็น build artifact — gitignore ไว้ generate ใหม่ทุก deploy)

Candidate #199 adds `bundleBuilt`, `bundleSha256` and `enginePayload` (sorted file hashes and
aggregate hash for engine JavaScript, Objects XML, VERSION, SDF manifest and SuiteCloud config).
The engine hash excludes fonts, account metadata and generated deploy scope/stamp; SPA assets
have their own manifest digest. `+dirty` includes staged and untracked changes.

`npm run build:netsuite` writes `designer/dist-netsuite/pld-build-manifest.json`. Deployment
verifies source/config/lockfile/environment and every asset before staging and again before
stamping. `--no-build` now rejects missing, stale or altered bundles; rebuild to recover.
Environment values are hashed, not stored as plaintext. This is consistency evidence, not a
signature or proof that an account has the same files. Compare the deployed stamp and actual
assets during sandbox acceptance. `--dryrun` still invokes SuiteCloud against the named account;
it is not an offline test. Project metadata and deploy scope are restored byte-for-byte on exit.

ตรวจ version ที่ deploy ไปบน account:
```
GET  scriptlet.nl?script=customscript_pld_render&deploy=customdeploy_pld_render&action=version
→ {"version":"0.3.0-dev","sha":"35da24b","built":"2026-07-17T04:21:54Z"}
```
หรือเปิดไฟล์ `SuiteScripts/pdf-layout-designer/pld_version.txt` ตรง ๆ ใน File Cabinet

---

## Step 1: สร้าง Custom Record

**Customization > Lists, Records & Fields > Record Types > New**

| Field | Value |
|-------|-------|
| Label | PDF Layout Template |
| ID | `customrecord_pld_template` |
| Include Name Field | ✓ |

**Custom Fields:**

| Label | ID | Type | Notes |
|-------|----|------|-------|
| Template Name | `custrecord_pld_tpl_name` | Free-Form Text | ชื่อ template |
| Designer Data | `custrecord_pld_tpl_data` | Long Text | JSON จาก Designer |
| BFO XML | `custrecord_pld_tpl_xml` | Long Text | BFO XML ที่ render ได้ |
| Record Type | `custrecord_pld_tpl_rectype` | Free-Form Text | invoice, salesorder, etc. |
| Is Default | `custrecord_pld_tpl_default` | Checkbox | Default template for this type |

**Custom Record 2 — ประวัติเวอร์ชัน (`customrecord_pld_tpl_version`, #189)**

engine เขียนแถวหนึ่งแถวต่อการเขียนเทมเพลตหนึ่งครั้ง (สร้าง / แก้ / กู้คืน / ลบ) — **ห้ามแก้ด้วยมือ** และห้ามลบทิ้ง เพราะเป็นทั้งทางถอยกลับและร่องรอยว่าใครแก้เอกสาร

| Label | ID | Type | Notes |
|-------|----|------|-------|
| Template Internal ID | `custrecord_pld_ver_tplid` | Integer | id ของเทมเพลต — ตัวเลขล้วน ไม่ใช่ List/Record เพื่อให้ประวัติรอดจากการลบเทมเพลต |
| Version | `custrecord_pld_ver_no` | Integer | เดินหน้าทีละ 1 ต่อเทมเพลต |
| Action | `custrecord_pld_ver_action` | Free-Form Text | create / update / rollback / delete / baseline |
| Template Name | `custrecord_pld_ver_name` | Free-Form Text | ชื่อ ณ เวอร์ชันนั้น |
| Record Type | `custrecord_pld_ver_rectype` | Free-Form Text | |
| Changed By (ID) / Changed By / Role | `custrecord_pld_ver_userid` / `_username` / `_roleid` | Free-Form Text | ชื่อเก็บเป็นข้อความ ประวัติจึงอ่านได้แม้พนักงานลาออก |
| BFO XML / Designer Data | `custrecord_pld_ver_xml` / `_data` | Long Text | เนื้อของเวอร์ชันนั้น |
| Note | `custrecord_pld_ver_note` | Free-Form Text | เช่น ย้อนกลับไปเวอร์ชันไหน |
| Payload Pruned | `custrecord_pld_ver_pruned` | Checkbox | เนื้อถูกตัดตามโควตาแล้ว — แถวยังอยู่ แต่กู้คืนไม่ได้ |

> เก็บเนื้อไฟล์ไว้ **20 เวอร์ชันล่าสุดต่อเทมเพลต** เวอร์ชันที่เก่ากว่านั้นถูกตัดเฉพาะ XML/JSON ทิ้งเพื่อไม่ให้ CLOBTEXT โตไม่มีเพดานบน account ลูกค้า — แถว audit ไม่เคยถูกลบ

---

## Step 2: Build App

```bash
cd pdf-layout-designer
npm install
npm run build:netsuite
```

ได้โฟลเดอร์ `dist-netsuite/`:
```
dist-netsuite/
├── index.html
└── assets/
    ├── pld-app.js
    └── pld-app.css
```

---

## Step 3: Upload to File Cabinet

**Documents > Files > File Cabinet**

```
SuiteScripts/
└── pdf-layout-designer/
    ├── pld_sl_designer.js        ← Suitelet: Host Designer
    ├── pld_sl_render_pdf.js      ← Suitelet: Render PDF
    ├── pld_ue_button.js          ← UE: Transaction Buttons
    └── dist/
        ├── index.html
        └── assets/
            ├── pld-app.js
            └── pld-app.css
```

**จดเลข Internal ID:**
- `index.html` → ใส่ `INDEX_FILE_ID` ใน `pld_sl_designer.js`
- โฟลเดอร์ `dist/` → ใส่ `APP_FOLDER_ID` ใน `pld_sl_designer.js`

---

## Step 4: Create Script Records

### Script 1 — PDF Designer (Suitelet)

| Field | Value |
|-------|-------|
| Type | Suitelet |
| Name | PLD - PDF Designer |
| ID | `customscript_pld_designer` |
| Script File | `pld_sl_designer.js` |

**Deploy:**

| Field | Value |
|-------|-------|
| Title | PLD Designer |
| ID | `customdeploy_pld_designer` |
| Status | Released |
| Audience | Administrator, or roles ที่ต้องการ |

**Script Parameters (เฉพาะ Designer — generator ฝั่ง client ใช้ตอน export):**

| ID | Label | Type |
|----|-------|------|
| `custscript_pld_font_regular` | Thai Font Regular URL | Free-Form Text |
| `custscript_pld_font_bold` | Thai Font Bold URL | Free-Form Text |

---

## Company Config (customrecord_pld_config) — จุดตั้งค่า per-account จุดเดียว

### Permission migration for #199

Drain existing batch tasks before deploying schema v5. Old jobs without authenticated identity are
rejected with resubmission guidance; do not mix old/new worker files while tasks run. Queue jobs
now retain the server-resolved XML and copies at enqueue. No edits to the template or default
after submission change that job. Per-job private folders and authenticated snapshots are implemented,
but secret restrictions, native historical access and role-revocation behavior require sandbox evidence under
`docs/PRODUCTION-READINESS.md`.
Limits are 500 documents per job, 1,000,000 XML characters per snapshot, 8 MiB serialized job,
8 MiB framed XML per merge chunk (at most 25 documents), and 20 render copies per document across immediate/queued/sample
paths. These limits do not establish live capacity; test governance/latency before rollout.

If save reports that content was saved but default reconciliation failed, keep the returned
template ID/version and repair permissions/default selection before printing. Multiple active
defaults for the same record type now cause an explicit error; the renderer does not pick one
arbitrarily. The new content and version remain available even if changing another record fails.

The candidate emits empty `runasrole` on packaged deployments and sets Suitelets `isonline=F`.
For user-facing scripts, verify that upgrading clears the old Administrator override and preserves
the caller's record/employee/subsidiary restrictions. Do not restore elevation for missing permissions.
For Map/Reduce, role inheritance comes from **programmatic submission by the caller**, not from
interpreting an empty XML field as a selectable Current Role deployment setting. Oracle documents
the MR deployment UI's Execute As Role as fixed Administrator, while script-submitted executions
inherit their caller. UI/scheduled execution is not an approved batch path.
[MR deployment fields](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1509578980.html),
[script submission](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1508887826.html).
Empty MR `runasrole` is present in Oracle's
[SDF example](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157185630390.html).
Local XML tests verify packaging only; SDF readback and restricted-role executions remain mandatory.

Prepare a minimum-permission role matrix per account: transaction View for required document
types; View for template/company config and font files; editor roles additionally need template
and version write permissions plus the configured editor allowlist. Restrict config changes to
administrators. Batch submitters need SuiteScript and SuiteScript Scheduling, and appropriate
private batch folder permissions; test direct file access separately from Suitelet access.

On-demand Map/Reduce runs with the calling script's identity and permissions according to
[Oracle's submission documentation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1508887826.html).
Manual UI submission runs as System with administrator permissions, so production jobs must be
submitted through the authorized batch flow. Required scheduling permissions are documented by
[MapReduceScriptTask.submit](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_453639770507.html).

Before sign-off, read back all deployment settings and test two restricted users in different
subsidiaries: render, preview-live, load-record, list/search, batch queue and file download. A
known forbidden record ID must remain forbidden on every route. Test template read-only versus
editor roles and administrator setup. File ownership/isolation remains a separate release blocker;
clearing role elevation does not establish per-requester batch privacy.

ค่าที่ template กลางอ้างผ่าน `${company.*}` ทั้งหมดมาจาก custom record **PDF Layout Config**
(SDF deploy ให้อัตโนมัติ) — สร้าง 1 record ต่อ account แล้ว template ทุกใบใช้ได้ทันที
โดยไม่ต้องแก้ template XML (#9). เมื่อพิมพ์ transaction ระบบเลือก config ของ subsidiary นั้น
หรือ global config ที่เว้น subsidiary ว่างเท่านั้น; ไม่ใช้ข้อมูลของ subsidiary อื่นแทน.
ไม่มี config หรือ File Cabinet font Regular/Bold ที่โหลดได้จะหยุดพร้อม error และวิธีแก้ (#199).
หน้า setup ที่ไม่มี transaction context ยังเปิดตรวจค่าที่ตั้งไว้ได้.

| Field | alias ใน template | หมายเหตุ |
|-------|-------------------|----------|
| Company Name (TH) | `${company.name}` | บังคับ |
| Company Name (EN) | `${company.nameEn}` | |
| Address (TH) | `${company.address}` | |
| Address (EN) | `${company.addressEn}` | |
| Phone | `${company.phone}` | |
| Email | `${company.email}` | |
| Tax ID | `${company.taxId}` | เลขประจำตัวผู้เสียภาษี 13 หลัก |
| Branch | `${company.branch}` | เช่น สำนักงานใหญ่ (Head Office) |
| Logo URL | `${company.logo}` | **file id** ของไฟล์ใน File Cabinet (แนะนำ) หรือ URL เต็ม (Available Without Login) |
| Theme Color | `${company.themeColor}` | hex เช่น `#1a3c6e` |
| Thai Font Regular URL | `${company.fontRegular}` | **file id** (แนะนำ) หรือ URL เต็ม — ดูขั้นตอนฟอนต์ด้านล่าง |
| Thai Font Bold URL | `${company.fontBold}` | เช่นเดียวกัน |
| Feature Flags | `${company.flags}` | comma-separated — template ใช้ `company.flags?contains("x")` |

> URL ทุกตัว (font/logo) ใน template ต้องผ่าน `?xml` เสมอ: `${(company.fontRegular!'')?xml}` —
> ค่า config มี `&` ดิบ ไม่ escape = BFO parse พังหลัง FreeMarker แทนค่า

**ฟอนต์ไทย (บังคับสำหรับเอกสารภาษาไทย — ไม่ embed = ตัวอักษรไทยหายเงียบ):**
1. ไฟล์ font อยู่ที่ `engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/fonts/` — **`THSarabunPSK-Regular.ttf` / `THSarabunPSK-Bold.ttf`** · ครั้งแรกต้อง deploy พร้อมฟอนต์: `scripts/deploy.sh --with-fonts` (deploy ปกติข้ามไฟล์ฟอนต์ ดู #167)
2. เปิดไฟล์ทั้งสองใน File Cabinet → ติ๊ก **Available Without Login** → Save
3. **ใส่ file id ของไฟล์** (เลขใน URL `id=<n>` ของหน้าไฟล์) ลงช่อง Thai Font Regular/Bold บน config record — engine จะ resolve URL สดตอน render เอง (#167)
   · ใส่ URL เต็มก็ยังใช้ได้ (ของเดิมไม่ต้องแก้) — engine ดึง `id=` จาก URL นั้นมา resolve ใหม่ให้ ไม่ต้องกลัว token หมดอายุ
4. Template pack อ้าง `${company.fontRegular}` อยู่แล้ว — ไม่ต้องแก้ template

> ⚠️ **ห้ามเก็บ URL ที่มี token ไว้เป็นค่าถาวรถ้าเลี่ยงได้ (#167)** — token `h=` เปลี่ยนทุกครั้งที่ไฟล์ถูก re-save (การ deploy ทับก็นับ) พิสูจน์สดบน SB2: ใส่ token ผิด → **บรรทัดภาษาไทยหายทั้งบรรทัด ไม่มี error** (PDF เล็กลงจาก 18,691 → 5,442 bytes = ฟอนต์ไม่ถูก embed) ใส่ file id แล้วปัญหานี้หายไปทั้งคลาส

> ⚠️ **ต้องใช้ THSarabunPSK เท่านั้น — ห้าม THSarabunNew (#32).** BFO ของ NetSuite **ไม่ apply GPOS mark positioning**; THSarabunNew ออกแบบให้วรรณยุกต์/สระ (่ ้ ั ิ ี ึ ื ุ ู) พึ่ง GPOS ดึงลง → บน BFO mark ลอยหลุดจากฐาน (เห็นชัดบนฐานเตี้ย เช่น น้ำ ค่า). THSarabunPSK วาง mark ถูกใน glyph outline เอง จึง render ถูกโดยไม่พึ่ง GPOS (พิสูจน์ด้วย render จริงบน SB2 2026-07-17 + ตรงกับ Suitelet PFTS ที่ใช้อยู่). หมายเหตุ: template ยังใช้ label `font-family: THSarabunNew` เป็น BFO font-family identifier เฉย ๆ — ตัวฟอนต์ที่ embed จริงมาจาก URL ใน config (ต้องชี้ไป THSarabunPSK)
>
> ⚠️ พิสูจน์แล้วบน SB2 (2026-07-17): font-family ที่ไม่ embed — รวมถึง `NotoSansThai` — ทำให้ **glyph ไทยถูก drop เงียบ ๆ** ใน PDF (ไม่ error) — เอกสารไทยทุกใบต้องตั้ง font URL บน config เสมอ

---

## Template Governance — ใครแก้เทมเพลตได้ (#189)

รุ่นเก่าใช้ `All Roles` + `Execute as Administrator`; candidate นี้ต้องยกเลิกการยกระดับของ Suitelet และพิสูจน์สิทธิ์ผู้เรียกตามขั้นตอนด้านบน การพิมพ์ต้องเคารพสิทธิ์ record/subsidiary ของผู้ใช้ ส่วน action เปลี่ยนเทมเพลต (`save` / `delete` / `rollback`) ตรวจ editor allowlist เพิ่มจากสิทธิ์ NetSuite.

**ตั้งค่า:** ช่อง **Template Editor Roles** (`custrecord_pld_cfg_editor_roles`) บน config record — ใส่ internal id ของ role คั่นด้วย comma เช่น `1017,1042` (ดู id ที่ Setup > Users/Roles > Manage Roles คอลัมน์ Internal ID)

| ค่าในช่อง | ใครแก้เทมเพลตได้ |
|---|---|
| ว่าง (ค่าตั้งต้น) | **Administrator เท่านั้น** |
| `1017` | Administrator + role 1017 |

- เป็นสิทธิ์ระดับ **account** ไม่ผูก subsidiary — engine อ่าน union ของ config record ที่ active ทุกใบ เพราะเทมเพลตหนึ่งตัวใช้พิมพ์ได้ทั้ง account (`customrecord_pld_template` ไม่มีช่อง subsidiary)
- Administrator (role 3) อนุญาตเสมอ — กัน account ล็อกตัวเองออกจากการตั้งค่าของตัวเอง
- **fail-closed**: config อ่านไม่ได้ / ยังไม่ได้ deploy field / ไม่มี config record = เหลือ Administrator อย่างเดียว พร้อม log บอกสาเหตุ ไม่มีทางที่ config ผิดแล้วเปิดให้ทุก role
- การพิมพ์ (`render`, `preview`, พิมพ์เป็นชุด) และการอ่าน (`list`, `get`, `history`) **ไม่ถูกจำกัด** — เป็นงานประจำวันของทุกคน

**ตรวจว่าใครแก้อะไรไป:** ทุกการเขียนทิ้งไว้สองที่ — แถวใน `customrecord_pld_tpl_version` (อยู่บน account ถาวร) และ `log.audit` หนึ่งบรรทัดใน Script Execution Log (`PLD template update` / `… delete` / `… rollback` / `PLD template write denied`) ที่มี `userId` `userName` `roleId` `tplid` `version` ครบ

> ⚠️ **ยืนยัน roleId สดหลัง deploy ครั้งแรกของทุก account** — login ด้วย role ที่ไม่ใช่ Administrator แล้วกดบันทึกเทมเพลตหนึ่งครั้ง จากนั้นอ่าน `roleId` ใน audit line: ถ้าขึ้น `3` แปลว่า account นี้ให้ `runtime.getCurrentUser().role` ตามค่า run-as ของ deployment ไม่ใช่ role จริงของผู้ใช้ → ด่านนี้เปิดให้ทุกคนโดยปริยาย ต้องกันที่ชั้น deployment แทน (ตั้ง Audience เป็นเฉพาะ role ที่แก้ได้ แล้วแยก deployment ของการพิมพ์ออก) unit test พิสูจน์ข้อนี้ไม่ได้โดยธรรมชาติ

---

### Script 2 — PDF Renderer (Suitelet)

| Field | Value |
|-------|-------|
| Type | Suitelet |
| Name | PLD - PDF Renderer |
| ID | `customscript_pld_render` |
| Script File | `pld_sl_render_pdf.js` |

**Deploy:**

| Field | Value |
|-------|-------|
| Title | PLD Renderer |
| ID | `customdeploy_pld_render` |
| Status | Released |
| Audience | All Roles ที่ต้องการ print |

**สำคัญ:** ใช้ Script Parameters เดียวกับ Designer สำหรับ company info

---

### Script 3 — Batch Print (Suitelet, #181)

| Field | Value |
|-------|-------|
| Type | Suitelet |
| Name | PLD - Batch Print |
| ID | `customscript_pld_batch` |
| Script File | `pld_sl_batch_print.js` |

**Deploy:**

| Field | Value |
|-------|-------|
| Title | PLD Batch Print |
| ID | `customdeploy_pld_batch` |
| Status | Released |
| Audience | All Roles ที่ต้องการพิมพ์เอกสารเป็นชุด |

**เปิดใช้งาน:** เปิด URL ของ deployment ตรง ๆ (Customization → Scripting → Scripts → PLD - Batch Print → Deployments → คลิกที่ deployment แล้วดู External/Internal URL) หรือทำ **Center Link** ให้ผู้ใช้กดจากเมนู: Customization → Centers and Tabs → Center Links → New โดยชี้ไป URL เดียวกัน

**ข้อจำกัดที่ต้องบอกผู้ใช้:** Suitelet มีโควตา 1,000 usage units ต่อครั้ง สคริปต์วัดต้นทุนจริงต่อใบตอนรันแล้วหยุดก่อนโควตาหมด — เอกสารทั่วไปพิมพ์ได้ราวสิบกว่าใบต่อครั้ง ถ้าเลือกเกิน ระบบขึ้นหน้าสรุปว่าพิมพ์ได้กี่ใบ เหลือกี่ใบ พร้อมปุ่มพิมพ์ส่วนที่เหลือ (ไม่ตัดทิ้งเงียบ) · ชุดใหญ่กว่านั้นจะย้ายไป Map/Reduce ใน PR ถัดไปของ #181

---

### Script 4 — Batch Print ชุดใหญ่ (Map/Reduce, #181)

| Field | Value |
|-------|-------|
| Type | Map/Reduce |
| Name | PLD - Batch Print (Map/Reduce) |
| ID | `customscript_pld_batch_mr` |
| Script File | `pld_mr_batch_print.js` |
| Parameter | `custscript_pld_mr_job` — ID ของ `customrecord_pld_batch_job` (schema v5; หน้าจอเขียนให้เอง) |

**Deploy:**

| Field | Value |
|-------|-------|
| Title | PLD Batch Print MR |
| ID | `customdeploy_pld_batch_mr` |
| Status | Not Scheduled (สั่งงานผ่าน `N/task` จากหน้าจอเท่านั้น) |

Candidate #199 requires `customrecord_pld_batch_job` and `customrecord_pld_batch_artifact`. Their `USEPERMISSIONLIST` starts with no
account-specific grants. Configure selected caller roles with EDIT and VIEWANDEDIT restrictions
on the record/role permission lists, plus the minimum File Cabinet and scheduling permissions.
Native VIEWANDEDIT includes creator/subordinates; application checks also require exact job
owner, requester and role. UI access and UI owner changes are disabled. Custom fields retain
native write access needed by the worker; do not assume this makes snapshots tamper-proof.

Each request creates a private `pld-job-<job ID>` folder under the engine folder found via
`pld_version.txt`. Owner, parent and `isprivate` are read back before sensitive files are written.
The file list now lists the caller's jobs. Status/download routes accept `job=<ID>` and recheck
ownership; download requires a committed result in that private folder, with `isOnline=false`.
Notifications link to authenticated Suitelet routes, not raw File Cabinet URLs.

Drain existing tasks before deploying schema v5; the parameter requires an authenticated job record ID.
Test two users, supervisors, subsidiaries, a weaker role of the same user, direct Cabinet/native
API access and Company-Wide Usage before enabling callers. Folder owners/admins retain native
access; same-user role revocation and snapshot integrity are not established by route checks.
Failed merge/commit retains private inputs for operator recovery. Automatic orphan recovery,
retention, a deployment pool and chunked outputs are still pending; this remains a sandbox
candidate, not a validated production queue.

#### Required batch signing secret (schema v5)

Before enabling queue access, an authorized account administrator must provision the account-local
API secret `custsecret_pld_batch_v1` with a new independent high-entropy value. No value belongs in
source control, script parameters, logs or deployment artifacts. Configure approved employees and
restrict script use to `customscript_pld_batch`, `customscript_pld_batch_mr` and
`customscript_pld_batch_merge`; do not allow all
scripts. Protect those scripts and their libraries from caller edits. Keep management access with
trusted administrators. Restrict domains for crypto-only use according to Oracle's setup guidance.
[Secret access](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160337298977.html),
[Secret creation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160216498405.html).

The new `custrecord_pld_job_auth` and `custrecord_pld_job_resultseal` fields hold authenticated
envelopes, not secret values. Job writes use optimistic record saves and bounded conflict retries.
Snapshots, part XML and result metadata are authenticated against account/environment and domain;
downloads verify PDF bytes and stream an unsaved copy of the verified contents. The final PDF must
fit the 10 MiB authenticated read limit per chunk; larger individual output fails explicitly.

V4 jobs and earlier outputs do not have the schema v5 ledger/state contract. Preserve
their private artifacts under the approved retention policy and finish/drain them with the prior
deployment before migration; never add an unsigned fallback or sign arbitrary old native fields.
An unsigned inert row can remain if initial secret access fails. Operators must reconcile such
rows; the current list fails closed on invalid records. Validate the new deployment with synthetic
jobs before granting callers access. Missing/denied secrets display an integrity error.

Test unauthorized scripts/employees, swapped account/role/job identity, altered XML/part/PDF bytes,
and concurrent status/task-ID writes. Retain the prior deployment for rollback while draining the
matching schema. Signing detects forgery but does not revoke native owner access or stop replay of
old valid signed state; exactly-once publication and historical-access policy remain release gates.

#### Merge deployment and recovery (schema v5)

Deploy `pld_mr_batch_merge.js` as `customscript_pld_batch_merge` /
`customdeploy_pld_batch_merge`, Not Scheduled, submitted programmatically with the caller's role. Parameter
`custscript_pld_merge_job` contains the authenticated job record ID. Render workers publish PART
records before MR output; merge reduce publishes one CHUNK record per bounded invocation.
Exact `(job, snapshot digest, kind, ordinal)` external IDs provide logical uniqueness, which must
be verified under concurrent native saves in sandbox. No unsigned intermediate ledger row is used.

The signed plan accounts for every selected sequence, including failed documents. Finalization
checks ledger metadata and publishes one signed ordered manifest; each download separately
rechecks the actual PDF bytes. Tests do not prove that unchanged File Cabinet content is available
at publication time. A modified/deleted result fails guarded download and needs operator review.

The caller can POST `action=recover&job=<ID>` only for MERGE_FAILED jobs with a stored merge task
that `task.checkStatus` reports COMPLETE or FAILED. An optimistic claim prevents concurrent
requests from both submitting. The old task ID is cleared before submission. Missing/unknown
submission outcomes remain MERGE_SUBMIT_UNKNOWN for operator reconciliation; timestamps never
authorize a blind resubmit. [Task status API](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4345805891.html).

Worker summarize phases retain inputs. The status page offers an explicit owner-triggered cleanup
of committed XML parts already referenced by published PDFs. Both worker task IDs must be known
and terminal. Signed POST continuations examine at most three sequence positions, reserve 250 units,
and stop cooperatively after 20 seconds. Each affected PDF and each deletable part is verified before
deletion; snapshot, ledger, unpublished inputs, orphan files and PDFs are retained. Missing files are
reported as unavailable; permission/integrity failures stop the sweep. Verify File Cabinet search,
PLAINTEXT metadata, delete permission and concurrent cleanup under the intended caller role in
sandbox. [N/file deletion and governance](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157072844224.html)
is part of this budget; native check/delete is not atomic. No scheduled cleanup or retention age is
enabled by this change.

Pre-plan render recovery is available only for FAILED/DONE jobs with a known render task and no
plan, output or merge task. Both render and merge recovery require a signed action token from the
current status page. The caller must retain the original role; render recovery verifies snapshot
identity/digest, checks the old task is terminal and atomically clears its identity before submitting.
Unknown outcomes remain RENDER_SUBMIT_UNKNOWN and require operator reconciliation. Never fill task
IDs by editing native fields: authenticated job state must not be bypassed. Verify concurrent claims,
worker reuse, expired/unavailable task status and accepted-task metadata failures in sandbox.

Initial queue submission also treats a thrown or missing task-ID response as uncertain once
`submit()` was called. It retains the private snapshot and exposes the job/error reference; a
guarded RENDER_SUBMIT_UNKNOWN marker cannot overwrite a worker that already advanced. Only
preparation failures before the call may mark the job failed and remove its snapshot. Unknown
submissions have no automatic retry, including when the deployment pool is saturated.

Age-based retention, adoption of files saved before ledger commit, recovery after a sealed plan and
deployment pools remain pending. Size limits are safety bounds; measure actual BFO usage, output
size and Thai layout before setting release capacity.

---

### Script 5 — Transaction Buttons (User Event)

| Field | Value |
|-------|-------|
| Type | User Event |
| Name | PLD - Transaction Buttons |
| ID | `customscript_pld_ue_btn` |
| Script File | `pld_ue_button.js` |

**Deploy:**

| Field | Value |
|-------|-------|
| Title | PLD Buttons |
| ID | `customdeploy_pld_ue_btn` |
| Status | Released |
| Applied To | Invoice, Sales Order, Purchase Order (เลือกตามต้องการ) |
| Event Type | Before Load |

---

## Step 5: ทดสอบ

### ทดสอบ Designer
1. เปิด Invoice → กดปุ่ม **Design PDF**
2. Designer เปิดพร้อม record data
3. ลาก elements, bind fields, configure table
4. กด **Save** → template บันทึกลง Custom Record
5. กด **BFO Export** → ดู XML preview

### ทดสอบ Print PDF
1. เปิด Invoice → กดปุ่ม **Print PDF**
2. PDF เปิดในแท็บใหม่
3. ข้อมูลจาก Invoice ปรากฏใน PDF

### ทดสอบ Download
1. เปิด Invoice → กดปุ่ม **Download PDF**
2. ไฟล์ PDF ดาวน์โหลดอัตโนมัติ

---

## API Endpoints

### Designer Suitelet (`pld_sl_designer.js`)

| Action | Method | Params | Description |
|--------|--------|--------|-------------|
| `app` | GET | rectype, recid | Serve designer app |
| `load-record` | GET | rectype, recid | Load record as JSON |
| `list-templates` | GET | rectype | List saved templates |

> Suitelet ตัวนี้ **อ่านอย่างเดียวตั้งแต่ #189** — POST ทุกแบบถูกปฏิเสธ (`save-template` และ `generate-bfo` ถูกถอดออก) ทางเขียนเทมเพลตมีเส้นเดียวคือ Renderer Suitelet ซึ่งมีด่านสิทธิ์ + ประวัติเวอร์ชัน

### Renderer Suitelet (`pld_sl_render_pdf.js`)

| Action | Method | Params | Description | ต้องมีสิทธิ์แก้ |
|--------|--------|--------|-------------|:--:|
| `render` | GET | rectype, recid, tplid?, download? | Generate PDF | |
| `preview` | GET | tplid | Preview with sample data | |
| `preview-live` | POST | body JSON (`xml`, `rectype`, `recid` หรือ `sample:true`) | เรนเดอร์ XML ที่ยังไม่บันทึก · `sample:true` = ใช้ข้อมูลตัวอย่างของ engine ไม่ต้องมี record (#191) | |
| `list` | GET | rectype | List available templates | |
| `get` | GET | tplid | Get single template | |
| `sample-data` | GET | rectype | ข้อมูลตัวอย่าง + binding contract (#191) | |
| `history` | GET | tplid, limit? | ประวัติเวอร์ชันของเทมเพลต (#189) | |
| `version` | GET | — | version stamp ที่ deploy ไว้ | |
| `save` | POST | body JSON | Save/update template | ✓ |
| `delete` | POST | tplid | ลบเทมเพลต | ✓ |
| `rollback` | POST | tplid, version | กู้คืนเวอร์ชันเก่า (#189) | ✓ |

action ที่ต้องมีสิทธิ์และถูกปฏิเสธ ตอบ `{"error":true,"denied":true,"message":"…"}` — ไม่ใช่หน้า error ของ render

---

## FreeMarker Variables

Template XML ใช้ FreeMarker syntax ที่ N/render รองรับ:

### Body Fields
```freemarker
${record.tranid}           ← Transaction Number
${record.trandate}         ← Transaction Date
${record.entity}           ← Customer/Vendor Name
${record.total}            ← Total Amount
${record.memo}             ← Memo
```

### Company Info (Custom Data Source)
```freemarker
${company.name}            ← Company Name
${company.address}         ← Company Address
${company.taxId}           ← Tax ID
```

### Context
```freemarker
${context.today}           ← Today's Date
${context.userName}        ← Current User Name
```

### Line Items (Sublist Loop)
```freemarker
<#list record.item as line>
  ${line.item}             ← Item Name
  ${line.description}      ← Description
  ${line.quantity}          ← Quantity
  ${line.rate}              ← Rate
  ${line.amount}            ← Amount
  ${line_index + 1}        ← Line Number (1-based)
</#list>
```

### Formatting
```freemarker
${record.total?string["#,##0.00"]}     ← Number format
${record.trandate?string["dd/MM/yyyy"]} ← Date format
```

---

## Supported Record Types

| Record Type | Item Sublist | Body Fields |
|-------------|-------------|-------------|
| `invoice` | item | entity, trandate, duedate, terms, subtotal, taxtotal, total |
| `salesorder` | item | entity, trandate, shipdate, terms, shipmethod, subtotal, total |
| `purchaseorder` | item | entity, trandate, shipdate, terms, subtotal, total |
| `estimate` | item | entity, trandate, duedate, probability, subtotal, total |
| `vendorbill` | item | entity, trandate, duedate, terms, subtotal, total |
| `cashsale` | item | entity, trandate, paymentmethod, subtotal, total |
| `itemfulfillment` | item | entity, shipdate, shipmethod, shipstatus |

---

## Troubleshooting

| ปัญหา | สาเหตุ | แก้ไข |
|--------|--------|-------|
| ปุ่มไม่ขึ้นบน form | UE ไม่ได้ deploy ไปที่ record type นั้น | ตรวจ Applied To ใน Deployment |
| Print PDF ว่าง | ไม่มี template สำหรับ record type | สร้าง template แล้ว set เป็น Default |
| FreeMarker error | Field ไม่มีบน record | ตรวจ field ID ใน template, ใช้ `${record.field!""}` สำหรับ null safety |
| Designer โหลดช้า | JS bundle ใหญ่ | ปกติโหลดครั้งแรกช้า, ครั้งต่อไป cache |
| Template save fail | Custom Record ไม่มี / field ผิด | ตรวจ field IDs ตรงกับ script |
| CSS ไม่ทำงานใน PDF | BFO ไม่รองรับ CSS บางอย่าง | ดู [BFO CSS Reference](https://www.netsuite.com/portal/developers/resources/apis/suitescript/ss-reference.shtml) |
| ภาษาไทยไม่แสดง | BFO ฝั่ง server ไม่มีฟอนต์ระบบไทย (Tahoma ใช้ไม่ได้) | ตั้ง `custscript_pld_font_regular/bold` ชี้ไป THSarabunPSK (ดู §ฟอนต์ไทย) |
| วรรณยุกต์/สระไทยลอยหลุดจากฐาน (เห็นชัดบน น้ำ ค่า ก้าว) | ใช้ฟอนต์ที่พึ่ง GPOS (เช่น THSarabunNew/NotoSansThai) — BFO ไม่ apply GPOS | เปลี่ยนเป็น **THSarabunPSK** (mark วางถูกใน outline เอง) — ดู §ฟอนต์ไทย (#32) |

---

## Tips

- **Default Template**: set checkbox `Is Default` เพื่อใช้เป็น template อัตโนมัติเมื่อกด Print PDF (ไม่ต้องเลือก)
- **Multiple Templates**: ถ้ามีหลาย template สำหรับ record type เดียวกัน, UE จะแสดง dropdown ให้เลือก
- **Governance**: N/render.create() ใช้ ~10 units, โหลด record ~5 units, รวม ~20 units/call
- **Thai**: ต้องใช้ `THSarabunPSK` (embed จาก File Cabinet) — **ห้าม THSarabunNew** เพราะ BFO ไม่ apply GPOS แล้ววรรณยุกต์ลอย (#32); `Tahoma` ไม่มีบน BFO ฝั่ง server
- **Logo**: upload logo ไปที่ File Cabinet แล้วใส่ URL ใน Script Parameter `custscript_pld_company_logo`

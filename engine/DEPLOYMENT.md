# NetSuite Deployment Guide — PDF Layout Designer

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

`deploy.sh` วนทีละ account: stamp version → เขียน `defaultAuthId` ใหม่ → `suitecloud project:deploy`
→ สรุปผล PASS/FAIL ต่อ account (account ที่พังไม่ทำให้ตัวอื่นหยุด) → คืน `project.json` เป็นค่าเดิมเสมอ

> `project:deploy` ไม่มี flag `--authid` — มันอ่าน `defaultAuthId` จาก `project.json` เท่านั้น
> นี่คือเหตุผลที่ต้อง loop เขียน `project.json` ใหม่ต่อ account

### Version stamp — ตรวจได้ว่า account ไหนรัน version อะไร

`engine/VERSION` เป็น source of truth. ทุกครั้งที่ `deploy.sh` รัน มัน stamp
`version + git short sha (+dirty ถ้า working tree ไม่ clean) + UTC` ลงไฟล์
`pld_version.txt` ใน File Cabinet (ไฟล์นี้เป็น build artifact — gitignore ไว้ generate ใหม่ทุก deploy)

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

ค่าที่ template กลางอ้างผ่าน `${company.*}` ทั้งหมดมาจาก custom record **PDF Layout Config**
(SDF deploy ให้อัตโนมัติ) — สร้าง 1 record ต่อ account แล้ว template ทุกใบใช้ได้ทันที
โดยไม่ต้องแก้ template XML (#9) · Suitelet ใช้ record แรกที่ active; ถ้าไม่มี render ยังทำงาน
(binding null-safe) แต่ค่า company ว่างทั้งหมด และมี audit log บอกไว้

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

### Script 3 — Transaction Buttons (User Event)

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
| `save-template` | POST | body JSON | Save template to CR |
| `generate-bfo` | POST | body JSON | Save BFO to File Cabinet |

### Renderer Suitelet (`pld_sl_render_pdf.js`)

| Action | Method | Params | Description |
|--------|--------|--------|-------------|
| `render` | GET | rectype, recid, tplid?, download? | Generate PDF |
| `preview` | GET | tplid | Preview with sample data |
| `list` | GET | rectype | List available templates |
| `get` | GET | tplid | Get single template |
| `save` | POST | body JSON | Save/update template |

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

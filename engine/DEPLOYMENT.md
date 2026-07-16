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

**Script Parameters (Optional):**

| ID | Label | Type |
|----|-------|------|
| `custscript_pld_company_name` | Company Name | Free-Form Text |
| `custscript_pld_company_addr` | Company Address | Free-Form Text |
| `custscript_pld_company_phone` | Company Phone | Free-Form Text |
| `custscript_pld_company_taxid` | Tax ID | Free-Form Text |
| `custscript_pld_company_email` | Company Email | Free-Form Text |
| `custscript_pld_company_logo` | Logo URL | Free-Form Text |
| `custscript_pld_font_regular` | Thai Font Regular URL | Free-Form Text |
| `custscript_pld_font_bold` | Thai Font Bold URL | Free-Form Text |

**ฟอนต์ไทย (บังคับสำหรับเอกสารภาษาไทย — ไม่ embed = ตัวอักษรไทยหายเงียบ):**
1. ไฟล์ font อยู่ที่ `engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/fonts/` (SDF deploy ให้อัตโนมัติ)
2. เปิดไฟล์ทั้งสองใน File Cabinet → ติ๊ก **Available Without Login** → Save
3. copy **URL เต็ม** จากหน้าไฟล์ (ต้องมี `h=` token และลงท้าย `_xt=.ttf` — token ออกใหม่ทุกครั้งที่ save ไฟล์)
   มาใส่ script parameters ข้างบน
4. Designer จะฝัง `<link name="THSarabunNew" type="font" subtype="truetype" src=... src-bold=... bytes="2">` ให้อัตโนมัติ

> ⚠️ พิสูจน์แล้วบน SB2 (2026-07-17): font-family ที่ไม่ embed — รวมถึง `NotoSansThai` — ทำให้ **glyph ไทยถูก drop เงียบ ๆ** ใน PDF (ไม่ error) — เอกสารไทยทุกใบต้องตั้ง font params เสมอ

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
| ภาษาไทยไม่แสดง | BFO ฝั่ง server ไม่มีฟอนต์ระบบไทย (Tahoma/Sarabun ใช้ไม่ได้) | ตั้ง `custscript_pld_font_regular/bold` (ดู §ฟอนต์ไทย) หรือใช้ `font-family: NotoSansThai` (built-in) |

---

## Tips

- **Default Template**: set checkbox `Is Default` เพื่อใช้เป็น template อัตโนมัติเมื่อกด Print PDF (ไม่ต้องเลือก)
- **Multiple Templates**: ถ้ามีหลาย template สำหรับ record type เดียวกัน, UE จะแสดง dropdown ให้เลือก
- **Governance**: N/render.create() ใช้ ~10 units, โหลด record ~5 units, รวม ~20 units/call
- **Thai**: ใช้ `Tahoma` หรือ `THSarabunNew` (upload font to File Cabinet ถ้าจำเป็น)
- **Logo**: upload logo ไปที่ File Cabinet แล้วใส่ URL ใน Script Parameter `custscript_pld_company_logo`

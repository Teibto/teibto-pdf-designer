# PDF Layout Designer v2.0 — Feature & Capability Summary

> **Stack:** Lit 3.x · TypeScript 5.5 · Tailwind CSS 4 · Immer · jsPDF · bwip-js · Vite 6
> **Source:** 66 files · 15,250 LOC · 50+ state actions · 229 unit tests · 7 E2E specs · 7 Storybook stories
> **Build:** 2.6 MB dist (lazy-loaded chunks, fonts on demand)

---

## 📊 Project Stats

| Metric | Value |
|--------|-------|
| Source Files | 66 TypeScript files |
| Lines of Code | 15,250+ |
| State Actions | 50+ functions |
| Keyboard Shortcuts | 40+ |
| Unit Tests | 229 (Vitest) |
| E2E Test Files | 7 (Playwright) |
| Storybook Stories | 7 story files |
| Sample Templates | 6 built-in |
| Element Types | 8 |
| Element Roles | 6 |
| Build Output | 2.6 MB (chunked) |

---

## 🧩 Element Types (8)

| Type | Canvas Preview | PDF Export | BFO Export | Data Binding | Notes |
|------|:-:|:-:|:-:|:-:|-------|
| **Header** | ✅ | ✅ | ✅ | ✅ `{{path}}` | Bold, large text, font size/weight/color/align |
| **Text** | ✅ | ✅ | ✅ | ✅ `{{path}}` | Normal text, font size/weight/color/align |
| **Image** | ✅ Placeholder + upload | ✅ PNG/JPEG | ✅ | — | File picker, clipboard paste, object-fit |
| **Table** | ✅ Real data + sample | ✅ AutoTable | ✅ `<#list>` | ✅ Array binding | Column config, auto-detect, header styling, alternate rows |
| **Shape** | ✅ | ✅ | ✅ | — | Background color, border-radius, opacity |
| **Line** | ✅ | ✅ | ✅ | — | Solid/dashed/dotted, color, width |
| **Barcode** | ✅ SVG (bwip-js) | ✅ PNG | ✅ SVG | — | Code128, Code39, EAN-13, QR, EAN-8, UPC-A, ITF-14, DataMatrix, PDF417 |
| **List** | ✅ | ✅ | ✅ | ✅ `{{path}}` | Bullet (•), numbered (1.), dash (–) |

---

## 🏷️ Element Roles (6)

| Role | Show On | Description |
|------|---------|-------------|
| **Header** | All pages | Company logo, doc title — repeats on every page |
| **Content** | First page only | Bill-to address, dates, one-time info |
| **Table** | All pages | Paginated table data rows |
| **Summary** | Last page only | Totals, grand total, subtotals |
| **Footer** | All pages | Page number, footer text — repeats |
| **Watermark** | All pages | Semi-transparent overlay (15% opacity) |

---

## 📄 Sample Templates (6)

| # | Template | Elements | Use Case |
|---|----------|----------|----------|
| 1 | Invoice | 15+ elements | Standard commercial invoice with line items |
| 2 | Tax Invoice | 15+ elements | Tax invoice (Thai/international format) |
| 3 | Purchase Order | 15+ elements | PO with vendor info and item table |
| 4 | Quotation | 15+ elements | Sales quotation with terms |
| 5 | Delivery Note | 15+ elements | Shipping/delivery document |
| 6 | Receipt | 15+ elements | Payment receipt |

---

## 🎨 Canvas & Design

| Feature | Status | Description |
|---------|:------:|-------------|
| Drag-drop from palette | ✅ | 8 element types in sidebar palette |
| Element move | ✅ | Click-drag to reposition |
| Element resize | ✅ | Corner handles with aspect preservation |
| Multi-select | ✅ | Shift+Click, Ctrl+A select all |
| Copy/Cut/Paste | ✅ | Ctrl+C/X/V with 10px offset paste |
| Duplicate | ✅ | Ctrl+D |
| Z-order management | ✅ | Bring front/back, raise/lower |
| Zoom | ✅ | 25%–300%, Ctrl+/−, Ctrl+0 reset |
| Canvas rulers | ✅ | Horizontal + vertical, zoom-aware tick marks |
| Grid overlay | ✅ | Configurable grid size and visibility |
| Snap guides | ✅ | Edge/center alignment snap lines |
| Snap to grid | ✅ | Toggle on/off, configurable grid step |
| Page sizes | ✅ | A4, Letter, Legal, A3, A5, custom |
| Page orientation | ✅ | Portrait / Landscape |
| Table column resize | ✅ | Drag handles between columns on canvas |
| Right-click context menu | ✅ | All actions accessible via context menu |

---

## 🔗 Data Binding

| Feature | Status | Description |
|---------|:------:|-------------|
| Template strings | ✅ | `{{company.name}}` syntax in text/header |
| Deep path resolution | ✅ | Nested object access: `{{customer.address.city}}` |
| Array binding (tables) | ✅ | Bind table to JSON array path (e.g., `items`) |
| Auto column detection | ✅ | Detect columns from bound JSON array structure |
| JSON editor panel | ✅ | Paste/edit JSON data directly in sidebar |
| JSON key extraction | ✅ | Auto-extract available binding paths |
| Flow Map view | ✅ | Visual graph showing element ↔ data connections |

---

## 📑 Pagination Engine

| Feature | Status | Description |
|---------|:------:|-------------|
| Row-based pagination | ✅ | Fixed rows per page |
| Height-based pagination | ✅ | Auto-calculate rows fitting available height |
| Dynamic row height | ✅ | Measure text wrap for accurate height calc |
| Role-aware rendering | ✅ | Header/footer repeat, content on first, summary on last |
| Page navigation (preview) | ✅ | Navigate between pages in preview modal |
| Table row slicing | ✅ | Accurate row offset per page with index continuation |

---

## 📤 Export Systems

| Export | Status | Details |
|--------|:------:|---------|
| **PDF (jsPDF)** | ✅ | Main thread + Web Worker options |
| **PDF via Web Worker** | ✅ | Off-main-thread, progress callback, fallback to main |
| **Thai fonts (Sarabun)** | ✅ | Regular + Bold TTF, lazy-loaded, 144KB total |
| **BFO XML (NetSuite)** | ✅ | FreeMarker syntax, CSS layout, `<#list>` iteration |
| **Template JSON** | ✅ | Copy to clipboard / import-export files |
| **Preview modal** | ✅ | All 8 element types rendered, zoom, page nav |

### PDF Export Details

| Capability | Status |
|------------|:------:|
| Text with font weight | ✅ |
| Text alignment (left/center/right) | ✅ |
| Images (PNG/JPEG) | ✅ |
| Tables (jsPDF-AutoTable) | ✅ |
| Table header styling | ✅ |
| Table column alignment | ✅ |
| Shapes with border-radius | ✅ |
| Lines (solid/dashed/dotted) | ✅ |
| Barcodes (PNG via bwip-js) | ✅ |
| QR Codes | ✅ |
| Lists (bullet/number/dash) | ✅ |
| Thai font (Sarabun Regular+Bold) | ✅ |
| Multi-page with roles | ✅ |
| Web Worker generation | ✅ |
| Progress callback | ✅ |
| Open in new tab | ✅ |
| Download with filename | ✅ |

### BFO Export Details

| Capability | Status |
|------------|:------:|
| FreeMarker variables `${record.field}` | ✅ |
| Table iteration `<#list>` | ✅ |
| CSS-based page layout | ✅ |
| Record types: transaction, customer, item, employee | ✅ |
| Record type selector modal | ✅ |
| Copy to clipboard | ✅ |

---

## 📐 Layers Panel

| Feature | Status | Description |
|---------|:------:|-------------|
| Layer list (z-order sorted) | ✅ | Top = front, bottom = back |
| Type icons | ✅ | H/T/◻/⊞/■/─/|||/≡ per type |
| Role badges | ✅ | Color-coded dots + role label |
| Group badges | ✅ | ⊞ G indicator for grouped elements |
| Drag-to-reorder | ✅ | Drag layers to change z-order |
| Inline rename | ✅ | Double-click to rename |
| Lock toggle | ✅ | 🔒/🔓 prevent editing |
| Visibility toggle | ✅ | 👁 show/hide elements |
| Selection sync | ✅ | Click layer = select on canvas |
| Multi-select highlight | ✅ | Shows shift-selected elements |
| Binding path display | ✅ | Shows `{{binding}}` in meta row |

---

## 🔗 Element Grouping

| Feature | Status | Shortcut |
|---------|:------:|----------|
| Group elements | ✅ | Ctrl+G |
| Ungroup elements | ✅ | Ctrl+Shift+G |
| Auto-select group members | ✅ | Click one → all group members selected |
| Group via context menu | ✅ | Right-click → Group / Ungroup |
| Group badge in layers | ✅ | Visual indicator in layers panel |

---

## ⌨️ Keyboard Shortcuts (40+)

| Category | Shortcuts |
|----------|-----------|
| **Clipboard** | Ctrl+C Copy, Ctrl+X Cut, Ctrl+V Paste, Ctrl+D Duplicate |
| **History** | Ctrl+Z Undo, Ctrl+Shift+Z Redo |
| **Selection** | Ctrl+A Select All, Escape Deselect |
| **Delete** | Delete / Backspace Remove |
| **Movement** | Arrow keys (1px), Shift+Arrow (10px) |
| **Zoom** | Ctrl+Plus Zoom In, Ctrl+Minus Zoom Out, Ctrl+0 Reset |
| **Grouping** | Ctrl+G Group, Ctrl+Shift+G Ungroup |
| **Z-Order** | Ctrl+] Raise, Ctrl+[ Lower, Ctrl+Shift+] Front, Ctrl+Shift+[ Back |
| **File** | Ctrl+S Save Template |

---

## 💾 Template Management

| Feature | Status | Description |
|---------|:------:|-------------|
| Save to IndexedDB | ✅ | Persistent local storage |
| Load templates | ✅ | Browse saved templates |
| Delete templates | ✅ | Remove from storage |
| Import JSON | ✅ | Paste or upload template JSON |
| Export JSON | ✅ | Copy template as JSON |
| Dirty state tracking | ✅ | isDirty flag for unsaved changes |
| beforeunload warning | ✅ | Browser prevents close with unsaved changes |
| Template name editing | ✅ | Edit in template bar |
| 6 sample templates | ✅ | One-click load for demo |

---

## 🏗️ Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **UI Framework** | Lit 3.x Web Components | Component library, Shadow DOM |
| **State Management** | Lit Context + Immer | Centralized store, immutable updates |
| **Styling** | Tailwind CSS 4 + CSS custom properties | Utility-first + design tokens |
| **PDF Engine** | jsPDF + jsPDF-AutoTable | PDF generation with table support |
| **Barcode Engine** | bwip-js | SVG + Canvas barcode/QR rendering |
| **Font** | Sarabun (fontsource → merged TTF) | Thai + Latin character support |
| **Build** | Vite 6 + TypeScript 5.5 | Fast dev server, optimized production build |
| **Unit Testing** | Vitest | 229 tests, 11 test files |
| **E2E Testing** | Playwright | 7 spec files, Chromium |
| **Documentation** | Storybook 8 | 7 story files, component showcase |

### Lazy Loading Strategy

| Resource | Load Trigger | Bundle Impact |
|----------|-------------|---------------|
| jsPDF + AutoTable | PDF export | Separate chunk (400KB) |
| bwip-js | Barcode element | Separate chunk (885KB) |
| Sarabun fonts | PDF export | Runtime fetch (144KB) |
| Web Worker | PDF export | Separate file (4KB) |

---

## 🧪 Test Coverage

### Unit Tests (229 tests, 11 files)

| Test File | Tests | Area |
|-----------|:-----:|------|
| actions.test.ts | 46 | State mutations |
| validation.service.test.ts | 37 | Template validation |
| utils.test.ts | 27 | Formatting, color, text measure |
| binding.service.test.ts | 23 | Data binding resolution |
| bfo-export.service.test.ts | 18 | BFO XML generation |
| column-detect.service.test.ts | 16 | Auto column detection |
| history.service.test.ts | 14 | Undo/redo |
| store-middleware.test.ts | 14 | Middleware pipeline |
| migration-pagination.test.ts | 14 | Schema migration |
| pagination.service.test.ts | 12 | Multi-page engine |
| snap-guide.service.test.ts | 8 | Alignment snapping |

### E2E Tests (7 spec files)

| Spec File | Coverage |
|-----------|----------|
| app.spec.ts | App launch, layout, navigation, zoom |
| elements.spec.ts | Palette, drag-drop, selection, delete, duplicate, shortcuts |
| templates.spec.ts | Save, load, sample, JSON export |
| grouping.spec.ts | Multi-select, group, ungroup |
| export.spec.ts | Preview modal, BFO modal, PDF export |
| tables-layers.spec.ts | Table add, column resize, layers panel |
| barcode-list.spec.ts | Barcode SVG, list items, image placeholder |

### Storybook (7 story files)

| Story File | Components |
|------------|-----------|
| canvas-element.stories.ts | All 8 element types, locked, data binding |
| toast-notification.stories.ts | Success, error, warning, info toasts |
| modal.stories.ts | Small, medium, large modals |
| layout.stories.ts | App header, template bar |
| panels.stories.ts | Layers, grid, alignment, pagination, JSON editor |
| sidebars.stories.ts | Left sidebar (palette), right sidebar (inspector) |
| shared-components.stories.ts | Context menu, error boundary |

---

## 🌐 NetSuite Integration

| Feature | Status | Description |
|---------|:------:|-------------|
| BFO XML export | ✅ | FreeMarker template generation |
| Record type detection | ✅ | Transaction, customer, item, employee |
| Auto-load record data | ✅ | Detect NetSuite env, load current record |
| NS context adapter | ✅ | Bridge between app state and NS APIs |
| Single-file build mode | ✅ | `npm run build -- --mode netsuite` → single JS |
| Relative base paths | ✅ | Works in NetSuite File Cabinet |

---

## 🛡️ Quality & Safety

| Feature | Status | Description |
|---------|:------:|-------------|
| TypeScript strict mode | ✅ | 0 errors, full type coverage |
| Error boundary component | ✅ | Catches and displays render errors |
| Per-element error recovery (PDF) | ✅ | Broken element skipped, rest continues |
| Font fallback (Helvetica) | ✅ | If Thai font fails, PDF still works |
| Worker fallback (main thread) | ✅ | If worker fails, main thread export |
| History debouncing | ✅ | Prevents excessive undo states |
| Validation service | ✅ | Template structure validation |
| Migration service | ✅ | Schema version migration |

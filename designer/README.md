# PDF Layout Flow Designer

> Production-grade Lit 3.x + TypeScript + Tailwind CSS 4 application for designing PDF templates with visual data binding and NetSuite BFO export.

## ⚡ Quick Start

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # → dist/
```

## 📁 Project Structure

```
src/
├── main.ts                          # Entry point
├── components/
│   ├── app-shell.ts                 # Root container, provides store context
│   ├── canvas/
│   │   ├── pdf-canvas.ts            # Design surface with zoom, scroll, rulers
│   │   └── rulers.ts                # Horizontal + vertical canvas rulers
│   ├── elements/
│   │   └── canvas-element.ts        # Individual element renderer
│   ├── flow/
│   │   └── flow-view.ts             # Data binding flow visualization
│   ├── layout/
│   │   ├── app-header.ts            # Top toolbar with view/export buttons
│   │   ├── template-bar.ts          # Template name, page size display
│   │   ├── sidebar-left.ts          # Element palette, page settings, layers, JSON
│   │   └── sidebar-right.ts         # Property inspector with image upload
│   ├── modals/
│   │   ├── column-config-modal.ts   # Table column editor with drag reorder
│   │   ├── template-manager-modal.ts # Save/load/import/export templates
│   │   ├── preview-modal.ts         # PDF preview with page navigation
│   │   └── bfo-export-modal.ts      # NetSuite BFO XML export
│   ├── panels/
│   │   ├── layers-panel.ts          # Figma-style layers (drag reorder, lock, vis)
│   │   ├── alignment-panel.ts       # Multi-select alignment/distribution
│   │   ├── grid-panel.ts            # Grid, ruler, snap configuration
│   │   ├── json-editor.ts           # Visual JSON data editor
│   │   └── pagination-panel.ts      # Pagination mode/rows configuration
│   └── shared/
│       ├── modal.ts                 # Reusable modal shell
│       ├── toast-notification.ts    # Toast notification system
│       └── context-menu.ts          # Right-click context menu
├── services/
│   ├── binding.service.ts           # JSON path resolution, template strings
│   ├── bfo-export.service.ts        # NetSuite BFO XML generation
│   ├── column-detect.service.ts     # Auto-detect table columns from JSON
│   ├── history.service.ts           # Undo/redo state snapshots
│   ├── image.service.ts             # Image upload, paste, resize
│   ├── keyboard.service.ts          # Global keyboard shortcuts
│   ├── pagination.service.ts        # Multi-page layout engine
│   ├── pdf-export.service.ts        # PDF generation with jsPDF + AutoTable
│   ├── snap-guide.service.ts        # Alignment snap guide computation
│   └── template.service.ts          # IndexedDB persistence
├── state/
│   ├── app-state.ts                 # AppState type definition
│   ├── store.ts                     # Lit Context store with Immer
│   └── actions.ts                   # 40+ state mutation functions
├── models/
│   ├── element.ts                   # CanvasElement types & defaults
│   ├── page.ts                      # PageConfig & dimensions
│   ├── template.ts                  # DocumentTemplate & PaginationConfig
│   └── index.ts                     # Barrel exports
├── constants/
│   ├── roles.ts                     # Element role definitions
│   ├── column-presets.ts            # Table column presets
│   └── sample-templates.ts          # 6 built-in templates
├── styles/ tokens/ mixins/ utils/
```

## ✅ Completed Features

### Phase 1 — Foundation
- [x] Lit 3.x web component architecture
- [x] State management (Lit Context + Immer)
- [x] 8 element types with type-specific editors
- [x] 6 element roles for multi-page layout
- [x] Drag-drop from palette to canvas
- [x] Element move, resize, select
- [x] JSON data binding with {{path}} syntax
- [x] Flow Map visualization
- [x] PDF export with jsPDF + AutoTable
- [x] BFO XML export with FreeMarker syntax
- [x] Template save/load to IndexedDB
- [x] 6 sample templates
- [x] Toast notifications

### Phase 2 — Interactive Features
- [x] Column configuration modal (drag reorder, presets)
- [x] Template manager modal (save, load, delete, import, export)
- [x] PDF preview modal with page navigation
- [x] BFO export modal with record type selector
- [x] Undo/Redo history service
- [x] Pagination engine (row-based & height-based)
- [x] Multi-select elements (Shift+click)
- [x] Copy/Cut/Paste clipboard actions
- [x] Z-order management
- [x] Right-click context menu
- [x] Alignment & distribution tools
- [x] Grid/ruler/snap configuration panel
- [x] JSON editor panel
- [x] Snap guide service
- [x] Enhanced keyboard shortcuts (40+)

### Phase 3 — Polish & Enhancement
- [x] Layers panel (drag-to-reorder, inline rename, lock, visibility, role badges, group badges)
- [x] Canvas rulers (horizontal + vertical, zoom-aware)
- [x] Image upload (file picker, clipboard paste)
- [x] Auto-detect table columns from JSON data
- [x] Image properties panel (upload, preview, object-fit)

### Phase 4 — Advanced Features
- [x] Barcode rendering with bwip-js (SVG canvas preview + PNG PDF export)
- [x] QR Code, EAN-13, Code39, DataMatrix, PDF417 support
- [x] Table column resize on canvas (drag handles between columns)
- [x] Thai font embedding for PDF (Sarabun Regular + Bold)
- [x] Web Worker for PDF generation (off-main-thread, progress callback)
- [x] Element grouping (Ctrl+G / Ctrl+Shift+G, group auto-select)
- [x] List element full rendering (canvas + PDF + preview)
- [x] Preview modal with all 8 element types rendered
- [x] Storybook component documentation
- [x] E2E tests with Playwright

## ⌨️ Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Delete/Backspace | Remove selected |
| Ctrl+D | Duplicate |
| Ctrl+C/X/V | Copy/Cut/Paste |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+A | Select all |
| Ctrl+S | Save template |
| Ctrl +/- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| Arrow keys | Nudge (1px/10px with Shift) |
| Ctrl+G | Group selected elements |
| Ctrl+Shift+G | Ungroup |
| Escape | Deselect |

## 📝 NetSuite Integration

### BFO Export
- FreeMarker variable syntax (${record.field})
- Table iteration (<#list>)
- CSS-based page layout
- Record types: transaction, customer, item, employee

---
**Author:** Wichit Wongta
**Stack:** Lit 3.x · TypeScript 5.5 · Tailwind CSS 4 · Immer · jsPDF · bwip-js · Vite 6
**LOC:** ~12,000+ across 60+ source files

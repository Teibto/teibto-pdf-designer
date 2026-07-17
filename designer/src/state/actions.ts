/**
 * State Actions
 * All state mutations go through these functions.
 * Components call actions; actions call store.dispatch().
 *
 * @author Wichit Wongta
 */
import { nanoid } from 'nanoid';
import { current } from 'immer';
import type { AppStore } from './store';
import type {
  CanvasElement,
  ElementType,
  TextElement,
  TableElement,
  ShapeElement,
  LineElement,
  BarcodeElement,
  ListElement,
  ImageElement,
} from '../models/element';
import { ELEMENT_DEFAULTS } from '../models/element';
import type { PageSizeName, Orientation } from '../models/page';
import { resolvePageDimensions } from '../models/page';
import { validatePropertyUpdate } from '../services/validation.service';
import { elementsToBands, redistributeRowWidths } from '../services/band-layout.service';
import { tagAction } from './middleware';

// ═══════════════════════════════════════
// ELEMENT ACTIONS
// ═══════════════════════════════════════

/** Add a new element to the canvas */
export function addElement(
  store: AppStore,
  type: ElementType,
  x: number,
  y: number,
): string {
  const id = nanoid(10);
  const defaults = ELEMENT_DEFAULTS[type];
  const count = store.state.elements.filter((e) => e.type === type).length + 1;

  store.dispatch((draft) => {
    const base = {
      id,
      type,
      name: `${type}_${count}`,
      role: defaults.role,
      x,
      y,
      w: defaults.w,
      h: defaults.h,
      zIndex: draft.elements.length,
      locked: false,
      visible: true,
    };

    let element: CanvasElement;

    switch (type) {
      case 'header':
      case 'text':
        element = {
          ...base,
          type,
          content: type === 'header' ? 'Header Text' : 'Text content',
          fontSize: type === 'header' ? 18 : 12,
          fontWeight: type === 'header' ? 'bold' : 'normal',
          color: type === 'header' ? '#111111' : '#333333',
          textAlign: 'left',
        } as TextElement;
        break;

      case 'image':
        element = {
          ...base,
          type: 'image',
          objectFit: 'contain',
        } as ImageElement;
        break;

      case 'table':
        element = {
          ...base,
          type: 'table',
          columns: [],
          headerBgColor: '#e8eaf0',
          headerTextColor: '#333333',
          borderColor: '#d0d2da',
          alternateRowColor: '#f9fafb',
        } as TableElement;
        break;

      case 'shape':
        element = {
          ...base,
          type: 'shape',
          bgColor: '#4f6ef7',
          borderRadius: 0,
          opacity: 1,
        } as ShapeElement;
        break;

      case 'line':
        element = {
          ...base,
          type: 'line',
          lineColor: '#cccccc',
          lineWidth: 1.5,
          lineStyle: 'solid',
        } as LineElement;
        break;

      case 'barcode':
        element = {
          ...base,
          type: 'barcode',
          value: 'BARCODE-001',
          barcodeType: 'code128',
        } as BarcodeElement;
        break;

      case 'list':
        element = {
          ...base,
          type: 'list',
          items: ['Item 1', 'Item 2', 'Item 3'],
          fontSize: 11,
          color: '#333333',
          listStyle: 'bullet',
        } as ListElement;
        break;

      default:
        return;
    }

    draft.elements.push(element);
    draft.selectedId = id;
    draft.template.isDirty = true;
  });

  return id;
}

/** Remove an element from canvas (skip if locked) */
export function removeElement(store: AppStore, id: string): void {
  const el = store.state.elements.find((e) => e.id === id);
  if (el && el.locked) return;

  store.dispatch((draft) => {
    draft.elements = draft.elements.filter((e) => e.id !== id);
    if (draft.selectedId === id) {
      draft.selectedId = null;
    }
    draft.template.isDirty = true;
  });
}

/** Select an element */
export function selectElement(store: AppStore, id: string | null): void {
  store.dispatch(tagAction((draft) => {
    draft.selectedId = id;
  }, { name: 'selectElement', undoable: false }));
}

/** Move an element to new position */
export function moveElement(
  store: AppStore,
  id: string,
  x: number,
  y: number,
): void {
  store.dispatch(tagAction((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el && !el.locked) {
      el.x = Math.max(0, x);
      el.y = Math.max(0, y);
      draft.template.isDirty = true;
    }
  }, { name: 'moveElement', undoable: true, batchKey: `move-${id}` }));
}

/** Resize an element */
export function resizeElement(
  store: AppStore,
  id: string,
  w: number,
  h: number,
): void {
  store.dispatch(tagAction((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el && !el.locked) {
      el.w = Math.max(20, w);
      el.h = Math.max(10, h);
      draft.template.isDirty = true;
    }
  }, { name: 'resizeElement', undoable: true, batchKey: `resize-${id}` }));
}

/** Update any element property (with validation) */
export function updateElement<K extends keyof CanvasElement>(
  store: AppStore,
  id: string,
  key: K,
  value: CanvasElement[K],
): void {
  const el = store.state.elements.find((e) => e.id === id);
  if (!el) return;

  // Validate the update
  const validation = validatePropertyUpdate(el.type, key as string, value);
  if (!validation.valid) {
    console.warn(`[updateElement] Validation failed for ${el.type}.${key as string}:`,
      validation.errors.map((e) => e.message).join(', '));
    return;
  }

  store.dispatch((draft) => {
    const target = draft.elements.find((e) => e.id === id);
    if (target) {
      (target as any)[key] = value;
      draft.template.isDirty = true;
    }
  });
}

/** Duplicate an element */
export function duplicateElement(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (!el) return;

    const clone = structuredClone(current(el)) as CanvasElement;
    clone.id = nanoid(10);
    clone.name = `${el.name}_copy`;
    clone.x += 20;
    clone.y += 20;
    clone.zIndex = draft.elements.length;

    draft.elements.push(clone);
    draft.selectedId = clone.id;
    draft.template.isDirty = true;
  });
}

// ═══════════════════════════════════════
// PAGE ACTIONS
// ═══════════════════════════════════════

/** Set page size */
export function setPageSize(store: AppStore, size: PageSizeName): void {
  store.dispatch((draft) => {
    draft.page.size = size;
    const dims = resolvePageDimensions(draft.page);
    draft.page.width = dims.width;
    draft.page.height = dims.height;
    draft.template.isDirty = true;
  });
}

/** Set page orientation */
export function setOrientation(store: AppStore, orientation: Orientation): void {
  store.dispatch((draft) => {
    draft.page.orientation = orientation;
    const dims = resolvePageDimensions(draft.page);
    draft.page.width = dims.width;
    draft.page.height = dims.height;
    draft.template.isDirty = true;
  });
}

// ═══════════════════════════════════════
// ZOOM ACTIONS
// ═══════════════════════════════════════

export function setZoom(store: AppStore, zoom: number): void {
  store.dispatch(tagAction((draft) => {
    draft.zoom = Math.max(25, Math.min(300, zoom));
  }, { name: 'setZoom', undoable: false }));
}

export function zoomIn(store: AppStore): void {
  setZoom(store, store.state.zoom + 10);
}

export function zoomOut(store: AppStore): void {
  setZoom(store, store.state.zoom - 10);
}

export function resetZoom(store: AppStore): void {
  setZoom(store, 100);
}

// ═══════════════════════════════════════
// VIEW ACTIONS
// ═══════════════════════════════════════

export function switchView(store: AppStore, view: 'design' | 'flow'): void {
  store.dispatch(tagAction((draft) => {
    draft.view = view;
  }, { name: 'switchView', undoable: false }));
}

// ═══════════════════════════════════════
// JSON DATA ACTIONS
// ═══════════════════════════════════════

/** Load JSON data and extract keys for binding */
export function loadJsonData(
  store: AppStore,
  data: Record<string, unknown>,
): void {
  store.dispatch((draft) => {
    draft.jsonData = data;
    draft.jsonKeys = extractJsonKeys(data);
  });
}

/** Recursively extract all keys from JSON (dot-notation) */
export function extractJsonKeys(
  obj: Record<string, unknown>,
  prefix = '',
): string[] {
  const keys: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);

    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      keys.push(
        ...extractJsonKeys(val as Record<string, unknown>, fullKey),
      );
    }
  }

  return keys;
}

// ═══════════════════════════════════════
// PAGINATION ACTIONS
// ═══════════════════════════════════════

export function setCurrentPage(store: AppStore, page: number): void {
  store.dispatch(tagAction((draft) => {
    draft.currentPage = Math.max(1, Math.min(page, draft.totalPages));
  }, { name: 'setCurrentPage', undoable: false }));
}

export function nextPage(store: AppStore): void {
  setCurrentPage(store, store.state.currentPage + 1);
}

export function prevPage(store: AppStore): void {
  setCurrentPage(store, store.state.currentPage - 1);
}

// ═══════════════════════════════════════
// TEMPLATE ACTIONS
// ═══════════════════════════════════════

export function setTemplateName(store: AppStore, name: string): void {
  store.dispatch((draft) => {
    draft.template.name = name;
    draft.template.isDirty = true;
  });
}

export function markTemplateClean(store: AppStore): void {
  store.dispatch(tagAction((draft) => {
    draft.template.isDirty = false;
  }, { name: 'markTemplateClean', undoable: false }));
}

// ═══════════════════════════════════════
// MULTI-SELECT ACTIONS
// ═══════════════════════════════════════

/** Toggle multi-select for an element (Shift+click) */
export function toggleMultiSelect(store: AppStore, id: string): void {
  store.dispatch(tagAction((draft) => {
    const idx = draft.multiSelect.indexOf(id);
    if (idx >= 0) {
      draft.multiSelect.splice(idx, 1);
    } else {
      draft.multiSelect.push(id);
    }
    draft.selectedId = id;
  }, { name: 'toggleMultiSelect', undoable: false }));
}

/** Select all elements */
export function selectAll(store: AppStore): void {
  store.dispatch((draft) => {
    draft.multiSelect = draft.elements.map((e) => e.id);
    draft.selectedId = draft.elements[draft.elements.length - 1]?.id ?? null;
  });
}

/** Clear multi-selection */
export function clearMultiSelect(store: AppStore): void {
  store.dispatch((draft) => {
    draft.multiSelect = [];
  });
}

/** Get all selected element IDs (single + multi) */
export function getSelectedIds(store: AppStore): string[] {
  const { selectedId, multiSelect } = store.state;
  if (multiSelect.length > 0) return [...multiSelect];
  if (selectedId) return [selectedId];
  return [];
}

// ═══════════════════════════════════════
// LOCK & VISIBILITY ACTIONS
// ═══════════════════════════════════════

/** Toggle element locked state */
export function toggleLock(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el) {
      el.locked = !el.locked;
      draft.template.isDirty = true;
    }
  });
}

/** Toggle element visibility */
export function toggleVisibility(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el) {
      el.visible = !el.visible;
      draft.template.isDirty = true;
    }
  });
}

// ═══════════════════════════════════════
// Z-INDEX ACTIONS
// ═══════════════════════════════════════

/** Bring element to front */
export function bringToFront(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const maxZ = Math.max(...draft.elements.map((e) => e.zIndex), 0);
    const el = draft.elements.find((e) => e.id === id);
    if (el) {
      el.zIndex = maxZ + 1;
      draft.template.isDirty = true;
    }
  });
}

/** Send element to back */
export function sendToBack(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const minZ = Math.min(...draft.elements.map((e) => e.zIndex), 0);
    const el = draft.elements.find((e) => e.id === id);
    if (el) {
      el.zIndex = minZ - 1;
      draft.template.isDirty = true;
    }
  });
}

/** Move element one step up */
export function bringForward(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el) {
      el.zIndex += 1;
      draft.template.isDirty = true;
    }
  });
}

/** Move element one step down */
export function sendBackward(store: AppStore, id: string): void {
  store.dispatch((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el) {
      el.zIndex -= 1;
      draft.template.isDirty = true;
    }
  });
}

// ═══════════════════════════════════════
// CLIPBOARD ACTIONS
// ═══════════════════════════════════════

/** Copy selected elements to clipboard */
export function copyElements(store: AppStore): void {
  const ids = getSelectedIds(store);
  store.dispatch((draft) => {
    draft.clipboard = draft.elements
      .filter((e) => ids.includes(e.id))
      .map((e) => structuredClone(current(e)) as CanvasElement);
  });
}

/** Cut selected elements (skip locked) */
export function cutElements(store: AppStore): void {
  copyElements(store);
  const ids = getSelectedIds(store);
  store.dispatch((draft) => {
    draft.elements = draft.elements.filter((e) => !ids.includes(e.id) || e.locked);
    draft.selectedId = null;
    draft.multiSelect = [];
    draft.template.isDirty = true;
  });
}

/** Paste from clipboard */
export function pasteElements(store: AppStore): void {
  store.dispatch((draft) => {
    if (draft.clipboard.length === 0) return;

    const newIds: string[] = [];
    for (const orig of draft.clipboard) {
      const clone = structuredClone(current(orig)) as CanvasElement;
      clone.id = nanoid(10);
      clone.name = `${orig.name}_paste`;
      clone.x += 15;
      clone.y += 15;
      clone.zIndex = draft.elements.length;
      draft.elements.push(clone);
      newIds.push(clone.id);
    }

    draft.selectedId = newIds[newIds.length - 1];
    draft.multiSelect = newIds.length > 1 ? newIds : [];
    draft.template.isDirty = true;
  });
}

// ═══════════════════════════════════════
// ALIGNMENT ACTIONS
// ═══════════════════════════════════════

type AlignType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type DistributeType = 'horizontal' | 'vertical';

/** Align selected elements */
export function alignElements(store: AppStore, alignment: AlignType): void {
  const ids = getSelectedIds(store);
  if (ids.length < 2) return;

  store.dispatch((draft) => {
    const els = draft.elements.filter((e) => ids.includes(e.id));
    if (els.length < 2) return;

    switch (alignment) {
      case 'left': {
        const minX = Math.min(...els.map((e) => e.x));
        els.forEach((e) => { e.x = minX; });
        break;
      }
      case 'right': {
        const maxRight = Math.max(...els.map((e) => e.x + e.w));
        els.forEach((e) => { e.x = maxRight - e.w; });
        break;
      }
      case 'center': {
        const minX = Math.min(...els.map((e) => e.x));
        const maxRight = Math.max(...els.map((e) => e.x + e.w));
        const cx = (minX + maxRight) / 2;
        els.forEach((e) => { e.x = cx - e.w / 2; });
        break;
      }
      case 'top': {
        const minY = Math.min(...els.map((e) => e.y));
        els.forEach((e) => { e.y = minY; });
        break;
      }
      case 'bottom': {
        const maxBottom = Math.max(...els.map((e) => e.y + e.h));
        els.forEach((e) => { e.y = maxBottom - e.h; });
        break;
      }
      case 'middle': {
        const minY = Math.min(...els.map((e) => e.y));
        const maxBottom = Math.max(...els.map((e) => e.y + e.h));
        const cy = (minY + maxBottom) / 2;
        els.forEach((e) => { e.y = cy - e.h / 2; });
        break;
      }
    }
    draft.template.isDirty = true;
  });
}

/** Distribute selected elements evenly */
export function distributeElements(store: AppStore, direction: DistributeType): void {
  const ids = getSelectedIds(store);
  if (ids.length < 3) return;

  store.dispatch((draft) => {
    const els = draft.elements
      .filter((e) => ids.includes(e.id))
      .sort((a, b) => (direction === 'horizontal' ? a.x - b.x : a.y - b.y));

    if (els.length < 3) return;

    if (direction === 'horizontal') {
      const first = els[0].x;
      const last = els[els.length - 1].x + els[els.length - 1].w;
      const totalW = els.reduce((s, e) => s + e.w, 0);
      const gap = (last - first - totalW) / (els.length - 1);
      let cx = first;
      for (const el of els) {
        el.x = cx;
        cx += el.w + gap;
      }
    } else {
      const first = els[0].y;
      const last = els[els.length - 1].y + els[els.length - 1].h;
      const totalH = els.reduce((s, e) => s + e.h, 0);
      const gap = (last - first - totalH) / (els.length - 1);
      let cy = first;
      for (const el of els) {
        el.y = cy;
        cy += el.h + gap;
      }
    }
    draft.template.isDirty = true;
  });
}

// ═══════════════════════════════════════
// NUDGE ACTIONS (Arrow Keys)
// ═══════════════════════════════════════

/** Nudge selected element by delta */
export function nudgeElement(store: AppStore, dx: number, dy: number): void {
  const ids = getSelectedIds(store);
  if (ids.length === 0) return;

  store.dispatch(tagAction((draft) => {
    for (const el of draft.elements) {
      if (ids.includes(el.id) && !el.locked) {
        el.x = Math.max(0, el.x + dx);
        el.y = Math.max(0, el.y + dy);
      }
    }
    draft.template.isDirty = true;
  }, { name: 'nudgeElement', undoable: true, batchKey: 'nudge' }));
}

// ═══════════════════════════════════════
// GRID ACTIONS
// ═══════════════════════════════════════

export function setGridEnabled(store: AppStore, enabled: boolean): void {
  store.dispatch(tagAction((d) => { d.grid.enabled = enabled; }, { name: 'setGridEnabled', undoable: false }));
}

export function setGridSize(store: AppStore, size: number): void {
  store.dispatch(tagAction((d) => { d.grid.size = Math.max(5, Math.min(50, size)); }, { name: 'setGridSize', undoable: false }));
}

export function setSnapToGrid(store: AppStore, snap: boolean): void {
  store.dispatch(tagAction((d) => { d.grid.snapToGrid = snap; }, { name: 'setSnapToGrid', undoable: false }));
}

export function setShowRulers(store: AppStore, show: boolean): void {
  store.dispatch(tagAction((d) => { d.grid.showRulers = show; }, { name: 'setShowRulers', undoable: false }));
}

export function setShowGuides(store: AppStore, show: boolean): void {
  store.dispatch(tagAction((d) => { d.grid.showGuides = show; }, { name: 'setShowGuides', undoable: false }));
}

/** Snap a coordinate to the grid */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

// ═══════════════════════════════════════
// CONTEXT MENU ACTIONS
// ═══════════════════════════════════════

export function showContextMenu(store: AppStore, x: number, y: number, elementId: string | null): void {
  store.dispatch(tagAction((d) => {
    d.contextMenu = { show: true, x, y, elementId };
  }, { name: 'showContextMenu', undoable: false }));
}

export function hideContextMenu(store: AppStore): void {
  store.dispatch(tagAction((d) => {
    d.contextMenu.show = false;
  }, { name: 'hideContextMenu', undoable: false }));
}

// ═══════════════════════════════════════
// ELEMENT GROUPING
// ═══════════════════════════════════════

/** Group selected elements together */
export function groupElements(store: AppStore): void {
  const ids = getSelectedIds(store);
  if (ids.length < 2) return;

  const groupId = nanoid(8);
  store.dispatch((draft) => {
    for (const el of draft.elements) {
      if (ids.includes(el.id)) {
        el.groupId = groupId;
      }
    }
    draft.template.isDirty = true;
  });
}

/** Ungroup selected elements */
export function ungroupElements(store: AppStore): void {
  const ids = getSelectedIds(store);
  if (ids.length === 0) return;

  store.dispatch((draft) => {
    // Find all groupIds from selected elements
    const groupIds = new Set<string>();
    for (const el of draft.elements) {
      if (ids.includes(el.id) && el.groupId) {
        groupIds.add(el.groupId);
      }
    }

    // Remove groupId from all elements in those groups
    for (const el of draft.elements) {
      if (el.groupId && groupIds.has(el.groupId)) {
        el.groupId = undefined;
      }
    }
    draft.template.isDirty = true;
  });
}

/** Get all element IDs that belong to the same group as the given element */
export function getGroupMemberIds(store: AppStore, elementId: string): string[] {
  const el = store.state.elements.find((e) => e.id === elementId);
  if (!el?.groupId) return [elementId];

  return store.state.elements
    .filter((e) => e.groupId === el.groupId)
    .map((e) => e.id);
}

// ═══════════════════════════════════════
// BULK DELETE
// ═══════════════════════════════════════

/** Resize a table column width */
export function resizeTableColumn(
  store: AppStore,
  tableId: string,
  columnIndex: number,
  newWidth: number,
): void {
  store.dispatch(tagAction((draft) => {
    const el = draft.elements.find((e) => e.id === tableId);
    if (el && el.type === 'table') {
      const table = el as TableElement;
      if (table.columns[columnIndex]) {
        table.columns[columnIndex].width = Math.max(20, newWidth);
        draft.template.isDirty = true;
      }
    }
  }, { name: 'resizeTableColumn', undoable: true, batchKey: `col-resize-${tableId}` }));
}

export function deleteSelected(store: AppStore): void {
  const ids = getSelectedIds(store);
  if (ids.length === 0) return;

  // Only delete unlocked elements
  const lockedIds = new Set(
    store.state.elements.filter((e) => ids.includes(e.id) && e.locked).map((e) => e.id),
  );

  const deletableIds = ids.filter((id) => !lockedIds.has(id));
  if (deletableIds.length === 0) return;

  store.dispatch((draft) => {
    draft.elements = draft.elements.filter((e) => !deletableIds.includes(e.id));
    if (draft.selectedId && deletableIds.includes(draft.selectedId)) {
      draft.selectedId = null;
    }
    draft.multiSelect = draft.multiSelect.filter((id) => !deletableIds.includes(id));
    draft.template.isDirty = true;
  });
}

// ═══════════════════════════════════════
// BAND ACTIONS (#47) — band mode edits state.bands directly
// ═══════════════════════════════════════

/** Regenerate bands from the current elements (call on band-mode entry). */
export function regenerateBands(store: AppStore): void {
  store.dispatch((draft) => {
    draft.bands = elementsToBands(current(draft).elements);
  });
}

/** Set a column's width % and redistribute the row to keep the sum at 100. */
export function setColumnWidth(
  store: AppStore,
  bandIdx: number,
  rowIdx: number,
  colIdx: number,
  pct: number,
): void {
  store.dispatch(tagAction((draft) => {
    const row = draft.bands[bandIdx]?.rows[rowIdx];
    if (!row) return;
    const widths = redistributeRowWidths(row.columns.map((c) => c.widthPct), colIdx, pct);
    row.columns.forEach((c, i) => { c.widthPct = widths[i]; });
  }, { name: 'setColumnWidth', undoable: true, batchKey: `bandw-${bandIdx}-${rowIdx}-${colIdx}` }));
}

// Band structural edits are tagged undoable:false on purpose: the history service
// snapshots only `elements` + `selectedId`, never `bands`, so recording them would
// push meaningless element snapshots that undo can't restore. Band mode is a
// pre-cutover bridge; element undo takes over once bands become derived (slice 3).

/** Insert a new empty row (one full-width empty column) into a band. */
export function addBandRow(store: AppStore, bandIdx: number, atIdx?: number): void {
  store.dispatch(tagAction((draft) => {
    const band = draft.bands[bandIdx];
    if (!band) return;
    const row = { id: nanoid(8), columns: [{ id: nanoid(8), widthPct: 100, elements: [] }] };
    const at = atIdx == null ? band.rows.length : Math.max(0, Math.min(atIdx, band.rows.length));
    band.rows.splice(at, 0, row);
  }, { name: 'addBandRow', undoable: false }));
}

/** Remove a row from a band. */
export function removeBandRow(store: AppStore, bandIdx: number, rowIdx: number): void {
  store.dispatch(tagAction((draft) => {
    const band = draft.bands[bandIdx];
    if (!band?.rows[rowIdx]) return;
    band.rows.splice(rowIdx, 1);
  }, { name: 'removeBandRow', undoable: false }));
}

/** Move a row up (dir=-1) or down (dir=+1) within its band. */
export function moveBandRow(store: AppStore, bandIdx: number, rowIdx: number, dir: -1 | 1): void {
  store.dispatch(tagAction((draft) => {
    const rows = draft.bands[bandIdx]?.rows;
    if (!rows) return;
    const to = rowIdx + dir;
    if (to < 0 || to >= rows.length) return;
    const [row] = rows.splice(rowIdx, 1);
    rows.splice(to, 0, row);
  }, { name: 'moveBandRow', undoable: false }));
}

/** Split a column into two — the new empty column shares the original's width. */
export function splitColumn(store: AppStore, bandIdx: number, rowIdx: number, colIdx: number): void {
  store.dispatch(tagAction((draft) => {
    const row = draft.bands[bandIdx]?.rows[rowIdx];
    const col = row?.columns[colIdx];
    if (!row || !col) return;
    const left = Math.max(1, Math.ceil(col.widthPct / 2));
    const right = col.widthPct - left;
    col.widthPct = left;
    row.columns.splice(colIdx + 1, 0, { id: nanoid(8), widthPct: right, elements: [] });
  }, { name: 'splitColumn', undoable: false }));
}

/** Merge a column into the previous one — elements concatenate, widths add. */
export function mergeColumn(store: AppStore, bandIdx: number, rowIdx: number, colIdx: number): void {
  store.dispatch(tagAction((draft) => {
    const row = draft.bands[bandIdx]?.rows[rowIdx];
    if (!row || colIdx <= 0 || colIdx >= row.columns.length) return;
    const prev = row.columns[colIdx - 1];
    const cur = row.columns[colIdx];
    prev.elements.push(...cur.elements);
    prev.widthPct += cur.widthPct;
    row.columns.splice(colIdx, 1);
  }, { name: 'mergeColumn', undoable: false }));
}

/**
 * Move an element to another cell WITHIN THE SAME BAND (re-parent only).
 * Geometry (x/y/w/h) is never touched — position in band mode comes from the
 * cell, not element coordinates. Cross-band moves change an element's role and
 * are deferred to the palette work (#49); an id not found in this band is a no-op.
 */
export function moveElementToCell(
  store: AppStore,
  elId: string,
  bandIdx: number,
  rowIdx: number,
  colIdx: number,
): void {
  store.dispatch(tagAction((draft) => {
    const band = draft.bands[bandIdx];
    const target = band?.rows[rowIdx]?.columns[colIdx];
    if (!band || !target) return;

    // Locate + detach the element from its source cell (this band only).
    for (const row of band.rows) {
      for (const col of row.columns) {
        const i = col.elements.findIndex((e) => e.id === elId);
        if (i >= 0) {
          const [el] = col.elements.splice(i, 1);
          target.elements.push(el);
          return;
        }
      }
    }
  }, { name: 'moveElementToCell', undoable: false }));
}

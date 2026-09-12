/**
 * State Actions
 * All state mutations go through these functions.
 * Components call actions; actions call store.dispatch().
 *
 * @author Wichit Wongta
 */
import { nanoid } from 'nanoid';
import { current, type Draft } from 'immer';
import type { AppStore } from './store';
import type { AppState, ClipboardOrigin } from './app-state';
import type { BandColumn } from '../models/bands';
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
import { BAND_ORDER, bandAccepts } from '../models/bands';
import type { ElementRoleType } from '../models/element';
import { tagAction } from './middleware';

// ═══════════════════════════════════════
// BAND ↔ POOL SYNC HELPERS (#126 / #135)
// ═══════════════════════════════════════
// Bands hold only id references (#49 model B); element properties live on the
// shared `state.elements`. So every action that adds to or removes from the pool
// must mirror the change into `state.bands`, or the two desync — a removed
// element leaves a dangling id that rides along through save/undo, and an added
// element never shows up in the band editor / preview / BFO export.

/** Drop `ids` from every band cell. Same cleanup as removeBandElement, for a set. */
function stripBandRefs(draft: Draft<AppState>, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  for (const band of draft.bands) {
    for (const row of band.rows) {
      for (const col of row.columns) {
        // filter, not indexOf+splice: also clears an id repeated in one cell
        if (col.elementIds.some((id) => drop.has(id))) {
          col.elementIds = col.elementIds.filter((id) => !drop.has(id));
        }
      }
    }
  }
}

/** Locate the band cell holding `id` — null when the element sits in no band. */
function findBandCell(
  draft: Draft<AppState>,
  id: string,
): { col: Draft<BandColumn>; index: number; origin: ClipboardOrigin } | null {
  for (const band of draft.bands) {
    for (let rowIdx = 0; rowIdx < band.rows.length; rowIdx++) {
      const row = band.rows[rowIdx];
      for (let colIdx = 0; colIdx < row.columns.length; colIdx++) {
        const col = row.columns[colIdx];
        const index = col.elementIds.indexOf(id);
        if (index >= 0) {
          return { col, index, origin: { role: band.role, rowIdx, colIdx, index } };
        }
      }
    }
  }
  return null;
}

/**
 * Put a pasted `el` into a band cell (#135), preferring the cell it was copied
 * from. Returns false when no band accepts it — the caller then skips the
 * element rather than leaving an orphan in the pool.
 *
 * Order: the recorded origin cell → the element's own role band (created, with
 * a row, if missing — mirrors addElementToNewBand). Acceptance matrix (#49)
 * applies because a paste is a NEW addition.
 */
function placePastedElement(
  draft: Draft<AppState>,
  el: Draft<CanvasElement>,
  sourceId: string,
  origin: ClipboardOrigin | undefined,
): boolean {
  // 1. The exact cell it came from, if it still exists and accepts the type.
  if (origin) {
    const band = draft.bands.find((b) => b.role === origin.role);
    const col = band?.rows[origin.rowIdx]?.columns[origin.colIdx];
    if (band && col && bandAccepts(band.role, el.type)) {
      el.role = band.role;
      // After a copy the source is still in the cell → sit right after it (same
      // convention as duplicateElement). After a cut it is gone → reuse its slot.
      const at = col.elementIds.indexOf(sourceId);
      const insertAt = at >= 0 ? at + 1 : Math.min(origin.index, col.elementIds.length);
      col.elementIds.splice(insertAt, 0, el.id);
      return true;
    }
  }

  // 2. Fall back to the element's own role band.
  if (!bandAccepts(el.role, el.type)) return false;

  let band = draft.bands.find((b) => b.role === el.role);
  if (!band) {
    band = { role: el.role, rows: [] };
    const order = BAND_ORDER.indexOf(el.role);
    const at = draft.bands.findIndex((b) => BAND_ORDER.indexOf(b.role) > order);
    if (at === -1) draft.bands.push(band);
    else draft.bands.splice(at, 0, band);
  }

  const firstCol = band.rows[0]?.columns[0];
  if (firstCol) firstCol.elementIds.push(el.id);
  else band.rows.push({ id: nanoid(8), columns: [{ id: nanoid(8), widthPct: 100, elementIds: [el.id] }] });
  return true;
}

// ═══════════════════════════════════════
// ELEMENT ACTIONS
// ═══════════════════════════════════════

/** Add a new element to the canvas */
export function addElement(
  store: AppStore,
  type: ElementType,
  x?: number,
  y?: number,
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
    // Drop any band reference too (#126) — otherwise a dangling id survives in
    // state.bands and rides along through save/undo.
    stripBandRefs(draft, [id]);
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
    if (clone.x != null) clone.x += 20;
    if (clone.y != null) clone.y += 20;
    clone.zIndex = draft.elements.length;

    draft.elements.push(clone);

    // Mirror into the band structure (#125): place the clone right after the
    // source in its band cell, so it's visible in the editor/preview/export
    // (bands are the layout source of truth after #47).
    const cell = findBandCell(draft, id);
    if (cell) cell.col.elementIds.splice(cell.index + 1, 0, clone.id);

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
  store.dispatch(tagAction((draft) => {
    draft.jsonData = data;
    draft.jsonKeys = extractJsonKeys(data);
  }, { name: 'loadJsonData', undoable: false }));
}

/** Clear preview/binding data without creating an undo entry for document layout. */
export function clearJsonData(store: AppStore): void {
  store.dispatch(tagAction((draft) => {
    draft.jsonData = null;
    draft.jsonKeys = [];
  }, { name: 'clearJsonData', undoable: false }));
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

/**
 * Copy selected elements to clipboard, recording each one's band cell (#135)
 * so paste can put the clone back where it came from.
 */
export function copyElements(store: AppStore): void {
  const ids = getSelectedIds(store);
  store.dispatch((draft) => {
    draft.clipboard = draft.elements
      .filter((e) => ids.includes(e.id))
      .map((e) => ({
        el: structuredClone(current(e)) as CanvasElement,
        origin: findBandCell(draft, e.id)?.origin,
      }));
  });
}

/** Cut selected elements (skip locked) */
export function cutElements(store: AppStore): void {
  copyElements(store);
  const ids = getSelectedIds(store);
  store.dispatch((draft) => {
    // Locked elements survive the cut, so only clear band refs for the ones
    // that actually leave the pool (#135) — same desync as #126 otherwise.
    const cutIds = draft.elements.filter((e) => ids.includes(e.id) && !e.locked).map((e) => e.id);
    draft.elements = draft.elements.filter((e) => !ids.includes(e.id) || e.locked);
    stripBandRefs(draft, cutIds);
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
    for (const entry of draft.clipboard) {
      const orig = entry.el;
      const clone = structuredClone(current(orig)) as CanvasElement;
      clone.id = nanoid(10);
      clone.name = `${orig.name}_paste`;
      if (clone.x != null) clone.x += 15;
      if (clone.y != null) clone.y += 15;
      clone.zIndex = draft.elements.length;

      // Bands are the layout source of truth (#47): an element that lands in no
      // cell is invisible in the editor/preview/export. Rather than paste an
      // orphan (#135), skip it — same call as addElementToCell returning null
      // when the acceptance matrix (#49) rejects the type.
      draft.elements.push(clone);
      const placed = placePastedElement(
        draft,
        draft.elements[draft.elements.length - 1],
        orig.id,
        entry.origin ? current(entry.origin) : undefined,
      );
      if (!placed) {
        draft.elements.pop();
        continue;
      }
      newIds.push(clone.id);
    }

    if (newIds.length === 0) return;

    draft.selectedId = newIds[newIds.length - 1];
    draft.multiSelect = newIds.length > 1 ? newIds : [];
    draft.template.isDirty = true;
  });
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
    // Keyboard/multi-select delete must clear band refs too (#135) — the same
    // dangling-id desync #126 fixed for the inspector's ✕ ลบ button.
    stripBandRefs(draft, deletableIds);
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

/** Drag the boundary between column leftIdx and leftIdx+1 (#98): only the
 *  pair changes (their sum is preserved), so the divider tracks the mouse.
 *  Both sides clamp to >=5%. */
export function dragColumnBoundary(
  store: AppStore,
  bandIdx: number,
  rowIdx: number,
  leftIdx: number,
  leftPct: number,
  recordHistory = true,
  historyBatchKey?: string,
): boolean {
  const currentRow = store.state.bands[bandIdx]?.rows[rowIdx];
  const currentLeft = currentRow?.columns[leftIdx];
  const currentRight = currentRow?.columns[leftIdx + 1];
  if (!currentLeft || !currentRight) return false;
  const pair = currentLeft.widthPct + currentRight.widthPct;
  if (pair < 10) return false;
  const newLeft = Math.round(Math.min(Math.max(leftPct, 5), pair - 5));
  if (currentLeft.widthPct === newLeft && currentRight.widthPct === pair - newLeft) return false;

  store.dispatch(tagAction((draft) => {
    const row = draft.bands[bandIdx]?.rows[rowIdx];
    const left = row?.columns[leftIdx];
    const right = row?.columns[leftIdx + 1];
    if (!left || !right) return;
    left.widthPct = newLeft;
    right.widthPct = pair - newLeft;
  }, {
    name: 'dragColumnBoundary',
    undoable: recordHistory,
    batchKey: historyBatchKey ?? `banddrag-${bandIdx}-${rowIdx}-${leftIdx}`,
  }));
  return true;
}

// Band structural edits are undoable (#47 cutover): the history service now
// snapshots `state.bands` alongside elements, so Ctrl+Z restores band layout the
// same as canvas edits. (addElementToCell stays undoable:false because the
// addElement it calls already pushes the undo point — see there.)

/** Insert a new empty row (one full-width empty column) into a band. */
export function addBandRow(store: AppStore, bandIdx: number, atIdx?: number): void {
  store.dispatch(tagAction((draft) => {
    const band = draft.bands[bandIdx];
    if (!band) return;
    const row = { id: nanoid(8), columns: [{ id: nanoid(8), widthPct: 100, elementIds: [] }] };
    const at = atIdx == null ? band.rows.length : Math.max(0, Math.min(atIdx, band.rows.length));
    band.rows.splice(at, 0, row);
  }, { name: 'addBandRow', undoable: true }));
}

/**
 * Set a band row's height in pt (#107) — bands own vertical geometry, so this
 * reaches the header/footer macro height directly (roleHeightFromBand).
 * height <= 0 / NaN clears back to auto (content estimate on export).
 */
export function setRowHeight(store: AppStore, bandIdx: number, rowIdx: number, height: number): void {
  store.dispatch(tagAction((draft) => {
    const row = draft.bands[bandIdx]?.rows[rowIdx];
    if (!row) return;
    row.height = Number.isFinite(height) && height > 0 ? Math.max(4, height) : undefined;
  }, { name: 'setRowHeight', undoable: true }));
}

/** Remove a row from a band, deleting the elements it holds (#136). */
export function removeBandRow(store: AppStore, bandIdx: number, rowIdx: number): void {
  store.dispatch(tagAction((draft) => {
    const band = draft.bands[bandIdx];
    const row = band?.rows[rowIdx];
    if (!row) return;
    // The row owns its elements — deleting the row deletes them from the pool too
    // (#136). Leaving them behind stranded invisible orphans, since bands are the
    // layout source of truth after #47 and an element with no cell renders nowhere.
    const ids = row.columns.flatMap((c) => c.elementIds);
    if (ids.length) {
      const drop = new Set(ids);
      draft.elements = draft.elements.filter((e) => !drop.has(e.id));
      if (draft.selectedId && drop.has(draft.selectedId)) draft.selectedId = null;
      draft.multiSelect = draft.multiSelect.filter((id) => !drop.has(id));
      // Clear any stray ref in another cell before the row itself goes.
      stripBandRefs(draft, ids);
    }
    band.rows.splice(rowIdx, 1);
    draft.template.isDirty = true;
  }, { name: 'removeBandRow', undoable: true }));
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
  }, { name: 'moveBandRow', undoable: true }));
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
    row.columns.splice(colIdx + 1, 0, { id: nanoid(8), widthPct: right, elementIds: [] });
  }, { name: 'splitColumn', undoable: true }));
}

/** Merge a column into the previous one — elements concatenate, widths add. */
export function mergeColumn(store: AppStore, bandIdx: number, rowIdx: number, colIdx: number): void {
  store.dispatch(tagAction((draft) => {
    const row = draft.bands[bandIdx]?.rows[rowIdx];
    if (!row || colIdx <= 0 || colIdx >= row.columns.length) return;
    const prev = row.columns[colIdx - 1];
    const cur = row.columns[colIdx];
    prev.elementIds.push(...cur.elementIds);
    prev.widthPct += cur.widthPct;
    row.columns.splice(colIdx, 1);
  }, { name: 'mergeColumn', undoable: true }));
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

    // Locate + detach the element id from its source cell (this band only).
    for (const row of band.rows) {
      for (const col of row.columns) {
        const i = col.elementIds.indexOf(elId);
        if (i >= 0) {
          col.elementIds.splice(i, 1);
          target.elementIds.push(elId);
          return;
        }
      }
    }
  }, { name: 'moveElementToCell', undoable: true }));
}

/**
 * Add a new element into a specific cell (#49). The element is created in the
 * shared pool via addElement, then re-roled to the band's role so it belongs here
 * and survives a re-sync from canvas (an element with a mismatched role would jump
 * bands). addElement already selects it, so the property panel opens on the new
 * chip. (A restrictive type→role palette filter is a later #49 concern — no
 * acceptance table exists yet, so any element type is accepted for now.)
 */
export function addElementToCell(
  store: AppStore,
  type: ElementType,
  bandIdx: number,
  rowIdx: number,
  colIdx: number,
): string | null {
  const band = store.state.bands[bandIdx];
  if (!band?.rows[rowIdx]?.columns[colIdx]) return null;
  // Acceptance matrix (#49): the band's role decides which element types may
  // be ADDED (legacy templates keep whatever they already carry).
  if (!bandAccepts(band.role, type)) return null;
  const id = addElement(store, type); // pool + selection (no legacy x/y, #107)
  store.dispatch(tagAction((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el) el.role = band.role;
    draft.bands[bandIdx].rows[rowIdx].columns[colIdx].elementIds.push(id);
    // undoable:false — the addElement above already pushed the undo snapshot, so a
    // single Ctrl+Z removes the whole "add element to cell" (element + band ref).
  }, { name: 'addElementToCell', undoable: false }));
  return id;
}

/**
 * Move an element before/after another in the authoritative document structure.
 * Returns false for rejected or unchanged moves. Preserves row geometry and
 * makes the band references and element role one undoable edit.
 */
export function reorderDocumentElement(
  store: AppStore,
  sourceId: string,
  targetId: string,
  position: 'above' | 'below',
): boolean {
  if (sourceId === targetId) return false;
  const source = store.state.elements.find((el) => el.id === sourceId);
  const target = store.state.elements.find((el) => el.id === targetId);
  if (!source || !target || source.locked) return false;
  const locations = (id: string) => store.state.bands.flatMap((band) =>
    band.rows.flatMap((row) => row.columns.flatMap((col) =>
      col.elementIds.flatMap((ref, index) => ref === id ? [{ band, col, index }] : []))));
  const sources = locations(sourceId);
  const targets = locations(targetId);
  // Ambiguous or orphaned references must be repaired explicitly, not silently
  // discarded by a Layers gesture. Structure is authoritative for PDF order.
  if (sources.length !== 1 || targets.length !== 1) return false;
  const from = sources[0];
  const to = targets[0];
  // Export renders a single band per role. Refuse malformed duplicate-role
  // imports rather than offering a reorder that cannot match printed output.
  if ([from.band.role, to.band.role].some((role) =>
    store.state.bands.filter((band) => band.role === role).length !== 1)) return false;
  if (from.band.role !== to.band.role && !bandAccepts(to.band.role, source.type)) return false;
  if (from.col === to.col && from.index === to.index + (position === 'above' ? -1 : 1)) {
    return false;
  }
  store.dispatch(tagAction((draft) => {
    const origin = findBandCell(draft, sourceId)!;
    const destination = findBandCell(draft, targetId)!;
    origin.col.elementIds.splice(origin.index, 1);
    const index = destination.col.elementIds.indexOf(targetId);
    destination.col.elementIds.splice(index + (position === 'below' ? 1 : 0), 0, sourceId);
    draft.elements.find((el) => el.id === sourceId)!.role = destination.origin.role;
    draft.template.isDirty = true;
  }, { name: 'reorderDocumentElement', undoable: true }));
  return true;
}

/** Re-home an element to a role, keeping its band references synchronized. */
export function moveElementToBandByRole(
  store: AppStore,
  elId: string,
  role: ElementRoleType,
): boolean {
  const el = store.state.elements.find((e) => e.id === elId);
  if (!el) return false;
  if (el.role === role) return true; // already there — no-op
  if (!bandAccepts(role, el.type)) return false; // acceptance matrix (#49)

  store.dispatch(tagAction((draft) => {
    const target = draft.elements.find((e) => e.id === elId);
    if (!target) return;
    target.role = role;

    // Detach from every band cell it currently occupies.
    for (const band of draft.bands) {
      for (const row of band.rows) {
        for (const col of row.columns) {
          const i = col.elementIds.indexOf(elId);
          if (i >= 0) col.elementIds.splice(i, 1);
        }
      }
    }

    // Find or create the destination band at its canonical BAND_ORDER position.
    let dest = draft.bands.find((b) => b.role === role);
    if (!dest) {
      dest = { role, rows: [] };
      const order = BAND_ORDER.indexOf(role);
      const at = draft.bands.findIndex((b) => BAND_ORDER.indexOf(b.role) > order);
      if (at === -1) draft.bands.push(dest);
      else draft.bands.splice(at, 0, dest);
    }

    // Append into the band's last cell, or seed a fresh row when it has none.
    const lastRow = dest.rows[dest.rows.length - 1];
    if (lastRow) {
      lastRow.columns[lastRow.columns.length - 1].elementIds.push(elId);
    } else {
      dest.rows.push({ id: nanoid(8), columns: [{ id: nanoid(8), widthPct: 100, elementIds: [elId] }] });
    }

    draft.template.isDirty = true;
  }, { name: 'moveElementToBandByRole', undoable: true }));
  return true;
}

/**
 * Add a new element into a brand-new row of a role's band, creating the band if
 * it doesn't exist yet (#47 cutover empty-state). Lets a consultant start a blank
 * template — or add to a role that has no band — without a free canvas. The band
 * is inserted at its BAND_ORDER position so document order stays canonical.
 */
export function addElementToNewBand(store: AppStore, type: ElementType, role: ElementRoleType): string | null {
  if (!bandAccepts(role, type)) return null; // acceptance matrix (#49)
  const id = addElement(store, type); // pool + selection (undo point; no legacy x/y, #107)
  store.dispatch(tagAction((draft) => {
    const el = draft.elements.find((e) => e.id === id);
    if (el) el.role = role;

    let band = draft.bands.find((b) => b.role === role);
    if (!band) {
      band = { role, rows: [] };
      const order = BAND_ORDER.indexOf(role);
      const at = draft.bands.findIndex((b) => BAND_ORDER.indexOf(b.role) > order);
      if (at === -1) draft.bands.push(band);
      else draft.bands.splice(at, 0, band);
    }
    band.rows.push({ id: nanoid(8), columns: [{ id: nanoid(8), widthPct: 100, elementIds: [id] }] });
  }, { name: 'addElementToNewBand', undoable: false })); // addElement pushed the undo point
  return id;
}

/** Remove an element from BOTH the shared pool and its band cell (skip if locked). */
export function removeBandElement(store: AppStore, elId: string): void {
  const el = store.state.elements.find((e) => e.id === elId);
  if (el?.locked) return;
  store.dispatch(tagAction((draft) => {
    draft.elements = draft.elements.filter((e) => e.id !== elId);
    if (draft.selectedId === elId) draft.selectedId = null;
    for (const band of draft.bands) {
      for (const row of band.rows) {
        for (const col of row.columns) {
          const i = col.elementIds.indexOf(elId);
          if (i >= 0) col.elementIds.splice(i, 1);
        }
      }
    }
  }, { name: 'removeBandElement', undoable: true }));
}

/**
 * Set (or clear) the type of the element currently being dragged from the palette
 * (#49 acceptance-matrix discriminator; read in band-view drag handlers).
 *
 * `dragType` is a TRANSIENT UI flag, not document state — so this dispatch is
 * tagged `undoable:false`. Writing it untagged made every dragstart/drop clear
 * push a spurious history snapshot (state after the drop), which made the first
 * Ctrl+Z a no-op and desynced elements/bands on a later undo (#129).
 */
export function setDragType(store: AppStore, type: ElementType | null): void {
  store.dispatch(tagAction((draft) => {
    draft.dragType = type;
  }, { name: 'setDragType', undoable: false }));
}

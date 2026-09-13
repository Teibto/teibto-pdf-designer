/**
 * Undo/Redo History Service v2 — Production Grade
 *
 * Changes from v1:
 *   1. Uses structuredClone() instead of JSON.parse(JSON.stringify())
 *   2. Strips base64 imageData from snapshots (stores ref only)
 *   3. Integrated as proper middleware (no monkey-patching)
 *   4. Only records undoable actions (zoom/view/select/grid are excluded)
 *   5. Debounced rapid-fire mutations (drag/nudge → single history entry)
 *   6. Memory budget tracking with automatic trimming
 *
 * @author Wichit Wongta
 */
import { DocumentSessionChangedEvent, type AppStore } from '../state/store';
import type { CanvasElement } from '../models/element';
import type { Band } from '../models/bands';
import type { PageConfig } from '../models/page';
import type { PaginationConfig, TemplateCopy } from '../models/template';
import type { Middleware, DispatchRecipe } from '../state/middleware';
import { getActionTag, NON_UNDOABLE_ACTIONS } from '../state/middleware';

// ─── Configuration ───

const MAX_HISTORY = 50;
const DEBOUNCE_MS = 300;

/**
 * Approximate max memory for history stack (~20MB).
 * Each snapshot is estimated; if exceeded, oldest entries are trimmed.
 */
const MAX_MEMORY_BYTES = 20 * 1024 * 1024;

/**
 * Uploads are capped at 2,000,000 data-URL characters by image.service. Keep
 * at most 16 MiB of deduplicated UTF-16 payloads inside the overall 20 MiB
 * history budget, so deleting an uploaded image remains undoable without
 * copying its base64 string into every snapshot.
 */
const MAX_IMAGE_DATA_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_STORE_BYTES = 16 * 1024 * 1024;

// ─── Snapshot (stripped of heavy data) ───

interface HistorySnapshot {
  editorMode: 'visual' | 'xml';
  rawXml: string;
  elements: CanvasElement[];
  /** Band structure (#47 cutover): band edits are undoable like element edits. */
  bands: Band[];
  page: PageConfig;
  pagination: PaginationConfig;
  copies: TemplateCopy[] | null;
  /** Element id -> content-addressed entry in the bounded image payload store. */
  imageDataRefs: Record<string, string>;
  selectedId: string | null;
  timestamp: number;
  /** Approximate byte size of this snapshot */
  estimatedSize: number;
}

interface ImageDataEntry {
  data: string;
  bytes: number;
  refs: number;
}

// ─── History Service ───

export class HistoryService {
  private _undoStack: HistorySnapshot[] = [];
  private _redoStack: HistorySnapshot[] = [];
  private _store: AppStore;
  private _isApplying = false;
  private _totalMemory = 0;
  private _imageStoreMemory = 0;
  private _imageDataStore = new Map<string, ImageDataEntry>();
  private _documentSession: number;

  // Debounce: collapse rapid mutations into one entry
  private _lastBatchKey: string | null = null;
  private _lastPushTime = 0;

  constructor(store: AppStore) {
    this._store = store;
    this._documentSession = store.documentSession;
    store.addEventListener('document-session-changed', (event) => {
      this._documentSession = (event as DocumentSessionChangedEvent).session;
      this.clear();
    });
  }

  // ─── Middleware Factory ───

  /**
   * Returns a store middleware that automatically records history
   * for undoable actions.
   */
  createMiddleware(): Middleware {
    return (_api) => (next) => (recipe: DispatchRecipe) => {
      if (this._isApplying) {
        next(recipe);
        return;
      }

      // beginDocumentSession() announces the boundary before its paired load.
      // Clear immediately and let exactly that replacement dispatch pass
      // without capturing state from the previous document.
      if (this._store.consumeDocumentReplacementBoundary(this._store.documentSession)) {
        this._documentSession = this._store.documentSession;
        this.clear();
        next(recipe);
        return;
      }

      // Defensive fallback for a store implementation that changes the token
      // without emitting the boundary event.
      if (this._documentSession !== this._store.documentSession) {
        this._documentSession = this._store.documentSession;
        this.clear();
        next(recipe);
        return;
      }

      const tag = getActionTag(recipe);
      const actionName = tag?.name ?? '';
      const isUndoable = tag ? tag.undoable : !NON_UNDOABLE_ACTIONS.has(actionName);

      if (isUndoable) {
        const batchKey = tag?.batchKey ?? null;
        this._pushIfNeeded(batchKey);
      }

      next(recipe);
    };
  }

  // ─── Push Logic ───

  private _pushIfNeeded(batchKey: string | null): void {
    const now = Date.now();

    // Debounce: if same batchKey within DEBOUNCE_MS, skip push
    if (
      batchKey &&
      batchKey === this._lastBatchKey &&
      now - this._lastPushTime < DEBOUNCE_MS
    ) {
      return;
    }

    this._pushSnapshot();
    this._lastBatchKey = batchKey;
    this._lastPushTime = now;
  }

  private _pushSnapshot(): void {
    const snapshot = this._createSnapshot();

    this._undoStack.push(snapshot);
    this._totalMemory += snapshot.estimatedSize;

    // Trim: max entries
    while (this._undoStack.length > MAX_HISTORY) {
      const removed = this._undoStack.shift()!;
      this._totalMemory -= removed.estimatedSize;
      this._releaseSnapshot(removed);
    }

    // Trim: memory budget
    while (this._memoryUsed() > MAX_MEMORY_BYTES && this._undoStack.length > 1) {
      const removed = this._undoStack.shift()!;
      this._totalMemory -= removed.estimatedSize;
      this._releaseSnapshot(removed);
    }

    // Clear redo on new action
    this._clearRedoStack();
  }

  // ─── Undo / Redo ───

  undo(): boolean {
    if (this._undoStack.length === 0) return false;

    const currentSnapshot = this._createSnapshot();
    this._redoStack.push(currentSnapshot);
    this._totalMemory += currentSnapshot.estimatedSize;

    const snapshot = this._undoStack.pop()!;
    this._totalMemory -= snapshot.estimatedSize;
    this._applySnapshot(snapshot);
    this._releaseSnapshot(snapshot);

    return true;
  }

  redo(): boolean {
    if (this._redoStack.length === 0) return false;

    const currentSnapshot = this._createSnapshot();
    this._undoStack.push(currentSnapshot);
    this._totalMemory += currentSnapshot.estimatedSize;

    const snapshot = this._redoStack.pop()!;
    this._totalMemory -= snapshot.estimatedSize;
    this._applySnapshot(snapshot);
    this._releaseSnapshot(snapshot);

    return true;
  }

  // ─── Snapshot Helpers ───

  private _createSnapshot(): HistorySnapshot {
    const state = this._store.state;
    const { elements: stripped, imageDataRefs } = this._captureElements(state.elements);
    const bands = structuredClone(state.bands);
    const page = structuredClone(state.page);
    const pagination = structuredClone(state.pagination);
    const copies = structuredClone(state.copies);
    return {
      editorMode: state.editorMode,
      rawXml: state.rawXml,
      elements: stripped,
      bands,
      page,
      pagination,
      copies,
      imageDataRefs,
      selectedId: state.selectedId,
      timestamp: Date.now(),
      estimatedSize: state.rawXml.length * 2 + estimateSize(stripped) + estimateBandsSize(bands)
        + estimateObjectSize(page) + estimateObjectSize(pagination) + estimateObjectSize(copies),
    };
  }

  private _applySnapshot(snapshot: HistorySnapshot): void {
    this._isApplying = true;
    try {
      const restored = snapshot.elements.map((el) => {
        const ref = snapshot.imageDataRefs[el.id];
        const imageData = ref ? this._imageDataStore.get(ref)?.data : undefined;
        if (el.type === 'image' && imageData) {
          return { ...el, imageData };
        }
        return el;
      });

      this._store.dispatch((draft) => {
        draft.editorMode = snapshot.editorMode;
        draft.rawXml = snapshot.rawXml;
        draft.elements = restored as any;
        draft.bands = structuredClone(snapshot.bands);
        draft.page = structuredClone(snapshot.page);
        draft.pagination = structuredClone(snapshot.pagination);
        draft.copies = structuredClone(snapshot.copies);
        draft.selectedId = snapshot.selectedId;
      });
    } finally {
      this._isApplying = false;
    }
  }

  // ─── Cleanup ───

  private _clearRedoStack(): void {
    for (const snapshot of this._redoStack) {
      this._totalMemory -= snapshot.estimatedSize;
      this._releaseSnapshot(snapshot);
    }
    this._redoStack = [];
  }

  clear(): void {
    this._undoStack = [];
    this._redoStack = [];
    this._totalMemory = 0;
    this._imageStoreMemory = 0;
    this._imageDataStore.clear();
    this._lastBatchKey = null;
    this._lastPushTime = 0;
  }

  get canUndo(): boolean { return this._undoStack.length > 0; }
  get canRedo(): boolean { return this._redoStack.length > 0; }

  get stats() {
    return {
      undoCount: this._undoStack.length,
      redoCount: this._redoStack.length,
      memoryUsedMB: (this._memoryUsed() / (1024 * 1024)).toFixed(2),
      maxHistory: MAX_HISTORY,
    };
  }

  private _captureElements(elements: readonly CanvasElement[]): {
    elements: CanvasElement[];
    imageDataRefs: Record<string, string>;
  } {
    const imageDataRefs: Record<string, string> = {};
    const stripped = elements.map((el) => {
      const clone = structuredClone(el);
      if (clone.type !== 'image') return clone;

      const data = clone.imageData;
      clone.imageData = undefined;
      if (typeof data !== 'string') return clone;

      const ref = this._retainImageData(data);
      if (ref) imageDataRefs[clone.id] = ref;
      return clone;
    });
    return { elements: stripped, imageDataRefs };
  }

  private _retainImageData(data: string): string | null {
    const bytes = data.length * 2;
    if (bytes > MAX_IMAGE_DATA_BYTES) return null;

    const base = imageDataAddress(data);
    let ref = base;
    let collision = 0;
    while (true) {
      const existing = this._imageDataStore.get(ref);
      if (!existing) break;
      if (existing.data === data) {
        existing.refs++;
        return ref;
      }
      ref = `${base}-${++collision}`;
    }

    // Do not mutate either stack while constructing an undo/redo snapshot:
    // its top entry may be the operation about to be applied. The normal
    // 2,000,000-character upload bound fits four distinct retained payloads;
    // older stack entries are released by the 20 MiB history trim above.
    if (this._imageStoreMemory + bytes > MAX_IMAGE_STORE_BYTES) return null;
    this._imageDataStore.set(ref, { data, bytes, refs: 1 });
    this._imageStoreMemory += bytes;
    return ref;
  }

  private _releaseSnapshot(snapshot: HistorySnapshot): void {
    for (const ref of Object.values(snapshot.imageDataRefs)) {
      const entry = this._imageDataStore.get(ref);
      if (!entry || --entry.refs > 0) continue;
      this._imageDataStore.delete(ref);
      this._imageStoreMemory -= entry.bytes;
    }
  }

  private _memoryUsed(): number {
    return this._totalMemory + this._imageStoreMemory;
  }
}

// ═══════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════

/** Stable, collision-checked content address for a retained image data URL. */
function imageDataAddress(data: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${data.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

/**
 * Rough byte-size estimate for memory budget.
 */
function estimateSize(elements: CanvasElement[]): number {
  let size = 0;
  for (const el of elements) {
    size += 200;
    if ('content' in el && typeof (el as any).content === 'string') {
      size += (el as any).content.length * 2;
    }
    if (el.type === 'table') {
      size += (el as any).columns.length * 100;
    }
    if (el.type === 'list') {
      size += (el as any).items.reduce((s: number, i: string) => s + i.length * 2, 0);
    }
  }
  return size;
}

/** Rough byte-size estimate for a band structure (ids + widths only, no heavy data). */
function estimateBandsSize(bands: readonly Band[]): number {
  let cols = 0;
  for (const b of bands) for (const r of b.rows) cols += r.columns.length;
  return cols * 80;
}

function estimateObjectSize(value: unknown): number {
  return JSON.stringify(value)?.length * 2 || 0;
}

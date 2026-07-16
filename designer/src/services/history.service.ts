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
import type { AppStore } from '../state/store';
import type { CanvasElement } from '../models/element';
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

// ─── Snapshot (stripped of heavy data) ───

interface HistorySnapshot {
  elements: CanvasElement[];
  selectedId: string | null;
  timestamp: number;
  /** Approximate byte size of this snapshot */
  estimatedSize: number;
}

// ─── History Service ───

export class HistoryService {
  private _undoStack: HistorySnapshot[] = [];
  private _redoStack: HistorySnapshot[] = [];
  private _store: AppStore;
  private _isApplying = false;
  private _totalMemory = 0;

  // Debounce: collapse rapid mutations into one entry
  private _lastBatchKey: string | null = null;
  private _lastPushTime = 0;

  constructor(store: AppStore) {
    this._store = store;
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
    const state = this._store.state;
    const stripped = stripHeavyData(state.elements);
    const estimatedSize = estimateSize(stripped);

    const snapshot: HistorySnapshot = {
      elements: stripped,
      selectedId: state.selectedId,
      timestamp: Date.now(),
      estimatedSize,
    };

    this._undoStack.push(snapshot);
    this._totalMemory += estimatedSize;

    // Trim: max entries
    while (this._undoStack.length > MAX_HISTORY) {
      const removed = this._undoStack.shift()!;
      this._totalMemory -= removed.estimatedSize;
    }

    // Trim: memory budget
    while (this._totalMemory > MAX_MEMORY_BYTES && this._undoStack.length > 1) {
      const removed = this._undoStack.shift()!;
      this._totalMemory -= removed.estimatedSize;
    }

    // Clear redo on new action
    this._clearRedoStack();
  }

  // ─── Undo / Redo ───

  undo(): boolean {
    if (this._undoStack.length === 0) return false;

    const currentSnapshot = this._createSnapshot();
    this._redoStack.push(currentSnapshot);

    const snapshot = this._undoStack.pop()!;
    this._totalMemory -= snapshot.estimatedSize;
    this._applySnapshot(snapshot);

    return true;
  }

  redo(): boolean {
    if (this._redoStack.length === 0) return false;

    const currentSnapshot = this._createSnapshot();
    this._undoStack.push(currentSnapshot);
    this._totalMemory += currentSnapshot.estimatedSize;

    const snapshot = this._redoStack.pop()!;
    this._applySnapshot(snapshot);

    return true;
  }

  // ─── Snapshot Helpers ───

  private _createSnapshot(): HistorySnapshot {
    const state = this._store.state;
    const stripped = stripHeavyData(state.elements);
    return {
      elements: stripped,
      selectedId: state.selectedId,
      timestamp: Date.now(),
      estimatedSize: estimateSize(stripped),
    };
  }

  private _applySnapshot(snapshot: HistorySnapshot): void {
    this._isApplying = true;
    try {
      const currentElements = this._store.state.elements;

      // Restore imageData from current state (since we stripped it from snapshots)
      const imageDataMap = new Map<string, string | undefined>();
      for (const el of currentElements) {
        if (el.type === 'image' && (el as any).imageData) {
          imageDataMap.set(el.id, (el as any).imageData);
        }
      }

      const restored = snapshot.elements.map((el) => {
        if (el.type === 'image' && imageDataMap.has(el.id)) {
          return { ...el, imageData: imageDataMap.get(el.id) };
        }
        return el;
      });

      this._store.dispatch((draft) => {
        draft.elements = restored as any;
        draft.selectedId = snapshot.selectedId;
      });
    } finally {
      this._isApplying = false;
    }
  }

  // ─── Cleanup ───

  private _clearRedoStack(): void {
    this._redoStack = [];
  }

  clear(): void {
    this._undoStack = [];
    this._redoStack = [];
    this._totalMemory = 0;
  }

  get canUndo(): boolean { return this._undoStack.length > 0; }
  get canRedo(): boolean { return this._redoStack.length > 0; }

  get stats() {
    return {
      undoCount: this._undoStack.length,
      redoCount: this._redoStack.length,
      memoryUsedMB: (this._totalMemory / (1024 * 1024)).toFixed(2),
      maxHistory: MAX_HISTORY,
    };
  }
}

// ═══════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════

/**
 * Deep clone elements but strip heavy base64 imageData.
 * Image data is preserved in the live store and restored on undo.
 */
function stripHeavyData(elements: readonly CanvasElement[]): CanvasElement[] {
  return elements.map((el) => {
    const clone = structuredClone(el);
    if (clone.type === 'image') {
      (clone as any).imageData = undefined;
    }
    return clone;
  });
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

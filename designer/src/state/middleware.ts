/**
 * Store Middleware System
 * Proper middleware pipeline for AppStore — replaces monkey-patching dispatch.
 *
 * Middleware can:
 *   - Intercept dispatches before they happen
 *   - Run side effects after state changes
 *   - Decide whether to record history (undoable vs non-undoable)
 *
 * @author Wichit Wongta
 */
import type { Draft } from 'immer';
import type { AppState } from './app-state';
import type { AppStore } from './store';

// ─── Types ───

export type DispatchRecipe = (draft: Draft<AppState>) => void;

export interface MiddlewareAPI {
  getState: () => Readonly<AppState>;
  dispatch: (recipe: DispatchRecipe) => void;
}

export type Middleware = (
  api: MiddlewareAPI,
) => (next: (recipe: DispatchRecipe) => void) => (recipe: DispatchRecipe) => void;

// ─── Apply Middleware ───

/**
 * Apply middleware chain to the store's dispatch method.
 * Returns a cleanup function.
 *
 * @example
 *   const cleanup = applyMiddleware(store, [historyMiddleware, loggingMiddleware]);
 */
export function applyMiddleware(
  store: AppStore,
  middlewares: Middleware[],
): () => void {
  const originalDispatch = store.dispatch.bind(store);

  const api: MiddlewareAPI = {
    getState: () => store.state,
    dispatch: (recipe) => store.dispatch(recipe),
  };

  // Build middleware chain (right-to-left)
  const chain = middlewares.map((mw) => mw(api));
  const enhancedDispatch = chain.reduceRight(
    (next, mw) => mw(next),
    originalDispatch,
  );

  store.dispatch = enhancedDispatch;

  // Cleanup: restore original dispatch
  return () => {
    store.dispatch = originalDispatch;
  };
}

// ─── Action Tagging ───

/**
 * Tagged recipe carries metadata alongside the mutation.
 * Components use tagAction() to annotate dispatches.
 */
export interface TaggedRecipe {
  (draft: Draft<AppState>): void;
  __pld_tag?: ActionTag;
}

export interface ActionTag {
  /** Human-readable action name (for debugging) */
  name: string;
  /** Whether this action should be recorded in undo history */
  undoable: boolean;
  /** Optional: group rapid successive calls into one history entry */
  batchKey?: string;
}

/**
 * Tag a dispatch recipe with metadata.
 *
 * @example
 *   store.dispatch(tagAction(d => { d.zoom = 150; }, { name: 'setZoom', undoable: false }));
 */
export function tagAction(
  recipe: DispatchRecipe,
  tag: ActionTag,
): TaggedRecipe {
  const tagged = recipe as TaggedRecipe;
  tagged.__pld_tag = tag;
  return tagged;
}

/**
 * Read tag from a recipe (returns undefined if untagged).
 */
export function getActionTag(recipe: DispatchRecipe): ActionTag | undefined {
  return (recipe as TaggedRecipe).__pld_tag;
}

// ─── Non-undoable action names ───
// These actions are UI-only state changes that should NOT create history entries.

export const NON_UNDOABLE_ACTIONS = new Set([
  'setZoom',
  'zoomIn',
  'zoomOut',
  'resetZoom',
  'switchView',
  'setCurrentPage',
  'nextPage',
  'prevPage',
  'selectElement',
  'toggleMultiSelect',
  'clearMultiSelect',
  'showContextMenu',
  'hideContextMenu',
  'setGridEnabled',
  'setGridSize',
  'setSnapToGrid',
  'setShowRulers',
  'setShowGuides',
  'markTemplateClean',
]);

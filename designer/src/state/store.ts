/**
 * Reactive Store
 * Centralized state management using Lit Context and Immer for immutable updates.
 *
 * Usage in components:
 *   @consume({ context: storeContext, subscribe: true })
 *   private store!: AppStore;
 *
 * @author Wichit Wongta
 */
import { createContext } from '@lit/context';
import { produce, type Draft } from 'immer';
import type { AppState } from './app-state';
import { createDefaultPage } from '../models/page';
import { createDefaultPagination } from '../models/template';

// ─── Context key ───
export const storeContext = createContext<AppStore>('pld-store');

// ─── Initial State ───
function createInitialState(): AppState {
  return {
    elements: [],
    bands: [],
    selectedId: null,
    multiSelect: [],
    zoom: 100,
    clipboard: [],

    page: createDefaultPage(),

    jsonData: null,
    jsonKeys: [],

    pagination: createDefaultPagination(),
    currentPage: 1,
    totalPages: 1,

    template: {
      id: null,
      name: 'Untitled Template',
      isDirty: false,
    },

    view: 'design',
    dragType: null,
    isExporting: false,

    grid: {
      enabled: true,
      size: 10,
      snapToGrid: false,
      showRulers: true,
      showGuides: true,
    },

    contextMenu: {
      show: false,
      x: 0,
      y: 0,
      elementId: null,
    },
  };
}

// ─── State Change Event ───
export class StateChangedEvent extends Event {
  readonly state: Readonly<AppState>;

  constructor(state: AppState) {
    super('state-changed', { bubbles: false });
    this.state = state;
  }
}

// ─── Store Class ───
export class AppStore extends EventTarget {
  private _state: AppState;

  constructor() {
    super();
    this._state = createInitialState();
  }

  /** Read-only access to current state */
  get state(): Readonly<AppState> {
    return this._state;
  }

  /**
   * Dispatch a state mutation using Immer.
   * The draft is mutable — Immer produces a new immutable state.
   *
   * @example
   *   store.dispatch(draft => {
   *     draft.zoom = 150;
   *     draft.selectedId = 'abc';
   *   });
   */
  dispatch(recipe: (draft: Draft<AppState>) => void): void {
    const prev = this._state;
    this._state = produce(this._state, recipe);

    // Only fire event if state actually changed
    if (this._state !== prev) {
      this.dispatchEvent(new StateChangedEvent(this._state));
    }
  }

  /**
   * Select a slice of state.
   *
   * @example
   *   const zoom = store.select(s => s.zoom);
   */
  select<T>(selector: (state: Readonly<AppState>) => T): T {
    return selector(this._state);
  }

  /** Reset state to initial defaults */
  reset(): void {
    this._state = createInitialState();
    this.dispatchEvent(new StateChangedEvent(this._state));
  }

  /**
   * Replace entire state (for loading templates).
   * Use sparingly — prefer dispatch() for granular updates.
   */
  replaceState(newState: AppState): void {
    this._state = newState;
    this.dispatchEvent(new StateChangedEvent(this._state));
  }
}

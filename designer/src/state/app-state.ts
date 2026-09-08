/**
 * Application State Definition
 * Single source of truth for the entire application.
 *
 * @author Wichit Wongta
 */
import type { CanvasElement, ElementRoleType } from '../models/element';
import type { Band } from '../models/bands';
import type { PageConfig } from '../models/page';
import type { PaginationConfig } from '../models/template';

export interface GridConfig {
  enabled: boolean;
  size: number;       // grid cell size in px
  snapToGrid: boolean;
  showRulers: boolean;
  showGuides: boolean; // snap alignment guides
}

/**
 * Where a copied element sat in the band structure (#135). Recorded at copy/cut
 * time so paste can put the clone back in the same cell — which makes cut→paste
 * a real move instead of dropping an orphan into the element pool.
 */
export interface ClipboardOrigin {
  role: ElementRoleType;
  rowIdx: number;
  colIdx: number;
  /** Position of the element inside that cell's elementIds at copy time. */
  index: number;
}

/**
 * One clipboard entry (#135) — the element plus where it came from.
 * `origin` is absent when the source element had no band cell at all (legacy or
 * pool-only state); paste then falls back to the element's own role band.
 */
export interface ClipboardEntry {
  el: CanvasElement;
  origin?: ClipboardOrigin;
}

export interface AppState {
  // ─── Canvas ───
  elements: CanvasElement[];
  /** Band-mode layout (#13/#47). Regenerated from `elements` on band-mode entry;
   *  edited directly by band actions; read by the band-mode export path. Empty
   *  until band mode is entered. `elements` remains the source of truth for the
   *  production canvas + element-path export until cutover. */
  bands: Band[];
  selectedId: string | null;
  multiSelect: string[];
  zoom: number;
  clipboard: ClipboardEntry[];

  // ─── Page ───
  page: PageConfig;

  // ─── Data Source ───
  jsonData: Record<string, unknown> | null;
  /** Copy set (#92) — null = engine default per rectype */
  copies: import('../models/template').TemplateCopy[] | null;
  jsonKeys: string[];

  // ─── Pagination ───
  pagination: PaginationConfig;
  currentPage: number;
  totalPages: number;

  // ─── Template ───
  template: {
    id: string | null;
    name: string;
    isDirty: boolean;
    nsMetadata?: { rectype: string; isDefault: boolean };
  };

  // ─── UI State ───
  view: 'design' | 'flow';
  dragType: string | null;
  isExporting: boolean;

  // ─── Grid & Guides ───
  grid: GridConfig;

  // ─── Context Menu ───
  contextMenu: {
    show: boolean;
    x: number;
    y: number;
    elementId: string | null;
  };
}

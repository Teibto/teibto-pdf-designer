/**
 * Application State Definition
 * Single source of truth for the entire application.
 *
 * @author Wichit Wongta
 */
import type { CanvasElement } from '../models/element';
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
  clipboard: CanvasElement[];

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

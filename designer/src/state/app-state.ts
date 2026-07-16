/**
 * Application State Definition
 * Single source of truth for the entire application.
 *
 * @author Wichit Wongta
 */
import type { CanvasElement } from '../models/element';
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
  selectedId: string | null;
  multiSelect: string[];
  zoom: number;
  clipboard: CanvasElement[];

  // ─── Page ───
  page: PageConfig;

  // ─── Data Source ───
  jsonData: Record<string, unknown> | null;
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

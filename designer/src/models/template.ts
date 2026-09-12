/**
 * Template Data Model
 * Represents a saveable/loadable document template.
 *
 * @author Wichit Wongta
 */
import type { CanvasElement } from './element';
import type { Band } from './bands';
import type { PageConfig } from './page';

export interface PaginationConfig {
  mode: 'rows' | 'height';
  rowsPerPage: number;
  baseRowHeight: number;
  lineHeightPx: number;
  showContinuationHeader: boolean;

  // ─── Advanced Layout Controls ───

  /** Minimum rows allowed on the last page (orphan) or first continuation page (widow).
   *  If a page break would leave fewer rows, it pulls/pushes rows to maintain this minimum.
   *  Set 0 to disable. Default: 2 */
  orphanWidowMinRows: number;

  /** Summary element page break behavior.
   *  - 'auto': summary shares last page if it fits, otherwise breaks to new page
   *  - 'always': summary always starts on a fresh page (formal documents)
   *  - 'samePage': never break, always on same page as last table rows
   *  Default: 'auto' */
  summaryBreak: 'auto' | 'always' | 'samePage';

  /** When true, footer & summary elements are repositioned relative to where
   *  the table content actually ends on each page, eliminating large gaps.
   *  Default: true */
  /** @deprecated no-op since #107 — the sim preview is band-flow, so a footer
   *  follows the table naturally (same as BFO print). Kept for saved-template
   *  compatibility only. */
  dynamicFooter?: boolean;

  /** Spacing in pt between table end and the first summary/footer element.
   *  Only effective when dynamicFooter is true. Default: 16
   *  @deprecated no-op since #107 (see dynamicFooter). */
  dynamicFooterGap?: number;

  // ─── Page Break Controls (v2.2) ───

  /** Force page break before these row indices (0-based).
   *  E.g., [5, 15] forces a break before row 5 and row 15.
   *  Empty array = disabled. */
  forceBreakBeforeRows: number[];

  /** Group rows by this data field — rows sharing the same value won't be
   *  split across pages (keep-together). The engine treats each group as
   *  an atomic block during bin-packing.
   *  Empty string = disabled. */
  keepTogetherField: string;

  /** Header element visibility mode.
   *  - 'all': header role visible on every page (default)
   *  - 'firstOnly': header role visible only on first page
   *  - 'firstLast': header role visible on first + last page only */
  headerMode: 'all' | 'firstOnly' | 'firstLast';

  /** Data field name for full-width column-span rows.
   *  When this field is truthy in a data row, that row renders as a single
   *  merged cell spanning all visible columns (section headers, subtotals).
   *  Empty string = disabled. */
  columnSpanField: string;

  /** Pad the item table with empty rows so the printed row count is a
   *  multiple of rowsPerPage — keeps the table box a constant height and
   *  anchors the summary block on the last page (#84). Requires
   *  rowsPerPage > 0. Default: false (optional for legacy templates). */
  fillLastPage?: boolean;

  /** Section subtotal (#106): emit a bold subtotal row at the end of every
   *  section (rows delimited by columnSpanField headers), summing the columns
   *  flagged TableColumn.subtotal. Requires columnSpanField. Default: false. */
  sectionSubtotal?: boolean;

  /** Label printed in the first non-summed cell of a subtotal row (#106).
   *  Empty/unset = "รวม". */
  sectionSubtotalLabel?: string;
}

/** One printed copy of the document (#92) — e.g. ต้นฉบับ/Original */
export interface TemplateCopy {
  th: string;
  en: string;
}

export interface DocumentTemplate {
  /** Unique template ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Template version for migration */
  version: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;

  /** Page configuration */
  page: PageConfig;
  /** Pagination settings */
  pagination: PaginationConfig;
  /** Canvas elements */
  elements: CanvasElement[];
  /**
   * Band layout structure (#13/#47). Optional during the transition: sample
   * templates carry it; legacy element-only templates omit it and regenerate it
   * from elements on load (elementsToBands). Bands reference elements by id and
   * hold the row/column widths — the layout source once the free canvas retires.
   */
  bands?: Band[];
  /** Copy set (#92): one PDF section per entry (ต้นฉบับ/สำเนา/...). Unset =
   *  engine default (invoice → ต้นฉบับ+สำเนา, others → single copy). */
  copies?: TemplateCopy[];
  /** Bound JSON data (optional) */
  jsonData?: Record<string, unknown> | null;
  /** Explicit editing mode for locally persisted/recovered canonical XML. */
  editorMode?: 'visual' | 'xml';
  /** Canonical BFO/FreeMarker source, preserved byte-for-byte in XML mode. */
  rawXml?: string;
}

/** Default pagination config */
export function createDefaultPagination(): PaginationConfig {
  return {
    mode: 'rows',
    rowsPerPage: 10,
    baseRowHeight: 24,
    lineHeightPx: 18,
    showContinuationHeader: true,
    orphanWidowMinRows: 2,
    summaryBreak: 'auto',
    forceBreakBeforeRows: [],
    keepTogetherField: '',
    headerMode: 'all',
    columnSpanField: '',
    fillLastPage: false,
    sectionSubtotal: false,
    sectionSubtotalLabel: '',
  };
}

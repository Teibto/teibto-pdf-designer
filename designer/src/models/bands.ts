/**
 * Band Layout Model (#13 / #44)
 *
 * Band-based layout maps 1:1 to BFO semantics: a document is an ordered stack of
 * bands (= the 6 element roles), each band a stack of rows, each row a set of
 * columns with percentage widths. Horizontal placement comes from column width
 * (which BFO honors via <td width="%">), vertical from row order (BFO flow) —
 * so "what you design = what BFO prints".
 *
 * This module is ADDITIVE (#44): it defines the types + a one-time migration from
 * the current free-canvas model. It does NOT yet make bands authoritative or
 * remove element x/y — that flip is gated on the big-bang decision (#13 §7 Q1).
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
import type { ElementRoleType } from './element';

/** One cell in a row — a percentage-width column holding stacked elements. */
export interface BandColumn {
  id: string;
  /** Column width as a percent of the row (columns in a row sum to 100). */
  widthPct: number;
  /**
   * Ids of the elements stacked top-to-bottom in this cell (#49 model B).
   * Bands hold only structure + id references; element properties live on the
   * shared `state.elements`, so the existing property panel edits reach band
   * mode for free. Resolve an id → element via `state.elements` at read time.
   */
  elementIds: string[];
}

/** A horizontal row inside a band — one or more columns. */
export interface BandRow {
  id: string;
  columns: BandColumn[];
  /**
   * Row height in pt (#107) — bands own vertical geometry. elementsToBands
   * assigns each row its y-slice (this row's top up to the next row's top,
   * unrounded) so Σ heights over a band equals the legacy element bbox and
   * header/footer macro heights stay byte-identical. Absent on rows saved
   * before #107 and on rows added in the band editor: the exporter then falls
   * back (whole-band bbox when NO row has a height; per-row content estimate
   * when only some do).
   */
  height?: number;
}

/** A band = one role's region, an ordered stack of rows. */
export interface Band {
  role: ElementRoleType;
  rows: BandRow[];
}

/**
 * Fixed vertical order of bands in the document (BFO flow order).
 * Matches the section order in bfo-export.service.ts buildBfoBody.
 */
export const BAND_ORDER: readonly ElementRoleType[] = [
  'header',
  'content',
  'table',
  'summary',
  'footer',
  'watermark',
] as const;

/**
 * Band Layout migration (#13 / #44)
 *
 * One-time, best-effort migration from the free-canvas model (absolute x/y) to the
 * band model. Row grouping and column widths are NOT recoverable from flat x/y with
 * certainty, so this is lossy-by-design: it produces a reasonable starting layout
 * that a consultant then adjusts (per docs/design/BAND-LAYOUT-MODEL.md §5).
 *
 * ADDITIVE only (#44): nothing here mutates existing state or makes bands
 * authoritative. `bandsToElements` is the inverse read-model used during the
 * transition until the big-bang flip (#13 §7 Q1).
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
import type { CanvasElement } from '../models/element';
import { BAND_ORDER, type Band, type BandRow, type BandColumn } from '../models/bands';

/**
 * Migrate free-canvas elements into bands.
 * @param elements   canvas elements (each carries role + x/y/w/h)
 * @param contentWidth  page content width in the same units as element x/w
 *                      (reserved for future absolute-gap heuristics; row widths
 *                      are normalized to 100% today)
 */
export function elementsToBands(
  elements: readonly CanvasElement[],
  contentWidth?: number,
): Band[] {
  void contentWidth; // reserved — see docstring
  const bands: Band[] = [];

  for (const role of BAND_ORDER) {
    const inRole = elements.filter((e) => e.role === role);
    if (inRole.length === 0) continue;

    const rows = groupIntoRows(inRole);
    // y-slice partition (#107): each row's height spans its top up to the next
    // row's top (last row: to the role bbox bottom), UNROUNDED — the heights
    // telescope, so Σ heights === bbox and macro heights derived from bands
    // stay byte-identical to the legacy element-bbox math.
    const tops = rows.map((r) => Math.min(...r.map((e) => e.y ?? 0)));
    const bottom = Math.max(...inRole.map((e) => (e.y ?? 0) + e.h));
    bands.push({
      role,
      rows: rows.map((rowEls, ri) => {
        const sliceEnd = ri + 1 < rows.length ? tops[ri + 1] : bottom;
        return buildRow(role, ri, rowEls, Math.max(sliceEnd - tops[ri], 1));
      }),
    });
  }

  return bands;
}

/**
 * Group elements (one role) into rows by vertical overlap: elements whose
 * y-ranges overlap the current row belong to the same row; a clear vertical gap
 * starts a new row. Deterministic (sorted by y, then x).
 */
function groupIntoRows(els: readonly CanvasElement[]): CanvasElement[][] {
  const sorted = [...els].sort((a, b) => ((a.y ?? 0) - (b.y ?? 0)) || ((a.x ?? 0) - (b.x ?? 0)));
  const rows: CanvasElement[][] = [];
  let current: CanvasElement[] = [];
  let rowBottom = -Infinity;

  for (const el of sorted) {
    const y = el.y ?? 0;
    if (current.length === 0 || y < rowBottom) {
      current.push(el);
      rowBottom = Math.max(rowBottom, y + el.h);
    } else {
      rows.push(current);
      current = [el];
      rowBottom = y + el.h;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/** Build a row: sort its elements left-to-right, one column each, widths → 100%. */
function buildRow(role: string, ri: number, rowEls: CanvasElement[], height: number): BandRow {
  const ordered = [...rowEls].sort((a, b) => ((a.x ?? 0) - (b.x ?? 0)) || ((a.y ?? 0) - (b.y ?? 0)));
  const widths = normalizeWidths(ordered.map((e) => e.w));

  const columns: BandColumn[] = ordered.map((el, ci) => ({
    id: `${role}-r${ri}-c${ci}`,
    widthPct: widths[ci],
    elementIds: [el.id],
  }));

  return { id: `${role}-r${ri}`, columns, height };
}

/**
 * Distribute integer percentages proportional to widths, summing to exactly 100.
 * Largest-remainder rounding; the largest column absorbs any leftover.
 */
export function normalizeWidths(widths: number[]): number[] {
  const n = widths.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const total = widths.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) {
    // no meaningful widths — split evenly, remainder to first
    const base = Math.floor(100 / n);
    const out = Array(n).fill(base);
    out[0] += 100 - base * n;
    return out;
  }

  const raw = widths.map((w) => (Math.max(0, w) / total) * 100);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = 100 - floored.reduce((s, v) => s + v, 0);

  // hand out the remaining points to the largest fractional parts
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    floored[order[k].i] += 1;
  }
  return floored;
}

/**
 * Set one column to `targetPct` and redistribute the rest of the row so widths
 * still sum to 100 (#47 band editing). The target is clamped to [5, 95] so no
 * column collapses; remaining width is shared among the other columns in
 * proportion to their current widths. Returns new integer widths (sum 100).
 */
export function redistributeRowWidths(
  widths: number[],
  colIdx: number,
  targetPct: number,
): number[] {
  const n = widths.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const target = Math.max(5, Math.min(95, Math.round(targetPct)));
  const remaining = 100 - target;

  const otherW = widths.map((w, i) => (i === colIdx ? 0 : Math.max(1, w)));
  const otherSum = otherW.reduce((s, w) => s + w, 0);

  const raw = widths.map((_w, i) =>
    i === colIdx ? target : (otherSum > 0 ? (otherW[i] / otherSum) * remaining : remaining / (n - 1)),
  );

  // integer, keeping the target exact; largest-remainder on the other columns
  const out = raw.map((r) => Math.floor(r));
  out[colIdx] = target;
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .filter((o) => o.i !== colIdx)
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k].i] += 1;
  return out;
}

/**
 * Flatten bands back to a plain element list (band → row → column order), in
 * document order. Bands store element ids (#49 model B), so ids are resolved
 * against `elements`; an id with no matching element is skipped (a stale ref,
 * e.g. an element deleted on the free canvas). Read-model for the transition.
 */
export function bandsToElements(
  bands: readonly Band[],
  elements: readonly CanvasElement[],
): CanvasElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: CanvasElement[] = [];
  for (const band of bands) {
    for (const row of band.rows) {
      for (const col of row.columns) {
        for (const id of col.elementIds) {
          const el = byId.get(id);
          if (el) out.push(el);
        }
      }
    }
  }
  return out;
}

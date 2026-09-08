/**
 * Pagination Engine v3.2
 * Computes multi-page layout based on table data and element roles.
 *
 * Features:
 *   - Row-based: fixed number of rows per page
 *   - Height-based: auto-calculate rows that fit given element heights
 *   - Orphan/Widow control: ensures minimum rows on first/last pages
 *   - Summary page break: 'auto' | 'always' | 'samePage'
 *   - Dynamic footer: repositions footer/summary relative to table end
 *   - Manual page breaks: force break before specific row indices
 *   - Keep-together groups: prevent row groups from splitting across pages
 *   - Header mode: first-only / first+last / all pages
 *   - Column span: full-width merged rows for section headers/subtotals
 *
 * v3.1 fixes:
 *   - [PERF-1] hashJsonContent optimised to O(1) fingerprint
 *   - [PERF-2] shouldForceBreak uses Set for O(1) lookup
 *   - [CALC-2] fixedHeight respects headerMode via getFixedHeight()
 *   - [CALC-3] applySummaryBreak uses actual rowHeights
 *   - [CALC-4] forceBreak inside group logs console.warn
 *   - [FLOW-1] applyOrphanWidow respects group boundaries
 *   - [FLOW-2] finalizePagination state param now required
 *
 * v3.2 fixes:
 *   - [PERF-3] buildRowGroups uses lazy IdentityRowGroups (no N-object alloc)
 *
 * @author Wichit Wongta
 */
import type { AppState } from '../state/app-state';
import type { AppStore } from '../state/store';
import type { CanvasElement, TableElement } from '../models/element';
import { ELEMENT_ROLES } from '../constants/roles';
import { resolveBinding } from './binding.service';
import { calculateRowHeight } from '../utils/text-measure';

// ═══════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════

/** Result of pagination computation */
export interface PaginationResult {
  totalPages: number;
  totalRows: number;
  pagesData: PageData[];
}

/** Data for a single page */
export interface PageData {
  pageNumber: number;
  elements: PageElement[];
  tableRowStart: number;
  tableRowEnd: number;
  isContinuation: boolean;
  /** Whether this page is a dedicated summary page (no table rows) */
  isSummaryPage: boolean;
  /** Row indices (absolute, 0-based) that should render as full-width column span.
   *  Only populated when columnSpanField is configured. */
  columnSpanRows: number[];
}

/** Element with page-specific adjustments */
export interface PageElement {
  element: CanvasElement;
  visible: boolean;
  /** For tables: which rows to display on this page */
  rowSlice?: { start: number; end: number };
}

// ═══════════════════════════════════════
// CACHE — complete immutable inputs, never sampled document content
// ═══════════════════════════════════════

type PaginationInputs = Pick<AppState, 'elements' | 'pagination' | 'page' | 'jsonData'>;
let _cache: {
  inputs: PaginationInputs;
  mutableKey: string | null;
  result: PaginationResult;
} | null = null;

// Immer freezes the store's input branches. Reference equality detects every
// edit while keeping UI-only selection/zoom cache hits O(1). Mutable callers
// use a complete key: sampling rows or truncating text can return stale pages.
function paginationInputs(state: Readonly<AppState>): PaginationInputs {
  return { elements: state.elements, pagination: state.pagination, page: state.page, jsonData: state.jsonData };
}

// ═══════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════

export function computePagination(state: Readonly<AppState>): PaginationResult {
  const inputs = paginationInputs(state);
  const immutable = Object.values(inputs).every((value) => value === null || Object.isFrozen(value));
  const mutableKey = immutable ? null : JSON.stringify(inputs);
  if (_cache && (immutable
    ? _cache.mutableKey === null && _cache.inputs.elements === inputs.elements &&
      _cache.inputs.pagination === inputs.pagination && _cache.inputs.page === inputs.page &&
      _cache.inputs.jsonData === inputs.jsonData
    : _cache.mutableKey === mutableKey)) return _cache.result;

  const result =
    state.pagination.mode === 'rows'
      ? computeRowBased(state)
      : computeHeightBased(state);

  _cache = { inputs, mutableKey, result };
  return result;
}

export function clearPaginationCache(): void {
  _cache = null;
}

export function applyPagination(store: AppStore): void {
  const result = computePagination(store.state);
  store.dispatch((draft) => {
    draft.totalPages = result.totalPages;
  });
}

// ═══════════════════════════════════════
// ROW-BASED PAGINATION
// ═══════════════════════════════════════

function computeRowBased(state: Readonly<AppState>): PaginationResult {
  const { elements, pagination, jsonData } = state;
  const rowsPerPage = pagination.rowsPerPage || 10;
  const minRows = pagination.orphanWidowMinRows ?? 2;

  const { totalRows, rows } = getTableData(elements, jsonData);

  if (totalRows === 0) {
    return {
      totalPages: 1,
      totalRows: 0,
      pagesData: [buildPage(1, state, 0, 0, false, false, rows)],
    };
  }

  // Build groups (atomic blocks that can't be split)
  const groups = buildRowGroups(rows, pagination);

  // [PERF-2] Pre-build forceBreak set for O(1) lookups
  const forceBreakSet = new Set(pagination.forceBreakBeforeRows ?? []);

  // [CALC-4] Warn about force breaks inside groups
  warnForceBreakInsideGroups(forceBreakSet, groups);

  // Build initial page ranges respecting groups
  let ranges: { start: number; end: number }[] = [];
  let currentCount = 0;
  let rangeStart = 0;

  for (const group of groups) {
    // Force break before this group's first row?
    if (forceBreakSet.has(group.start) && group.start > rangeStart) {
      ranges.push({ start: rangeStart, end: group.start });
      rangeStart = group.start;
      currentCount = 0;
    }

    if (currentCount + group.count > rowsPerPage && currentCount > 0) {
      ranges.push({ start: rangeStart, end: group.start });
      rangeStart = group.start;
      currentCount = 0;
    }

    currentCount += group.count;
  }
  if (rangeStart < totalRows) {
    ranges.push({ start: rangeStart, end: totalRows });
  }

  // [FLOW-1] Apply orphan/widow control — pass groups for boundary-aware snapping
  ranges = applyOrphanWidow(ranges, totalRows, minRows, groups);

  // Apply summary page break
  ranges = applySummaryBreak(ranges, state, totalRows);

  const pagesData = ranges.map((range, idx) =>
    buildPage(idx + 1, state, range.start, range.end, idx > 0, range.start === range.end, rows),
  );

  return {
    totalPages: pagesData.length,
    totalRows,
    pagesData,
  };
}

// ═══════════════════════════════════════
// HEIGHT-BASED PAGINATION
// ═══════════════════════════════════════

function computeHeightBased(state: Readonly<AppState>): PaginationResult {
  const { elements, pagination, page, jsonData } = state;
  const minRows = pagination.orphanWidowMinRows ?? 2;

  const pageHeight = page.height;

  // [CALC-2] Use headerMode-aware fixed height
  const fixedHeightFirst = getFixedHeight(elements, pagination, true, true);
  const fixedHeightCont = getFixedHeight(elements, pagination, false, false);

  const availableHeightFirst = pageHeight - fixedHeightFirst - 80; // 80pt margin
  const availableHeightCont = pageHeight - fixedHeightCont - 80;
  const baseRowHeight = pagination.baseRowHeight || 24;
  const lineHeightPt = pagination.lineHeightPx || 18;

  // Find the table element and its data rows
  const tableEl = elements.find(
    (el): el is TableElement => el.type === 'table' && el.role === 'table' && !!el.binding,
  ) as TableElement | undefined;

  const { totalRows, rows } = getTableData(elements, jsonData);

  if (totalRows === 0) {
    return {
      totalPages: 1,
      totalRows: 0,
      pagesData: [buildPage(1, state, 0, 0, false, false, rows)],
    };
  }

  // Pre-compute row heights
  const TABLE_HEADER_HEIGHT = baseRowHeight + 4;
  const baseFontSize = 8;
  const columns = tableEl ? tableEl.columns : [];

  const rowHeights: number[] = rows.map((row) =>
    tableEl
      ? calculateRowHeight(row, columns, baseFontSize, baseRowHeight, lineHeightPt)
      : baseRowHeight,
  );

  // Build groups (atomic blocks)
  const groups = buildRowGroups(rows, pagination);

  // [PERF-2] Pre-build forceBreak set
  const forceBreakSet = new Set(pagination.forceBreakBeforeRows ?? []);

  // [CALC-4] Warn about force breaks inside groups
  warnForceBreakInsideGroups(forceBreakSet, groups);

  // Variable-height bin packing respecting groups + force breaks
  let ranges: { start: number; end: number }[] = [];
  let currentHeight = TABLE_HEADER_HEIGHT;
  let rangeStart = 0;
  let isFirstRange = true;

  for (const group of groups) {
    // [CALC-2] Use correct available height per page
    const availableHeight = isFirstRange ? availableHeightFirst : availableHeightCont;

    // Force break before this group?
    if (forceBreakSet.has(group.start) && group.start > rangeStart) {
      ranges.push({ start: rangeStart, end: group.start });
      rangeStart = group.start;
      currentHeight = pagination.showContinuationHeader ? TABLE_HEADER_HEIGHT : 0;
      isFirstRange = false;
    }

    // Calculate group's total height
    let groupHeight = 0;
    for (let i = group.start; i < group.end; i++) {
      groupHeight += rowHeights[i];
    }

    // Would adding this group exceed available height?
    if (currentHeight + groupHeight > availableHeight && group.start > rangeStart) {
      ranges.push({ start: rangeStart, end: group.start });
      rangeStart = group.start;
      currentHeight = pagination.showContinuationHeader ? TABLE_HEADER_HEIGHT + groupHeight : groupHeight;
      isFirstRange = false;
    } else {
      currentHeight += groupHeight;
    }
  }
  if (rangeStart < totalRows) {
    ranges.push({ start: rangeStart, end: totalRows });
  }

  // [FLOW-1] Apply orphan/widow control — pass groups
  ranges = applyOrphanWidow(ranges, totalRows, minRows, groups);

  // [CALC-3] Apply summary page break (pass rowHeights for accurate space calculation)
  ranges = applySummaryBreak(ranges, state, totalRows, rowHeights);

  const pagesData = ranges.map((range, idx) =>
    buildPage(idx + 1, state, range.start, range.end, idx > 0, range.start === range.end, rows),
  );

  return {
    totalPages: pagesData.length,
    totalRows,
    pagesData,
  };
}

// ═══════════════════════════════════════
// FIXED HEIGHT CALCULATION
// ═══════════════════════════════════════

/**
 * [CALC-2] Calculate fixed element heights considering headerMode for a given page context.
 */
function getFixedHeight(
  elements: readonly CanvasElement[],
  pagination: Readonly<AppState['pagination']>,
  isFirstPage: boolean,
  isLastPage: boolean,
): number {
  const headerMode = pagination.headerMode ?? 'all';
  let h = 0;
  for (const el of elements) {
    const role = ELEMENT_ROLES[el.role];
    if (!role.repeatOnAllPages || el.role === 'table') continue;

    if (el.role === 'header') {
      if (headerMode === 'all') h += el.h;
      else if (headerMode === 'firstOnly' && isFirstPage) h += el.h;
      else if (headerMode === 'firstLast' && (isFirstPage || isLastPage)) h += el.h;
    } else {
      h += el.h;
    }
  }
  return h;
}

// ═══════════════════════════════════════
// ORPHAN / WIDOW CONTROL
// ═══════════════════════════════════════

/**
 * Ensure no page has fewer than minRows of table data.
 *
 * [FLOW-1] When groups are provided, adjustments snap to group boundaries
 * to prevent splitting keep-together groups.
 */
function applyOrphanWidow(
  ranges: { start: number; end: number }[],
  _totalRows: number,
  minRows: number,
  groups?: RowGroup[],
): { start: number; end: number }[] {
  if (minRows <= 0 || ranges.length <= 1) return ranges;

  // Build set of valid split points (group boundaries)
  const validSplits = new Set<number>();
  if (groups && groups.length > 0) {
    for (const g of groups) {
      validSplits.add(g.start);
    }
  }

  const result = ranges.map((r) => ({ ...r }));

  // Fix orphan: last page has fewer than minRows
  const last = result[result.length - 1];
  const lastRowCount = last.end - last.start;

  if (lastRowCount > 0 && lastRowCount < minRows && result.length >= 2) {
    const prev = result[result.length - 2];
    const prevRowCount = prev.end - prev.start;
    const deficit = minRows - lastRowCount;

    const targetSplit = prev.end - deficit;
    const snappedSplit = snapToGroupBoundary(targetSplit, validSplits, prev.start);
    const pullAmount = prev.end - snappedSplit;

    if (pullAmount > 0 && prevRowCount - pullAmount >= minRows) {
      prev.end = snappedSplit;
      last.start = snappedSplit;
    } else if (prevRowCount > minRows) {
      const maxPull = prevRowCount - minRows;
      const altTarget = prev.end - maxPull;
      const altSnap = snapToGroupBoundary(altTarget, validSplits, prev.start);
      const altPull = prev.end - altSnap;
      if (altPull > 0) {
        prev.end = altSnap;
        last.start = altSnap;
      }
    }
    const newLastCount = last.end - last.start;
    const newPrevCount = prev.end - prev.start;
    if (newLastCount < minRows && newPrevCount + newLastCount <= (ranges[0].end - ranges[0].start) * 1.5) {
      prev.end = last.end;
      result.pop();
    }
  }

  // Fix widow: each continuation page (index >= 1) must have >= minRows
  for (let i = 1; i < result.length; i++) {
    const page = result[i];
    const pageRowCount = page.end - page.start;

    if (pageRowCount > 0 && pageRowCount < minRows && i > 0) {
      const prev = result[i - 1];
      const prevRowCount = prev.end - prev.start;
      const deficit = minRows - pageRowCount;

      const targetSplit = prev.end - deficit;
      const snappedSplit = snapToGroupBoundary(targetSplit, validSplits, prev.start);
      const pullAmount = prev.end - snappedSplit;

      if (pullAmount > 0 && prevRowCount - pullAmount >= minRows) {
        prev.end = snappedSplit;
        page.start = snappedSplit;
      }
    }
  }

  return result.filter((r) => r.end > r.start || (r.start === r.end));
}

/**
 * Snap a target row index to the nearest valid group boundary.
 * Returns the closest boundary that is <= target and >= rangeMin.
 * Falls back to target if no groups defined.
 */
function snapToGroupBoundary(
  target: number,
  validSplits: Set<number>,
  rangeMin: number,
): number {
  if (validSplits.size === 0) return target;

  let best = target;
  let bestDist = Infinity;
  for (const split of validSplits) {
    if (split >= rangeMin && split <= target) {
      const dist = target - split;
      if (dist < bestDist) {
        bestDist = dist;
        best = split;
      }
    }
  }
  if (bestDist === Infinity) {
    for (const split of validSplits) {
      if (split > target && split > rangeMin) {
        const dist = split - target;
        if (dist < bestDist) {
          bestDist = dist;
          best = split;
        }
      }
    }
  }
  return best;
}

// ═══════════════════════════════════════
// SUMMARY PAGE BREAK
// ═══════════════════════════════════════

/**
 * [CALC-3] Uses actual rowHeights when available instead of baseRowHeight.
 */
function applySummaryBreak(
  ranges: { start: number; end: number }[],
  state: Readonly<AppState>,
  totalRows: number,
  rowHeights?: number[],
): { start: number; end: number }[] {
  const summaryBreak = state.pagination.summaryBreak ?? 'auto';
  if (summaryBreak === 'samePage' || ranges.length === 0) return ranges;

  const summaryElements = state.elements.filter((el) => el.role === 'summary');
  if (summaryElements.length === 0) return ranges;

  if (summaryBreak === 'always') {
    return [...ranges, { start: totalRows, end: totalRows }];
  }

  // 'auto': check if summary fits on last page
  const summaryTotalHeight = summaryElements.reduce((sum, el) => sum + el.h, 0);
  const pageHeight = state.page.height;
  const lastRange = ranges[ranges.length - 1];
  const baseRowHeight = state.pagination.baseRowHeight || 24;

  // [CALC-2] Use headerMode-aware fixed height
  const isFirstPage = ranges.length === 1;
  const fixedHeight = getFixedHeight(state.elements, state.pagination, isFirstPage, true);

  const gap = state.pagination.dynamicFooterGap ?? 16;
  const tableHeaderH = baseRowHeight + 4;

  // [CALC-3] Use actual row heights when available
  let tableContentH: number;
  if (rowHeights && rowHeights.length > 0) {
    tableContentH = 0;
    for (let i = lastRange.start; i < lastRange.end; i++) {
      tableContentH += rowHeights[i] ?? baseRowHeight;
    }
  } else {
    tableContentH = (lastRange.end - lastRange.start) * baseRowHeight;
  }

  const estimatedTableHeight = tableHeaderH + tableContentH;
  const usedHeight = fixedHeight + estimatedTableHeight + gap + 80;
  const remainingHeight = pageHeight - usedHeight;

  if (remainingHeight < summaryTotalHeight) {
    return [...ranges, { start: totalRows, end: totalRows }];
  }

  return ranges;
}

// ═══════════════════════════════════════
// PAGE BUILDING
// ═══════════════════════════════════════

/**
 * Build one page's element visibility + row slice. Layout is band-flow (#107):
 * the sim preview stacks bands in order, so the old y-based tableEndY /
 * dynamic-footer reposition machinery is gone — a footer after the table in
 * flow follows it naturally, same as BFO print.
 */
function buildPage(
  pageNumber: number,
  state: Readonly<AppState>,
  rowStart: number,
  rowEnd: number,
  isContinuation: boolean,
  isSummaryPage: boolean,
  rows: Record<string, unknown>[] = [],
): PageData {
  const elements = state.elements;
  const pagination = state.pagination;
  const pageElements: PageElement[] = [];
  const headerMode = pagination.headerMode ?? 'all';
  const columnSpanField = pagination.columnSpanField ?? '';
  const rowCount = rowEnd - rowStart;

  for (const el of elements) {
    const role = ELEMENT_ROLES[el.role];
    let visible = false;

    switch (role.showOnPages) {
      case 'all':
        visible = true;
        break;
      case 'first':
        visible = pageNumber === 1;
        break;
      case 'last':
        visible = false; // Set in finalizePagination
        break;
    }

    // ─── Header mode override ───
    if (el.role === 'header' && headerMode !== 'all') {
      if (headerMode === 'firstOnly') {
        visible = pageNumber === 1;
      } else if (headerMode === 'firstLast') {
        visible = pageNumber === 1; // finalizePagination fixes last page
      }
    }

    const pageEl: PageElement = { element: el, visible };

    if (el.type === 'table' && el.role === 'table') {
      pageEl.visible = rowCount > 0;
      pageEl.rowSlice = { start: rowStart, end: rowEnd };
    }

    pageElements.push(pageEl);
  }

  // Column span rows
  const columnSpanRows: number[] = [];
  if (columnSpanField) {
    for (let i = rowStart; i < rowEnd; i++) {
      const row = rows[i];
      if (row && row[columnSpanField]) {
        columnSpanRows.push(i);
      }
    }
  }

  return {
    pageNumber,
    elements: pageElements,
    tableRowStart: rowStart,
    tableRowEnd: rowEnd,
    isContinuation,
    isSummaryPage,
    columnSpanRows,
  };
}

// ═══════════════════════════════════════
// FINALIZE (post-process last page visibility)
// ═══════════════════════════════════════

/**
 * [FLOW-2] state is now required to ensure headerMode always takes effect.
 */
export function finalizePagination(result: PaginationResult, state: Readonly<AppState>): PaginationResult {
  const lastPage = result.totalPages;
  const headerMode = state.pagination.headerMode ?? 'all';

  for (const page of result.pagesData) {
    for (const pageEl of page.elements) {
      const role = ELEMENT_ROLES[pageEl.element.role];

      if (role.showOnPages === 'last') {
        pageEl.visible = page.pageNumber === lastPage;
      }

      if (pageEl.element.role === 'header' && headerMode === 'firstLast') {
        if (page.pageNumber === 1 || page.pageNumber === lastPage) {
          pageEl.visible = true;
        }
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════
// ROW GROUPS (Keep-Together)
// ═══════════════════════════════════════

/** A contiguous block of rows that must stay together on the same page. */
interface RowGroup {
  start: number;
  end: number;
  count: number;
}

/**
 * Build atomic row groups for keep-together logic.
 * Consecutive rows sharing the same keepTogetherField value form one group.
 * If keepTogetherField is empty, each row is its own group.
 *
 * [PERF-3] When no grouping field, returns a lightweight lazy array
 * that generates {start:i, end:i+1, count:1} on access instead of
 * pre-allocating N objects (avoids GC pressure at 5k+ rows).
 */
function buildRowGroups(
  rows: Record<string, unknown>[],
  pagination: Readonly<AppState['pagination']>,
): RowGroup[] {
  const field = pagination.keepTogetherField ?? '';

  if (!field || rows.length === 0) {
    // [PERF-3] Lazy identity groups — no upfront allocation
    return new IdentityRowGroups(rows.length) as unknown as RowGroup[];
  }

  const groups: RowGroup[] = [];
  let groupStart = 0;
  let currentVal = String(rows[0][field] ?? '');

  for (let i = 1; i < rows.length; i++) {
    const val = String(rows[i][field] ?? '');
    if (val !== currentVal) {
      groups.push({ start: groupStart, end: i, count: i - groupStart });
      groupStart = i;
      currentVal = val;
    }
  }
  groups.push({ start: groupStart, end: rows.length, count: rows.length - groupStart });

  return groups;
}

/**
 * [PERF-3] Lightweight array-like that lazily generates identity row groups.
 * Supports: for..of iteration, .length, .map(), indexed access [i].
 * Avoids allocating N RowGroup objects when no keepTogetherField is set.
 */
class IdentityRowGroups {
  readonly length: number;
  constructor(len: number) {
    this.length = len;
    // Proxy enables indexed access (groups[i]) without pre-allocation
    return new Proxy(this, {
      get(target, prop) {
        if (typeof prop === 'string') {
          const idx = Number(prop);
          if (Number.isInteger(idx) && idx >= 0 && idx < target.length) {
            return { start: idx, end: idx + 1, count: 1 };
          }
        }
        return (target as any)[prop];
      },
    });
  }

  map<T>(fn: (group: RowGroup, index: number) => T): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.length; i++) {
      result.push(fn({ start: i, end: i + 1, count: 1 }, i));
    }
    return result;
  }

  [Symbol.iterator](): Iterator<RowGroup> {
    let i = 0;
    const len = this.length;
    // Reuse a single object during iteration (safe for synchronous for..of)
    const group: RowGroup = { start: 0, end: 1, count: 1 };
    return {
      next() {
        if (i < len) {
          group.start = i;
          group.end = i + 1;
          i++;
          return { value: group, done: false };
        }
        return { value: undefined as any, done: true };
      },
    };
  }
}

// ═══════════════════════════════════════
// FORCE BREAK HELPERS
// ═══════════════════════════════════════

/**
 * [CALC-4] Warn when force break indices fall inside keep-together groups.
 */
function warnForceBreakInsideGroups(
  forceBreakSet: Set<number>,
  groups: RowGroup[],
): void {
  if (forceBreakSet.size === 0) return;
  const groupStarts = new Set(groups.map((g) => g.start));
  for (const idx of forceBreakSet) {
    if (idx > 0 && !groupStarts.has(idx)) {
      for (const g of groups) {
        if (idx > g.start && idx < g.end && g.count > 1) {
          console.warn(
            `[Pagination] forceBreakBeforeRows index ${idx} falls inside keep-together group [${g.start}..${g.end - 1}] and will be ignored. ` +
            `Force breaks only work at group boundaries. Consider adjusting to ${g.start} or ${g.end}.`,
          );
          break;
        }
      }
    }
  }
}

// ═══════════════════════════════════════
// DATA HELPERS
// ═══════════════════════════════════════

function getTableData(
  elements: readonly CanvasElement[],
  jsonData: Record<string, unknown> | null,
): { totalRows: number; rows: Record<string, unknown>[] } {
  if (!jsonData) return { totalRows: 0, rows: [] };

  for (const el of elements) {
    if (el.type === 'table' && el.binding) {
      const data = resolveBinding(jsonData, el.binding);
      if (Array.isArray(data)) {
        const rows = data as Record<string, unknown>[];
        return { totalRows: rows.length, rows };
      }
    }
  }

  return { totalRows: 0, rows: [] };
}

export function getElementsForPage(
  state: Readonly<AppState>,
  pageNumber: number,
): PageElement[] {
  const result = finalizePagination(computePagination(state), state);
  const page = result.pagesData.find((p) => p.pageNumber === pageNumber);
  return page ? page.elements.filter((e) => e.visible) : [];
}

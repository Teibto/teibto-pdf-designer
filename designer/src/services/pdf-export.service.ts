/**
 * PDF Export Service
 * Generates PDF from canvas state using jsPDF + AutoTable.
 * Supports multi-page, role-based rendering, Thai fonts, and data bindings.
 *
 * Libraries are lazy-loaded to keep initial bundle small.
 *
 * @author Wichit Wongta
 */
import type { AppState } from '../state/app-state';
import type {
  CanvasElement,
  TextElement,
  TableElement,
  ShapeElement,
  LineElement,
  ImageElement,
  BarcodeElement,
  ListElement,
} from '../models/element';
import { ELEMENT_ROLES } from '../constants/roles';
import { resolveTemplateString, resolveBinding } from './binding.service';
import { computePagination, finalizePagination } from './pagination.service';
import type { PageData } from './pagination.service';
import { formatCellValue } from '../utils/format';
import { hexToRgb } from '../utils/color';
import { loadThaiFonts, registerThaiFonts, THAI_FONT_FAMILY, getFontData } from './thai-font.service';
import { renderBarcodeDataUrl } from './barcode.service';

/** Lazy load jsPDF */
async function loadJsPDF() {
  const { jsPDF } = await import('jspdf');
  await import('jspdf-autotable');
  return jsPDF;
}

/** Track whether Thai fonts were successfully registered */
let _hasThaiFonts = false;

export interface PdfExportOptions {
  filename?: string;
  openInNewTab?: boolean;
}

/**
 * Export the current state as a PDF document.
 */
export async function exportPdf(
  state: Readonly<AppState>,
  options: PdfExportOptions = {},
): Promise<Blob> {
  // Load jsPDF and Thai fonts in parallel
  const [jsPDF] = await Promise.all([
    loadJsPDF(),
    loadThaiFonts(),
  ]);

  const { page, elements, jsonData, pagination } = state;
  const { filename = 'document.pdf', openInNewTab = false } = options;

  // Create PDF
  const doc = new jsPDF({
    orientation: page.orientation,
    unit: 'pt',
    format: [page.width, page.height],
  });

  // Register Sarabun (Thai + Latin) font
  _hasThaiFonts = registerThaiFonts(doc);
  if (_hasThaiFonts) {
    doc.setFont(THAI_FONT_FAMILY, 'normal');
  }

  // Compute pagination once for consistent row slicing across all pages
  const paginationResult = finalizePagination(computePagination(state), state);
  const totalPages = paginationResult.totalPages || 1;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (pageNum > 1) doc.addPage();

    const pageData = paginationResult.pagesData.find((p) => p.pageNumber === pageNum);

    // Build a map of dynamicY overrides from pagination engine
    const dynamicYMap = new Map<string, number>();
    if (pageData) {
      for (const pe of pageData.elements) {
        if (pe.dynamicY !== undefined) {
          dynamicYMap.set(pe.element.id, pe.dynamicY);
        }
      }
    }

    // Determine which elements render on this page
    // Use pagination engine's visibility (respects headerMode, role overrides)
    let visibleElements: CanvasElement[];
    if (pageData) {
      visibleElements = pageData.elements
        .filter((pe) => pe.visible)
        .map((pe) => pe.element);
    } else {
      // Fallback when no pagination data
      visibleElements = elements.filter((el) =>
        shouldRenderOnPage(el, pageNum, totalPages),
      );
    }

    // Sort by zIndex for correct layering
    const sorted = [...visibleElements].sort((a, b) => a.zIndex - b.zIndex);

    for (const el of sorted) {
      try {
        // Apply dynamicY: override element position for summary/footer on this page
        const dynY = dynamicYMap.get(el.id);
        const effectiveEl = dynY !== undefined ? { ...el, y: dynY } as typeof el : el;
        await renderElement(doc, effectiveEl, jsonData, pageNum, pagination, pageData);
      } catch (err) {
        // Per-element error recovery: skip broken element, continue PDF
        console.warn(`[PDF Export] Failed to render element "${el.name}" (${el.type}):`, err);
      }
    }
  }

  // Output
  const blob = doc.output('blob');

  if (openInNewTab) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Revoke after a short delay to allow the new tab to load the blob
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } else {
    // Trigger download with filename
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return blob;
}

/** Check if an element should render on a given page number */
function shouldRenderOnPage(
  el: CanvasElement,
  pageNum: number,
  totalPages: number,
): boolean {
  const role = ELEMENT_ROLES[el.role];

  switch (role.showOnPages) {
    case 'all':
      return true;
    case 'first':
      return pageNum === 1;
    case 'last':
      return pageNum === totalPages;
    default:
      return true;
  }
}

/** Render a single element onto the jsPDF document */
async function renderElement(
  doc: any,
  el: CanvasElement,
  jsonData: Record<string, unknown> | null,
  pageNum: number,
  pagination: AppState['pagination'],
  pageData?: PageData,
): Promise<void> {
  switch (el.type) {
    case 'text':
    case 'header':
      renderText(doc, el as TextElement, jsonData);
      break;

    case 'image':
      renderImage(doc, el as ImageElement);
      break;

    case 'table':
      renderTable(doc, el as TableElement, jsonData, pageNum, pagination, pageData);
      break;

    case 'shape':
      renderShape(doc, el as ShapeElement);
      break;

    case 'line':
      renderLine(doc, el as LineElement);
      break;

    case 'barcode':
      await renderBarcode(doc, el as BarcodeElement);
      break;

    case 'list':
      renderList(doc, el as ListElement, jsonData);
      break;

    default:
      break;
  }
}

function renderText(
  doc: any,
  el: TextElement,
  jsonData: Record<string, unknown> | null,
): void {
  const text = resolveTemplateString(el.content, jsonData);
  const rgb = hexToRgb(el.color);

  doc.setFontSize(el.fontSize);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);

  // Set font weight (Thai font supports bold variant)
  if (_hasThaiFonts) {
    doc.setFont(THAI_FONT_FAMILY, el.fontWeight === 'bold' ? 'bold' : 'normal');
  } else {
    doc.setFont('helvetica', el.fontWeight === 'bold' ? 'bold' : 'normal');
  }

  const align = el.textAlign || 'left';
  let x = el.x;

  if (align === 'center') x = el.x + el.w / 2;
  else if (align === 'right') x = el.x + el.w;

  doc.text(text, x, el.y + el.fontSize, {
    align,
    maxWidth: el.w,
  });
}

function renderImage(doc: any, el: ImageElement): void {
  const src = el.imageData || el.src;
  if (!src) return;

  try {
    doc.addImage(src, 'PNG', el.x, el.y, el.w, el.h);
  } catch {
    // Image load failed — skip silently
  }
}

function renderTable(
  doc: any,
  el: TableElement,
  jsonData: Record<string, unknown> | null,
  pageNum: number,
  pagination: AppState['pagination'],
  pageData?: PageData,
): void {
  if (el.columns.length === 0) return;

  // Resolve table data from binding
  let rows: Record<string, unknown>[] = [];
  if (jsonData && el.binding) {
    const data = resolveBinding(jsonData, el.binding);
    if (Array.isArray(data)) {
      rows = data as Record<string, unknown>[];
    }
  }

  // Paginate rows — prefer pagination result for accurate slicing
  let rowOffset = 0;
  if (pageData) {
    rowOffset = pageData.tableRowStart;
    rows = rows.slice(pageData.tableRowStart, pageData.tableRowEnd);
  } else if (pagination.mode === 'rows' && pagination.rowsPerPage > 0) {
    rowOffset = (pageNum - 1) * pagination.rowsPerPage;
    rows = rows.slice(rowOffset, rowOffset + pagination.rowsPerPage);
  }

  const visibleCols = el.columns.filter((c) => !c.hidden);
  const head = [visibleCols.map((c) => c.label)];

  // Determine column span rows for this page
  const columnSpanField = pagination.columnSpanField ?? '';
  const spanRowIndices = new Set<number>();
  if (columnSpanField && pageData) {
    for (const absIdx of pageData.columnSpanRows) {
      spanRowIndices.add(absIdx - (pageData?.tableRowStart ?? 0));
    }
  } else if (columnSpanField) {
    rows.forEach((row, i) => {
      if (row[columnSpanField]) spanRowIndices.add(i);
    });
  }

  // [FUNC-1] Find first non-index visible column for span row labels
  const firstContentCol = visibleCols.find((c) => !c.isIndex);

  const body = rows.map((row, i) =>
    visibleCols.map((c, colIdx) => {
      // For span rows: put the meaningful label in cell 0
      if (spanRowIndices.has(i) && colIdx === 0) {
        if (firstContentCol && !c.isIndex) {
          return formatCellValue(row[c.key], c.format);
        }
        // If column 0 is index, use value from first content column
        if (firstContentCol) {
          return formatCellValue(row[firstContentCol.key], firstContentCol.format);
        }
      }
      return c.isIndex ? String(rowOffset + i + 1) : formatCellValue(row[c.key], c.format);
    }),
  );

  const headerRgb = hexToRgb(el.headerBgColor);
  const headerTextRgb = hexToRgb(el.headerTextColor);

  (doc as any).autoTable({
    startY: el.y,
    margin: { left: el.x },
    tableWidth: el.w,
    head,
    body,
    theme: 'grid',
    styles: _hasThaiFonts ? { font: THAI_FONT_FAMILY } : {},
    headStyles: {
      fillColor: [headerRgb.r, headerRgb.g, headerRgb.b],
      textColor: [headerTextRgb.r, headerTextRgb.g, headerTextRgb.b],
      fontSize: 9,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
    },
    columnStyles: Object.fromEntries(
      visibleCols.map((c, i) => {
        const style: Record<string, unknown> = {
          halign: c.align,
          cellWidth: c.width || 'auto',
        };

        // Overflow mode → jsPDF AutoTable overflow option
        const overflow = c.overflow ?? 'ellipsis';
        if (overflow === 'wrap') {
          style.overflow = 'linebreak';
          // maxLines: 0 = unlimited; >0 = clamp
          if (c.maxLines > 0) {
            style.minCellHeight = 0;
          }
        } else if (overflow === 'ellipsis') {
          style.overflow = 'ellipsize';
        } else {
          // clip
          style.overflow = 'hidden';
        }

        // Bold
        if (c.bold) {
          style.fontStyle = 'bold';
        }

        return [i, style];
      }),
    ),
    // Column span: merge cells for designated rows
    ...(spanRowIndices.size > 0 ? {
      didParseCell(data: any) {
        if (data.section === 'body' && spanRowIndices.has(data.row.index)) {
          if (data.column.index === 0) {
            data.cell.colSpan = visibleCols.length;
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.halign = 'left';
          }
        }
      },
    } : {}),
  });
}

function renderShape(doc: any, el: ShapeElement): void {
  const rgb = hexToRgb(el.bgColor);
  doc.setFillColor(rgb.r, rgb.g, rgb.b);

  if (el.borderRadius > 0) {
    doc.roundedRect(el.x, el.y, el.w, el.h, el.borderRadius, el.borderRadius, 'F');
  } else {
    doc.rect(el.x, el.y, el.w, el.h, 'F');
  }
}

function renderLine(doc: any, el: LineElement): void {
  const rgb = hexToRgb(el.lineColor);
  doc.setDrawColor(rgb.r, rgb.g, rgb.b);
  doc.setLineWidth(el.lineWidth);

  if (el.lineStyle === 'dashed') {
    doc.setLineDashPattern([4, 3], 0);
  } else if (el.lineStyle === 'dotted') {
    doc.setLineDashPattern([1, 2], 0);
  }

  const midY = el.y + el.h / 2;
  doc.line(el.x, midY, el.x + el.w, midY);

  doc.setLineDashPattern([], 0); // Reset
}

async function renderBarcode(doc: any, el: BarcodeElement): Promise<void> {
  const dataUrl = await renderBarcodeDataUrl({
    value: el.value,
    barcodeType: el.barcodeType,
    width: el.w,
    height: el.h,
    includeText: true,
  });

  if (dataUrl) {
    try {
      doc.addImage(dataUrl, 'PNG', el.x, el.y, el.w, el.h);
    } catch {
      // Fallback: render value as text
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(el.value, el.x + 4, el.y + el.h / 2);
    }
  }
}

function renderList(
  doc: any,
  el: ListElement,
  jsonData: Record<string, unknown> | null,
): void {
  const rgb = hexToRgb(el.color);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.setFontSize(el.fontSize);

  if (_hasThaiFonts) {
    doc.setFont(THAI_FONT_FAMILY, 'normal');
  } else {
    doc.setFont('helvetica', 'normal');
  }

  const lineHeight = el.fontSize * 1.5;
  let curY = el.y + el.fontSize;

  for (let i = 0; i < el.items.length; i++) {
    const item = resolveTemplateString(el.items[i], jsonData);
    let prefix: string;

    switch (el.listStyle) {
      case 'number': prefix = `${i + 1}. `; break;
      case 'dash':   prefix = '– '; break;
      default:       prefix = '• '; break;
    }

    doc.text(`${prefix}${item}`, el.x + 4, curY, { maxWidth: el.w - 8 });
    curY += lineHeight;

    // Stop if we exceed element bounds
    if (curY > el.y + el.h) break;
  }
}

// ═══════════════════════════════════════
// WEB WORKER EXPORT
// ═══════════════════════════════════════

/**
 * Export PDF via Web Worker (off main thread).
 * Pre-renders barcodes on main thread (Canvas API needed),
 * then delegates jsPDF rendering to the worker.
 *
 * @param onProgress — Optional progress callback (0-100)
 */
export async function exportPdfViaWorker(
  state: Readonly<AppState>,
  options: PdfExportOptions & { onProgress?: (pct: number) => void } = {},
): Promise<Blob> {
  const { filename = 'document.pdf', openInNewTab = false, onProgress } = options;

  onProgress?.(5);

  // 1. Load Thai fonts (main thread — needs fetch)
  await loadThaiFonts();
  const fontData = getFontData();

  onProgress?.(15);

  // 2. Pre-render barcodes on main thread (Canvas API not available in worker)
  const barcodeElements = state.elements.filter((el) => el.type === 'barcode') as BarcodeElement[];
  const barcodeImages: Record<string, string> = {};

  for (const el of barcodeElements) {
    const key = `${el.barcodeType}:${el.value}`;
    if (!barcodeImages[key]) {
      const dataUrl = await renderBarcodeDataUrl({
        value: el.value,
        barcodeType: el.barcodeType,
        width: el.w,
        height: el.h,
      });
      if (dataUrl) barcodeImages[key] = dataUrl;
    }
  }

  onProgress?.(25);

  // 3. Prepare serializable state for worker
  const workerState = {
    page: state.page,
    elements: state.elements,
    jsonData: state.jsonData,
    pagination: state.pagination,
    totalPages: state.totalPages || 1,
    roles: ELEMENT_ROLES,
  };

  // 4. Create and run worker
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/pdf-export.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e) => {
      const { type, blob, message, percent } = e.data;

      switch (type) {
        case 'progress':
          onProgress?.(percent);
          break;

        case 'done':
          worker.terminate();
          onProgress?.(100);

          // Handle output
          if (openInNewTab) {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
          }

          resolve(blob);
          break;

        case 'error':
          worker.terminate();
          reject(new Error(message));
          break;
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    // Send work to worker
    worker.postMessage({
      type: 'generate',
      state: workerState,
      options,
      barcodeImages,
      fontData,
    });
  });
}

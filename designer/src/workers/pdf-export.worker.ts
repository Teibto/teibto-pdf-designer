/**
 * PDF Export Web Worker
 * Runs heavy jsPDF generation off the main thread to prevent UI freezes.
 *
 * Communication protocol:
 *   Main → Worker: { type: 'generate', state, options, barcodeImages, fontData }
 *   Worker → Main: { type: 'done', blob }
 *   Worker → Main: { type: 'error', message }
 *   Worker → Main: { type: 'progress', percent }
 *
 * @author Wichit Wongta
 */

// Dynamically import jsPDF inside the worker
let _jsPDF: any = null;

async function loadJsPDF() {
  if (!_jsPDF) {
    const mod = await import('jspdf');
    await import('jspdf-autotable');
    _jsPDF = mod.jsPDF;
  }
  return _jsPDF;
}

// ═══════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════

self.onmessage = async (e: MessageEvent) => {
  const { type, state, barcodeImages, fontData } = e.data;

  if (type !== 'generate') return;

  try {
    postProgress(5);

    const jsPDF = await loadJsPDF();
    postProgress(15);

    const { page, elements, jsonData } = state;
    const doc = new jsPDF({
      orientation: page.orientation,
      unit: 'pt',
      format: [page.width, page.height],
    });

    // Register Thai fonts if provided
    let hasThaiFonts = false;
    if (fontData?.regular && fontData?.bold) {
      try {
        doc.addFileToVFS('Sarabun-Regular.ttf', fontData.regular);
        doc.addFileToVFS('Sarabun-Bold.ttf', fontData.bold);
        doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
        doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
        doc.setFont('Sarabun', 'normal');
        hasThaiFonts = true;
      } catch {
        // Fallback to Helvetica
      }
    }

    postProgress(25);

    // Simplified pagination for worker (use pre-computed totalPages)
    const totalPages = state.totalPages || 1;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (pageNum > 1) doc.addPage();

      const visibleElements = elements.filter((el: any) =>
        shouldRenderOnPage(el, pageNum, totalPages, state.roles),
      );

      const sorted = [...visibleElements].sort((a: any, b: any) => a.zIndex - b.zIndex);

      for (const el of sorted) {
        try {
          renderElement(doc, el, jsonData, hasThaiFonts, barcodeImages);
        } catch (err) {
          // Skip broken element
        }
      }

      postProgress(25 + Math.round((pageNum / totalPages) * 60));
    }

    postProgress(90);

    const blob = doc.output('blob');
    (self as any).postMessage({ type: 'done', blob });
  } catch (err: any) {
    (self as any).postMessage({ type: 'error', message: err.message || String(err) });
  }
};

// ═══════════════════════════════════════
// RENDER FUNCTIONS (simplified for worker)
// ═══════════════════════════════════════

function shouldRenderOnPage(el: any, pageNum: number, totalPages: number, roles: any): boolean {
  const role = roles?.[el.role];
  if (!role) return true;

  switch (role.showOnPages) {
    case 'all': return true;
    case 'first': return pageNum === 1;
    case 'last': return pageNum === totalPages;
    default: return true;
  }
}

function renderElement(
  doc: any, el: any, jsonData: any,
  hasThaiFonts: boolean, barcodeImages: Record<string, string>,
): void {
  switch (el.type) {
    case 'text':
    case 'header':
      renderText(doc, el, jsonData, hasThaiFonts);
      break;
    case 'image':
      renderImage(doc, el);
      break;
    case 'shape':
      renderShape(doc, el);
      break;
    case 'line':
      renderLine(doc, el);
      break;
    case 'barcode':
      renderBarcode(doc, el, barcodeImages);
      break;
    case 'list':
      renderList(doc, el, jsonData, hasThaiFonts);
      break;
    case 'table':
      renderTable(doc, el, jsonData, hasThaiFonts);
      break;
  }
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function resolveTemplate(content: string, data: any): string {
  if (!data || !content) return content || '';
  return content.replace(/\{\{(\w[\w.]*)\}\}/g, (_m, path) => {
    const parts = path.split('.');
    let val: any = data;
    for (const p of parts) {
      if (val == null) return '';
      val = val[p];
    }
    return val != null ? String(val) : '';
  });
}

function setFont(doc: any, hasThai: boolean, weight: string = 'normal') {
  if (hasThai) {
    doc.setFont('Sarabun', weight);
  } else {
    doc.setFont('helvetica', weight);
  }
}

function renderText(doc: any, el: any, jsonData: any, hasThai: boolean): void {
  const text = resolveTemplate(el.content, jsonData);
  const rgb = hexToRgb(el.color);
  doc.setFontSize(el.fontSize);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  setFont(doc, hasThai, el.fontWeight === 'bold' ? 'bold' : 'normal');

  const align = el.textAlign || 'left';
  let x = el.x;
  if (align === 'center') x = el.x + el.w / 2;
  else if (align === 'right') x = el.x + el.w;

  doc.text(text, x, el.y + el.fontSize, { align, maxWidth: el.w });
}

function renderImage(doc: any, el: any): void {
  const src = el.imageData || el.src;
  if (!src) return;
  try { doc.addImage(src, 'PNG', el.x, el.y, el.w, el.h); } catch { /* skip */ }
}

function renderShape(doc: any, el: any): void {
  const rgb = hexToRgb(el.bgColor);
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  if (el.borderRadius > 0) {
    doc.roundedRect(el.x, el.y, el.w, el.h, el.borderRadius, el.borderRadius, 'F');
  } else {
    doc.rect(el.x, el.y, el.w, el.h, 'F');
  }
}

function renderLine(doc: any, el: any): void {
  const rgb = hexToRgb(el.lineColor);
  doc.setDrawColor(rgb.r, rgb.g, rgb.b);
  doc.setLineWidth(el.lineWidth);
  if (el.lineStyle === 'dashed') doc.setLineDashPattern([4, 3], 0);
  else if (el.lineStyle === 'dotted') doc.setLineDashPattern([1, 2], 0);
  const midY = el.y + el.h / 2;
  doc.line(el.x, midY, el.x + el.w, midY);
  doc.setLineDashPattern([], 0);
}

function renderBarcode(doc: any, el: any, barcodeImages: Record<string, string>): void {
  const key = `${el.barcodeType}:${el.value}`;
  const dataUrl = barcodeImages[key];
  if (dataUrl) {
    try { doc.addImage(dataUrl, 'PNG', el.x, el.y, el.w, el.h); } catch { /* skip */ }
  }
}

function renderList(doc: any, el: any, jsonData: any, hasThai: boolean): void {
  const rgb = hexToRgb(el.color);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.setFontSize(el.fontSize);
  setFont(doc, hasThai, 'normal');

  const lineHeight = el.fontSize * 1.5;
  let curY = el.y + el.fontSize;

  for (let i = 0; i < el.items.length; i++) {
    const item = resolveTemplate(el.items[i], jsonData);
    let prefix: string;
    switch (el.listStyle) {
      case 'number': prefix = `${i + 1}. `; break;
      case 'dash':   prefix = '– '; break;
      default:       prefix = '• '; break;
    }
    doc.text(`${prefix}${item}`, el.x + 4, curY, { maxWidth: el.w - 8 });
    curY += lineHeight;
    if (curY > el.y + el.h) break;
  }
}

function renderTable(doc: any, el: any, jsonData: any, hasThai: boolean): void {
  if (!el.columns || el.columns.length === 0) return;

  let rows: any[] = [];
  if (jsonData && el.binding) {
    const parts = el.binding.split('.');
    let data: any = jsonData;
    for (const p of parts) {
      if (data == null) break;
      data = data[p];
    }
    if (Array.isArray(data)) rows = data;
  }

  const visibleCols = el.columns.filter((c: any) => !c.hidden);
  const head = [visibleCols.map((c: any) => c.label)];
  const body = rows.map((row: any, i: number) =>
    visibleCols.map((c: any) => c.isIndex ? String(i + 1) : String(row[c.key] ?? '')),
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
    styles: hasThai ? { font: 'Sarabun' } : {},
    headStyles: {
      fillColor: [headerRgb.r, headerRgb.g, headerRgb.b],
      textColor: [headerTextRgb.r, headerTextRgb.g, headerTextRgb.b],
      fontSize: 9,
      fontStyle: 'bold',
    },
    bodyStyles: { fontSize: 8 },
    columnStyles: Object.fromEntries(
      visibleCols.map((c: any, i: number) => [i, { halign: c.align, cellWidth: c.width || 'auto' }]),
    ),
  });
}

function postProgress(percent: number) {
  (self as any).postMessage({ type: 'progress', percent });
}

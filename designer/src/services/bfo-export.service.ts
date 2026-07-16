/**
 * NetSuite BFO XML Template Export Service
 * Converts canvas elements to NetSuite-compatible BFO (Big Faceless Organization) XML.
 *
 * BFO uses a subset of XHTML with CSS for PDF rendering inside NetSuite.
 *
 * @author Wichit Wongta
 */
import type { AppState } from '../state/app-state';
import type { PaginationConfig } from '../models/template';
import type {
  CanvasElement,
  TextElement,
  TableElement,
  TableColumn,
  ShapeElement,
  LineElement,
  ImageElement,
  BarcodeElement,
  ListElement,
} from '../models/element';
import { escapeXml, sanitizeColor, sanitizeNumericCss } from './validation.service';

export interface BfoExportOptions {
  /** NetSuite record type for variable references */
  recordType?: string;
  /** Use FreeMarker syntax for data binding */
  useFreeMarker?: boolean;
  /** Include page header/footer CSS */
  includePageHeaders?: boolean;
}

/**
 * Export the current state as BFO XML string.
 */
export function exportBfoXml(
  state: Readonly<AppState>,
  options: BfoExportOptions = {},
): string {
  const {
    recordType = 'transaction',
    useFreeMarker = true,
    includePageHeaders = true,
  } = options;

  const { page, elements } = state;

  // Build CSS
  const css = buildBfoCss(page, elements, includePageHeaders);

  // Build body HTML
  const bodyHtml = buildBfoBody(elements, recordType, useFreeMarker, state.pagination);

  // Wrap in full BFO template
  return `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
<style type="text/css">
${css}
</style>
</head>
<body>
${bodyHtml}
</body>
</pdf>`;
}

/** Build BFO-compatible CSS */
function buildBfoCss(
  page: AppState['page'],
  elements: CanvasElement[],
  includePageHeaders: boolean,
): string {
  const lines: string[] = [];

  // Page setup
  const isLandscape = page.orientation === 'landscape';
  lines.push(`@page {`);
  lines.push(`  size: ${isLandscape ? 'landscape' : 'portrait'};`);
  lines.push(`  margin: 0.5in;`);
  lines.push(`}`);

  // Base styles
  lines.push(`body { font-family: sans-serif; font-size: 10pt; color: #333; }`);
  lines.push(`table { border-collapse: collapse; }`);
  lines.push(`th, td { padding: 4pt 6pt; }`);

  // Header/Footer regions
  if (includePageHeaders) {
    const headerElements = elements.filter((e) => e.role === 'header');
    const footerElements = elements.filter((e) => e.role === 'footer');

    if (headerElements.length > 0) {
      lines.push(`@page { @top-center { content: ""; } }`);
    }
    if (footerElements.length > 0) {
      lines.push(`@page { @bottom-center { content: "Page " counter(page) " of " counter(pages); } }`);
    }
  }

  return lines.join('\n');
}

/** Build BFO body HTML from elements */
function buildBfoBody(
  elements: CanvasElement[],
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
): string {
  const lines: string[] = [];

  // Group by role for proper ordering
  const header = elements.filter((e) => e.role === 'header');
  const content = elements.filter((e) => e.role === 'content');
  const tables = elements.filter((e) => e.role === 'table');
  const summary = elements.filter((e) => e.role === 'summary');
  const footer = elements.filter((e) => e.role === 'footer');
  const watermark = elements.filter((e) => e.role === 'watermark');

  // Header section
  if (header.length > 0) {
    lines.push('<!-- ═══ HEADER ═══ -->');
    lines.push('<div id="header" style="margin-bottom: 12pt;">');
    header.forEach((el) => lines.push(elementToHtml(el, recordType, useFreeMarker, pagination)));
    lines.push('</div>');
    lines.push('');
  }

  // Content section
  if (content.length > 0) {
    lines.push('<!-- ═══ CONTENT ═══ -->');
    lines.push('<div id="content">');
    content.forEach((el) => lines.push(elementToHtml(el, recordType, useFreeMarker, pagination)));
    lines.push('</div>');
    lines.push('');
  }

  // Table section
  if (tables.length > 0) {
    lines.push('<!-- ═══ TABLE ═══ -->');
    tables.forEach((el) => lines.push(elementToHtml(el, recordType, useFreeMarker, pagination)));
    lines.push('');
  }

  // Summary section
  if (summary.length > 0) {
    lines.push('<!-- ═══ SUMMARY ═══ -->');
    lines.push('<div id="summary" style="margin-top: 12pt;">');
    summary.forEach((el) => lines.push(elementToHtml(el, recordType, useFreeMarker, pagination)));
    lines.push('</div>');
    lines.push('');
  }

  // Footer section
  if (footer.length > 0) {
    lines.push('<!-- ═══ FOOTER ═══ -->');
    lines.push('<div id="footer" style="margin-top: 12pt;">');
    footer.forEach((el) => lines.push(elementToHtml(el, recordType, useFreeMarker, pagination)));
    lines.push('</div>');
    lines.push('');
  }

  // Watermark section
  if (watermark.length > 0) {
    lines.push('<!-- ═══ WATERMARK ═══ -->');
    watermark.forEach((el) => lines.push(elementToHtml(el, recordType, useFreeMarker, pagination)));
    lines.push('');
  }

  return lines.join('\n');
}

/** Convert a single element to BFO HTML */
function elementToHtml(
  el: CanvasElement,
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
): string {
  switch (el.type) {
    case 'text':
    case 'header':
      return textToHtml(el as TextElement, recordType, useFreeMarker);
    case 'image':
      return imageToHtml(el as ImageElement, recordType, useFreeMarker);
    case 'table':
      return tableToHtml(el as TableElement, recordType, useFreeMarker, pagination);
    case 'shape':
      return shapeToHtml(el as ShapeElement);
    case 'line':
      return lineToHtml(el as LineElement);
    case 'barcode':
      return barcodeToHtml(el as BarcodeElement, recordType, useFreeMarker);
    case 'list':
      return listToHtml(el as ListElement, recordType, useFreeMarker);
    default:
      return `<!-- ${(el as CanvasElement).type}: ${(el as CanvasElement).name} (not supported in BFO) -->`;
  }
}

function textToHtml(el: TextElement, recordType: string, useFreeMarker: boolean): string {
  const style = [
    `font-size: ${sanitizeNumericCss(el.fontSize, 'pt', 1, 200)}`,
    `font-weight: ${el.fontWeight === 'bold' ? 'bold' : 'normal'}`,
    `color: ${sanitizeColor(el.color)}`,
    `text-align: ${['left', 'center', 'right'].includes(el.textAlign) ? el.textAlign : 'left'}`,
    `width: ${sanitizeNumericCss(el.w, 'pt', 0, 5000)}`,
  ].join('; ');

  let content = escapeXml(el.content);

  // Convert bindings to NetSuite FreeMarker or SuiteScript
  if (el.binding && useFreeMarker) {
    content = convertBindingToFreeMarker(el.binding, recordType);
  } else if (el.content.includes('{{')) {
    // Replace template placeholders while keeping literal text escaped
    content = escapeXml(el.content).replace(
      /\{\{(.+?)\}\}/g,
      (_, path) => useFreeMarker
        ? convertBindingToFreeMarker(path.trim(), recordType)
        : `\${${recordType}.${path.trim()}}`,
    );
  }

  const tag = el.type === 'header' ? 'h2' : 'p';
  return `<${tag} style="${style}">${content}</${tag}>`;
}

function imageToHtml(el: ImageElement, recordType: string, useFreeMarker: boolean): string {
  let src = el.src || '';
  if (el.binding && useFreeMarker) {
    src = convertBindingToFreeMarker(el.binding, recordType);
  }

  return `<img src="${escapeXml(src)}" style="width: ${el.w}pt; height: ${el.h}pt; object-fit: ${el.objectFit};" />`;
}

/**
 * Generate inline CSS for a table cell based on column overflow mode.
 * BFO supports: word-wrap, overflow:hidden, text-overflow:ellipsis
 */
function cellOverflowStyle(col: TableColumn, borderColor: string): string {
  const parts = [
    `text-align: ${col.align}`,
    'padding: 4pt 6pt',
    `border: 0.5pt solid ${borderColor}`,
    `width: ${col.width}pt`,
  ];

  if (col.bold) parts.push('font-weight: bold');
  if (col.uppercase) parts.push('text-transform: uppercase');

  const overflow = col.overflow ?? 'ellipsis';
  if (overflow === 'wrap') {
    parts.push('word-wrap: break-word');
    if (col.maxLines > 0) {
      // BFO doesn't support -webkit-line-clamp; approximate with max-height
      // Assume ~12pt line-height for body text (8pt font × 1.5)
      parts.push(`max-height: ${col.maxLines * 12}pt`);
      parts.push('overflow: hidden');
    }
  } else if (overflow === 'ellipsis') {
    parts.push('white-space: nowrap');
    parts.push('overflow: hidden');
    parts.push('text-overflow: ellipsis');
  } else {
    // clip
    parts.push('white-space: nowrap');
    parts.push('overflow: hidden');
  }

  return parts.join('; ') + ';';
}

function tableToHtml(el: TableElement, recordType: string, useFreeMarker: boolean, pagination?: PaginationConfig): string {
  if (el.columns.length === 0) return `<!-- table ${el.name}: no columns configured -->`;

  const visibleCols = el.columns.filter((c) => !c.hidden);
  const lines: string[] = [];
  const spanField = pagination?.columnSpanField ?? '';

  lines.push(`<table style="width: ${el.w}pt; border: 0.5pt solid ${el.borderColor};">`);

  // Header
  lines.push('<thead>');
  lines.push('<tr>');
  visibleCols.forEach((col) => {
    const style = `background-color: ${sanitizeColor(el.headerBgColor)}; color: ${sanitizeColor(el.headerTextColor)}; text-align: ${col.align}; font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)}; width: ${col.width}pt;`;
    lines.push(`  <th style="${style}">${escapeXml(col.label)}</th>`);
  });
  lines.push('</tr>');
  lines.push('</thead>');

  // Body (FreeMarker loop)
  lines.push('<tbody>');

  if (useFreeMarker && el.binding) {
    const listVar = el.binding.split('.').pop() || 'item';
    lines.push(`<#list ${recordType}.${el.binding} as ${listVar}>`);

    // Column span: conditionally render merged row or normal row
    if (spanField) {
      const spanStyle = `text-align: left; font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)};`;
      // [FUNC-2] Use first non-index column for span row label (index column has no meaningful value)
      const spanLabelCol = visibleCols.find((c) => !c.isIndex) ?? visibleCols[0];
      lines.push(`<#if ${listVar}.${spanField}?has_content>`);
      lines.push(`<tr><td colspan="${visibleCols.length}" style="${spanStyle}">\${${listVar}.${spanLabelCol.key}}</td></tr>`);
      lines.push('<#else>');
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        lines.push(`  <td style="${style}">\${${listVar}.${col.key}}</td>`);
      });
      lines.push('</tr>');
      lines.push('</#if>');
    } else {
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        lines.push(`  <td style="${style}">\${${listVar}.${col.key}}</td>`);
      });
      lines.push('</tr>');
    }

    lines.push(`</#list>`);
  } else {
    lines.push('<tr>');
    visibleCols.forEach((col) => {
      const style = cellOverflowStyle(col, el.borderColor);
      lines.push(`  <td style="${style}">[${col.key}]</td>`);
    });
    lines.push('</tr>');
  }

  lines.push('</tbody>');
  lines.push('</table>');

  return lines.join('\n');
}

function shapeToHtml(el: ShapeElement): string {
  const style = [
    `width: ${el.w}pt`,
    `height: ${el.h}pt`,
    `background-color: ${el.bgColor}`,
    el.borderRadius > 0 ? `border-radius: ${el.borderRadius}pt` : '',
    `opacity: ${el.opacity}`,
  ]
    .filter(Boolean)
    .join('; ');

  return `<div style="${style}"></div>`;
}

function lineToHtml(el: LineElement): string {
  return `<hr style="border: none; border-top: ${el.lineWidth}pt ${el.lineStyle} ${el.lineColor}; width: ${el.w}pt;" />`;
}

function barcodeToHtml(el: BarcodeElement, recordType: string, useFreeMarker: boolean): string {
  const value = el.binding && useFreeMarker
    ? convertBindingToFreeMarker(el.binding, recordType)
    : escapeXml(el.value);

  // BFO supports barcode rendering via <barcode> tag
  const barcodeTypeMap: Record<string, string> = {
    code128: 'code128',
    code39: 'code3of9',
    ean13: 'ean13',
    qrcode: 'qrcode',
  };
  const bfoType = barcodeTypeMap[el.barcodeType] || 'code128';

  return [
    `<!-- Barcode: ${escapeXml(el.name)} -->`,
    `<barcode codetype="${bfoType}" value="${value}"`,
    `  style="width: ${el.w}pt; height: ${el.h}pt;"`,
    `  showtext="true" />`,
  ].join('\n');
}

function listToHtml(el: ListElement, recordType: string, useFreeMarker: boolean): string {
  const tag = el.listStyle === 'number' ? 'ol' : 'ul';
  const listStyleType = el.listStyle === 'bullet' ? 'disc' : el.listStyle === 'dash' ? 'square' : 'decimal';

  const items = el.items.map((item) => {
    let text = escapeXml(item);
    // Replace template bindings with FreeMarker variables
    if (useFreeMarker) {
      text = text.replace(/\{\{(\w[\w.]*)\}\}/g, (_m, path) =>
        convertBindingToFreeMarker(path, recordType),
      );
    }
    return `  <li>${text}</li>`;
  });

  return [
    `<!-- List: ${escapeXml(el.name)} -->`,
    `<${tag} style="font-size: ${el.fontSize}pt; color: ${el.color}; list-style-type: ${listStyleType}; padding-left: 16pt;">`,
    ...items,
    `</${tag}>`,
  ].join('\n');
}

/** Convert a JSON binding path to FreeMarker variable syntax */
function convertBindingToFreeMarker(path: string, recordType: string): string {
  return `\${${recordType}.${path}}`;
}

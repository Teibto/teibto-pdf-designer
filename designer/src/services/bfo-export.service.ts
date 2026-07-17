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
  ElementRoleType,
} from '../models/element';
import { escapeXml, sanitizeColor, sanitizeNumericCss } from './validation.service';
import { elementsToBands } from './band-layout.service';
import type { Band } from '../models/bands';

export interface BfoExportOptions {
  /**
   * @deprecated No longer sets the FreeMarker alias — that is fixed to `record`
   * (the render engine's addRecord binding, #12). Retained for API compat.
   */
  recordType?: string;
  /** Use FreeMarker syntax for data binding */
  useFreeMarker?: boolean;
  /** Include page header/footer CSS */
  includePageHeaders?: boolean;
  /**
   * File Cabinet URLs of THSarabunNew TTFs to embed via <link type="font">.
   * REQUIRED for Thai documents: server-side BFO silently drops Thai glyphs
   * with any non-embedded font-family (verified on SB2 — NotoSansThai in CSS
   * does NOT render Thai). Files must be "Available Without Login" and the
   * URL must be the full form with the h= token and _xt=.ttf suffix.
   */
  thaiFontUrls?: { regular: string; bold?: string };
  /**
   * Render from the stored band structure (`state.bands`) instead of re-deriving
   * bands from element x/y (#47 cutover slice 3a). When true, each role section is
   * emitted via `renderBand(storedBand)` so the consultant's band edits (column
   * split/merge, width, cross-cell moves) reach the PDF. Element properties are
   * still resolved from `state.elements` by id (model B). An UNEDITED band export
   * is byte-identical to the element path — edits are the only divergence.
   * Default false → the element path, unchanged.
   */
  useBands?: boolean;
}

/**
 * Export the current state as BFO XML string.
 */
export function exportBfoXml(
  state: Readonly<AppState>,
  options: BfoExportOptions = {},
): string {
  const {
    useFreeMarker = true,
    includePageHeaders = true,
    thaiFontUrls,
    useBands = false,
  } = options;

  // The FreeMarker data-source alias is a fixed contract with the render engine:
  // pld_sl_render_pdf.js binds the record via addRecord({templateName:'record'}),
  // so every binding MUST be ${record.*} to resolve at Print/Preview time (matches
  // the hand-written master template pack). options.recordType no longer sets the
  // alias — that mismatch (${transaction.*} vs the 'record' binding) is why designer
  // templates printed blank and preview never matched print (#12).
  const recordType = 'record';

  const { page, elements } = state;

  // Band source (#47 3a): render stored bands via renderBand instead of
  // re-deriving from x/y. Element roles equal their band's role, so header/footer
  // detection, roleHeight and body attrs are identical either way — only the inner
  // render of each role section switches. byId resolves element properties (model B).
  const bands = useBands ? state.bands : undefined;
  const byId = useBands ? new Map(elements.map((e) => [e.id, e])) : undefined;

  // Repeating header/footer must be BFO macros — NetSuite's BFO engine does
  // not support CSS @page margin boxes or counter(page)/counter(pages).
  const headerElements = includePageHeaders ? elements.filter((e) => e.role === 'header') : [];
  const footerElements = includePageHeaders ? elements.filter((e) => e.role === 'footer') : [];
  const useMacros = headerElements.length > 0 || footerElements.length > 0;

  const macrolist = useMacros
    ? buildMacrolist(headerElements, footerElements, recordType, useFreeMarker, state.pagination, bands, byId)
    : '';

  const fontLink = buildFontLink(thaiFontUrls);

  // Build CSS
  const css = buildBfoCss(!!thaiFontUrls);

  // Build body HTML (header/footer live in macros when useMacros)
  const bodyHtml = buildBfoBody(elements, recordType, useFreeMarker, state.pagination, useMacros, bands, byId);

  const bodyAttrs = buildBodyAttrs(page, headerElements, footerElements);

  // Wrap in full BFO template
  return `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
${fontLink ? fontLink + '\n' : ''}${macrolist ? macrolist + '\n' : ''}<style type="text/css">
${css}
</style>
</head>
<body${bodyAttrs}>
${bodyHtml}
</body>
</pdf>`;
}

/** Embed THSarabunNew from the File Cabinet (server-side BFO has no system Thai fonts) */
function buildFontLink(thaiFontUrls?: BfoExportOptions['thaiFontUrls']): string {
  if (!thaiFontUrls?.regular) return '';

  const attrs = [
    'name="THSarabunNew"',
    'type="font"',
    'subtype="truetype"',
    `src="${escapeXml(thaiFontUrls.regular)}"`,
  ];
  if (thaiFontUrls.bold) {
    attrs.push(`src-bold="${escapeXml(thaiFontUrls.bold)}"`);
  }
  // bytes="2" — 2-byte glyph encoding, required for non-Latin scripts
  attrs.push('bytes="2"');

  return `<link ${attrs.join(' ')} />`;
}

/** Build BFO-compatible CSS */
function buildBfoCss(hasEmbeddedThaiFont: boolean): string {
  const lines: string[] = [];

  // WARNING (verified on SB2): non-embedded font-family names — including
  // NotoSansThai — silently DROP Thai glyphs in BFO. Thai documents require
  // thaiFontUrls (embedded <link type="font">); the fallback below only keeps
  // Latin text readable.
  const fontFamily = hasEmbeddedThaiFont
    ? 'THSarabunNew, sans-serif'
    : 'NotoSansThai, sans-serif';

  // Base styles (page size/margins are <body> attributes in BFO, not @page CSS)
  lines.push(`body { font-family: ${fontFamily}; font-size: 10pt; color: #333; }`);
  lines.push(`table { border-collapse: collapse; }`);
  lines.push(`th, td { padding: 4pt 6pt; }`);

  return lines.join('\n');
}

/** Bounding-box height (pt) of a group of elements, with breathing room */
function roleHeight(els: CanvasElement[], minHeight: number): number {
  if (els.length === 0) return 0;
  const top = Math.min(...els.map((e) => e.y));
  const bottom = Math.max(...els.map((e) => e.y + e.h));
  return Math.max(Math.ceil(bottom - top) + 8, minHeight);
}

/**
 * Render one band as BFO HTML (#13/#45). Each row with ≥2 columns becomes a
 * `<table><tr><td width="%">` so BFO honors the horizontal placement exactly
 * (design = print). A single-column row is emitted directly WITHOUT a table
 * wrapper — this avoids needless nesting and, critically, keeps the item table
 * (a lone full-width element) un-nested so its cross-page pagination is
 * unaffected. Only a table deliberately placed beside another element nests.
 */
function renderBand(
  band: Band,
  byId: Map<string, CanvasElement>,
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
): string {
  const cellHtml = (col: { elementIds: string[] }, out: string[]) => {
    for (const id of col.elementIds) {
      const el = byId.get(id);
      if (el) out.push(elementToHtml(el, recordType, useFreeMarker, pagination));
    }
  };

  const out: string[] = [];
  for (const row of band.rows) {
    if (row.columns.length <= 1) {
      if (row.columns[0]) cellHtml(row.columns[0], out);
      continue;
    }
    out.push('<table style="width: 100%; border-collapse: collapse;"><tr>');
    for (const col of row.columns) {
      out.push(`<td style="width: ${col.widthPct}%; vertical-align: top;">`);
      cellHtml(col, out);
      out.push('</td>');
    }
    out.push('</tr></table>');
  }
  return out.join('\n');
}

/**
 * Render stored bands (state.bands) to BFO body HTML — the band-mode export path
 * (#47). Reads bands directly so band edits (e.g. column widths) reach the output
 * without going through the element path. Reuses the same renderBand as the
 * element path, so band-mode output matches what #45 verified on SB2.
 */
export function renderBandsBody(
  bands: Band[],
  elements: CanvasElement[],
  recordType = 'record',
  useFreeMarker = true,
  pagination?: PaginationConfig,
): string {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return bands.map((band) => renderBand(band, byId, recordType, useFreeMarker, pagination)).join('\n');
}

/** Render a single-role element group via the band model (row/column layout). */
function renderElementsAsBands(
  els: CanvasElement[],
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
): string {
  const byId = new Map(els.map((e) => [e.id, e]));
  return elementsToBands(els)
    .map((band) => renderBand(band, byId, recordType, useFreeMarker, pagination))
    .join('\n');
}

/**
 * Render one role's section (#47 3a). With a band source, emit the stored band
 * for that role via renderBand (honors the consultant's edits); otherwise derive
 * bands from element x/y (the legacy element path). Same output when the stored
 * band is an unedited migration of the same elements.
 */
function renderRoleSection(
  role: ElementRoleType,
  els: CanvasElement[],
  recordType: string,
  useFreeMarker: boolean,
  pagination: PaginationConfig | undefined,
  bands?: Band[],
  byId?: Map<string, CanvasElement>,
): string {
  if (bands && byId) {
    const band = bands.find((b) => b.role === role);
    return band ? renderBand(band, byId, recordType, useFreeMarker, pagination) : '';
  }
  return renderElementsAsBands(els, recordType, useFreeMarker, pagination);
}

/** Build <macrolist> with nlheader/nlfooter macros for repeat-on-every-page content */
function buildMacrolist(
  headerElements: CanvasElement[],
  footerElements: CanvasElement[],
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
  bands?: Band[],
  byId?: Map<string, CanvasElement>,
): string {
  const lines: string[] = [];
  lines.push('<macrolist>');

  if (headerElements.length > 0) {
    lines.push('<macro id="nlheader">');
    lines.push(renderRoleSection('header', headerElements, recordType, useFreeMarker, pagination, bands, byId));
    lines.push('</macro>');
  }

  if (footerElements.length > 0) {
    lines.push('<macro id="nlfooter">');
    lines.push(renderRoleSection('footer', footerElements, recordType, useFreeMarker, pagination, bands, byId));
    lines.push('<p style="font-size: 8pt; color: #888888; text-align: center;">Page <pagenumber/> of <totalpages/></p>');
    lines.push('</macro>');
  }

  lines.push('</macrolist>');
  return lines.join('\n');
}

/** Body attributes: page size/orientation + macro bindings (BFO attributes, not CSS) */
function buildBodyAttrs(
  page: AppState['page'],
  headerElements: CanvasElement[],
  footerElements: CanvasElement[],
): string {
  const attrs: string[] = [];

  const sizeName = page.size === 'Custom' ? 'A4' : page.size;
  attrs.push(`size="${sizeName}${page.orientation === 'landscape' ? '-LANDSCAPE' : ''}"`);

  if (headerElements.length > 0) {
    attrs.push('header="nlheader"');
    attrs.push(`header-height="${roleHeight(headerElements, 24)}pt"`);
  }
  if (footerElements.length > 0) {
    attrs.push('footer="nlfooter"');
    // extra room for the appended "Page X of Y" line
    attrs.push(`footer-height="${roleHeight(footerElements, 20) + 14}pt"`);
  }

  attrs.push('padding="0.5in"');

  return ' ' + attrs.join(' ');
}

/** Build BFO body HTML from elements */
function buildBfoBody(
  elements: CanvasElement[],
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
  headerFooterInMacros = false,
  bands?: Band[],
  byId?: Map<string, CanvasElement>,
): string {
  const lines: string[] = [];

  // Group by role for proper ordering
  const header = headerFooterInMacros ? [] : elements.filter((e) => e.role === 'header');
  const content = elements.filter((e) => e.role === 'content');
  const tables = elements.filter((e) => e.role === 'table');
  const summary = elements.filter((e) => e.role === 'summary');
  const footer = headerFooterInMacros ? [] : elements.filter((e) => e.role === 'footer');
  const watermark = elements.filter((e) => e.role === 'watermark');

  const section = (role: ElementRoleType, els: CanvasElement[]) =>
    renderRoleSection(role, els, recordType, useFreeMarker, pagination, bands, byId);

  // Header section
  if (header.length > 0) {
    lines.push('<!-- ═══ HEADER ═══ -->');
    lines.push('<div id="header" style="margin-bottom: 12pt;">');
    lines.push(section('header', header));
    lines.push('</div>');
    lines.push('');
  }

  // Content section
  if (content.length > 0) {
    lines.push('<!-- ═══ CONTENT ═══ -->');
    lines.push('<div id="content">');
    lines.push(section('content', content));
    lines.push('</div>');
    lines.push('');
  }

  // Table section
  if (tables.length > 0) {
    lines.push('<!-- ═══ TABLE ═══ -->');
    lines.push(section('table', tables));
    lines.push('');
  }

  // Summary section
  if (summary.length > 0) {
    lines.push('<!-- ═══ SUMMARY ═══ -->');
    lines.push('<div id="summary" style="margin-top: 12pt;">');
    lines.push(section('summary', summary));
    lines.push('</div>');
    lines.push('');
  }

  // Footer section
  if (footer.length > 0) {
    lines.push('<!-- ═══ FOOTER ═══ -->');
    lines.push('<div id="footer" style="margin-top: 12pt;">');
    lines.push(section('footer', footer));
    lines.push('</div>');
    lines.push('');
  }

  // Watermark section
  if (watermark.length > 0) {
    lines.push('<!-- ═══ WATERMARK ═══ -->');
    lines.push(section('watermark', watermark));
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
  // FreeMarker expression goes into the attribute raw — escapeXml would mangle the
  // !'' null-safe default into &apos; and break the expression when N/render runs (#4).
  const src = el.binding && useFreeMarker
    ? convertBindingToFreeMarker(el.binding, recordType)
    : escapeXml(el.src || '');

  return `<img src="${src}" style="width: ${el.w}pt; height: ${el.h}pt; object-fit: ${el.objectFit};" />`;
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
    // Null-safe list: record without sublist lines renders an empty table, not an error (#4)
    lines.push(`<#list (${recordType}.${el.binding})![] as ${listVar}>`);

    // Column span: conditionally render merged row or normal row
    if (spanField) {
      const spanStyle = `text-align: left; font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)};`;
      // [FUNC-2] Use first non-index column for span row label (index column has no meaningful value)
      const spanLabelCol = visibleCols.find((c) => !c.isIndex) ?? visibleCols[0];
      lines.push(`<#if ${listVar}.${spanField}?has_content>`);
      lines.push(`<tr><td colspan="${visibleCols.length}" style="${spanStyle}">\${${listVar}.${spanLabelCol.key}!''}</td></tr>`);
      lines.push('<#else>');
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        lines.push(`  <td style="${style}">\${${listVar}.${col.key}!''}</td>`);
      });
      lines.push('</tr>');
      lines.push('</#if>');
    } else {
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        lines.push(`  <td style="${style}">\${${listVar}.${col.key}!''}</td>`);
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
  const bound = !!el.binding && useFreeMarker;
  const value = bound
    ? convertBindingToFreeMarker(el.binding!, recordType)
    : escapeXml(el.value);

  // BFO supports barcode rendering via <barcode> tag
  const barcodeTypeMap: Record<string, string> = {
    code128: 'code128',
    code39: 'code3of9',
    ean13: 'ean13',
    qrcode: 'qrcode',
  };
  const bfoType = barcodeTypeMap[el.barcodeType] || 'code128';

  const barcodeTag = [
    `<!-- Barcode: ${escapeXml(el.name)} -->`,
    `<barcode codetype="${bfoType}" value="${value}"`,
    `  style="width: ${el.w}pt; height: ${el.h}pt;"`,
    `  showtext="true" />`,
  ].join('\n');

  if (!bound) return barcodeTag;

  // Verified on SB2 (#4): barcode with an empty value is a HARD BFO error
  // ('Missing "value" attribute in barcode') — null-safe !'' alone is not enough,
  // the whole element must be skipped when the bound field is empty.
  return [
    `<#if (${recordType}.${el.binding}!'')?has_content>`,
    barcodeTag,
    `</#if>`,
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

/**
 * Convert a JSON binding path to FreeMarker variable syntax.
 * Always null-safe (`!""`): one empty field must not kill the whole PDF —
 * N/render fails the entire render on an unresolvable expression (#4).
 */
function convertBindingToFreeMarker(path: string, recordType: string): string {
  return `\${${recordType}.${path}!''}`;
}

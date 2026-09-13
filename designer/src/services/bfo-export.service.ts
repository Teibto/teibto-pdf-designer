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
 * Resolve the current document's BFO source. Visual documents continue through
 * the single generator below; canonical XML documents return their source
 * verbatim so FreeMarker whitespace and directives are never rewritten.
 */
export function getCurrentBfoXml(
  state: Readonly<AppState>,
  options: BfoExportOptions = {},
): string {
  if (state.editorMode !== 'xml') return exportBfoXml(state, options);
  if (!state.rawXml.trim()) {
    throw new Error('Canonical XML is empty / XML ต้นฉบับว่างเปล่า');
  }
  return state.rawXml;
}

const EMBEDDED_IMAGE_ERROR = 'รูปภาพฝังไม่รองรับหรือข้อมูลเสียหาย กรุณาอัปโหลดไฟล์ PNG/JPEG ใหม่ '
  + '(Invalid or unsupported embedded image. Please upload a base64 PNG/JPEG file.)';
const MAX_EMBEDDED_DATA_URL_LENGTH = 2_000_000;
const MAX_EMBEDDED_IMAGE_DIMENSION = 4096;
const MAX_EMBEDDED_IMAGE_PIXELS = 16_777_216;

function invalidEmbeddedImage(): never {
  throw new Error(EMBEDDED_IMAGE_ERROR);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface EmbeddedImageLimits {
  maxDimension?: number;
  maxPixels?: number;
}

function assertSafeDimensions(
  width: number,
  height: number,
  limits: EmbeddedImageLimits,
): void {
  const maxDimension = limits.maxDimension ?? MAX_EMBEDDED_IMAGE_DIMENSION;
  const maxPixels = limits.maxPixels ?? MAX_EMBEDDED_IMAGE_PIXELS;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > maxDimension || height > maxDimension
    || width * height > maxPixels) {
    invalidEmbeddedImage();
  }
}

function assertPng(bytes: Uint8Array, limits: EmbeddedImageLimits): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) {
    invalidEmbeddedImage();
  }

  let offset = 8;
  let chunkIndex = 0;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (dataEnd > bytes.length - 4) invalidEmbeddedImage();
    const type = String.fromCharCode(...bytes.slice(typeStart, dataStart));
    if (!/^[A-Za-z]{4}$/.test(type)
      || crc32(bytes, typeStart, dataEnd) !== readUint32(bytes, crcOffset)) {
      invalidEmbeddedImage();
    }

    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) invalidEmbeddedImage();
      assertSafeDimensions(readUint32(bytes, dataStart), readUint32(bytes, dataStart + 4), limits);
    } else if (type === 'IHDR') {
      invalidEmbeddedImage();
    }
    if (type === 'IDAT') hasImageData = true;
    offset = crcOffset + 4;
    chunkIndex++;
    if (type === 'IEND') {
      if (length !== 0 || !hasImageData || offset !== bytes.length) invalidEmbeddedImage();
      return;
    }
  }
  invalidEmbeddedImage();
}

function assertJpeg(bytes: Uint8Array, limits: EmbeddedImageLimits): void {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    invalidEmbeddedImage();
  }

  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let hasDimensions = false;
  let hasScan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) invalidEmbeddedImage();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length - 2) invalidEmbeddedImage();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length - 2) invalidEmbeddedImage();
    if (startOfFrame.has(marker)) {
      if (length < 7) invalidEmbeddedImage();
      assertSafeDimensions(
        (bytes[offset + 5] << 8) | bytes[offset + 6],
        (bytes[offset + 3] << 8) | bytes[offset + 4],
        limits,
      );
      hasDimensions = true;
    }
    if (marker === 0xda) {
      hasScan = true;
      break; // Entropy-coded data is bounded by the validated URL and EOI.
    }
    offset += length;
  }
  if (!hasDimensions || !hasScan) invalidEmbeddedImage();
}

/**
 * BFO-safe embedded image policy. Data URLs are untrusted template content, so
 * validate both their declared MIME type and file signature before placing them
 * in the XML. In particular, this keeps active SVG content and BFO-unsupported
 * GIF/WebP payloads out of saved templates.
 */
export function assertSupportedEmbeddedImageData(
  dataUrl: string,
  limits: EmbeddedImageLimits = {},
): void {
  if (dataUrl.length > MAX_EMBEDDED_DATA_URL_LENGTH) invalidEmbeddedImage();
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) {
    invalidEmbeddedImage();
  }

  const mime = match[1].toLowerCase();
  let bytes: Uint8Array;
  try {
    const decoded = atob(match[2]);
    bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  } catch {
    invalidEmbeddedImage();
  }
  if (mime === 'png') assertPng(bytes, limits);
  else assertJpeg(bytes, limits);
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
  const watermarkText = (page.watermarkText ?? '').trim();
  const useMacros = headerElements.length > 0 || footerElements.length > 0 || watermarkText !== '';

  const macrolist = useMacros
    ? buildMacrolist(headerElements, footerElements, recordType, useFreeMarker, state.pagination, bands, byId, watermarkText)
    : '';

  const fontLink = buildFontLink();

  // Build CSS
  const css = buildBfoCss();

  // Build body HTML (header/footer live in macros when useMacros)
  const bodyHtml = buildBfoBody(elements, recordType, useFreeMarker, state.pagination, useMacros, bands, byId);

  const bodyAttrs = buildBodyAttrs(page, headerElements, footerElements, watermarkText, bands, byId);

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

/**
 * Embed the Thai font from the File Cabinet — server-side BFO has no system Thai
 * fonts, and any non-embedded font-family (Tahoma, NotoSansThai, …) makes it drop
 * Thai glyphs silently.
 *
 * The URL is bound to the per-account config record and resolved at render time,
 * never baked into the XML (#156, rule #32): a File Cabinet media URL carries an
 * `h=` token that changes when the font file is re-saved, so a baked URL turns a
 * working template into one whose Thai text vanishes later — with no error, because
 * BFO ignores an unreachable font. This is the same `<link>` the hand-written master
 * pack uses, so both paths break or work together.
 *
 * `name` is only an identifier for the CSS font-family; the file the config points
 * at must be THSarabunPSK — THSarabunNew leaves Thai tone marks floating because
 * BFO does not apply GPOS mark positioning (#32).
 */
function buildFontLink(): string {
  return '<link name="THSarabunNew" type="font" subtype="truetype"'
    + " src=\"${(company.fontRegular!'')?xml}\""
    + " src-bold=\"${(company.fontBold!'')?xml}\""
    // bytes="2" — 2-byte glyph encoding, required for non-Latin scripts
    + ' bytes="2" />';
}

/** Build BFO-compatible CSS */
function buildBfoCss(): string {
  const lines: string[] = [];

  // Always the embedded family (#156): buildFontLink() emits the <link> on every
  // export, so there is no path left where a non-embedded fallback would apply —
  // and a fallback family only ever produced Thai-less PDFs anyway.
  const fontFamily = 'THSarabunNew, sans-serif';

  // Base styles (page size/margins are <body> attributes in BFO, not @page CSS)
  lines.push(`body { font-family: ${fontFamily}; font-size: 10pt; color: #333; }`);
  // Headings (header-role elements render as <h2>) do NOT inherit the body font in
  // BFO — its default heading font is Latin-only, so Thai glyphs silently drop (a
  // header-type "บริษัท …" rendered as "( SB2)"). Force the embedded font on headings.
  lines.push(`h1, h2, h3, h4, h5, h6 { font-family: ${fontFamily}; }`);
  lines.push(`table { border-collapse: collapse; }`);
  lines.push(`th, td { padding: 4pt 6pt; }`);

  return lines.join('\n');
}

/** Bounding-box height (pt) of a group of elements, with breathing room */
function roleHeight(els: CanvasElement[], minHeight: number): number {
  if (els.length === 0) return 0;
  const top = Math.min(...els.map((e) => e.y ?? 0));
  const bottom = Math.max(...els.map((e) => (e.y ?? 0) + e.h));
  return Math.max(Math.ceil(bottom - top) + 8, minHeight);
}

/**
 * Band-owned macro height (#107). Three tiers keep legacy output stable:
 * - every row has a height → Σ heights (elementsToBands assigns telescoping
 *   y-slices, so an unedited band is byte-identical to the bbox math);
 * - NO row has a height (band persisted before #107) → legacy element bbox;
 * - mixed (rows added in the band editor carry no height) → per-row: stored
 *   height, else content estimate (tallest column = Σ stacked el.h).
 */
function roleHeightFromBand(
  band: Band | undefined,
  byId: Map<string, CanvasElement> | undefined,
  els: CanvasElement[],
  minHeight: number,
): number {
  if (!band || band.rows.length === 0 || band.rows.every((r) => r.height == null)) {
    return roleHeight(els, minHeight);
  }
  const estimate = (r: Band['rows'][number]): number =>
    Math.max(
      12,
      ...r.columns.map((c) =>
        c.elementIds.reduce((sum, id) => sum + (byId?.get(id)?.h ?? 0), 0),
      ),
    );
  const sum = band.rows.reduce((acc, r) => acc + (r.height ?? estimate(r)), 0);
  return Math.max(Math.ceil(sum) + 8, minHeight);
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
  // inCell = element sits in a multi-column <td width="%">, whose width already
  // governs the column. A text element must then fill the cell, not carry its own
  // fixed el.w — otherwise an edited/narrow band column can't shrink the element
  // and it overflows (verified on SB2, #47 3a). Single-column rows keep el.w.
  // stacked = the cell holds >1 element (hand-authored bands, #73). BFO's default
  // <p>/<h2>/<hr> margins then accumulate per element, growing the cell past the
  // roleHeight bounding box (header macro overflows into the body). Stacked cells
  // render tight (margin ~0); single-element cells keep the default rhythm.
  const cellHtml = (col: { elementIds: string[] }, out: string[], inCell: boolean) => {
    const stacked = col.elementIds.length > 1;
    for (const id of col.elementIds) {
      const el = byId.get(id);
      if (el) out.push(elementToHtml(el, recordType, useFreeMarker, pagination, inCell, stacked));
    }
  };

  const out: string[] = [];
  for (const row of band.rows) {
    if (row.columns.length <= 1) {
      if (row.columns[0]) cellHtml(row.columns[0], out, false);
      continue;
    }
    out.push('<table style="width: 100%; border-collapse: collapse;"><tr>');
    for (const col of row.columns) {
      out.push(`<td style="width: ${col.widthPct}%; vertical-align: top;">`);
      cellHtml(col, out, true);
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
  watermarkText = '',
): string {
  const lines: string[] = [];
  lines.push('<macrolist>');

  // Watermark (#100): background-macro paints behind the page content.
  // Horizontal faint gray only — BFO errors on transform:rotate and opacity
  // (probed on SB2 2026-07-20); absolute positioning IS honored.
  if (watermarkText) {
    lines.push('<macro id="nlwatermark">');
    lines.push(
      `<p style="position: absolute; top: 350pt; left: 0pt; width: 100%; ` +
      `text-align: center; font-size: 64pt; color: #e8e8e8;">${escapeXml(watermarkText)}</p>`,
    );
    lines.push('</macro>');
  }

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
  watermarkText = '',
  bands?: readonly Band[],
  byId?: Map<string, CanvasElement>,
): string {
  const attrs: string[] = [];

  const sizeName = page.size === 'Custom' ? 'A4' : page.size;
  attrs.push(`size="${sizeName}${page.orientation === 'landscape' ? '-LANDSCAPE' : ''}"`);

  if (headerElements.length > 0) {
    attrs.push('header="nlheader"');
    attrs.push(`header-height="${roleHeightFromBand(bands?.find((b) => b.role === 'header'), byId, headerElements, 24)}pt"`);
  }
  if (footerElements.length > 0) {
    attrs.push('footer="nlfooter"');
    // extra room for the appended "Page X of Y" line
    attrs.push(`footer-height="${roleHeightFromBand(bands?.find((b) => b.role === 'footer'), byId, footerElements, 20) + 14}pt"`);
  }

  if (watermarkText) {
    attrs.push('background-macro="nlwatermark"');
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
  inCell = false,
  stacked = false,
): string {
  const html = elementInnerHtml(el, recordType, useFreeMarker, pagination, inCell, stacked);
  // Conditional visibility (#90): render only when the guarded field has a
  // value. ?string first (JSON data source values are strings, but addRecord
  // models can be numbers) then ?length — NOT ?has_content, which reports
  // true for empty strings on the JSON data source (see #73 quirk).
  if (useFreeMarker && el.visibleIf) {
    return `<#if ((${recordType}.${el.visibleIf})!'')?string?length != 0>${html}</#if>`;
  }
  return html;
}

function elementInnerHtml(
  el: CanvasElement,
  recordType: string,
  useFreeMarker: boolean,
  pagination?: PaginationConfig,
  inCell = false,
  stacked = false,
): string {
  switch (el.type) {
    case 'text':
    case 'header':
      return textToHtml(el as TextElement, recordType, useFreeMarker, inCell, stacked);
    case 'image':
      return imageToHtml(el as ImageElement, recordType, useFreeMarker);
    case 'table':
      return tableToHtml(el as TableElement, recordType, useFreeMarker, pagination);
    case 'shape':
      return shapeToHtml(el as ShapeElement);
    case 'line':
      return lineToHtml(el as LineElement, stacked);
    case 'barcode':
      return barcodeToHtml(el as BarcodeElement, recordType, useFreeMarker);
    case 'list':
      return listToHtml(el as ListElement, recordType, useFreeMarker);
    default:
      return `<!-- ${(el as CanvasElement).type}: ${(el as CanvasElement).name} (not supported in BFO) -->`;
  }
}

function textToHtml(el: TextElement, recordType: string, useFreeMarker: boolean, inCell = false, stacked = false): string {
  const style = [
    `font-size: ${sanitizeNumericCss(el.fontSize, 'pt', 1, 200)}`,
    `font-weight: ${el.fontWeight === 'bold' ? 'bold' : 'normal'}`,
    `color: ${sanitizeColor(el.color)}`,
    `text-align: ${['left', 'center', 'right'].includes(el.textAlign) ? el.textAlign : 'left'}`,
    // In a multi-column cell the <td width%> governs the width; a fixed el.w would
    // overflow an edited/narrow column, so the text fills the cell instead (#47 3a).
    ...(inCell ? [] : [`width: ${sanitizeNumericCss(el.w, 'pt', 0, 5000)}`]),
    // Stacked cell: default <p>/<h2> margins accumulate per element and overflow
    // the band's roleHeight box — render tight; width 100% because BFO
    // shrink-fits a stacked <h2>/<p> to its text, which defeats
    // text-align: center (title rendered flush-left, #73).
    ...(stacked ? ['margin: 0 0 2pt 0', 'width: 100%'] : []),
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
  let src: string;
  if (el.binding && useFreeMarker) {
    src = convertBindingToFreeMarker(el.binding, recordType);
  } else if (el.imageData) {
    assertSupportedEmbeddedImageData(el.imageData);
    src = escapeXml(el.imageData);
  } else {
    src = escapeXml(el.src || '');
  }

  // `object-fit` ไม่ถูกส่งลง XML: พิสูจน์บน SB2 2026-07-26 (#195) ว่า BFO ให้ภาพ
  // เหมือนกันทุกประการไม่ว่าจะ contain / cover / ไม่ใส่เลย · ปล่อยลงไปมีแต่จะทำให้
  // ตัวตรวจกับดักเตือนทุกครั้งจนผู้ใช้เลิกอ่านคำเตือน · el.objectFit ยังมีผลกับ
  // พรีวิวบนจอของดีไซเนอร์ตามเดิม · กล่องครบสองแกนคือสิ่งที่ BFO ใช้จริง (#178)
  const img = `<img src="${src}" style="width: ${el.w}pt; height: ${el.h}pt;" />`;
  if (el.binding && useFreeMarker) {
    // An empty bound URL (e.g. company.logo not configured) renders BFO's
    // broken-image box — skip the img entirely instead (#73). NOT ?has_content:
    // N/render's JSON data source reports has_content=true for a 0-length
    // string (verified on SB2), so test the length.
    return `<#if (${recordType}.${el.binding}!'')?length != 0>${img}</#if>`;
  }
  return img;
}

/**
 * Generate inline CSS for a table cell based on column overflow mode.
 *
 * ที่ BFO ทำจริง (พิสูจน์บน SB2 2026-07-26, #195): `white-space: nowrap` กับ
 * `overflow: hidden` **ตัดข้อความที่ยาวเกินคอลัมน์ได้จริง** ส่วน `text-overflow: ellipsis`
 * ไม่เพิ่มอะไรเลย — ไม่มี `…` ต่อท้าย ผลออกมาเท่ากับโหมด clip ทุกประการ จึงไม่ส่งลง XML
 * (โหมด ellipsis ยังต่างจาก clip ในพรีวิวบนจอของดีไซเนอร์ตามเดิม)
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
    // เท่ากับ clip บนกระดาษ — BFO ไม่วาด `…` ให้ (#195)
    parts.push('white-space: nowrap');
    parts.push('overflow: hidden');
  } else {
    // clip
    parts.push('white-space: nowrap');
    parts.push('overflow: hidden');
  }

  return parts.join('; ') + ';';
}

/**
 * FreeMarker expression for a table cell value, applying col.format (#77).
 *
 * N/render's JSON custom data source delivers EVERY value as a string
 * (verified on SB2 — ?is_number is never true on that path), so numeric
 * formats regex-test the string (?matches) and coerce with ?number: a raw
 * numeric string ("1234.5") parses and gets the pattern; an already-formatted
 * string ("1,234.50" — the curated invoice data) fails the regex and falls
 * through unchanged, so existing templates render identically. ?is_number
 * stays as the fast path for real numeric models (addRecord). NOT
 * <#attempt>+?number: a failing #assign inside #attempt leaves the previous
 * cell's value in the var and renders it (verified on SB2 — values leak
 * across cells). Mirrors client-side formatCellValue (utils/format.ts).
 */
function cellValueFm(listVar: string, col: TableColumn): string {
  const passthrough = `\${(${listVar}.${col.key}!'')?string?xml?replace('\\n', '<br/>')}`;
  const fmt = col.format ?? 'text';
  if (fmt === 'text') return passthrough;

  const assign = `<#assign _cv = (${listVar}.${col.key})!''>`;
  // Re-derive the passthrough from _cv so the fallback branch stays in sync
  const fallback = `\${_cv?string?xml?replace('\\n', '<br/>')}`;

  // Numeric formats: number fast path, then string→number coercion (regex
  // pre-validated so ?number can never throw), then raw passthrough
  const numeric = (expr: (v: string) => string) =>
    `${assign}<#if _cv?is_number>${expr('_cv')}` +
    `<#elseif _cv?is_string && _cv?trim?matches(r"-?[0-9]+(\\.[0-9]+)?")>` +
    `<#assign _cn = _cv?trim?number>${expr('_cn')}` +
    `<#else>${fallback}</#if>`;

  switch (fmt) {
    case 'number':
      return numeric((v) => `\${${v}?string("#,##0.##")}`);
    case 'currency':
      return numeric((v) => `\${${v}?string("#,##0.00")}`);
    case 'percent':
      // |v| <= 1 (and non-zero) is a decimal fraction → ×100, else already a
      // percentage — same heuristic as formatPercent (utils/format.ts).
      return numeric(
        (v) =>
          `<#if ${v} gte -1 && ${v} lte 1 && ${v} != 0>\${(${v} * 100)?string("#,##0.0")}%` +
          `<#else>\${${v}?string("#,##0.0")}%</#if>`,
      );
    case 'date':
      // Strings can't be date-parsed reliably (→ fallback); only a real date
      // model (addRecord path) can be reformatted.
      return `${assign}<#if _cv?is_date>\${_cv?string('dd/MM/yyyy')}<#else>${fallback}</#if>`;
    default:
      return passthrough;
  }
}

function tableToHtml(el: TableElement, recordType: string, useFreeMarker: boolean, pagination?: PaginationConfig): string {
  if (el.columns.length === 0) return `<!-- table ${el.name}: no columns configured -->`;

  const visibleCols = el.columns.filter((c) => !c.hidden);
  const lines: string[] = [];
  const spanField = pagination?.columnSpanField ?? '';

  lines.push(`<table style="width: ${el.w}pt; border: 0.5pt solid ${el.borderColor};">`);

  // Header — skipped entirely when no column has a label (bordered key/value
  // grids like doc-info/summary would otherwise print a stray empty row, #73).
  if (visibleCols.some((c) => c.label !== '')) {
    lines.push('<thead>');

    // Column groups (#104): a leading row where ADJACENT columns sharing the
    // same non-empty group merge into one colspan cell. colspan only — rowspan
    // is unverified on BFO, so ungrouped columns get an empty cell here and
    // keep their label in the row below.
    const hasGroups = visibleCols.some((c) => (c.group ?? '').trim() !== '');
    if (hasGroups) {
      const groupStyle = `background-color: ${sanitizeColor(el.headerBgColor)}; color: ${sanitizeColor(el.headerTextColor)}; text-align: center; font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)};`;
      lines.push('<tr>');
      for (let i = 0; i < visibleCols.length; ) {
        const group = (visibleCols[i].group ?? '').trim();
        let span = 1;
        while (
          group !== '' &&
          i + span < visibleCols.length &&
          (visibleCols[i + span].group ?? '').trim() === group
        ) span++;
        if (group !== '') {
          lines.push(`  <th colspan="${span}" style="${groupStyle}"><p style="margin: 0; text-align: center;">${escapeXml(group)}</p></th>`);
        } else {
          lines.push(`  <th style="${groupStyle}"><p style="margin: 0;">&#160;</p></th>`);
        }
        i += span;
      }
      lines.push('</tr>');
    }

    lines.push('<tr>');
    visibleCols.forEach((col) => {
      const style = `background-color: ${sanitizeColor(el.headerBgColor)}; color: ${sanitizeColor(el.headerTextColor)}; text-align: ${col.align}; font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)}; width: ${col.width}pt;`;
      // Wrapped in a block <p> with its own alignment: BFO justifies bare text
      // that wraps inside a th/td (letter-spacing stretch, "A m o u n t") and
      // th text-align does not stop it (#73; netsuite-bfo-pdf truth table).
      lines.push(`  <th style="${style}"><p style="margin: 0; text-align: ${col.align};">${escapeXml(col.label)}</p></th>`);
    });
    lines.push('</tr>');
    lines.push('</thead>');
  }

  // Body (FreeMarker loop)
  lines.push('<tbody>');

  // Fill only the ITEM table (role 'table') — key/value grids bound to arrays
  // (doc-info role 'header', summary role 'summary') must keep their natural
  // height or the padding shoves the summary onto a new page (#84).
  const fillN = pagination?.fillLastPage && el.role === 'table'
    ? (pagination.rowsPerPage || 0) : 0;

  if (useFreeMarker && el.binding) {
    const listVar = el.binding.split('.').pop() || 'item';

    // Section subtotal (#106): sum the flagged columns per section (rows
    // delimited by columnSpanField headers) and emit a bold subtotal row
    // before the next section header + after the last data row. FreeMarker
    // accumulate — works on both preview-live and Print without touching the
    // data lib. JSON data-source values are ALL strings and the curated
    // invoice data pre-formats them ("1,234.50"), so each value is
    // comma-stripped and regex-gated before ?number. NOT <#attempt>+#assign:
    // a failing assign inside attempt leaks the previous value (SB2, #77).
    const stCols = spanField && pagination?.sectionSubtotal
      ? visibleCols.filter((c) => c.subtotal && !c.isIndex)
      : [];
    const stVar = (c: TableColumn) => `_st_${c.key.replace(/[^A-Za-z0-9_]/g, '_')}`;
    const emitSubtotalRow = () => {
      const labelCol = visibleCols.find((c) => !stCols.includes(c));
      const label = escapeXml((pagination?.sectionSubtotalLabel ?? '').trim() || 'รวม');
      lines.push('<#if _sec != 0>');
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = `font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)}; text-align: ${col.align};`;
        if (stCols.includes(col)) {
          lines.push(`  <td style="${style}"><p style="margin: 0; text-align: ${col.align};">\${${stVar(col)}?string("#,##0.00")}</p></td>`);
        } else if (col === labelCol) {
          lines.push(`  <td style="${style}"><p style="margin: 0; text-align: ${col.align};">${label}</p></td>`);
        } else {
          lines.push(`  <td style="${style}"><p style="margin: 0;">&#160;</p></td>`);
        }
      });
      lines.push('</tr>');
      // Subtotal rows occupy table height — count them into the fill total
      // (#84) or the last page loses alignment by one row per section.
      if (fillN > 0) lines.push('<#assign _rc = _rc + 1>');
      stCols.forEach((c) => lines.push(`<#assign ${stVar(c)} = 0>`));
      lines.push('<#assign _sec = 0>');
      lines.push('</#if>');
    };

    // Row counter for last-page fill (#84) — NOT ?size: on the JSON data
    // source ?size prints blank silently (netsuite-bfo-pdf truth table)
    if (fillN > 0) lines.push('<#assign _rc = 0>');
    if (stCols.length) {
      lines.push('<#assign _sec = 0>');
      stCols.forEach((c) => lines.push(`<#assign ${stVar(c)} = 0>`));
    }
    // Null-safe list: record without sublist lines renders an empty table, not an error (#4)
    lines.push(`<#list (${recordType}.${el.binding})![] as ${listVar}>`);

    // Column span: conditionally render merged row or normal row
    if (spanField) {
      const spanStyle = `text-align: left; font-weight: bold; padding: 4pt 6pt; border: 0.5pt solid ${sanitizeColor(el.borderColor)};`;
      // [FUNC-2] Use first non-index column for span row label (index column has no meaningful value)
      const spanLabelCol = visibleCols.find((c) => !c.isIndex) ?? visibleCols[0];
      // NOT ?has_content: on the JSON data source it returns true for '' AND
      // for missing keys (probe-proven SB2 2026-07-20, #111) — every row would
      // render as a span row. Only a ?length check separates empty from set.
      lines.push(`<#if ((${listVar}.${spanField})!'')?length != 0>`);
      if (stCols.length) emitSubtotalRow();
      // ?xml like every other cell — a raw & in the section name must not
      // break the whole render (#111).
      lines.push(`<tr><td colspan="${visibleCols.length}" style="${spanStyle}">\${(${listVar}.${spanLabelCol.key}!'')?string?xml}</td></tr>`);
      lines.push('<#else>');
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        lines.push(`  <td style="${style}">${cellValueFm(listVar, col)}</td>`);
      });
      lines.push('</tr>');
      if (stCols.length) {
        lines.push('<#assign _sec = _sec + 1>');
        stCols.forEach((c) => {
          lines.push(`<#assign _sv = (${listVar}.${c.key})!''>`);
          lines.push(
            `<#if _sv?is_number><#assign ${stVar(c)} = ${stVar(c)} + _sv>` +
            `<#elseif _sv?is_string && _sv?trim?replace(',','')?matches(r"-?[0-9]+(\\.[0-9]+)?")>` +
            `<#assign ${stVar(c)} = ${stVar(c)} + _sv?trim?replace(',','')?number></#if>`,
          );
        });
      }
      lines.push('</#if>');
    } else {
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        // ?xml first (a raw & in data — "Discount & FOC" — breaks the BFO parse),
        // then \n → <br/> so multi-line cells (item code + memo) print as lines.
        // ?string keeps numeric values (legacy templates) safe for ?xml (#73).
        // Cell text sits in a block <p> with its own alignment — BFO justifies
        // bare text that wraps inside a td (letter/word-spacing stretch on long
        // Thai descriptions), same quirk as the th headers (#75).
        const pOpen = `<p style="margin: 0; text-align: ${col.align};">`;
        if (col.boldFirstLine) {
          // First line bold (item name), remaining lines (memo) regular — the
          // reference scans by bold item names (#73).
          lines.push(
            `  <td style="${style}">${pOpen}<#assign _bfl = (${listVar}.${col.key}!'')?string?xml>` +
            `<#if _bfl?index_of('\\n') != -1><b>\${_bfl?keep_before('\\n')}</b><br/>\${_bfl?keep_after('\\n')?replace('\\n', '<br/>')}` +
            `<#else><b>\${_bfl}</b></#if></p></td>`,
          );
        } else {
          lines.push(`  <td style="${style}">${pOpen}${cellValueFm(listVar, col)}</p></td>`);
        }
      });
      lines.push('</tr>');
    }

    if (fillN > 0) lines.push('<#assign _rc = _rc + 1>');
    lines.push(`</#list>`);
    // Close the last open section (#106) — no trailing header row triggers it
    if (stCols.length) emitSubtotalRow();

    // Last-page fill (#84): pad with empty rows so the printed row count is a
    // multiple of rowsPerPage — the table box keeps a constant height and the
    // summary block below it stays anchored instead of floating up. An empty
    // table fills a whole page; an exact multiple gets no padding. Modulo
    // returns a double in FreeMarker → ?int before the range.
    if (fillN > 0) {
      lines.push(`<#assign _fill = (${fillN} - (_rc % ${fillN}))?int>`);
      lines.push(`<#if _fill == ${fillN} && _rc != 0><#assign _fill = 0></#if>`);
      lines.push('<#if _fill gt 0><#list 1.._fill as _f>');
      lines.push('<tr>');
      visibleCols.forEach((col) => {
        const style = cellOverflowStyle(col, el.borderColor);
        lines.push(`  <td style="${style}"><p style="margin: 0;">&#160;</p></td>`);
      });
      lines.push('</tr>');
      lines.push('</#list></#if>');
    }
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

function lineToHtml(el: LineElement, stacked = false): string {
  // Stacked cell: the cell width governs (a fixed el.w can poke past a narrow
  // column) and default <hr> margins accumulate — fill the cell, tight margins.
  const size = stacked ? 'width: 100%; margin: 1pt 0;' : `width: ${el.w}pt;`;
  return `<hr style="border: none; border-top: ${el.lineWidth}pt ${el.lineStyle} ${el.lineColor}; ${size}" />`;
}

function barcodeToHtml(el: BarcodeElement, recordType: string, useFreeMarker: boolean): string {
  const bound = !!el.binding && useFreeMarker;
  const value = bound
    ? convertBindingToFreeMarker(el.binding!, recordType)
    : escapeXml(el.value);

  // BFO supports barcode rendering via <barcode> tag
  const barcodeTypeMap: Record<string, string> = {
    code128: 'code128',
    code39: 'code39',
    ean13: 'ean13',
    qrcode: 'qrcode',
  };
  if (typeof el.barcodeType !== 'string' || !Object.hasOwn(barcodeTypeMap, el.barcodeType)) {
    throw new Error('Unsupported barcode type. Choose Code 128, Code 39, EAN-13 or QR Code before exporting.');
  }
  const bfoType = barcodeTypeMap[el.barcodeType];
  // BFO stretches a QR symbol to both supplied dimensions. Fit it inside the
  // user frame without changing its square modules when switching from a
  // linear barcode or resizing a previously saved rectangular frame.
  const isQr = bfoType === 'qrcode';
  const isEan = bfoType === 'ean13';
  const qrSide = Math.min(el.w, el.h);
  const width = isQr ? qrSide : el.w;
  const height = isQr ? qrSide : el.h;

  const symbol = [
    `<!-- Barcode: ${escapeXml(el.name)} -->`,
    `<barcode codetype="${bfoType}" value="${value}"`,
    // Native EAN13 rejects width even for valid values. Size its 95 modules plus
    // 11/7-module quiet zones through bar-width, retaining the requested frame.
    isEan
      ? `  bar-width="${el.w / 113}" style="height: ${height}pt;"`
      : `  style="width: ${width}pt; height: ${height}pt;"`,
    `  showtext="true" />`,
  ].join('\n');
  const barcodeTag = isQr || isEan ? [
    `<table cellpadding="0" cellspacing="0" style="width: ${el.w}pt; height: ${el.h}pt; border: 0;">`,
    `  <tr><td align="center" valign="middle" style="padding: 0;">${symbol}</td></tr>`,
    `</table>`,
  ].join('\n') : symbol;

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
  // ?xml is mandatory, not cosmetic (#184): BFO parses FreeMarker's output as XML,
  // so a value carrying `&` or `<` (an item description "Laser & Inkjet", a company
  // name "A & B") kills the WHOLE document — "Error Parsing XML: The entity name
  // must immediately follow the '&'" — not just that field. Proven on SB2 with a
  // real invoice; the master pack and validate-templates.sh enforce the same rule.
  return `\${(${recordType}.${path}!'')?xml}`;
}

/**
 * Validation Service — Production Grade
 * Input validation, template schema validation, XML sanitization.
 *
 * @author Wichit Wongta
 */
import type {
  ElementType,
  ElementRoleType,
  TextElement,
  TableElement,
  TableColumn,
} from '../models/element';
import type { PageConfig, PageSizeName, Orientation } from '../models/page';
import type { PaginationConfig } from '../models/template';

// ─── Constants ───

const VALID_ELEMENT_TYPES: ElementType[] = [
  'header', 'text', 'image', 'table', 'shape', 'line', 'barcode', 'list',
];

const VALID_ROLES: ElementRoleType[] = [
  'header', 'content', 'table', 'summary', 'footer', 'watermark',
];

const VALID_PAGE_SIZES: PageSizeName[] = ['A4', 'Letter', 'A3', 'A5', 'Custom'];
const VALID_ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];

// ─── Validation Result ───

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

function ok(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

function fail(errors: ValidationError[], warnings: ValidationWarning[] = []): ValidationResult {
  return { valid: false, errors, warnings };
}

function merge(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);
  return { valid: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════
// ELEMENT VALIDATION
// ═══════════════════════════════════════

const VALID_BARCODE_TYPES = new Set(['code128', 'code39', 'ean13', 'qrcode']);

function validateBarcodeType(value: unknown, path: string): ValidationResult {
  if (typeof value !== 'string' || !VALID_BARCODE_TYPES.has(value)) {
    return fail([{
      path,
      message: 'Barcode type must be code128, code39, ean13, or qrcode',
      code: 'INVALID_BARCODE_TYPE',
    }]);
  }
  return ok();
}

/** Validate a single element's properties */
export function validateElement(el: unknown, index: number): ValidationResult {
  const prefix = `elements[${index}]`;

  if (!el || typeof el !== 'object') {
    return fail([{ path: prefix, message: 'Element must be an object', code: 'INVALID_TYPE' }]);
  }

  const e = el as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Required fields
  if (!e.id || typeof e.id !== 'string') {
    errors.push({ path: `${prefix}.id`, message: 'Missing or invalid id', code: 'MISSING_ID' });
  }
  if (!e.type || !VALID_ELEMENT_TYPES.includes(e.type as ElementType)) {
    errors.push({ path: `${prefix}.type`, message: `Invalid type: ${e.type}`, code: 'INVALID_ELEMENT_TYPE' });
  }
  if (!e.role || !VALID_ROLES.includes(e.role as ElementRoleType)) {
    errors.push({ path: `${prefix}.role`, message: `Invalid role: ${e.role}`, code: 'INVALID_ROLE' });
  }

  // Numeric bounds — x/y are optional legacy-import coords (#107): validate
  // only when present so band-created elements (no x/y) pass.
  if (e.x !== undefined && (typeof e.x !== 'number' || !isFinite(e.x))) {
    errors.push({ path: `${prefix}.x`, message: 'x must be a finite number', code: 'INVALID_NUMBER' });
  }
  if (e.y !== undefined && (typeof e.y !== 'number' || !isFinite(e.y))) {
    errors.push({ path: `${prefix}.y`, message: 'y must be a finite number', code: 'INVALID_NUMBER' });
  }
  if (typeof e.w !== 'number' || (e.w as number) < 1) {
    errors.push({ path: `${prefix}.w`, message: 'Width must be >= 1', code: 'INVALID_DIMENSION' });
  }
  if (typeof e.h !== 'number' || (e.h as number) < 1) {
    errors.push({ path: `${prefix}.h`, message: 'Height must be >= 1', code: 'INVALID_DIMENSION' });
  }

  // Width/height sanity check (max 5000pt ≈ 70 inches)
  if (typeof e.w === 'number' && e.w > 5000) {
    warnings.push({ path: `${prefix}.w`, message: `Unusually large width: ${e.w}pt` });
  }
  if (typeof e.h === 'number' && e.h > 5000) {
    warnings.push({ path: `${prefix}.h`, message: `Unusually large height: ${e.h}pt` });
  }

  // Type-specific validation
  if (e.type === 'barcode') {
    errors.push(...validateBarcodeType(e.barcodeType, `${prefix}.barcodeType`).errors);
  }
  if (e.type === 'text' || e.type === 'header') {
    const te = e as Partial<TextElement>;
    if (typeof te.fontSize === 'number' && (te.fontSize < 1 || te.fontSize > 200)) {
      errors.push({ path: `${prefix}.fontSize`, message: 'Font size must be 1-200', code: 'OUT_OF_RANGE' });
    }
    if (te.textAlign && !['left', 'center', 'right'].includes(te.textAlign)) {
      errors.push({ path: `${prefix}.textAlign`, message: `Invalid textAlign: ${te.textAlign}`, code: 'INVALID_ENUM' });
    }
  }

  if (e.type === 'table') {
    const te = e as Partial<TableElement>;
    if (te.columns && Array.isArray(te.columns)) {
      for (let ci = 0; ci < te.columns.length; ci++) {
        const colResult = validateTableColumn(te.columns[ci], `${prefix}.columns[${ci}]`);
        errors.push(...colResult.errors);
        warnings.push(...colResult.warnings);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate a table column config */
function validateTableColumn(col: unknown, prefix: string): ValidationResult {
  if (!col || typeof col !== 'object') {
    return fail([{ path: prefix, message: 'Column must be an object', code: 'INVALID_TYPE' }]);
  }

  const c = col as Partial<TableColumn>;
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!c.key || typeof c.key !== 'string') {
    errors.push({ path: `${prefix}.key`, message: 'Column key is required', code: 'MISSING_KEY' });
  }

  if (typeof c.width === 'number' && c.width < 0) {
    errors.push({ path: `${prefix}.width`, message: 'Column width must be >= 0', code: 'INVALID_DIMENSION' });
  }

  const validFormats = ['text', 'number', 'currency', 'date', 'percent'];
  if (c.format && !validFormats.includes(c.format)) {
    warnings.push({ path: `${prefix}.format`, message: `Unknown format: ${c.format}, defaulting to text` });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════
// TEMPLATE VALIDATION
// ═══════════════════════════════════════

/** Validate a full template for import */
export function validateTemplate(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') {
    return fail([{ path: '', message: 'Template must be a JSON object', code: 'INVALID_FORMAT' }]);
  }

  const t = data as Record<string, unknown>;
  const results: ValidationResult[] = [];
  const warnings: ValidationWarning[] = [];

  // Required top-level fields
  if (!t.name || typeof t.name !== 'string') {
    results.push(fail([{ path: 'name', message: 'Template name is required', code: 'MISSING_NAME' }]));
  }

  // Version check
  if (t.version && typeof t.version === 'string') {
    const majorVersion = parseInt(t.version.split('.')[0], 10);
    if (majorVersion < 2) {
      warnings.push({ path: 'version', message: `Template version ${t.version} may need migration` });
    }
  }

  // Elements
  if (!Array.isArray(t.elements)) {
    results.push(fail([{ path: 'elements', message: 'elements must be an array', code: 'INVALID_TYPE' }]));
  } else {
    for (let i = 0; i < t.elements.length; i++) {
      results.push(validateElement(t.elements[i], i));
    }

    // Check for duplicate IDs
    const ids = (t.elements as any[]).map((e) => e?.id).filter(Boolean);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      results.push(fail([{
        path: 'elements',
        message: `Duplicate element IDs: ${dupes.join(', ')}`,
        code: 'DUPLICATE_ID',
      }]));
    }
  }

  // Page config
  if (t.page && typeof t.page === 'object') {
    results.push(validatePageConfig(t.page));
  }

  // Pagination config
  if (t.pagination && typeof t.pagination === 'object') {
    results.push(validatePaginationConfig(t.pagination));
  }

  const merged = merge(...results);
  merged.warnings.push(...warnings);
  return merged;
}

/** Validate page configuration */
export function validatePageConfig(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') return ok();

  const p = data as Partial<PageConfig>;
  const errors: ValidationError[] = [];

  if (p.size && !VALID_PAGE_SIZES.includes(p.size)) {
    errors.push({ path: 'page.size', message: `Invalid page size: ${p.size}`, code: 'INVALID_PAGE_SIZE' });
  }

  if (p.orientation && !VALID_ORIENTATIONS.includes(p.orientation)) {
    errors.push({ path: 'page.orientation', message: `Invalid orientation: ${p.orientation}`, code: 'INVALID_ORIENTATION' });
  }

  if (typeof p.width === 'number' && (p.width < 100 || p.width > 5000)) {
    errors.push({ path: 'page.width', message: 'Page width must be 100-5000pt', code: 'OUT_OF_RANGE' });
  }

  if (typeof p.height === 'number' && (p.height < 100 || p.height > 5000)) {
    errors.push({ path: 'page.height', message: 'Page height must be 100-5000pt', code: 'OUT_OF_RANGE' });
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

/** Validate pagination configuration */
export function validatePaginationConfig(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') return ok();

  const p = data as Partial<PaginationConfig>;
  const errors: ValidationError[] = [];

  if (p.mode && !['rows', 'height'].includes(p.mode)) {
    errors.push({ path: 'pagination.mode', message: `Invalid mode: ${p.mode}`, code: 'INVALID_ENUM' });
  }

  if (typeof p.rowsPerPage === 'number' && (p.rowsPerPage < 1 || p.rowsPerPage > 1000)) {
    errors.push({ path: 'pagination.rowsPerPage', message: 'Rows per page must be 1-1000', code: 'OUT_OF_RANGE' });
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

// ═══════════════════════════════════════
// PROPERTY UPDATE VALIDATION
// ═══════════════════════════════════════

/** Allowed keys per element type for updateElement() */
const ALLOWED_KEYS: Record<string, Set<string>> = {
  _base: new Set(['name', 'role', 'binding', 'visibleIf', 'locked', 'visible']),
  text: new Set(['content', 'fontSize', 'fontWeight', 'color', 'textAlign', 'fontFamily']),
  header: new Set(['content', 'fontSize', 'fontWeight', 'color', 'textAlign', 'fontFamily']),
  image: new Set(['src', 'imageData', 'objectFit']),
  table: new Set(['columns', 'headerBgColor', 'headerTextColor', 'borderColor', 'alternateRowColor']),
  shape: new Set(['bgColor', 'borderRadius', 'opacity']),
  line: new Set(['lineColor', 'lineWidth', 'lineStyle']),
  barcode: new Set(['value', 'barcodeType']),
  list: new Set(['items', 'fontSize', 'color', 'listStyle']),
};

/** Validate a property update before applying */
export function validatePropertyUpdate(
  elementType: ElementType,
  key: string,
  value: unknown,
): ValidationResult {
  const baseKeys = ALLOWED_KEYS._base;
  const typeKeys = ALLOWED_KEYS[elementType];

  if (!baseKeys.has(key) && (!typeKeys || !typeKeys.has(key))) {
    return fail([{
      path: `${elementType}.${key}`,
      message: `Property '${key}' is not valid for element type '${elementType}'`,
      code: 'INVALID_PROPERTY',
    }]);
  }

  // Type-specific value validation
  if (key === 'barcodeType') return validateBarcodeType(value, key);
  if (key === 'fontSize' && (typeof value !== 'number' || value < 1 || value > 200)) {
    return fail([{ path: key, message: 'Font size must be 1-200', code: 'OUT_OF_RANGE' }]);
  }

  if (key === 'opacity' && (typeof value !== 'number' || value < 0 || value > 1)) {
    return fail([{ path: key, message: 'Opacity must be 0-1', code: 'OUT_OF_RANGE' }]);
  }

  if (key === 'lineWidth' && (typeof value !== 'number' || value < 0.1 || value > 50)) {
    return fail([{ path: key, message: 'Line width must be 0.1-50', code: 'OUT_OF_RANGE' }]);
  }

  if (key === 'borderRadius' && (typeof value !== 'number' || value < 0 || value > 500)) {
    return fail([{ path: key, message: 'Border radius must be 0-500', code: 'OUT_OF_RANGE' }]);
  }

  return ok();
}

// ═══════════════════════════════════════
// XML SANITIZATION (for BFO export)
// ═══════════════════════════════════════

/** Escape special XML characters to prevent injection */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Sanitize a CSS color value (must be hex or named color) */
export function sanitizeColor(color: string): string {
  // Allow hex colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  // Allow named colors
  if (/^[a-zA-Z]+$/.test(color)) return color;
  // Allow rgb/rgba
  if (/^rgba?\(\d+,\s*\d+,\s*\d+/.test(color)) return color;
  // Default to black
  return '#000000';
}

/** Sanitize a CSS numeric value */
export function sanitizeNumericCss(value: number, unit: string, min: number, max: number): string {
  const clamped = Math.max(min, Math.min(max, value));
  return `${clamped}${unit}`;
}

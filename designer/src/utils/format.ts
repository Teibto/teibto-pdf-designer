/**
 * Data Formatting Utilities
 * Format cell values for display and PDF export.
 *
 * @author Wichit Wongta
 */

export type FormatType = 'text' | 'number' | 'currency' | 'date' | 'percent';

/** Format a cell value based on column format type */
export function formatCellValue(
  value: unknown,
  format: FormatType,
): string {
  if (value === null || value === undefined) return '';

  switch (format) {
    case 'number':
      return formatNumber(value);
    case 'currency':
      return formatCurrency(value);
    case 'date':
      return formatDate(value);
    case 'percent':
      return formatPercent(value);
    case 'text':
    default:
      return String(value);
  }
}

/** Format number with thousand separators */
export function formatNumber(value: unknown): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return String(value);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Format as Thai Baht currency */
export function formatCurrency(value: unknown): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return String(value);
  return num.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format date string */
export function formatDate(value: unknown): string {
  const str = String(value);
  try {
    const date = new Date(str);
    if (isNaN(date.getTime())) return str;
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return str;
  }
}

/** Format as percentage */
export function formatPercent(value: unknown): string {
  let str = String(value).trim();
  // Strip existing % suffix if present
  if (str.endsWith('%')) {
    str = str.slice(0, -1).trim();
  }
  const num = typeof value === 'number' ? value : parseFloat(str);
  if (isNaN(num)) return String(value);
  // Values > 1 are treated as already-percentage (e.g., 50 → "50.0%")
  // Values <= 1 are treated as decimals (e.g., 0.5 → "50.0%")
  const display = Math.abs(num) <= 1 && num !== 0 ? num * 100 : num;
  return `${display.toFixed(1)}%`;
}

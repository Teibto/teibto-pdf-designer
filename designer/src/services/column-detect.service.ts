/**
 * Auto-detect Table Columns from JSON Data
 * Analyzes array data to infer column definitions automatically.
 *
 * @author Wichit Wongta
 */
import type { TableColumn } from '../models/element';
import type { AppStore } from '../state/store';
import { getNestedValue as getValueByPath } from '../services/binding.service';

/** Try to guess the best format for a column based on its values */
function guessFormat(values: unknown[]): TableColumn['format'] {
  const samples = values
    .filter((v) => v != null && v !== '')
    .slice(0, 20);

  if (samples.length === 0) return 'text';

  let numberCount = 0;
  let currencyCount = 0;
  let dateCount = 0;
  let percentCount = 0;

  for (const val of samples) {
    const str = String(val).trim();

    // Check percent
    if (/^-?\d+(\.\d+)?%$/.test(str)) {
      percentCount++;
      continue;
    }

    // Check currency patterns (฿, $, €, ¥ prefix/suffix, or comma-separated numbers)
    if (/^[฿$€¥£][\s]?[\d,]+(\.\d{1,2})?$/.test(str) ||
        /^[\d,]+(\.\d{1,2})?\s?[฿$€¥£]$/.test(str) ||
        /^[\d,]+\.\d{2}$/.test(str)) {
      currencyCount++;
      continue;
    }

    // Check date patterns
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str) ||
        /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(str)) {
      dateCount++;
      continue;
    }

    // Check plain number
    if (!isNaN(Number(str)) && str !== '') {
      numberCount++;
      continue;
    }
  }

  const total = samples.length;
  if (percentCount > total * 0.6) return 'percent';
  if (currencyCount > total * 0.6) return 'currency';
  if (dateCount > total * 0.6) return 'date';
  if (numberCount > total * 0.6) return 'number';
  return 'text';
}

/** Guess alignment based on format */
function guessAlign(format: TableColumn['format']): TableColumn['align'] {
  switch (format) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'right';
    case 'date':
      return 'center';
    default:
      return 'left';
  }
}

/** Estimate column width based on key name and value lengths */
function estimateWidth(key: string, values: unknown[]): number {
  const keyLen = key.length;
  const maxValLen = Math.max(
    keyLen,
    ...values.slice(0, 20).map((v) => String(v ?? '').length),
  );

  // Rough px per char
  const charWidth = 7;
  const padding = 24;
  const minWidth = 50;
  const maxWidth = 200;

  return Math.min(maxWidth, Math.max(minWidth, maxValLen * charWidth + padding));
}

/** Make a human-friendly label from a key */
function keyToLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')     // camelCase → words
    .replace(/[_-]/g, ' ')           // snake/kebab → words
    .replace(/\b\w/g, (c) => c.toUpperCase())  // capitalize each word
    .trim();
}

/**
 * Detect columns from JSON array data.
 * @param data - Array of objects to analyze
 * @param includeIndex - Whether to add a # index column
 */
export function detectColumns(
  data: Record<string, unknown>[],
  includeIndex = true,
): TableColumn[] {
  if (!Array.isArray(data) || data.length === 0) return [];

  // Collect all unique keys from the data
  const keySet = new Set<string>();
  for (const row of data.slice(0, 50)) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        keySet.add(key);
      }
    }
  }

  const columns: TableColumn[] = [];

  // Optionally add index column
  if (includeIndex) {
    columns.push({
      key: '#',
      label: '#',
      width: 40,
      align: 'center',
      format: 'text',
      overflow: 'ellipsis',
      maxLines: 1,
      hidden: false,
      bold: false,
      uppercase: false,
      isIndex: true,
    });
  }

  // Create column for each key
  for (const key of keySet) {
    // Skip internal/system keys
    if (key.startsWith('_') || key === 'id' || key === 'internalid') continue;

    const values = data.map((row) => row[key]);
    const format = guessFormat(values);
    const align = guessAlign(format);
    const width = estimateWidth(key, values);

    columns.push({
      key,
      label: keyToLabel(key),
      width,
      align,
      format,
      overflow: (format === 'text' && Math.max(...values.map((v) => String(v ?? '').length)) > 30) ? 'wrap' : 'ellipsis',
      maxLines: 2,
      hidden: false,
      bold: false,
      uppercase: false,
    });
  }

  return columns;
}

/**
 * Auto-detect columns from the store's JSON data for a given table element.
 * Looks at the element's binding path to find the array data.
 *
 * @returns detected columns or empty array if no data found
 */
export function autoDetectColumnsFromStore(
  store: AppStore,
  elementId: string,
): TableColumn[] {
  const { elements, jsonData } = store.state;
  const el = elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'table' || !jsonData) return [];

  // Find the data array using the element's binding
  const binding = el.binding;
  if (!binding) {
    // Try to find the first array in jsonData
    for (const key of Object.keys(jsonData)) {
      const val = jsonData[key];
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        return detectColumns(val as Record<string, unknown>[]);
      }
    }
    return [];
  }

  // Resolve binding path
  const data = getValueByPath(jsonData, binding);
  if (!Array.isArray(data) || data.length === 0) return [];

  return detectColumns(data as Record<string, unknown>[]);
}

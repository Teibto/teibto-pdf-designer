/**
 * JSON Data Binding Service
 * Resolves element bindings to JSON data using dot-notation paths.
 *
 * @author Wichit Wongta
 */

/**
 * Get a nested value from an object using dot-notation path.
 *
 * @example
 *   getNestedValue({ company: { name: 'Acme' } }, 'company.name')
 *   // => 'Acme'
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (!obj || !path) return undefined;

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Resolve an element's binding to its actual value from JSON data.
 * For tables, returns the array. For text, returns the string value.
 */
export function resolveBinding(
  jsonData: Record<string, unknown> | null,
  binding: string | undefined,
): unknown {
  if (!jsonData || !binding) return undefined;
  return getNestedValue(jsonData, binding);
}

/**
 * Resolve template strings like "Invoice {{document.number}}"
 * Replaces all {{path}} tokens with actual values.
 */
export function resolveTemplateString(
  template: string,
  jsonData: Record<string, unknown> | null,
): string {
  if (!jsonData || !template) return template;

  return template.replace(/\{\{(.+?)\}\}/g, (_, path: string) => {
    const value = getNestedValue(jsonData, path.trim());
    return value !== undefined && value !== null ? String(value) : '';
  });
}

/**
 * Enumerate all dot-notation binding paths available in loaded JSON data (#78).
 * Leaf values (string/number/boolean/null) and arrays emit their full path —
 * an array path is a valid table binding. Nested objects recurse.
 *
 * @example
 *   listBindingPaths({ company: { name: 'A' }, items: [...] })
 *   // => ['company.name', 'items']
 */
export function listBindingPaths(
  data: Record<string, unknown> | null,
): string[] {
  if (!data) return [];
  const paths: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, path);
      } else {
        paths.push(path);
      }
    }
  };
  walk(data, '');
  return paths;
}

/**
 * Keys available inside one row of a bound array (#78) — the choices for a
 * table column key. Union of keys across all object rows (rows can be
 * heterogeneous, e.g. span rows), in order of first appearance.
 */
export function listRowKeys(
  data: Record<string, unknown> | null,
  arrayPath: string | undefined,
): string[] {
  if (!data || !arrayPath) return [];
  const arr = getNestedValue(data, arrayPath);
  if (!Array.isArray(arr)) return [];
  const keys: string[] = [];
  for (const row of arr) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * Extract all binding paths from a template string.
 *
 * @example
 *   extractBindingPaths("Hello {{customer.name}}, ref: {{document.number}}")
 *   // => ['customer.name', 'document.number']
 */
export function extractBindingPaths(template: string): string[] {
  const matches = template.matchAll(/\{\{(.+?)\}\}/g);
  return [...matches].map((m) => m[1].trim());
}

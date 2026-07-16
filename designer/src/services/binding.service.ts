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

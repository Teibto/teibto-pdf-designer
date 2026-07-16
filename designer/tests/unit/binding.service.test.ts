/**
 * Tests: binding.service.ts
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import {
  getNestedValue,
  resolveBinding,
  resolveTemplateString,
  extractBindingPaths,
} from '../../src/services/binding.service';

describe('getNestedValue', () => {
  const data = {
    company: { name: 'Acme', address: { city: 'Bangkok', zip: '10110' } },
    items: [{ sku: 'A1' }, { sku: 'A2' }],
    total: 1500,
    active: true,
  };

  it('resolves top-level key', () => {
    expect(getNestedValue(data, 'total')).toBe(1500);
  });

  it('resolves nested key', () => {
    expect(getNestedValue(data, 'company.name')).toBe('Acme');
  });

  it('resolves deeply nested key', () => {
    expect(getNestedValue(data, 'company.address.city')).toBe('Bangkok');
  });

  it('resolves array', () => {
    expect(getNestedValue(data, 'items')).toEqual([{ sku: 'A1' }, { sku: 'A2' }]);
  });

  it('returns undefined for missing key', () => {
    expect(getNestedValue(data, 'missing')).toBeUndefined();
  });

  it('returns undefined for missing nested key', () => {
    expect(getNestedValue(data, 'company.ceo.name')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(getNestedValue(data, '')).toBeUndefined();
  });

  it('returns undefined for null object', () => {
    expect(getNestedValue(null as any, 'key')).toBeUndefined();
  });

  it('returns boolean values', () => {
    expect(getNestedValue(data, 'active')).toBe(true);
  });
});

describe('resolveBinding', () => {
  it('resolves binding to array', () => {
    const data = { order: { lines: [1, 2, 3] } };
    expect(resolveBinding(data, 'order.lines')).toEqual([1, 2, 3]);
  });

  it('returns undefined when no jsonData', () => {
    expect(resolveBinding(null, 'key')).toBeUndefined();
  });

  it('returns undefined when no binding', () => {
    expect(resolveBinding({ a: 1 }, undefined)).toBeUndefined();
  });

  it('returns undefined for empty binding', () => {
    expect(resolveBinding({ a: 1 }, '')).toBeUndefined();
  });
});

describe('resolveTemplateString', () => {
  const data = {
    customer: { name: 'John' },
    document: { number: 'INV-001' },
  };

  it('replaces single binding', () => {
    expect(resolveTemplateString('Hello {{customer.name}}', data)).toBe('Hello John');
  });

  it('replaces multiple bindings', () => {
    expect(resolveTemplateString('{{customer.name}} - {{document.number}}', data))
      .toBe('John - INV-001');
  });

  it('replaces missing binding with empty string', () => {
    expect(resolveTemplateString('Ref: {{missing.key}}', data)).toBe('Ref: ');
  });

  it('returns original if no jsonData', () => {
    expect(resolveTemplateString('Hello {{name}}', null)).toBe('Hello {{name}}');
  });

  it('returns original if no template markers', () => {
    expect(resolveTemplateString('Plain text', data)).toBe('Plain text');
  });

  it('handles spaces in binding path', () => {
    expect(resolveTemplateString('{{ customer.name }}', data)).toBe('John');
  });
});

describe('extractBindingPaths', () => {
  it('extracts single path', () => {
    expect(extractBindingPaths('Hello {{customer.name}}')).toEqual(['customer.name']);
  });

  it('extracts multiple paths', () => {
    expect(extractBindingPaths('{{a.b}} and {{c.d}}')).toEqual(['a.b', 'c.d']);
  });

  it('returns empty array for no bindings', () => {
    expect(extractBindingPaths('No bindings here')).toEqual([]);
  });

  it('trims whitespace in paths', () => {
    expect(extractBindingPaths('{{ path.to.value }}')).toEqual(['path.to.value']);
  });
});

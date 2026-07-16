/**
 * Column Detect Service Tests
 *
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { detectColumns } from '../../src/services/column-detect.service';

// ═══════════════════════════════════════
// detectColumns()
// ═══════════════════════════════════════

describe('detectColumns()', () => {
  it('returns empty array for empty data', () => {
    expect(detectColumns([])).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(detectColumns(null as any)).toEqual([]);
    expect(detectColumns(undefined as any)).toEqual([]);
  });

  it('detects basic text columns', () => {
    const data = [
      { name: 'Alice', city: 'Bangkok' },
      { name: 'Bob', city: 'Chiang Mai' },
    ];
    const cols = detectColumns(data, false);
    expect(cols.length).toBe(2);
    expect(cols[0].key).toBe('name');
    expect(cols[0].format).toBe('text');
    expect(cols[0].align).toBe('left');
    expect(cols[1].key).toBe('city');
  });

  it('adds index column when includeIndex is true', () => {
    const data = [{ name: 'Alice' }];
    const cols = detectColumns(data, true);
    expect(cols[0].key).toBe('#');
    expect(cols[0].isIndex).toBe(true);
    expect(cols[0].align).toBe('center');
    expect(cols[0].width).toBe(40);
  });

  it('detects number columns', () => {
    const data = [
      { quantity: 10, price: 99.5 },
      { quantity: 20, price: 150 },
      { quantity: 5, price: 75.25 },
    ];
    const cols = detectColumns(data, false);
    const qtyCol = cols.find((c) => c.key === 'quantity')!;
    const priceCol = cols.find((c) => c.key === 'price')!;
    expect(qtyCol.format).toBe('number');
    expect(qtyCol.align).toBe('right');
    expect(priceCol.format).toBe('number');
  });

  it('detects currency columns', () => {
    const data = [
      { total: '$1,200.50' },
      { total: '$850.00' },
      { total: '$3,000.75' },
    ];
    const cols = detectColumns(data, false);
    expect(cols[0].format).toBe('currency');
    expect(cols[0].align).toBe('right');
  });

  it('detects date columns', () => {
    const data = [
      { date: '2025-01-15' },
      { date: '2025-02-20' },
      { date: '2025-03-10' },
    ];
    const cols = detectColumns(data, false);
    expect(cols[0].format).toBe('date');
    expect(cols[0].align).toBe('center');
  });

  it('detects percent columns', () => {
    const data = [
      { rate: '15%' },
      { rate: '7.5%' },
      { rate: '20%' },
    ];
    const cols = detectColumns(data, false);
    expect(cols[0].format).toBe('percent');
    expect(cols[0].align).toBe('right');
  });

  it('skips internal keys (_prefixed, id, internalid)', () => {
    const data = [
      { _internal: 'x', id: '1', internalid: '100', name: 'Item' },
    ];
    const cols = detectColumns(data, false);
    expect(cols.length).toBe(1);
    expect(cols[0].key).toBe('name');
  });

  it('generates human-friendly labels from camelCase keys', () => {
    const data = [{ firstName: 'Alice', orderDate: '2025-01-01' }];
    const cols = detectColumns(data, false);
    expect(cols.find((c) => c.key === 'firstName')!.label).toBe('First Name');
    expect(cols.find((c) => c.key === 'orderDate')!.label).toBe('Order Date');
  });

  it('generates labels from snake_case keys', () => {
    const data = [{ first_name: 'Alice' }];
    const cols = detectColumns(data, false);
    expect(cols[0].label).toBe('First Name');
  });

  it('handles mixed format data (majority wins)', () => {
    // Majority are numbers (3/5), text is minority (2/5)
    const data = [
      { value: '100' },
      { value: '200' },
      { value: '300' },
      { value: 'N/A' },
      { value: '500' },
    ];
    const cols = detectColumns(data, false);
    // 3/5 = 60% → still text since threshold is >60% (not >=)
    // Actually: 4 out of 5 non-empty samples parse as numbers (100,200,300,500)
    // N/A doesn't parse. So 4/5 = 80% → number
    expect(cols[0].format).toBe('number');
  });

  it('estimates reasonable column widths', () => {
    const data = [
      { short: 'Hi', longDescription: 'This is a very long description that spans multiple words' },
    ];
    const cols = detectColumns(data, false);
    const shortCol = cols.find((c) => c.key === 'short')!;
    const longCol = cols.find((c) => c.key === 'longDescription')!;
    expect(shortCol.width).toBeLessThan(longCol.width);
    expect(shortCol.width).toBeGreaterThanOrEqual(50);
    expect(longCol.width).toBeLessThanOrEqual(200);
  });

  it('sets overflow=wrap for long text values', () => {
    const data = [
      { description: 'A'.repeat(50) }, // 50 chars > 30 threshold
    ];
    const cols = detectColumns(data, false);
    expect(cols[0].overflow).toBe('wrap');
  });

  it('collects keys from multiple rows', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', email: 'bob@test.com' },
    ];
    const cols = detectColumns(data, false);
    const keys = cols.map((c) => c.key);
    expect(keys).toContain('name');
    expect(keys).toContain('age');
    expect(keys).toContain('email');
  });

  it('handles null and empty values gracefully', () => {
    const data = [
      { name: null, value: '' },
      { name: 'Alice', value: undefined },
    ];
    const cols = detectColumns(data, false);
    expect(cols.length).toBe(2);
    // With 1 text value and 1 null → text (default)
    expect(cols[0].format).toBe('text');
  });
});

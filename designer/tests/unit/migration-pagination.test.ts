/**
 * Tests: migration.service.ts & pagination.service.ts
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { migrateTemplate, needsMigration, CURRENT_VERSION } from '../../src/services/migration.service';

// ═══════════════════════════════════════
// MIGRATION SERVICE
// ═══════════════════════════════════════

describe('needsMigration', () => {
  it('returns false for current version', () => {
    expect(needsMigration({ version: CURRENT_VERSION })).toBe(false);
  });

  it('returns true for old version', () => {
    expect(needsMigration({ version: '1.0.0' })).toBe(true);
  });

  it('returns true for missing version', () => {
    expect(needsMigration({})).toBe(true);
  });
});

describe('migrateTemplate', () => {
  it('migrates v1.0.0 template to current', () => {
    const v1 = {
      id: 't-1',
      name: 'Old Template',
      version: '1.0.0',
      elements: [
        { id: 'el-1', type: 'text', x: 0, y: 0, w: 100, h: 30 },
        { id: 'el-2', type: 'table', x: 0, y: 50, w: 500, h: 200 },
        { id: 'el-3', type: 'header', x: 0, y: 0, w: 400, h: 40 },
      ],
    };

    const result = migrateTemplate(v1);

    expect(result.migrated).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.migrationsApplied.length).toBeGreaterThan(0);

    // Elements should have role assigned
    const elements = result.template.elements as any[];
    expect(elements[0].role).toBe('content');
    expect(elements[1].role).toBe('table');
    expect(elements[2].role).toBe('header');

    // Should have locked/visible
    expect(elements[0].locked).toBe(false);
    expect(elements[0].visible).toBe(true);

    // Should have pagination
    expect(result.template.pagination).toBeDefined();

    // Should have page config with customWidth/customHeight
    expect((result.template.page as any).customWidth).toBeDefined();

    // Version should be current
    expect(result.template.version).toBe(CURRENT_VERSION);
  });

  it('does not modify current version templates', () => {
    const current = {
      version: CURRENT_VERSION,
      name: 'Already Current',
      elements: [{ id: 'el-1', type: 'text', role: 'content', x: 0, y: 0, w: 100, h: 30 }],
    };

    const result = migrateTemplate(current);

    expect(result.migrated).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.migrationsApplied).toHaveLength(0);
  });

  it('migrates v1.1.0 to current', () => {
    const v11 = {
      version: '1.1.0',
      name: 'V1.1 Template',
      elements: [
        { id: 'el-1', type: 'text', role: 'content', x: 0, y: 0, w: 100, h: 30, locked: false, visible: true },
      ],
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842 },
    };

    const result = migrateTemplate(v11);

    expect(result.migrated).toBe(true);
    expect(result.template.pagination).toBeDefined();
    expect((result.template.page as any).customWidth).toBeDefined();

    // Elements should have zIndex
    const el = (result.template.elements as any[])[0];
    expect(typeof el.zIndex).toBe('number');
  });

  it('handles missing version as v1.0.0', () => {
    const noVersion = { name: 'No Version', elements: [] };
    const result = migrateTemplate(noVersion);
    expect(result.fromVersion).toBe('1.0.0');
    expect(result.migrated).toBe(true);
  });

  it('migrates v2.0.0: converts column wrap boolean to overflow enum', () => {
    const v2 = {
      version: '2.0.0',
      name: 'V2 Template',
      elements: [
        {
          id: 'table-1', type: 'table', role: 'table',
          x: 20, y: 200, w: 500, h: 300, zIndex: 0,
          locked: false, visible: true, binding: 'items',
          columns: [
            { key: 'desc', label: 'Desc', width: 200, align: 'left', format: 'text', wrap: true, maxLines: 3, hidden: false, bold: false, uppercase: false },
            { key: 'qty', label: 'Qty', width: 60, align: 'right', format: 'number', wrap: false, maxLines: 1, hidden: false, bold: false, uppercase: false },
          ],
        },
      ],
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, customWidth: 595, customHeight: 842 },
      pagination: { mode: 'rows', rowsPerPage: 10, baseRowHeight: 24, lineHeightPx: 18, showContinuationHeader: true },
    };

    const result = migrateTemplate(v2);
    expect(result.migrated).toBe(true);

    const cols = (result.template.elements as any[])[0].columns;
    // wrap: true → overflow: 'wrap'
    expect(cols[0].overflow).toBe('wrap');
    expect(cols[0].wrap).toBeUndefined();
    // wrap: false → overflow: 'ellipsis'
    expect(cols[1].overflow).toBe('ellipsis');
    expect(cols[1].wrap).toBeUndefined();
  });

  it('migrates v2.0.0: adds pagination advanced fields', () => {
    const v2 = {
      version: '2.0.0',
      name: 'V2 Minimal',
      elements: [],
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, customWidth: 595, customHeight: 842 },
      pagination: { mode: 'rows', rowsPerPage: 10, baseRowHeight: 24, lineHeightPx: 18, showContinuationHeader: true },
    };

    const result = migrateTemplate(v2);
    const p = result.template.pagination as any;
    expect(p.orphanWidowMinRows).toBe(2);
    expect(p.summaryBreak).toBe('auto');
    expect(p.dynamicFooter).toBe(true);
    expect(p.dynamicFooterGap).toBe(16);
  });

  it('v2.1.0 template needs no migration', () => {
    const v21 = {
      version: '2.1.0',
      name: 'V2.1',
      elements: [],
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, customWidth: 595, customHeight: 842 },
      pagination: { mode: 'rows', rowsPerPage: 10, baseRowHeight: 24, lineHeightPx: 18, showContinuationHeader: true, orphanWidowMinRows: 2, summaryBreak: 'auto', dynamicFooter: true, dynamicFooterGap: 16 },
    };

    const result = migrateTemplate(v21);
    expect(result.migrated).toBe(true);
    const p = result.template.pagination as any;
    expect(p.forceBreakBeforeRows).toEqual([]);
    expect(p.keepTogetherField).toBe('');
    expect(p.headerMode).toBe('all');
    expect(p.columnSpanField).toBe('');
  });

  it('v2.2.0 template needs no migration', () => {
    const v22 = {
      version: '2.2.0',
      name: 'Current',
      elements: [],
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, customWidth: 595, customHeight: 842 },
      pagination: { mode: 'rows', rowsPerPage: 10, baseRowHeight: 24, lineHeightPx: 18, showContinuationHeader: true, orphanWidowMinRows: 2, summaryBreak: 'auto', dynamicFooter: true, dynamicFooterGap: 16, forceBreakBeforeRows: [], keepTogetherField: '', headerMode: 'all', columnSpanField: '' },
    };

    const result = migrateTemplate(v22);
    expect(result.migrated).toBe(false);
  });
});

// ═══════════════════════════════════════
// PAGE MODEL
// ═══════════════════════════════════════

import { resolvePageDimensions, createDefaultPage, type PageConfig } from '../../src/models/page';

describe('resolvePageDimensions', () => {
  it('returns A4 portrait dimensions', () => {
    const page = createDefaultPage();
    const dims = resolvePageDimensions(page);
    expect(dims.width).toBe(595);
    expect(dims.height).toBe(842);
  });

  it('swaps dimensions for landscape', () => {
    const page: PageConfig = { ...createDefaultPage(), orientation: 'landscape' };
    const dims = resolvePageDimensions(page);
    expect(dims.width).toBe(842);
    expect(dims.height).toBe(595);
  });

  it('uses custom dimensions', () => {
    const page: PageConfig = {
      ...createDefaultPage(),
      size: 'Custom',
      customWidth: 400,
      customHeight: 600,
    };
    const dims = resolvePageDimensions(page);
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(600);
  });
});

// ═══════════════════════════════════════
// DEBOUNCE UTILS
// ═══════════════════════════════════════

import { debounce, throttle } from '../../src/utils/debounce';

describe('debounce', () => {
  it('debounces calls', async () => {
    let count = 0;
    const fn = debounce(() => { count++; }, 50);

    fn();
    fn();
    fn();

    expect(count).toBe(0);

    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(1);
  });

  it('cancel stops execution', async () => {
    let count = 0;
    const fn = debounce(() => { count++; }, 50);

    fn();
    fn.cancel();

    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(0);
  });
});

describe('throttle', () => {
  it('executes immediately on first call', () => {
    let count = 0;
    const fn = throttle(() => { count++; }, 100);

    fn();
    expect(count).toBe(1);
  });

  it('limits rapid calls', () => {
    let count = 0;
    const fn = throttle(() => { count++; }, 100);

    fn(); fn(); fn(); fn(); fn();
    expect(count).toBe(1);
  });
});

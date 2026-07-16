/**
 * Template Migration Service — Production Grade
 * Handles schema migration when template format changes between versions.
 *
 * Migrations are registered as functions that transform state from
 * one version to the next. They run in sequence.
 *
 * @author Wichit Wongta
 */
import { createDefaultPage } from '../models/page';
import { createDefaultPagination } from '../models/template';

// ─── Current Version ───

export const CURRENT_VERSION = '2.2.0';

// ─── Migration Registry ───

interface Migration {
  fromVersion: string;
  toVersion: string;
  description: string;
  migrate: (template: Record<string, unknown>) => Record<string, unknown>;
}

const migrations: Migration[] = [
  {
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    description: 'Add role field to elements',
    migrate(t) {
      const elements = (t.elements || []) as Record<string, unknown>[];
      for (const el of elements) {
        if (!el.role) {
          // Infer role from element type
          switch (el.type) {
            case 'header': el.role = 'header'; break;
            case 'table':  el.role = 'table'; break;
            default:       el.role = 'content'; break;
          }
        }
        // Ensure lock/visibility fields exist
        if (el.locked === undefined) el.locked = false;
        if (el.visible === undefined) el.visible = true;
      }
      return t;
    },
  },
  {
    fromVersion: '1.1.0',
    toVersion: '2.0.0',
    description: 'Add pagination config, grid config, page defaults',
    migrate(t) {
      // Ensure pagination config
      if (!t.pagination) {
        t.pagination = createDefaultPagination();
      }

      // Ensure page config has all required fields
      if (t.page && typeof t.page === 'object') {
        const page = t.page as Record<string, unknown>;
        if (!page.customWidth) page.customWidth = page.width || 595;
        if (!page.customHeight) page.customHeight = page.height || 842;
      } else {
        t.page = createDefaultPage();
      }

      // Ensure all elements have zIndex
      const elements = (t.elements || []) as Record<string, unknown>[];
      elements.forEach((el, i) => {
        if (typeof el.zIndex !== 'number') el.zIndex = i;
      });

      return t;
    },
  },
  {
    fromVersion: '2.0.0',
    toVersion: '2.1.0',
    description: 'Column overflow mode (wrap→overflow), pagination advanced fields',
    migrate(t) {
      // Migrate table columns: wrap boolean → overflow enum
      const elements = (t.elements || []) as Record<string, unknown>[];
      for (const el of elements) {
        if (el.type === 'table' && Array.isArray(el.columns)) {
          for (const col of el.columns as Record<string, unknown>[]) {
            if (col.overflow === undefined) {
              // Convert old wrap boolean to new overflow enum
              col.overflow = col.wrap ? 'wrap' : 'ellipsis';
            }
            delete col.wrap;
          }
        }
      }

      // Ensure pagination has new advanced fields
      if (t.pagination && typeof t.pagination === 'object') {
        const p = t.pagination as Record<string, unknown>;
        if (p.orphanWidowMinRows === undefined) p.orphanWidowMinRows = 2;
        if (p.summaryBreak === undefined) p.summaryBreak = 'auto';
        if (p.dynamicFooter === undefined) p.dynamicFooter = true;
        if (p.dynamicFooterGap === undefined) p.dynamicFooterGap = 16;
      }

      return t;
    },
  },
  {
    fromVersion: '2.1.0',
    toVersion: '2.2.0',
    description: 'Page break controls: forceBreak, keepTogether, headerMode, columnSpan',
    migrate(t) {
      // Ensure pagination has v2.2 page break fields
      if (t.pagination && typeof t.pagination === 'object') {
        const p = t.pagination as Record<string, unknown>;
        if (p.forceBreakBeforeRows === undefined) p.forceBreakBeforeRows = [];
        if (p.keepTogetherField === undefined) p.keepTogetherField = '';
        if (p.headerMode === undefined) p.headerMode = 'all';
        if (p.columnSpanField === undefined) p.columnSpanField = '';
      }

      return t;
    },
  },
];

// ═══════════════════════════════════════
// MIGRATION ENGINE
// ═══════════════════════════════════════

export interface MigrationResult {
  template: Record<string, unknown>;
  migrated: boolean;
  fromVersion: string;
  toVersion: string;
  migrationsApplied: string[];
  errors: string[];
}

/**
 * Migrate a template to the current version.
 * If no version field exists, assumes v1.0.0.
 */
export function migrateTemplate(raw: Record<string, unknown>): MigrationResult {
  const result: MigrationResult = {
    template: { ...raw },
    migrated: false,
    fromVersion: '',
    toVersion: CURRENT_VERSION,
    migrationsApplied: [],
    errors: [],
  };

  // Determine current version
  let version = typeof raw.version === 'string' ? raw.version : '1.0.0';
  result.fromVersion = version;

  // Already current?
  if (compareVersions(version, CURRENT_VERSION) >= 0) {
    result.template.version = CURRENT_VERSION;
    return result;
  }

  // Apply migrations in sequence
  let template = structuredClone(raw);

  for (const migration of migrations) {
    if (compareVersions(version, migration.fromVersion) <= 0 &&
        compareVersions(version, migration.toVersion) < 0) {
      try {
        template = migration.migrate(template);
        result.migrationsApplied.push(`${migration.fromVersion} → ${migration.toVersion}: ${migration.description}`);
        version = migration.toVersion;
        result.migrated = true;
      } catch (err) {
        result.errors.push(`Migration ${migration.fromVersion} → ${migration.toVersion} failed: ${err}`);
        break;
      }
    }
  }

  template.version = CURRENT_VERSION;
  result.template = template;
  result.toVersion = version;

  return result;
}

/**
 * Check if a template needs migration.
 */
export function needsMigration(template: Record<string, unknown>): boolean {
  const version = typeof template.version === 'string' ? template.version : '1.0.0';
  return compareVersions(version, CURRENT_VERSION) < 0;
}

// ─── Version Comparison ───

/**
 * Compare two semver strings.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Tests: future-schema handling (#145)
 * A template authored by a NEWER designer than this build must be flagged, and
 * loadTemplate/importTemplateJson must surface that as a warning (not swallow it).
 * @author Wichit Wongta
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('idb-keyval', () => {
  const mem = new Map<string, unknown>();
  return {
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => { mem.set(k, v); },
    del: async (k: string) => { mem.delete(k); },
    keys: async () => [...mem.keys()],
  };
});

import { isFutureVersion, needsMigration, CURRENT_VERSION } from '../../src/services/migration.service';
import { AppStore } from '../../src/state/store';
import { importTemplateJson, exportTemplateJson } from '../../src/services/template.service';
import { addElement } from '../../src/state/actions';

/** A schema-VALID template JSON at the given version (built from a real store). */
function validTemplateJson(version: string): string {
  const store = new AppStore();
  addElement(store, 'text');
  const obj = JSON.parse(exportTemplateJson(store));
  obj.version = version;
  return JSON.stringify(obj);
}

describe('isFutureVersion (#145)', () => {
  it('is true for a version newer than the current build', () => {
    expect(isFutureVersion({ version: '9.9.9' })).toBe(true);
    // and needsMigration is false for it — which is exactly why we need this check
    expect(needsMigration({ version: '9.9.9' })).toBe(false);
  });

  it('is false for the current and older versions', () => {
    expect(isFutureVersion({ version: CURRENT_VERSION })).toBe(false);
    expect(isFutureVersion({ version: '1.0.0' })).toBe(false);
    expect(isFutureVersion({})).toBe(false); // missing → treated as 1.0.0
  });
});

describe('importTemplateJson surfaces a future-schema warning (#145)', () => {
  it('warns when importing a newer-than-build template', () => {
    const store = new AppStore();
    const { warnings } = importTemplateJson(store, validTemplateJson('9.9.9'));
    expect(warnings.some((w) => /ใหม่กว่า|v9\.9\.9/.test(w))).toBe(true);
  });

  it('does not warn for a current-version template', () => {
    const store = new AppStore();
    const { warnings } = importTemplateJson(store, validTemplateJson(CURRENT_VERSION));
    expect(warnings.some((w) => /ใหม่กว่า/.test(w))).toBe(false);
  });
});

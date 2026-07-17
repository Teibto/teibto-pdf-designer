/**
 * Tests: sample-templates.ts band authoring (#47 3b)
 * Every built-in sample carries an explicit `bands` structure that references its
 * own elements and reproduces the migration exactly (same look, band model).
 * @author Wichit Wongta
 */
import { describe, it, expect } from 'vitest';
import { getSampleTemplates } from '../../src/constants/sample-templates';
import { elementsToBands } from '../../src/services/band-layout.service';

describe('sample templates carry band structures (#47 3b)', () => {
  const samples = getSampleTemplates();

  it('ships 6 samples, each with a non-empty bands array', () => {
    expect(samples).toHaveLength(6);
    for (const t of samples) {
      expect(t.bands, `${t.name} bands`).toBeDefined();
      expect(t.bands!.length, `${t.name} bands`).toBeGreaterThan(0);
    }
  });

  it('bands reference only real element ids (no dangling refs)', () => {
    for (const t of samples) {
      const ids = new Set(t.elements.map((e) => e.id));
      for (const band of t.bands!) {
        for (const row of band.rows) {
          for (const col of row.columns) {
            for (const id of col.elementIds) {
              expect(ids.has(id), `${t.name} col ref ${id}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('bands equal the migration of the elements (identical layout)', () => {
    for (const t of samples) {
      expect(t.bands, t.name).toEqual(elementsToBands(t.elements));
    }
  });

  it('every element with a band role appears in exactly one cell', () => {
    for (const t of samples) {
      const inBands = t.bands!.flatMap((b) => b.rows.flatMap((r) => r.columns.flatMap((c) => c.elementIds)));
      // migration groups by role for the 6 known roles — every such element lands once
      const roled = t.elements.filter((e) => inBands.includes(e.id));
      expect(new Set(inBands).size, `${t.name} no dup cell refs`).toBe(inBands.length);
      expect(inBands.length, `${t.name} count`).toBe(roled.length);
    }
  });
});

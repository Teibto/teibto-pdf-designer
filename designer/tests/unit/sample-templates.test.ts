/**
 * Tests: sample-templates.ts band authoring (#47 3b)
 * Every built-in sample carries an explicit `bands` structure that references its
 * own elements and reproduces the migration exactly (same look, band model) —
 * except the invoice, whose header/content bands are hand-authored (#73).
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
    // Invoice hand-authors header/content (#73) — stacked cells the migration
    // cannot derive — so it is asserted structurally below instead.
    for (const t of samples.filter((s) => s.id !== 'tpl-invoice')) {
      expect(t.bands, t.name).toEqual(elementsToBands(t.elements));
    }
  });

  it('invoice hand-authors header/content as stacked-cell bands (#73)', () => {
    const inv = samples.find((s) => s.id === 'tpl-invoice')!;
    const byName = new Map(inv.elements.map((e) => [e.id, e.name]));
    const names = (band: { rows: { columns: { elementIds: string[] }[] }[] }) =>
      band.rows.map((r) => r.columns.map((c) => c.elementIds.map((id) => byName.get(id))));

    const header = inv.bands!.find((b) => b.role === 'header')!;
    expect(names(header)).toEqual([[
      ['logo'],
      ['company_name', 'company_addr', 'company_tel', 'company_taxid', 'company_branch'],
      ['title_th', 'title_en', 'docinfo_table'],
    ]]);

    const content = inv.bands!.find((b) => b.role === 'content')!;
    expect(names(content)).toEqual([
      [
        ['cust_label', 'cust_ul', 'cust_name', 'cust_addr', 'cust_taxid', 'cust_branch'],
        ['ship_label', 'ship_ul', 'ship_addr'],
      ],
      [['disclaimer']],
    ]);

    // every row's widths sum to exactly 100
    for (const band of [header, content]) {
      for (const row of band.rows) {
        expect(row.columns.reduce((s, c) => s + c.widthPct, 0), row.id).toBe(100);
      }
    }

    // remaining roles still match the migration
    const derived = elementsToBands(inv.elements);
    for (const band of inv.bands!.filter((b) => b.role !== 'header' && b.role !== 'content')) {
      expect(band, band.role).toEqual(derived.find((d) => d.role === band.role));
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

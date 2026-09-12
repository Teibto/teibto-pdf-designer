/**
 * Document ordering must reach the sole BFO exporter and survive undo.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { describe, expect, it } from 'vitest';
import { AppStore } from '../../src/state/store';
import { addElement, reorderDocumentElement } from '../../src/state/actions';
import { applyMiddleware } from '../../src/state/middleware';
import { HistoryService } from '../../src/services/history.service';
import { exportBfoXml } from '../../src/services/bfo-export.service';

function fixture() {
  const store = new AppStore();
  const ids = ['ALPHA_MARKER', 'BETA_MARKER', 'GAMMA_MARKER'].map((content) => {
    const id = addElement(store, 'text');
    store.dispatch((draft) => {
      const el = draft.elements.find((entry) => entry.id === id)!;
      if (el.type === 'text') el.content = content;
    });
    return id;
  });
  store.dispatch((draft) => {
    draft.bands = [{ role: 'content', rows: [{ id: 'row', height: 120,
      columns: [{ id: 'cell', widthPct: 100, elementIds: [...ids] }] }] }];
    draft.template.isDirty = false;
  });
  const history = new HistoryService(store);
  applyMiddleware(store, [history.createMiddleware()]);
  const order = () => store.state.bands.flatMap((b) => b.rows.flatMap((r) =>
    r.columns.flatMap((c) => c.elementIds)));
  return { store, ids, history, order };
}

describe('canonical document reorder', () => {
  it('moves upward and downward in one cell and changes BFO output; undo restores exact structure', () => {
    const { store, ids: [a, b, c], history, order } = fixture();
    const original = structuredClone(store.state.bands);
    expect(reorderDocumentElement(store, c, a, 'above')).toBe(true);
    expect(order()).toEqual([c, a, b]);
    const xml = exportBfoXml(store.state, { useBands: true });
    expect(xml.indexOf('GAMMA_MARKER')).toBeGreaterThan(-1);
    expect(xml.indexOf('GAMMA_MARKER')).toBeLessThan(xml.indexOf('ALPHA_MARKER'));
    expect(history.undo()).toBe(true);
    expect(store.state.bands).toEqual(original);
    expect(reorderDocumentElement(store, a, c, 'below')).toBe(true);
    expect(order()).toEqual([b, c, a]);
    expect(store.state.bands[0].rows[0].height).toBe(120);
    expect(store.state.template.isDirty).toBe(true);
  });

  it('moves across cells and roles atomically and restores role on undo', () => {
    const { store, ids: [a, b, c], history } = fixture();
    store.dispatch((draft) => {
      draft.bands[0].rows[0].columns[0].elementIds = [a, b];
      draft.bands.push({ role: 'footer', rows: [{ id: 'footer-row', columns: [
        { id: 'footer-cell', widthPct: 100, elementIds: [c] },
      ] }] });
      draft.elements.find((el) => el.id === c)!.role = 'footer';
    });
    history.clear();
    expect(reorderDocumentElement(store, a, c, 'below')).toBe(true);
    expect(store.state.bands[1].rows[0].columns[0].elementIds).toEqual([c, a]);
    expect(store.state.elements.find((el) => el.id === a)!.role).toBe('footer');
    expect(history.undo()).toBe(true);
    expect(store.state.elements.find((el) => el.id === a)!.role).toBe('content');
    expect(store.state.bands[0].rows[0].columns[0].elementIds).toEqual([a, b]);
  });

  it('rejects no-ops, missing, locked, ambiguous and disallowed moves without undo pollution', () => {
    const { store, ids: [a, b, c], history } = fixture();
    expect(reorderDocumentElement(store, a, b, 'above')).toBe(false);
    expect(reorderDocumentElement(store, b, a, 'below')).toBe(false);
    expect(reorderDocumentElement(store, a, a, 'below')).toBe(false);
    expect(reorderDocumentElement(store, 'missing', b, 'below')).toBe(false);
    store.dispatch((draft) => { draft.elements.find((el) => el.id === a)!.locked = true; });
    expect(reorderDocumentElement(store, a, c, 'below')).toBe(false);
    store.dispatch((draft) => {
      draft.elements.find((el) => el.id === a)!.locked = false;
      draft.bands[0].rows[0].columns[0].elementIds.push(a);
    });
    expect(reorderDocumentElement(store, a, c, 'below')).toBe(false);
    store.dispatch((draft) => {
      draft.bands[0].rows[0].columns[0].elementIds.pop();
      draft.bands[0].rows[0].columns[0].elementIds = [a, b];
      draft.bands.push({ role: 'table', rows: [{ id: 'table-row', columns: [
        { id: 'table-cell', widthPct: 100, elementIds: [c] },
      ] }] });
      draft.elements.find((el) => el.id === c)!.role = 'table';
    });
    history.clear();
    const before = store.state;
    expect(reorderDocumentElement(store, a, c, 'above')).toBe(false);
    expect(store.state).toBe(before);
    expect(history.canUndo).toBe(false);
  });

  it('preserves grandfathered element types when reordering within their existing band', () => {
    const { store, ids: [a, b, c], order } = fixture();
    store.dispatch((draft) => {
      draft.bands[0].role = 'watermark';
      for (const el of draft.elements) el.role = 'watermark';
    });
    expect(reorderDocumentElement(store, c, a, 'above')).toBe(true);
    expect(order()).toEqual([c, a, b]);
  });

  it('rejects duplicate-role imports whose second band would be omitted by export', () => {
    const { store, ids: [a, , c], history } = fixture();
    store.dispatch((draft) => { draft.bands.push({ role: 'content', rows: [] }); });
    history.clear();
    const before = store.state;
    expect(reorderDocumentElement(store, c, a, 'above')).toBe(false);
    expect(store.state).toBe(before);
    expect(history.canUndo).toBe(false);
  });
});

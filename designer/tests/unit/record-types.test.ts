/**
 * Record-type options offered when saving a template (#158).
 *
 * The engine matches `custrecord_pld_tpl_rectype` exactly, so every option has to
 * be a real NetSuite record type id: a catch-all value saved fine, took the print
 * default, and then made Print report "No template found" forever.
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
import { describe, it, expect } from 'vitest';
import { RECORD_TYPES, DEFAULT_RECORD_TYPE, recordTypeOptions } from '../../src/constants/record-types';

describe('RECORD_TYPES', () => {
  it('offers no catch-all pseudo type that Print can never resolve', () => {
    const values = RECORD_TYPES.map((rt) => rt.value);
    expect(values).not.toContain('transaction');
    expect(values).not.toContain('');
  });

  it('offers creditmemo — the engine curates it but it was missing from the list', () => {
    expect(RECORD_TYPES.map((rt) => rt.value)).toContain('creditmemo');
  });

  it('covers every record type the transaction buttons appear on', () => {
    // pld_ue_button.js SUPPORTED_TYPES — a button with no selectable template
    // type is a dead end for the user
    const buttonTypes = [
      'invoice', 'salesorder', 'purchaseorder', 'purchaserequisition', 'estimate', 'vendorbill',
      'cashsale', 'itemfulfillment', 'creditmemo', 'returnauthorization', 'customerpayment',
    ];
    const values = new Set(RECORD_TYPES.map((rt) => rt.value));
    for (const t of buttonTypes) {
      expect(values, `record type ${t} has a Print button but no option`).toContain(t);
    }
  });

  it('every value looks like a NetSuite record type id, and no duplicates', () => {
    const values = RECORD_TYPES.map((rt) => rt.value);
    for (const v of values) {
      expect(v).toMatch(/^[a-z][a-z0-9]*$/);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('every option has a label', () => {
    for (const rt of RECORD_TYPES) {
      expect(rt.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_RECORD_TYPE is one of the offered values', () => {
    expect(RECORD_TYPES.map((rt) => rt.value)).toContain(DEFAULT_RECORD_TYPE);
  });
});

describe('recordTypeOptions', () => {
  it('keeps a retired/unknown saved value visible and first, so it can be fixed', () => {
    const opts = recordTypeOptions('transaction');

    expect(opts[0]).toEqual({ value: 'transaction', label: 'transaction' });
    expect(opts.length).toBe(RECORD_TYPES.length + 1);
  });

  it('does not duplicate a value that is already offered', () => {
    const opts = recordTypeOptions('invoice');

    expect(opts.length).toBe(RECORD_TYPES.length);
    expect(opts.filter((o) => o.value === 'invoice').length).toBe(1);
  });

  it('returns the plain list when no record type is given', () => {
    expect(recordTypeOptions('').map((o) => o.value)).toEqual(RECORD_TYPES.map((r) => r.value));
  });
});

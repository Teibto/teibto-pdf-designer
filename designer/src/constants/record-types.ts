/**
 * NetSuite record types a template can target (#138).
 * Shared by the Save-to-NetSuite dialog (save metadata) and the BFO export modal
 * (FreeMarker preview hints). The value is what lands in custrecord_pld_tpl_rectype.
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
export interface RecordTypeOption {
  value: string;
  label: string;
}

export const RECORD_TYPES: readonly RecordTypeOption[] = [
  { value: 'transaction', label: 'Transaction (Invoice, SO, PO)' },
  { value: 'salesorder', label: 'Sales Order' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'purchaseorder', label: 'Purchase Order' },
  { value: 'estimate', label: 'Estimate / Quotation' },
  { value: 'cashsale', label: 'Cash Sale / Receipt' },
  { value: 'itemfulfillment', label: 'Item Fulfillment' },
  { value: 'vendorbill', label: 'Vendor Bill' },
  { value: 'customer', label: 'Customer' },
  { value: 'employee', label: 'Employee' },
];

/**
 * Options list that always includes `rectype` even when it isn't one of the
 * presets — so a record opened with an unlisted type still shows its own value
 * selected rather than silently falling back to the first preset.
 */
export function recordTypeOptions(rectype: string): RecordTypeOption[] {
  if (rectype && !RECORD_TYPES.some((rt) => rt.value === rectype)) {
    return [{ value: rectype, label: rectype }, ...RECORD_TYPES];
  }
  return [...RECORD_TYPES];
}

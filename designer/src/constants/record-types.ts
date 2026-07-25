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

/**
 * Every entry must be a REAL NetSuite record type id (#158).
 *
 * The engine finds a template with an exact-match filter
 * (`[custrecord_pld_tpl_rectype, 'is', recType]` — pld_sl_render_pdf.js), so a
 * catch-all pseudo type can never be found: a template saved as `transaction`
 * used to save successfully, be marked default, and then make Print report
 * "No template found" forever. There is no such thing as one template covering
 * several record types — save one per type.
 */
export const RECORD_TYPES: readonly RecordTypeOption[] = [
  { value: 'invoice', label: 'Invoice / ใบแจ้งหนี้ · ใบกำกับภาษี' },
  { value: 'creditmemo', label: 'Credit Memo / ใบลดหนี้' },
  { value: 'estimate', label: 'Estimate / ใบเสนอราคา' },
  { value: 'salesorder', label: 'Sales Order / ใบสั่งขาย' },
  { value: 'purchaseorder', label: 'Purchase Order / ใบสั่งซื้อ' },
  { value: 'cashsale', label: 'Cash Sale / ใบเสร็จรับเงิน (ขายสด)' },
  { value: 'customerpayment', label: 'Customer Payment / ใบเสร็จรับเงิน' },
  { value: 'itemfulfillment', label: 'Item Fulfillment / ใบส่งสินค้า' },
  { value: 'vendorbill', label: 'Vendor Bill / ใบรับวางบิล' },
  { value: 'returnauthorization', label: 'Return Authorization / ใบรับคืนสินค้า' },
  { value: 'customer', label: 'Customer / ลูกค้า' },
  { value: 'employee', label: 'Employee / พนักงาน' },
];

/** Fallback when there is no record context to take the type from (#158). */
export const DEFAULT_RECORD_TYPE = 'invoice';

/**
 * Options list that always includes `rectype` even when it isn't one of the
 * presets — so a record opened with an unlisted type still shows its own value
 * selected rather than silently falling back to the first preset. This is also
 * what keeps a template saved earlier under a retired value (e.g. `transaction`,
 * removed in #158) visible and fixable instead of silently re-typed.
 */
export function recordTypeOptions(rectype: string): RecordTypeOption[] {
  if (rectype && !RECORD_TYPES.some((rt) => rt.value === rectype)) {
    return [{ value: rectype, label: rectype }, ...RECORD_TYPES];
  }
  return [...RECORD_TYPES];
}

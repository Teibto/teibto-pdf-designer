/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Invoice data builder (SuiteQL) — produces the designer's curated binding schema
 * {company, customer, document, totals, items} from a real invoice, so both the
 * mapping UI (load-record) and the render (preview-live) resolve against the SAME
 * shape (design = data = print). Data is pulled via SuiteQL (N/query) per the goal;
 * company info comes from the company-config record.
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
define(['N/query', 'N/record', './pld_lib_company_config'], function (query, record, companyConfig) {

  function first(sql, params) {
    var rows = query.runSuiteQL({ query: sql, params: params }).asMappedResults();
    return rows.length ? rows[0] : {};
  }
  function many(sql, params) {
    return query.runSuiteQL({ query: sql, params: params }).asMappedResults();
  }
  function num(v) { return v == null || v === '' ? 0 : Number(v); }
  function money(v) {
    return num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // BUILTIN.DF(entity) prepends the entity id ("02901 ชื่อลูกค้า") — customer-facing
  // documents want just the name, so drop a leading numeric id token.
  function cleanName(v) {
    return String(v == null ? '' : v).replace(/^\d+\s+/, '').trim();
  }

  /**
   * Build the curated invoice object from a transaction id via SuiteQL.
   * Keys match sample-templates bindings: customer.name/address, document.number/date,
   * totals.subtotal/tax/total, items[].{description,quantity,unit_price,amount}.
   */
  function buildInvoiceData(recId) {
    var id = Number(recId);

    var hdr = first(
      "SELECT tranid, " +
      "  TO_CHAR(trandate, 'DD/MM/YYYY') AS trandate, " +
      "  BUILTIN.DF(entity) AS customer_name, " +
      "  total " +
      "FROM transaction WHERE id = ?",
      [id]
    );

    // subtotal/taxtotal are not SuiteQL transaction columns — read the two totals
    // from the record body fields (authoritative), the one N/record hybrid.
    var rec = record.load({ type: record.Type.INVOICE, id: id });

    // transactionline stores invoice amounts/qty GL-signed (negative for income
    // charge lines) — negate for customer-facing display (charges positive).
    // Skip pure-noise rows (qty 0 AND amount 0) that clutter the printed invoice
    // (placeholder/empty item lines) — real charges and discounts (amount <> 0) stay.
    var lines = many(
      "SELECT COALESCE(memo, BUILTIN.DF(item)) AS description, " +
      "  -quantity AS quantity, " +
      "  rate AS unit_price, " +
      "  -netamount AS amount " +
      "FROM transactionline " +
      "WHERE transaction = ? AND mainline = 'F' AND taxline = 'F' AND item IS NOT NULL " +
      "  AND (netamount <> 0 OR quantity <> 0) " +
      "ORDER BY linesequencenumber",
      [id]
    );

    var items = lines.map(function (l) {
      return {
        description: l.description || '',
        quantity: num(l.quantity),
        unit_price: money(l.unit_price),
        amount: money(l.amount)
      };
    });

    // Totals from the record body (authoritative) — not summed from lines, which
    // can carry offsetting discount/return entries.
    var total = num(hdr.total);
    var subtotal = num(rec.getValue({ fieldId: 'subtotal' }));
    var tax = num(rec.getValue({ fieldId: 'taxtotal' }));

    // Billing address: the formatted address text lives on the record body field
    // (billaddress) — read via the record already loaded (N/record hybrid), avoiding
    // the multi-table SuiteQL address model.
    var billAddress = '';
    try { billAddress = rec.getValue({ fieldId: 'billaddress' }) || ''; } catch (e) { billAddress = ''; }

    return {
      company: companyConfig.load(),
      customer: { name: cleanName(hdr.customer_name), address: billAddress },
      document: { number: hdr.tranid || '', date: hdr.trandate || '' },
      totals: { subtotal: money(subtotal), tax: money(tax), total: money(total) },
      items: items
    };
  }

  return { buildInvoiceData: buildInvoiceData };
});

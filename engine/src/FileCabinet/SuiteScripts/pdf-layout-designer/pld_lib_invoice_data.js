/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Invoice data builder — produces the curated binding schema for the Thai tax
 * invoice (ใบแจ้งหนี้/ใบกำกับภาษี), matching the Teibto Thai Localization reference
 * (PFTS_Invoice, script 1455). Bound as `record` at Print/Preview (design = data = print).
 *
 * Sources (all verified on inv 1234683, #73):
 *  - company:  company-config record (pld_lib_company_config)
 *  - document/customer/shipTo: transaction body incl Thai-Loc custbody_thl_* fields
 *  - totals:   customrecord_thl_summarytotal (child rows typed by custrecord_sum_type) —
 *              the statutory breakdown (Product/Service Total, Special Discount, Base,
 *              Tax, Net) exactly as the reference computes it, NOT re-summed here
 *  - items:    transactionline (all lines; Amount = gross qty×rate, tax-exclusive)
 *  - amount-in-words: pld_lib_baht_text
 *
 * The schema is a SUPERSET of the earlier simple invoice (#69) — the old keys
 * (customer.name/address, document.number/date, totals.subtotal/tax/total,
 * items[].description/quantity/unit_price/amount) still resolve.
 *
 * Known refinements (verify phase): unit-of-measure display + multi-unit qty
 * conversion (e.g. "10 Pack12"), doc-title lookup from customrecord_thl_docprintouttype
 * (currently hard-set for the invoice type), and the exact PFTS line grouping.
 *
 * @author Wichit Wongta
 * @since 2026-07-18
 */
define(['N/query', 'N/record', './pld_lib_company_config', './pld_lib_baht_text'],
function (query, record, companyConfig, bahtText) {

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
  // BUILTIN.DF(entity) prepends the entity id ("02901 ชื่อลูกค้า") — drop it.
  function cleanName(v) {
    return String(v == null ? '' : v).replace(/^\d+\s+/, '').trim();
  }
  // Thai branch code convention: 00000 (or 0/empty) = head office.
  function branchText(code) {
    var c = String(code == null ? '' : code).trim();
    return (c === '' || c === '0' || c === '00000') ? 'สำนักงานใหญ่' : c;
  }
  function bodyValue(rec, fld) {
    try { return rec.getValue({ fieldId: fld }); } catch (e) { return ''; }
  }

  /**
   * @param {string|number} recId  invoice internal id
   * @param {string} [copyLabelTH] e.g. 'ต้นฉบับ' / 'สำเนา' (multi-copy); default original
   * @param {string} [copyLabelEN] e.g. 'Original' / 'Copy'
   */
  function buildInvoiceData(recId, copyLabelTH, copyLabelEN) {
    var id = Number(recId);
    var rec = record.load({ type: record.Type.INVOICE, id: id });

    var hdr = first(
      "SELECT tranid, TO_CHAR(trandate,'DD/MM/YYYY') AS trandate, " +
      "  TO_CHAR(duedate,'DD/MM/YYYY') AS duedate, otherrefnum, " +
      "  BUILTIN.DF(entity) AS customer_name, BUILTIN.DF(createdby) AS created_by " +
      "FROM transaction WHERE id = ?",
      [id]
    );

    // ── Thai-Loc body fields (custbody_thl_*) ──
    var custTaxId  = bodyValue(rec, 'custbody_thl_entvatregistrationno');
    var custBranch = bodyValue(rec, 'custbody_thl_entbranchno');
    var whtTotal   = num(bodyValue(rec, 'custbody_thl_withholdingtaxtotal'));
    var billAddr   = bodyValue(rec, 'billaddress') || '';
    var shipAddr   = bodyValue(rec, 'shipaddress') || '';

    // ── Statutory totals: customrecord_thl_summarytotal, one row per sum type ──
    var sums = many(
      "SELECT BUILTIN.DF(custrecord_sum_type) AS sumtype, custrecord_sum_total AS total, " +
      "  custrecord_sum_taxrate AS taxrate FROM customrecord_thl_summarytotal " +
      "WHERE custrecord_sum_parenttransaction = ?",
      [id]
    );
    var T = {}, taxRate = 0;
    sums.forEach(function (s) {
      T[s.sumtype] = (T[s.sumtype] || 0) + num(s.total);
      if (s.sumtype === 'Tax Total' && s.taxrate != null) taxRate = num(s.taxrate);
    });

    var grossTotal      = num(T['Product/Service Total']);
    var specialDiscount = Math.abs(num(T['Special Discount']) + num(T['Discount Item']));
    var advanceReceive  = Math.abs(num(T['Apply Advance']));
    var cashCoupon      = Math.abs(num(T['Cash Coupon']));
    // Fall back to body fields when a sum type isn't present.
    var baseAmount = T['Base Total'] != null ? num(T['Base Total']) : num(bodyValue(rec, 'subtotal'));
    var vat        = T['Tax Total']  != null ? num(T['Tax Total'])  : num(bodyValue(rec, 'taxtotal'));
    var grandTotal = T['Net Total']  != null ? num(T['Net Total'])  : (baseAmount + vat);
    var wht        = whtTotal || Math.abs(num(T['Withholding Tax']));
    var customerPaid = grandTotal - wht;
    var vatRatePct = taxRate ? (num(taxRate) * 100).toFixed(2) : '7.00';

    // ── Line items: all lines (exclude the 'Subtotal' totals-marker line). Amount is
    //    the GROSS extended amount (qty × rate, tax-exclusive) as the reference shows;
    //    discount/promotion lines carry only an amount (no qty/rate). quantity is
    //    GL-signed (negative for charges) → negate for display. ──
    var lines = many(
      "SELECT linesequencenumber AS seq, itemtype, BUILTIN.DF(item) AS item_code, memo, " +
      "  -quantity AS quantity, rate AS unit_price, " +
      "  CASE WHEN quantity IS NOT NULL AND rate IS NOT NULL THEN -quantity * rate " +
      "       ELSE -netamount END AS amount " +
      "FROM transactionline " +
      "WHERE transaction = ? AND mainline = 'F' AND taxline = 'F' AND item IS NOT NULL " +
      "  AND itemtype <> 'Subtotal' " +
      "ORDER BY linesequencenumber",
      [id]
    );

    var items = lines.map(function (l, i) {
      var qty = l.quantity == null ? null : num(l.quantity);
      return {
        no: i + 1,
        code: l.item_code || '',
        name: l.item_code || '',
        memo: l.memo || '',
        quantity: qty,
        unit: '',                                  // refinement: UOM display
        unit_price: l.unit_price == null ? '' : money(l.unit_price),
        discount: '',
        amount: money(l.amount),
        // backward-compat (#69 simple template)
        description: (l.item_code || '') + (l.memo ? '\n' + l.memo : '')
      };
    });

    var cfg = companyConfig.load();

    return {
      company: {
        name: cfg.name, nameEn: cfg.nameEn, address: cfg.address, addressEn: cfg.addressEn,
        phone: cfg.phone, email: cfg.email, taxId: cfg.taxId,
        branch: branchText(cfg.branch), branchCode: cfg.branch || '',
        logo: cfg.logo
      },
      document: {
        number: hdr.tranid || '',
        date: hdr.trandate || '',
        dueDate: hdr.duedate || '',
        refSo: '',
        refNo: hdr.otherrefnum || '',
        // Invoice type titles (this builder targets the invoice/tax-invoice form).
        titleTH: 'ใบแจ้งหนี้/ใบกำกับภาษี' + (copyLabelTH ? ' (' + copyLabelTH + ')' : ' (ต้นฉบับ)'),
        titleEN: 'INVOICE/TAX INVOICE' + (copyLabelEN ? ' (' + copyLabelEN + ')' : ' (Original)'),
        copyTH: copyLabelTH || 'ต้นฉบับ',
        copyEN: copyLabelEN || 'Original'
      },
      customer: {
        name: cleanName(hdr.customer_name),
        address: billAddr,
        taxId: custTaxId || '',
        branch: branchText(custBranch)
      },
      shipTo: { address: shipAddr },
      totals: {
        // Thai statutory 9-row breakdown
        gross: money(grossTotal),
        specialDiscount: money(specialDiscount),
        advanceReceive: money(advanceReceive),
        baseAmount: money(baseAmount),
        vatRate: vatRatePct,
        vat: money(vat),
        grandTotal: money(grandTotal),
        wht: money(wht),
        cashCoupon: money(cashCoupon),
        customerPaid: money(customerPaid),
        bahtText: bahtText.bahtText(grandTotal),
        // backward-compat (#69)
        subtotal: money(baseAmount),
        tax: money(vat),
        total: money(grandTotal)
      },
      issuer: { createdBy: cleanName(hdr.created_by) },
      items: items
    };
  }

  return { buildInvoiceData: buildInvoiceData };
});

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
 * Known refinements (verify phase): doc-title lookup from
 * customrecord_thl_docprintouttype (currently hard-set for the invoice type).
 *
 * @author Wichit Wongta
 * @since 2026-07-18
 */
define(['N/query', 'N/record', 'N/format', './pld_lib_company_config', './pld_lib_baht_text', './pld_lib_thai_wordbreak'],
function (query, record, format, companyConfig, bahtText, wordbreak) {

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

  // ── Generic body-field exposure (#79) ──
  // Every custbody_* plus a shortlist of standard body fields, so a template
  // can bind fields the curated schema doesn't cover (fields.custbody_xxx)
  // without touching this library. Select fields expose their display text;
  // dates become DD/MM/YYYY; numbers stay numeric so col.format (#77) applies.
  var STANDARD_FIELDS = [
    'memo', 'salesrep', 'terms', 'currency', 'location',
    'department', 'class', 'subsidiary', 'shipmethod', 'trackingnumbers'
  ];
  function fieldDisplay(rec, fld) {
    var v;
    try { v = rec.getValue({ fieldId: fld }); } catch (e) { return undefined; }
    if (v === undefined || v === null) return '';
    var t = '';
    try {
      t = rec.getText({ fieldId: fld });
    } catch (e) { /* fields without text representation */ }
    if (Array.isArray(t)) t = t.join(', ');
    if (Array.isArray(v)) v = v.join(', ');
    if (t !== '' && t != null && String(t) !== String(v)) return t;
    if (v instanceof Date) {
      return format.format({ value: v, type: format.Type.DATE });
    }
    return v;
  }
  function buildBodyFields(rec) {
    var out = {};
    var all = rec.getFields ? rec.getFields() : [];
    all.forEach(function (fld) {
      if (String(fld).indexOf('custbody') !== 0) return;
      var v = fieldDisplay(rec, fld);
      if (v !== undefined) out[fld] = v;
    });
    STANDARD_FIELDS.forEach(function (fld) {
      var v = fieldDisplay(rec, fld);
      if (v !== undefined) out[fld] = v;
    });
    return out;
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

    // ── Line items — mirror the PFTS reference line set (#73, verified against the
    //    reference PDF + probe of inv 1234683):
    //    · real item lines AND the item-less promo/markup/trade-agreement lines
    //    · hidden: 'Subtotal' marker; 'Discount' rows (a Discount row is the printed
    //      Discount column of the line ABOVE it — the reference lookahead)
    //    · zero/absent numbers print BLANK, not 0.00
    //    · qty in display units (base qty ÷ uom conversion, e.g. 120 → "10" Pack12);
    //      unit price stays the base-unit rate, amount = base qty × rate (as printed)
    //    · item display = code + displayname ("PD000002 Product B")
    //    · an item-less row prints the PREVIOUS printed row's memo as its name and
    //      its own memo as the sub-line (matches the reference bold/sub pairing)
    //    quantity is GL-signed (negative for charges) → negate for display. The
    //    reference shows expense-item lines GL-negative (-50/-1,500) but that
    //    contradicts the record UI and its own summary sum — kept record-signed.
    var lines = many(
      "SELECT tl.linesequencenumber AS seq, tl.itemtype, " +
      "  BUILTIN.DF(tl.item) AS item_code, itm.displayname AS item_name, tl.memo, " +
      "  -tl.quantity AS quantity, tl.rate AS unit_price, " +
      "  uom.unitname AS unit_name, uom.conversionrate AS conv, " +
      "  CASE WHEN tl.quantity IS NOT NULL AND tl.rate IS NOT NULL THEN -tl.quantity * tl.rate " +
      "       ELSE -tl.netamount END AS amount " +
      "FROM transactionline tl " +
      "  LEFT JOIN item itm ON itm.id = tl.item " +
      "  LEFT JOIN unitstypeuom uom ON uom.internalid = tl.units " +
      "WHERE tl.transaction = ? AND tl.mainline = 'F' AND tl.taxline = 'F' " +
      "  AND (tl.itemtype IS NULL OR tl.itemtype <> 'Subtotal') " +
      "ORDER BY tl.linesequencenumber",
      [id]
    );

    // ── Line-level custom fields (#89): custcol_* attached straight onto each
    //    printed row, so a table column can bind key 'custcol_xxx' directly and
    //    the column-key picker lists them. SELECT * (names are per-account);
    //    map by linesequencenumber. Select-type custcols yield internal ids
    //    (BUILTIN.DF can't wildcard) — text/number/date custcols print as-is.
    var custcolBySeq = {};
    try {
      many(
        "SELECT * FROM transactionline WHERE transaction = ? AND mainline = 'F' AND taxline = 'F'",
        [id]
      ).forEach(function (row) {
        var cc = {};
        Object.keys(row).forEach(function (k) {
          if (k.indexOf('custcol') !== 0) return;
          var v = row[k];
          cc[k] = typeof v === 'string' ? wordbreak.breakThai(v) : v;
        });
        custcolBySeq[row.linesequencenumber] = cc;
      });
    } catch (e) { /* custcol enrichment is best-effort — never break the render */ }

    function qtyText(q) {
      return q == null || q === '' ? ''
        : Number(q).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    function moneyOrBlank(v) {
      return num(v) === 0 ? '' : money(v);
    }

    var items = [];
    var prevMemo = '';
    lines.forEach(function (l) {
      if (l.itemtype === 'Discount') {
        if (items.length && num(l.amount) !== 0) {
          items[items.length - 1].discount = money(Math.abs(num(l.amount)));
        }
        return;
      }
      var isItem = !!l.item_code;
      var name = isItem
        ? l.item_code + (l.item_name && l.item_name !== l.item_code ? ' ' + l.item_name : '')
        : (prevMemo || l.memo || '');
      var conv = num(l.conv) || 1;
      var memo = l.memo || '';
      // ZWSP word breaks (#87) on the long Thai fields only — BFO otherwise
      // breaks Thai anywhere. prevMemo stays raw (lookahead compares data).
      var row = {
        no: items.length + 1,
        code: isItem ? l.item_code : '',
        name: wordbreak.breakThai(name),
        memo: wordbreak.breakThai(memo),
        quantity: isItem && l.quantity != null ? qtyText(num(l.quantity) / conv) : '',
        unit: isItem ? (l.unit_name || '') : '',
        unit_price: isItem ? moneyOrBlank(l.unit_price) : '',
        discount: '',
        amount: moneyOrBlank(l.amount),
        // backward-compat (#69 simple template); \n renders via the table cell <br/>
        description: wordbreak.breakThai(name + (memo ? '\n' + memo : ''))
      };
      // custcol_* ride on the row itself (#89) — curated keys can't collide
      // with the custcol prefix
      var cc = custcolBySeq[l.seq];
      if (cc) Object.keys(cc).forEach(function (k) { row[k] = cc[k]; });
      items.push(row);
      prevMemo = memo;
    });

    var cfg = companyConfig.load();

    // Bordered key/value grids rendered as PLD tables (ShapeElement has no border,
    // so the doc-info and summary boxes are 2-column tables bound to these arrays).
    var docInfoRows = [
      { label: 'Doc No. / เลขที่เอกสาร', value: hdr.tranid || '' },
      { label: 'Date / วันที่', value: hdr.trandate || '' },
      { label: 'Due Date / วันครบกำหนดชำระ', value: hdr.duedate || '' },
      { label: 'Ref.SO / เลขที่การขาย', value: '' },
      { label: 'Ref.No / เลขที่อ้างอิง', value: hdr.otherrefnum || '' }
    ];
    var summaryRows = [
      { label: 'Total / มูลค่ารวม', value: money(grossTotal) },
      { label: 'Special Discount / ส่วนลดพิเศษ', value: money(specialDiscount) },
      { label: 'Advance Receive / หักเงินรับล่วงหน้า', value: money(advanceReceive) },
      { label: 'Base Amount / มูลค่าก่อนภาษีมูลค่าเพิ่ม', value: money(baseAmount) },
      { label: 'VAT / ภาษีมูลค่าเพิ่ม ' + vatRatePct + '%', value: money(vat) },
      { label: 'Grand Total / มูลค่าสุทธิ', value: money(grandTotal) },
      { label: 'Withholding Tax / ภาษีหัก ณ ที่จ่าย', value: money(wht) },
      { label: 'Cash Coupon / คูปองส่วนลดเงินสด', value: money(cashCoupon) },
      { label: 'Customer Paid / ยอดชำระ (บาท)', value: money(customerPaid) }
    ];

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
        copyEN: copyLabelEN || 'Original',
        printedDate: format.format({ value: new Date(), type: format.Type.DATETIME }),
        docInfoRows: docInfoRows
      },
      customer: {
        name: wordbreak.breakThai(cleanName(hdr.customer_name)),
        address: wordbreak.breakThai(billAddr),
        taxId: custTaxId || '',
        branch: branchText(custBranch)
      },
      shipTo: { address: wordbreak.breakThai(shipAddr) },
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
        summaryRows: summaryRows,
        // backward-compat (#69)
        subtotal: money(baseAmount),
        tax: money(vat),
        total: money(grandTotal)
      },
      issuer: { createdBy: cleanName(hdr.created_by) },
      items: items,
      // Generic body fields (#79): fields.custbody_xxx + standard shortlist
      fields: buildBodyFields(rec)
    };
  }

  return { buildInvoiceData: buildInvoiceData };
});

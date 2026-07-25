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
  // Date → DD/MM/YYYY. Duck-typed rather than `instanceof Date` because the engine
  // unit tests mount this module in a separate vm realm, where a Date constructed
  // outside it fails instanceof; behaviour on NetSuite is identical either way.
  function dateText(v) {
    if (v == null || v === '') return '';
    if (typeof v.getTime === 'function') {
      return format.format({ value: v, type: format.Type.DATE });
    }
    return String(v);
  }

  // ── Generic body-field exposure (#79) ──
  // Every custbody_* plus a shortlist of standard body fields, so a template
  // can bind fields the curated schema doesn't cover (fields.custbody_xxx)
  // without touching this library. Select fields expose their display text;
  // dates become DD/MM/YYYY; numbers stay numeric so col.format (#77) applies.
  var STANDARD_FIELDS = [
    'memo', 'salesrep', 'terms', 'currency', 'location',
    'department', 'class', 'subsidiary', 'shipmethod', 'trackingnumbers',
    'employee',  // requestor on purchase orders (master pack binds ${record.employee}, #155)
    'paymentmethod', 'checknum',  // receipt: how it was paid + cheque/ref no (#170)
    // Source document of a fulfillment ("ใบสั่งขาย (SO No.)" on the master delivery
    // note, #170). Read off the LOADED RECORD, never from SuiteQL: `createdfrom` is
    // not an identifier the transaction table accepts, and selecting it threw
    // "Unknown identifier 'createdfrom'" on the very first query of EVERY curated
    // render — one column took the whole account's printing down (#174).
    'createdfrom'
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

  // ── Multi-rectype support (#91) ──
  // Curated schema is shared; only the record type, document titles, and the
  // GL sign of line amounts differ. Sales-side transactions store item lines
  // GL-negative (negate for display, #67); purchase-side lines are positive.
  // Titles mirror designer/src/constants/record-types.ts so the picker label and the
  // printed header agree — except cashsale, where the picker needs the "(ขายสด)"
  // disambiguator (it shares "ใบเสร็จรับเงิน" with customerpayment) but the printed
  // document must not carry it.
  var DOC_TITLES = {
    invoice:             { th: 'ใบแจ้งหนี้/ใบกำกับภาษี', en: 'INVOICE/TAX INVOICE' },
    creditmemo:          { th: 'ใบลดหนี้', en: 'CREDIT NOTE' },
    estimate:            { th: 'ใบเสนอราคา', en: 'QUOTATION' },
    salesorder:          { th: 'ใบสั่งขาย', en: 'SALES ORDER' },
    purchaseorder:       { th: 'ใบสั่งซื้อ', en: 'PURCHASE ORDER' },
    cashsale:            { th: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', en: 'RECEIPT/TAX INVOICE' },
    vendorbill:          { th: 'ใบรับวางบิล', en: 'VENDOR BILL' },
    returnauthorization: { th: 'ใบรับคืนสินค้า', en: 'RETURN AUTHORIZATION' },
    itemfulfillment:     { th: 'ใบส่งสินค้า', en: 'DELIVERY NOTE' },
    customerpayment:     { th: 'ใบเสร็จรับเงิน', en: 'RECEIPT' }
  };
  // Record types whose transactionline quantities are already the printed sign, so
  // they must NOT be negated (#176). Purchase-side documents were the original case;
  // a return authorization joined them after QA on SB2 proved it stores +0.5 and the
  // sales-side negation printed -0.5 on the customer's copy. The name says what the
  // flag DOES — it is not a statement about which side of the business a document is.
  var KEEP_LINE_SIGN = { purchaseorder: true, vendorbill: true, returnauthorization: true };
  // Record types whose transactionline rows are NOT the printed lines (#176).
  // An item fulfillment stores an accounting PAIR per shipped item — the item line and
  // its Cost of Sales counterpart — both `mainline='F' AND taxline='F'`, so the filter
  // that is correct for an invoice returns both: the delivery note printed the same
  // product twice, once with a negative quantity, with the account name as its
  // sub-line, and no unit. The record's own `item` sublist holds exactly one row per
  // shipped item, already in display units, with the unit text attached.
  // Proven on SB2 IFS-TH-260700003: transactionline → 2 rows (-168 / +168, unit
  // blank); `item` sublist → 1 row (quantity 7, unitsdisplay "Tray24").
  var SUBLIST_ITEMS = { itemfulfillment: true };
  // Types with NO statutory VAT breakdown (#170). The Thai 9-row summary comes from
  // customrecord_thl_summarytotal, which these records have no rows in — so every
  // money figure would otherwise print a truthful-looking "0.00" and a delivery note
  // would read "(ศูนย์บาทถ้วน)". Money TEXT is blank for these instead, which is also
  // what a template branches on (#165): `<#if (record.totalText!"") != "">`. The
  // numeric aliases stay 0 so the shape of the contract does not change per record
  // type. A receipt still prints ONE figure — the amount received — through its own
  // `payment`/`paymentText` aliases, not through the statutory rows.
  var NO_TOTALS = { itemfulfillment: true, customerpayment: true };
  // Types whose printed rows are NOT transaction lines (#170). A customer payment has
  // no item lines at all: its rows are the documents it settles, which live on the
  // `apply` sublist of the record itself. Reading that sublist (rather than joining
  // transaction-link tables in SuiteQL) keeps the field names the same ones the master
  // receipt already binds — refnum / applydate / total / amount ARE the sublist fields.
  var APPLY_SOURCE = { customerpayment: true };

  /** Record types this builder supports (exported for the suitelet gates) */
  function isSupportedType(recType) {
    return Object.prototype.hasOwnProperty.call(DOC_TITLES, String(recType));
  }

  // ── Binding contract (#155) ────────────────────────────────────────────────
  // Every supported record type binds THIS object as `record` (the render
  // Suitelet replaces NetSuite's raw record binding with it), so these lists are
  // the complete set of keys a template may bind — anything else resolves to
  // nothing, and null-safe bindings (`!""` / `![]`) turn that into a silently
  // BLANK pdf instead of an error.
  //
  // CURATED_KEYS  = the designer-facing schema (designer picker = data = print)
  // RAW_ALIAS_KEYS = raw-record aliases kept for the hand-written master pack in
  //   templates/master/*.xml, which was authored against NetSuite's raw binding
  //   (${record.tranid}, <#list record.item>). Without them every master printed
  //   an empty header, an empty item table and 0.00 totals.
  // ITEM_BINDING_KEYS = per-row keys inside <#list (record.item)![] as line>.
  //
  // scripts/validate-templates.sh reads these three lists and fails a PR whose
  // master template binds a key the engine never provides.
  var CURATED_KEYS = [
    'subsidiaryId', 'company', 'document', 'customer', 'shipTo', 'totals',
    'issuer', 'items', 'fields'
  ];
  var RAW_ALIAS_KEYS = [
    'tranid', 'trandate', 'duedate', 'entity', 'billaddress', 'shipaddress',
    'memo', 'otherrefnum', 'terms', 'salesrep', 'employee', 'createdfrom',
    'custbody_buyer_taxid', 'custbody_buyer_branch', 'custbody_doc_copy_label',
    'item', 'subtotal', 'discounttotal', 'taxtotal', 'total',
    // Money/quantity as ALREADY-FORMATTED text (#165). A template cannot format a
    // number itself: render.DataSource.OBJECT hands every value to FreeMarker as a
    // string, and `?string("#,##0.00")` on a string returns EMPTY without an error
    // (proven on SB2 — every money cell in the master pack printed blank). So the
    // engine formats, the template prints. discounttotalText is EMPTY when there is
    // no discount, so a template branches on a string compare, never on a number.
    'subtotalText', 'discounttotalText', 'netAmountText', 'taxtotalText',
    'totalText', 'bahtText',
    // Receipt (#170): the settled-document rows plus how the money arrived. `apply`
    // is the same array as `item` — a payment's rows ARE the documents it settles —
    // so a template can loop whichever name reads better for the document it prints.
    'apply', 'payment', 'paymentText', 'paymentmethod', 'checknum'
  ];
  var BINDING_KEYS = CURATED_KEYS.concat(RAW_ALIAS_KEYS);
  // One row shape for every document (#170). A key that does not apply to the row's
  // record type is present and EMPTY rather than absent, so the contract stays the
  // same list everywhere and a template never binds a key that silently disappears
  // on one record type (#155). Item rows leave the settlement keys blank; settlement
  // rows leave the item keys blank.
  var ITEM_BINDING_KEYS = [
    'item', 'description', 'quantity', 'units', 'rate', 'amount',
    // formatted counterparts (#165) — what the item table actually prints
    'quantityText', 'rateText', 'amountText',
    // settled-document rows on a receipt: which document, when, its total
    'refnum', 'applydate', 'total', 'totalText'
  ];
  // ${copy.*} — data source ที่ pld_sl_render_pdf ใส่ให้ทุก render pass (#159)
  // ป้ายชุดเอกสารของ pass นั้น ใช้ได้ทั้ง curated และ raw-record binding
  var COPY_BINDING_KEYS = ['th', 'en', 'label'];

  /**
   * @param {string} recType  NetSuite record type — any key of DOC_TITLES. On a
   *   purchase-side type (vendorbill) `customer.*` / `entity` carry the VENDOR:
   *   the curated schema names the counterparty once and the side decides who it is.
   * @param {string|number} recId  transaction internal id
   * @param {string} [copyLabelTH] e.g. 'ต้นฉบับ' / 'สำเนา' (multi-copy); default original
   * @param {string} [copyLabelEN] e.g. 'Original' / 'Copy'
   */
  function buildTransactionData(recType, recId, copyLabelTH, copyLabelEN) {
    var id = Number(recId);
    var titles = DOC_TITLES[recType] || DOC_TITLES.invoice;
    // '-' negates GL-signed sales lines for display; '' keeps purchase lines as-is
    var sign = KEEP_LINE_SIGN[recType] ? '' : '-';
    // Documents with no statutory VAT breakdown print no summary at all (#170).
    var showTotals = !NO_TOTALS[recType];
    function totalsText(v) { return showTotals ? money(v) : ''; }
    // A receipt's rows come from the `apply` sublist, not from transactionline (#170).
    var isPayment = !!APPLY_SOURCE[recType];
    // A delivery note's rows come from the `item` sublist, for the same reason (#176).
    var isSublistItems = !!SUBLIST_ITEMS[recType];
    var rec = record.load({ type: recType, id: id });

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
    var lines = (isPayment || isSublistItems) ? [] : many(
      "SELECT tl.linesequencenumber AS seq, tl.itemtype, " +
      "  BUILTIN.DF(tl.item) AS item_code, itm.displayname AS item_name, tl.memo, " +
      "  " + sign + "tl.quantity AS quantity, tl.rate AS unit_price, " +
      "  uom.unitname AS unit_name, uom.conversionrate AS conv, " +
      "  CASE WHEN tl.quantity IS NOT NULL AND tl.rate IS NOT NULL THEN " + sign + "tl.quantity * tl.rate " +
      "       ELSE " + sign + "tl.netamount END AS amount " +
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
      ((isPayment || isSublistItems) ? [] : many(
        "SELECT * FROM transactionline WHERE transaction = ? AND mainline = 'F' AND taxline = 'F'",
        [id]
      )).forEach(function (row) {
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
    // Raw-record alias of the printed rows (#155): same rows, NUMERIC values.
    // The master pack formats them with ?string["#,##0.00"], which is a hard
    // FreeMarker error on a string — so these must never carry the curated
    // display strings (money() output has thousands separators).
    var rawItems = [];
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
      rawItems.push({
        item: row.name,
        description: row.memo,
        quantity: isItem && l.quantity != null ? num(l.quantity) / conv : null,
        units: row.unit,
        rate: isItem && l.unit_price != null ? num(l.unit_price) : null,
        amount: l.amount != null ? num(l.amount) : null,
        // What the table prints (#165) — same formatting as the curated row, so a
        // master and a designer-built template show identical figures.
        quantityText: row.quantity,
        rateText: row.unit_price,
        amountText: row.amount,
        // Settlement keys are blank on an item row, not absent (#170) — one row
        // shape for every document, so a template never binds a vanishing key.
        refnum: '', applydate: '', total: null, totalText: ''
      });
      prevMemo = memo;
    });

    // ── Shipped-item rows from the record's own sublist (#176) ─────────────────
    // See SUBLIST_ITEMS. Quantities here are ALREADY in display units (7 Tray24, not
    // 168 base) and the unit text comes with them, so none of the transactionline
    // arithmetic (uom conversion, GL sign) applies. Money stays blank: the fulfillment
    // sublist carries no rate or amount at all — a delivery note prices nothing.
    // getLineCount is not guarded, for the same reason as the apply list (R4): a
    // fulfillment with no item sublist is a broken assumption, not a blank table.
    if (isSublistItems) {
      var itemFields = [];
      try { itemFields = rec.getSublistFields({ sublistId: 'item' }) || []; } catch (e) { itemFields = []; }
      var custcolFields = itemFields.filter(function (f) { return String(f).indexOf('custcol') === 0; });

      var sv = function (fld, line) {
        try {
          var v = rec.getSublistValue({ sublistId: 'item', fieldId: fld, line: line });
          return v == null ? '' : v;
        } catch (e) { return ''; }
      };

      var itemCount = rec.getLineCount({ sublistId: 'item' });
      for (var li = 0; li < itemCount; li++) {
        var code = String(sv('itemname', li) || '');
        var dName = String(sv('displayname', li) || '');
        var lineName = code + (dName && dName !== code ? ' ' + dName : '');
        var lineMemo = String(sv('itemdescription', li) || '');
        var qty = sv('quantity', li);
        var unitText = String(sv('unitsdisplay', li) || '');

        var srow = {
          no: items.length + 1,
          code: code,
          name: wordbreak.breakThai(lineName),
          memo: wordbreak.breakThai(lineMemo),
          quantity: qty === '' ? '' : qtyText(num(qty)),
          unit: unitText,
          unit_price: '',
          discount: '',
          amount: '',
          description: wordbreak.breakThai(lineName + (lineMemo ? '\n' + lineMemo : ''))
        };
        // custcol_* on the row, same contract as the transactionline path (#89)
        custcolFields.forEach(function (f) {
          var v = sv(f, li);
          srow[f] = typeof v === 'string' ? wordbreak.breakThai(v) : v;
        });
        items.push(srow);

        rawItems.push({
          item: srow.name,
          description: srow.memo,
          quantity: qty === '' ? null : num(qty),
          units: unitText,
          rate: null,
          amount: null,
          quantityText: srow.quantity,
          rateText: '',
          amountText: '',
          refnum: '', applydate: '', total: null, totalText: ''
        });
      }
    }

    // ── Settled-document rows (#170) ───────────────────────────────────────────
    // A customer payment has no item lines: what a receipt prints is the list of
    // documents the payment settles, which is the record's own `apply` sublist.
    // Only the lines actually ticked are printed — the sublist also carries every
    // OTHER open document of that customer, and printing those would tell the payer
    // they paid invoices they did not. getLineCount is NOT guarded: a payment record
    // without an apply sublist is a broken assumption, and R4 wants that loud rather
    // than a receipt with an empty table.
    if (isPayment) {
      var applyCount = rec.getLineCount({ sublistId: 'apply' });
      for (var ai = 0; ai < applyCount; ai++) {
        var applied = rec.getSublistValue({ sublistId: 'apply', fieldId: 'apply', line: ai });
        if (applied !== true && applied !== 'T') continue;
        var refnum = rec.getSublistValue({ sublistId: 'apply', fieldId: 'refnum', line: ai });
        var applyDate = rec.getSublistValue({ sublistId: 'apply', fieldId: 'applydate', line: ai });
        var docTotal = rec.getSublistValue({ sublistId: 'apply', fieldId: 'total', line: ai });
        var paidAmt = rec.getSublistValue({ sublistId: 'apply', fieldId: 'amount', line: ai });
        items.push({
          no: items.length + 1,
          code: '', name: String(refnum == null ? '' : refnum), memo: '',
          quantity: '', unit: '', unit_price: '', discount: '',
          amount: moneyOrBlank(paidAmt),
          description: String(refnum == null ? '' : refnum)
        });
        rawItems.push({
          item: String(refnum == null ? '' : refnum),
          description: '',
          quantity: null, units: '', rate: null,
          amount: paidAmt == null ? null : num(paidAmt),
          quantityText: '', rateText: '', amountText: money(paidAmt),
          refnum: String(refnum == null ? '' : refnum),
          applydate: dateText(applyDate),
          total: docTotal == null ? null : num(docTotal),
          totalText: money(docTotal)
        });
      }
    }

    // The one figure a receipt prints, and the figure the amount-in-words describes
    // (#170): the amount received on a payment, the grand total on a sales document,
    // nothing at all on a delivery note (so no "(ศูนย์บาทถ้วน)" under an empty table).
    var paymentAmount = isPayment ? num(bodyValue(rec, 'payment')) : 0;
    var wordsAmount = isPayment ? paymentAmount : (showTotals ? grandTotal : null);
    var wordsText = wordsAmount == null ? '' : bahtText.bahtText(wordsAmount);

    // Subsidiary scoping (OneWorld, issue #144): the transaction's own subsidiary
    // body field decides which customrecord_pld_config row companyConfig.load()
    // matches — empty/absent (non-OneWorld) falls back to the global config.
    var subsidiaryId = bodyValue(rec, 'subsidiary') || '';
    var cfg = companyConfig.load(subsidiaryId);

    // Bordered key/value grids rendered as PLD tables (ShapeElement has no border,
    // so the doc-info and summary boxes are 2-column tables bound to these arrays).
    var docInfoRows = [
      { label: 'Doc No. / เลขที่เอกสาร', value: hdr.tranid || '' },
      { label: 'Date / วันที่', value: hdr.trandate || '' },
      { label: 'Due Date / วันครบกำหนดชำระ', value: hdr.duedate || '' },
      { label: 'Ref.SO / เลขที่การขาย', value: '' },
      { label: 'Ref.No / เลขที่อ้างอิง', value: hdr.otherrefnum || '' }
    ];
    // Empty on a goods-movement document (#170): a designer template renders this
    // array as its summary box, so an empty list removes the box instead of drawing
    // nine labelled rows with nothing in them.
    var summaryRows = !showTotals ? [] : [
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

    // ── Raw-record aliases for the master pack (#155) ──
    var bodyFields = buildBodyFields(rec);
    var customerName = wordbreak.breakThai(cleanName(hdr.customer_name));
    // subtotal + discounttotal == baseAmount by construction, so the master's
    // "มูลค่าหลังหักส่วนลด (Net Amount)" row always matches the statutory Base Total.
    // No summary rows on the transaction → subtotal falls back to Base Total and
    // the discount row disappears (0), same as the reference layout.
    var rawSubtotal = grossTotal || baseAmount;
    var rawDiscount = baseAmount - rawSubtotal;

    var out = {
      // Exposed so callers that render from this curated object without their own
      // record handle (e.g. renderCopiesPdf, #144) can still subsidiary-scope the
      // top-level ${company.*} data source — not itself bound by any template.
      subsidiaryId: subsidiaryId,
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
        // Titles per record type (#91), copy label appended (multi-copy #15)
        titleTH: titles.th + (copyLabelTH ? ' (' + copyLabelTH + ')' : ' (ต้นฉบับ)'),
        titleEN: titles.en + (copyLabelEN ? ' (' + copyLabelEN + ')' : ' (Original)'),
        copyTH: copyLabelTH || 'ต้นฉบับ',
        copyEN: copyLabelEN || 'Original',
        printedDate: format.format({ value: new Date(), type: format.Type.DATETIME }),
        docInfoRows: docInfoRows
      },
      customer: {
        name: customerName,
        address: wordbreak.breakThai(billAddr),
        taxId: custTaxId || '',
        branch: branchText(custBranch)
      },
      shipTo: { address: wordbreak.breakThai(shipAddr) },
      totals: {
        // Thai statutory 9-row breakdown — every figure blank on a document that
        // moves goods rather than money (#170)
        gross: totalsText(grossTotal),
        specialDiscount: totalsText(specialDiscount),
        advanceReceive: totalsText(advanceReceive),
        baseAmount: totalsText(baseAmount),
        vatRate: showTotals ? vatRatePct : '',
        vat: totalsText(vat),
        grandTotal: totalsText(grandTotal),
        wht: totalsText(wht),
        cashCoupon: totalsText(cashCoupon),
        // On a receipt this row IS the document: the amount received (#170)
        customerPaid: isPayment ? money(paymentAmount) : totalsText(customerPaid),
        bahtText: wordsText,
        summaryRows: summaryRows,
        // backward-compat (#69)
        subtotal: totalsText(baseAmount),
        tax: totalsText(vat),
        total: totalsText(grandTotal)
      },
      issuer: { createdBy: cleanName(hdr.created_by) },
      items: items,
      // Generic body fields (#79): fields.custbody_xxx + standard shortlist
      fields: bodyFields,

      // ── Raw-record aliases (#155) — see RAW_ALIAS_KEYS ──────────────────────
      // Keep in sync with RAW_ALIAS_KEYS; validate-templates.sh fails a master
      // that binds a key missing from that list, and the engine unit test fails
      // a key listed there but missing here.
      tranid: hdr.tranid || '',
      trandate: hdr.trandate || '',
      duedate: hdr.duedate || '',
      entity: customerName,
      billaddress: wordbreak.breakThai(billAddr),
      shipaddress: wordbreak.breakThai(shipAddr),
      memo: bodyFields.memo || '',
      otherrefnum: hdr.otherrefnum || '',
      terms: bodyFields.terms || '',
      salesrep: bodyFields.salesrep || '',
      employee: bodyFields.employee || '',
      // Source document ("ใบสั่งขาย (SO No.)" on the master delivery note, #170) —
      // from the record, not SuiteQL (#174)
      createdfrom: bodyFields.createdfrom || '',
      // Buyer tax id/branch: the account's own field wins, else the Thai-Loc
      // custbody_thl_* values the curated schema already resolved.
      custbody_buyer_taxid: bodyValue(rec, 'custbody_buyer_taxid') || custTaxId || '',
      custbody_buyer_branch: bodyValue(rec, 'custbody_buyer_branch') || branchText(custBranch),
      // Copy label of the copy BEING rendered right now (#155). Must win over any
      // stored body field of the same name: the copy set is resolved per render
      // pass (renderCopiesPdf), so without this every copy of a Thai tax invoice
      // printed "ต้นฉบับ" — including the สำเนา.
      custbody_doc_copy_label: (copyLabelTH || 'ต้นฉบับ') + ' (' + (copyLabelEN || 'Original') + ')',
      item: rawItems,
      // Same rows under the name a receipt reads better with (#170) — the master
      // receipt loops <#list (record.apply)![] as line>.
      apply: rawItems,
      // How the money arrived (#170). `payment` stays numeric like the other amount
      // aliases; `paymentText` is what a template prints (#165).
      payment: paymentAmount,
      paymentText: isPayment ? money(paymentAmount) : '',
      paymentmethod: bodyFields.paymentmethod || '',
      checknum: bodyFields.checknum || '',
      subtotal: rawSubtotal,
      discounttotal: rawDiscount,
      taxtotal: vat,
      total: grandTotal,
      // Formatted money (#165): the numeric keys above survive the trip to
      // FreeMarker only as strings, so anything a template PRINTS must be
      // formatted here. Empty discount text = "no discount row" for the template.
      subtotalText: totalsText(rawSubtotal),
      discounttotalText: rawDiscount && showTotals ? money(Math.abs(rawDiscount)) : '',
      netAmountText: totalsText(baseAmount),
      taxtotalText: totalsText(vat),
      totalText: totalsText(grandTotal),
      bahtText: wordsText
    };

    // ── custbody_* passthrough at the top level (#170) ──────────────────────────
    // Adding a record type to DOC_TITLES flips it from NetSuite's raw record
    // binding to THIS object (pld_sl_render_pdf.makeRenderer), so a template that
    // already printed ${record.custbody_xxx} on an account would start printing
    // BLANK the day its type becomes curated — null-safe bindings swallow it, so
    // nobody would see an error (#155). Republish those keys where they were.
    // Curated keys cannot collide with the custbody prefix (same argument as the
    // per-row custcol_* merge, #89), and the explicit entries above win — notably
    // custbody_doc_copy_label, which must follow the copy being rendered (#159),
    // not whatever is stored on the record.
    Object.keys(bodyFields).forEach(function (fld) {
      if (fld.indexOf('custbody') !== 0) return;
      if (Object.prototype.hasOwnProperty.call(out, fld)) return;
      out[fld] = bodyFields[fld];
    });

    return out;
  }

  /** Back-compat wrapper — the original invoice-only entry point */
  function buildInvoiceData(recId, copyLabelTH, copyLabelEN) {
    return buildTransactionData('invoice', recId, copyLabelTH, copyLabelEN);
  }

  return {
    buildInvoiceData: buildInvoiceData,
    buildTransactionData: buildTransactionData,
    isSupportedType: isSupportedType,
    // Binding contract (#155) — consumed by the engine unit tests; the template
    // validator reads the same lists straight from this source file.
    bindingKeys: BINDING_KEYS,
    itemBindingKeys: ITEM_BINDING_KEYS,
    copyBindingKeys: COPY_BINDING_KEYS,
    supportedTypes: Object.keys(DOC_TITLES)
  };
});

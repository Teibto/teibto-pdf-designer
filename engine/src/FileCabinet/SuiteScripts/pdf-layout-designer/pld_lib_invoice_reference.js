/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Opt-in reference invoice enrichment. The shared N/render caller invokes this
 * only for a real invoice whose master declares pld:reference-layout.
 * Reads reference transaction lines, signed totals, company-branch data and setup;
 * never changes File Cabinet availability or substitutes account configuration.
 *
 * @author Wichit Wongta
 * @since 2026-09-13
 */
define(['N/search', 'N/record', 'N/file', './pld_lib_thai_wordbreak', './pld_lib_baht_text'],
function (search, record, file, wordbreak, amountWords) {
  // Generic default wording from the reference invoice print script. This is
  // document content, not customer data. Match its precedence: use this only
  // when no setup matches; a selected setup may intentionally supply no footer.
  var DEFAULT_REFERENCE_FOOTER =
    'เอกสารฉบับนี้ออกโดยผู้มีอํานาจซึ่งได้รับการอนุมัติผ่านระบบงานของบริษัทฯ ไม่จําเป็นต้องมีลายเซ็นผู้อนุมัติลงนาม / ห้ามโอนสิทธิเรียกร้อง / โปรดระบุเลขที่งานในเอกสารที่เกี่ยวข้อง \n' +
    'เพื่อความสะดวกในการตรวจรับและชําระเงิน / This document is issued and approved electronically by authorized person via internal system. \n' +
    'Authorized signature is not required. / No assignment of rights and obligations. / Please refer PO no in related documents.';
  var COMPANY_JOIN = 'CUSTBODY_THL_COMPANYBRANCHADDRESS';
  var COMPANY_FIELDS = {
    name: 'custrecord_cba_companyname',
    address: 'custrecord_cba_address',
    taxId: 'custrecord_cba_vatregistrationno',
    branchCode: 'custrecord_cba_branchno',
    logo: 'custrecord_cba_doclogo'
  };

  function text(value) { return String(value == null ? '' : value); }
  function fail(code, message) {
    var error = new Error(message);
    error.name = code;
    throw error;
  }

  // Return plain data, never XML fragments. Decode AFTER removing actual markup,
  // so encoded angle brackets remain literal text for the template's ?xml escape.
  function plainText(value) {
    return text(value)
      .replace(/\r\n?/g, '\n')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?\s*>|<\/(?:div|p)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (whole, entity) {
        var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        var key = entity.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(named, key)) return named[key];
        var code = key.indexOf('#x') === 0 ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        if (code === 9 || code === 10 || code === 13 ||
            (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
            (code >= 0x10000 && code <= 0x10ffff)) return String.fromCodePoint(code);
        return '';
      })
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .trim();
  }

  function scopedRows(searchId, scopeField, recordId, requiredColumns) {
    var saved = search.load({ id: searchId });
    var existing = saved.filterExpression || [];
    var scope = [scopeField, 'anyof', recordId];
    // Preserve grouping of any OR expression already present in the saved search.
    saved.filterExpression = existing.length ? [existing, 'AND', scope] : [scope];
    var columns = (saved.columns || []).slice();
    requiredColumns.forEach(function (required) {
      var present = columns.some(function (column) {
        return column.name === required.name && text(column.join).toUpperCase() === text(required.join).toUpperCase();
      });
      if (!present) columns.push(search.createColumn(required));
    });
    saved.columns = columns;
    // Keep the saved search's ordering: consecutive Discount Item rows belong
    // to the preceding printed item, including across search-page boundaries.
    var pages = saved.runPaged({ pageSize: 1000 });
    var rows = [];
    pages.pageRanges.forEach(function (range) {
      rows = rows.concat(pages.fetch({ index: range.index }).data);
    });
    return rows;
  }

  function invoiceRows(recordId) {
    var columns = Object.keys(COMPANY_FIELDS).map(function (key) {
      return { name: COMPANY_FIELDS[key], join: COMPANY_JOIN };
    });
    ['item', 'memo', 'quantityuom', 'fxamount', 'unit', 'fxrate', 'custcol_thl_summarytype',
      'custbody_thl_entlegalname', 'custbody_thl_entvatregistrationno', 'custbody_thl_entbranchno',
      'billaddress', 'shipaddress'].forEach(function (name) { columns.push({ name: name }); });
    columns.push({ name: 'displayname', join: 'item' }, { name: 'type', join: 'item' }, { name: 'symbol', join: 'CURRENCY' });
    var rows = scopedRows('customsearch_thl_transactiondataprintinv', 'internalid', recordId, columns);
    if (!rows.length) {
      fail('PLD_REFERENCE_COMPANY_MISSING', 'Reference invoice search returned no company-branch row for the requested invoice.');
    }
    return rows;
  }

  function companyForInvoice(rows) {
    // The legacy header uses the final result row; every row belongs to the
    // same invoice because the saved search is explicitly scoped above.
    var source = rows[rows.length - 1];
    var company = {};
    Object.keys(COMPANY_FIELDS).forEach(function (key) {
      company[key] = plainText(source.getValue({ name: COMPANY_FIELDS[key], join: COMPANY_JOIN }));
    });
    ['name', 'address', 'taxId'].forEach(function (key) {
      if (!company[key]) fail('PLD_REFERENCE_COMPANY_INCOMPLETE', 'Reference invoice company-branch field is missing: ' + key + '.');
    });
    if (!/^\d+$/.test(company.logo)) {
      fail('PLD_REFERENCE_LOGO_MISSING', 'Reference invoice company branch requires a File Cabinet logo file.');
    }
    // Read URL only: no save(), isOnline assignment, or public-availability change.
    company.logo = text(file.load({ id: company.logo }).url);
    if (!company.logo) fail('PLD_REFERENCE_LOGO_MISSING', 'Reference invoice logo file has no usable URL.');
    return company;
  }

  function number(value, field) {
    var result = Number(value == null || value === '' ? 0 : value);
    if (!isFinite(result)) fail('PLD_REFERENCE_NUMBER_INVALID', 'Reference invoice contains an invalid numeric field: ' + field + '.');
    return result;
  }

  function money(value) {
    var parts = number(value, 'formatted amount').toFixed(2).split('.');
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }

  function moneyOrBlank(value) {
    return value == null || value === '' ? '' : money(value);
  }

  function financialData(rows, invoice, recordId) {
    var items = [], rawItems = [];
    var gross = 0, specialDiscount = 0, advance = 0, coupon = 0;
    for (var index = 0; index < rows.length; index++) {
      var source = rows[index];
      if (source.getValue({ name: 'type', join: 'item' }) === 'Subtotal') continue;
      // The reference compares with ==: blank summary type is the ordinary
      // type-zero item. Unknown types do not enter any of these categories.
      var type = Number(source.getValue({ name: 'custcol_thl_summarytype' }));
      if (type === 0 || type === 1 || type === 2) {
        var discount = '';
        while (index + 1 < rows.length && rows[index + 1].getText({ name: 'custcol_thl_summarytype' }) === 'Discount Item') {
          index++;
          discount = number(discount, 'line discount') + number(rows[index].getValue({ name: 'fxamount' }), 'line discount');
        }
        var quantity = source.getValue({ name: 'quantityuom' });
        var rate = source.getValue({ name: 'fxrate' });
        // Deliberately do not use fxamount as a fallback. A blank rate on a
        // type-two advance produces a displayed 0.00, as the reference does.
        var amount = number(quantity, 'quantityuom') * number(rate, 'fxrate') + number(discount, 'line discount');
        var code = plainText(source.getText({ name: 'item' }));
        var name = wordbreak.breakThai(plainText(code + ' ' + text(source.getValue({ name: 'displayname', join: 'item' }))));
        var memo = wordbreak.breakThai(plainText(source.getValue({ name: 'memo' })));
        var unit = plainText(source.getValue({ name: 'unit' }));
        var row = {
          no: items.length + 1, code: code, name: name, memo: memo,
          quantity: moneyOrBlank(quantity), unit: unit, unit_price: moneyOrBlank(rate),
          discount: moneyOrBlank(discount), amount: money(amount), description: name + (memo ? '\n' + memo : '')
        };
        items.push(row);
        rawItems.push({
          item: name, description: memo,
          quantity: quantity == null || quantity === '' ? null : number(quantity, 'quantityuom'), units: unit,
          rate: rate == null || rate === '' ? null : number(rate, 'fxrate'), amount: amount,
          quantityText: row.quantity, rateText: row.unit_price, amountText: row.amount,
          refnum: '', applydate: '', total: null, totalText: ''
        });
        if (type === 0 || type === 1) gross += amount;
      } else if (type === 3) {
        specialDiscount += number(source.getValue({ name: 'fxamount' }), 'special discount');
      } else if (type === 4) {
        advance += number(source.getValue({ name: 'fxamount' }), 'advance receive');
      } else if (type === 8) {
        coupon += number(source.getValue({ name: 'fxamount' }), 'cash coupon');
      }
    }
    var summaries = scopedRows('customsearch_thl_summarytotaldataprint', 'custrecord_sum_parenttransaction', recordId,
      [{ name: 'custrecord_sum_type' }, { name: 'custrecord_sum_total' }, { name: 'custrecord_sum_taxrate' }]);
    var wht = 0, vatRate = '';
    summaries.forEach(function (row) {
      var type = Number(row.getValue({ name: 'custrecord_sum_type' }));
      // Source assignments use the final matching row, not a sum/absolute value.
      if (type === 7) wht = number(row.getValue({ name: 'custrecord_sum_total' }), 'withholding tax');
      // Saved percent fields may include the suffix; the template owns "%".
      if (type === 5) vatRate = text(row.getValue({ name: 'custrecord_sum_taxrate' })).trim().replace(/\s*%$/, '');
    });
    var base = gross + specialDiscount + advance;
    var vat = number(invoice.getValue({ fieldId: 'taxtotal' }), 'taxtotal');
    var grand = base + vat;
    coupon = -Math.abs(coupon);
    var paid = grand + wht + coupon;
    var currency = plainText(rows[rows.length - 1].getValue({ name: 'symbol', join: 'CURRENCY' }));
    if (!currency) fail('PLD_REFERENCE_CURRENCY_MISSING', 'Reference invoice saved search did not supply the currency symbol.');
    var words = amountWords.amountInWords(paid, currency);
    var totals = {
      gross: money(gross), specialDiscount: money(specialDiscount), advanceReceive: money(advance),
      baseAmount: money(base), vatRate: vatRate, vat: money(vat), grandTotal: money(grand),
      wht: money(wht), cashCoupon: money(coupon), customerPaid: money(paid),
      amountInWords: words, bahtText: words, subtotal: money(base), tax: money(vat), total: money(grand)
    };
    var labels = [
      ['Total / มูลค่ารวม', 'gross'], ['Special Discount / ส่วนลดพิเศษ', 'specialDiscount'],
      ['Advance Receive / หักเงินรับล่วงหน้า', 'advanceReceive'], ['Base Amount / มูลค่าก่อนภาษีมูลค่าเพิ่ม', 'baseAmount'],
      ['VAT / ภาษีมูลค่าเพิ่ม ' + vatRate + '%', 'vat'], ['Grand Total / มูลค่าสุทธิ', 'grandTotal'],
      ['Withholding Tax / ภาษีหัก ณ ที่จ่าย', 'wht'], ['Cash Coupon / คูปองส่วนลดเงินสด', 'cashCoupon'],
      ['Customer Paid / ยอดชำระ (' + (currency === 'THB' ? 'บาท' : currency) + ')', 'customerPaid']
    ];
    totals.summaryRows = labels.map(function (row) { return { label: row[0], value: totals[row[1]] }; });
    return {
      items: items, item: rawItems, totals: totals, currency: currency,
      subtotal: gross, discounttotal: specialDiscount + advance, taxtotal: vat, total: grand,
      subtotalText: totals.gross, discounttotalText: money(specialDiscount + advance),
      netAmountText: totals.baseAmount, taxtotalText: totals.vat, totalText: totals.grandTotal, bahtText: words
    };
  }

  function subsidiaries(value) {
    var values = Array.isArray(value) ? value : text(value).split(',');
    return values.map(function (entry) { return text(entry).trim(); }).filter(function (entry) { return entry !== ''; });
  }

  function footerSetup(invoice, data) {
    var transactionType = text(invoice.getValue({ fieldId: 'ntype' })).trim();
    var printType = text(invoice.getValue({ fieldId: 'custbody_thl_docprintouttype' })).trim();
    // Non-OneWorld reference forms use the root subsidiary; a real OneWorld
    // invoice supplies its mandatory subsidiary through the loaded record.
    var subsidiary = text(invoice.getValue({ fieldId: 'subsidiary' }) || data.subsidiaryId || '1').trim();
    if (!transactionType || !printType) {
      fail('PLD_REFERENCE_SETUP_CONTEXT_MISSING', 'Reference invoice requires transaction type and Thai document print-out type.');
    }
    var setupSearch = search.create({
      type: 'customrecord_thl_printform_setup',
      filters: [
        ['custrecord_thl_print_out_type', 'is', printType], 'AND',
        ['custrecord_pf_transaction_type', 'is', transactionType], 'AND',
        ['isinactive', 'is', 'F']
      ],
      columns: [
        search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
        search.createColumn({ name: 'custrecord_pf_subsidiaries' }),
        search.createColumn({ name: 'custrecord_pf_footer_description' })
      ]
    });
    var pages = setupSearch.runPaged({ pageSize: 1000 });
    var globalRow = null;
    for (var pageIndex = 0; pageIndex < pages.pageRanges.length; pageIndex++) {
      var rows = pages.fetch({ index: pages.pageRanges[pageIndex].index }).data;
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        var row = rows[rowIndex];
        var scope = subsidiaries(row.getValue({ name: 'custrecord_pf_subsidiaries' }));
        if (scope.indexOf(subsidiary) !== -1) return row;
        if (!scope.length && !globalRow) globalRow = row;
      }
    }
    if (globalRow) return globalRow;
    return null;
  }

  function enrich(data, recordId, request) {
    if (!data || !data.document || !/^\d+$/.test(text(recordId)) || Number(recordId) <= 0) {
      fail('PLD_REFERENCE_CONTEXT_INVALID', 'Reference invoice enrichment requires curated invoice data and a positive invoice internal ID.');
    }
    var invoice = request ? request.rec : record.load({ type: 'invoice', id: text(recordId), isDynamic: false });
    var rows = invoiceRows(text(recordId));
    var company = companyForInvoice(rows);
    var setup = footerSetup(invoice, data);
    var footer = plainText(setup ? setup.getValue({ name: 'custrecord_pf_footer_description' }) : DEFAULT_REFERENCE_FOOTER);
    var result = Object.assign({}, data);
    var finance = financialData(rows, invoice, text(recordId));
    Object.keys(finance).forEach(function (key) { if (key !== 'currency') result[key] = finance[key]; });
    var source = rows[rows.length - 1];
    result.customer = Object.assign({}, data.customer, {
      name: plainText(source.getValue({ name: 'custbody_thl_entlegalname' })),
      address: plainText(source.getValue({ name: 'billaddress' })),
      taxId: plainText(source.getValue({ name: 'custbody_thl_entvatregistrationno' })),
      branchCode: plainText(source.getValue({ name: 'custbody_thl_entbranchno' }))
    });
    result.shipTo = { address: plainText(source.getValue({ name: 'shipaddress' })) };
    result.entity = result.customer.name;
    result.billaddress = result.customer.address;
    result.shipaddress = result.shipTo.address;
    result.custbody_buyer_taxid = result.customer.taxId;
    result.custbody_buyer_branch = result.customer.branchCode;
    result.referenceCompany = company;
    result.document = Object.assign({}, data.document, { footerText: footer, currencyCode: finance.currency });
    return result;
  }

  return { enrich: enrich };
});

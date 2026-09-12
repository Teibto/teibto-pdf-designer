/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Opt-in reference invoice enrichment. The shared N/render caller invokes this
 * only for a real invoice whose master declares pld:reference-layout.
 * Reads transaction company-branch data and the matching Thai print-form setup;
 * never changes File Cabinet availability or substitutes account configuration.
 *
 * @author Wichit Wongta
 * @since 2026-09-13
 */
define(['N/search', 'N/record', 'N/file', './pld_lib_thai_wordbreak'],
function (search, record, file, wordbreak) {
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

  function companyForInvoice(recordId) {
    var saved = search.load({ id: 'customsearch_thl_transactiondataprintinv' });
    var existing = saved.filterExpression || [];
    var scope = ['internalid', 'anyof', recordId];
    // Preserve grouping of any OR expression already present in the saved search.
    saved.filterExpression = existing.length ? [existing, 'AND', scope] : [scope];
    var columns = (saved.columns || []).slice();
    Object.keys(COMPANY_FIELDS).forEach(function (key) {
      var field = COMPANY_FIELDS[key];
      var present = columns.some(function (column) {
        return column.name === field && text(column.join).toUpperCase() === COMPANY_JOIN;
      });
      if (!present) columns.push(search.createColumn({ name: field, join: COMPANY_JOIN }));
    });
    saved.columns = columns;
    var rows = saved.run().getRange({ start: 0, end: 1 });
    if (!rows || !rows.length) {
      fail('PLD_REFERENCE_COMPANY_MISSING', 'Reference invoice search returned no company-branch row for the requested invoice.');
    }
    var company = {};
    Object.keys(COMPANY_FIELDS).forEach(function (key) {
      company[key] = plainText(rows[0].getValue({ name: COMPANY_FIELDS[key], join: COMPANY_JOIN }));
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
    company.name = wordbreak.breakThai(company.name);
    company.address = wordbreak.breakThai(company.address);
    return company;
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

  function enrich(data, recordId) {
    if (!data || !data.document || !/^\d+$/.test(text(recordId)) || Number(recordId) <= 0) {
      fail('PLD_REFERENCE_CONTEXT_INVALID', 'Reference invoice enrichment requires curated invoice data and a positive invoice internal ID.');
    }
    var invoice = record.load({ type: 'invoice', id: text(recordId), isDynamic: false });
    var company = companyForInvoice(text(recordId));
    var setup = footerSetup(invoice, data);
    var footer = plainText(setup ? setup.getValue({ name: 'custrecord_pf_footer_description' }) : DEFAULT_REFERENCE_FOOTER);
    var result = Object.assign({}, data);
    result.referenceCompany = company;
    result.document = Object.assign({}, data.document, { footerText: wordbreak.breakThai(footer) });
    return result;
  }

  return { enrich: enrich };
});

/**
 * Reference invoice enrichment: company scope, read-only logo, setup selection,
 * plain-text output and loud failures. Fixtures are entirely synthetic.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./helpers/amd');

const JOIN = 'CUSTBODY_THL_COMPANYBRANCHADDRESS';
const COMPANY = {
  custrecord_cba_companyname: 'Example &amp; Test Limited',
  custrecord_cba_address: '<div>99 Example Road</div><div>Test City</div>',
  custrecord_cba_vatregistrationno: '0105500000000',
  custrecord_cba_branchno: '00002',
  custrecord_cba_doclogo: '501'
};
function setup(id, subsidiaries, footer) {
  return { internalid: id, custrecord_pf_subsidiaries: subsidiaries, custrecord_pf_footer_description: footer };
}
function result(values) {
  return { getValue({ name }) { return values[name] ?? ''; } };
}
function item(values = {}, texts = {}) {
  return {
    values: {
      custcol_thl_summarytype: '0', quantityuom: '1', fxrate: '100', fxamount: '100', unit: 'ชิ้น',
      memo: 'รายละเอียดตัวอย่าง', 'item.displayname': 'สินค้าตัวอย่าง', 'item.type': 'InvtPart',
      'CURRENCY.symbol': 'USD', custbody_thl_entlegalname: 'ผู้ซื้อตัวอย่าง',
      custbody_thl_entvatregistrationno: '0105599999999', custbody_thl_entbranchno: '00000',
      billaddress: 'ที่อยู่ลูกค้า\nบรรทัดเพิ่มเติม', shipaddress: 'ที่อยู่จัดส่ง\nบรรทัดเพิ่มเติม', ...values
    },
    texts: { item: 'SAMPLE-ITEM', custcol_thl_summarytype: 'Product/Service', ...texts }
  };
}
function harness(options = {}) {
  const calls = { file: [], record: [], setup: [], companyReads: [], fetches: [], invoiceFetches: [], summaryFetches: [], loadedSearches: [] };
  const sourceFilters = [['type', 'anyof', 'CustInvc'], 'OR', ['mainline', 'is', 'F']];
  const invoicePages = options.invoicePages ?? [options.noCompany ? [] : (options.lines ?? [item()])];
  const saved = {
    filterExpression: sourceFilters,
    columns: [{ name: 'tranid' }],
    runPaged({ pageSize }) {
      assert.equal(pageSize, 1000);
      if (options.searchError) throw new Error('saved search unavailable');
      return {
        pageRanges: invoicePages.map((_, index) => ({ index })),
        fetch({ index }) {
          calls.invoiceFetches.push(index);
          return { data: invoicePages[index].map(line => ({
            getValue(column) {
              if (column.join === JOIN) {
                calls.companyReads.push(column);
                return ({ ...COMPANY, ...options.company })[column.name] ?? '';
              }
              return line.values[(column.join ? column.join + '.' : '') + column.name] ?? '';
            },
            getText({ name }) { return line.texts[name] ?? ''; }
          })) };
        }
      };
    }
  };
  const summarySaved = {
    filterExpression: [], columns: [],
    runPaged() {
      if (options.summaryError) throw new Error('summary search unavailable');
      return {
        pageRanges: [{ index: 0 }],
        fetch({ index }) {
          calls.summaryFetches.push(index);
          return { data: (options.summaries ?? [{ custrecord_sum_type: '5', custrecord_sum_taxrate: '7.0' }]).map(result) };
        }
      };
    }
  };
  const rows = options.setups ?? [setup('10', '2', 'Synthetic configured footer')];
  const pages = options.pages ?? [rows];
  const search = {
    Sort: { DESC: 'DESC' },
    load(args) {
      calls.loadedSearches.push(args);
      if (args.id === 'customsearch_thl_transactiondataprintinv') { calls.savedSearch = args; return saved; }
      assert.equal(args.id, 'customsearch_thl_summarytotaldataprint');
      return summarySaved;
    },
    createColumn(column) { return column; },
    create(args) {
      calls.setup.push(args);
      return { runPaged({ pageSize }) {
        assert.equal(pageSize, 1000);
        return {
          pageRanges: pages.map((_, index) => ({ index })),
          fetch({ index }) {
            calls.fetches.push(index);
            return { data: pages[index].map(result) };
          }
        };
      } };
    }
  };
  const record = { load(args) {
    calls.record.push(args);
    return { getValue({ fieldId }) {
      return ({ ntype: '7', subsidiary: '2', custbody_thl_docprintouttype: '3', taxtotal: 7, ...options.body })[fieldId] ?? '';
    } };
  } };
  const file = { load(args) {
    calls.file.push(args);
    if (options.fileError) throw new Error('logo permission denied');
    return Object.freeze({ url: options.logoUrl ?? '/core/media/media.nl?id=501&c=EXAMPLE' });
  } };
  const helper = loadAmd('pld_lib_invoice_reference', {
    'N/search': search, 'N/record': record, 'N/file': file,
    './pld_lib_thai_wordbreak': { breakThai(value) { return options.breakThai ? options.breakThai(value) : value; } }
  });
  const data = { subsidiaryId: '2', company: { name: 'Unrelated config company' }, document: { number: 'SAMPLE-1' }, items: [] };
  return { helper, data, calls, saved, summarySaved, sourceFilters };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('invoice company search retains existing OR grouping and adds strict invoice ID scope', () => {
  const h = harness();
  const enriched = h.helper.enrich(h.data, 123);
  assert.deepEqual(plain(h.calls.savedSearch), { id: 'customsearch_thl_transactiondataprintinv' });
  assert.deepEqual(plain(h.saved.filterExpression), [h.sourceFilters, 'AND', ['internalid', 'anyof', '123']]);
  assert.deepEqual(plain(h.calls.record), [{ type: 'invoice', id: '123', isDynamic: false }]);
  assert.deepEqual(h.calls.invoiceFetches, [0]);
  assert.ok(h.calls.companyReads.every(column => column.join === JOIN));
  assert.ok(h.saved.columns.some(column => column.name === 'fxrate'));
  assert.ok(h.saved.columns.some(column => column.name === 'displayname' && column.join === 'item'));
  assert.deepEqual(plain(enriched.referenceCompany), {
    name: 'Example & Test Limited', address: '99 Example Road\nTest City',
    taxId: '0105500000000', branchCode: '00002', logo: '/core/media/media.nl?id=501&c=EXAMPLE'
  });
  assert.equal(enriched.company.name, 'Unrelated config company');
  assert.equal(enriched.document.number, 'SAMPLE-1');
  assert.equal(h.data.referenceCompany, undefined);
  assert.equal(h.data.document.footerText, undefined);
});

test('logo is loaded by File Cabinet ID with no mutation, save, or double escaping', () => {
  const h = harness();
  const enriched = h.helper.enrich(h.data, '123');
  assert.deepEqual(plain(h.calls.file), [{ id: '501' }]);
  assert.match(enriched.referenceCompany.logo, /&c=/);
  assert.doesNotMatch(enriched.referenceCompany.logo, /&amp;/);
});

test('newest exact subsidiary match wins over newer globals and other subsidiaries', () => {
  const h = harness({ setups: [
    setup('30', '', 'New global'), setup('29', '12, 22', 'Wrong subsidiary'),
    setup('28', '1, 2', 'Matching subsidiary'), setup('27', '2', 'Older match')
  ] });
  assert.equal(h.helper.enrich(h.data, '123').document.footerText, 'Matching subsidiary');
  const query = plain(h.calls.setup[0]);
  assert.equal(query.type, 'customrecord_thl_printform_setup');
  assert.deepEqual(query.filters, [
    ['custrecord_thl_print_out_type', 'is', '3'], 'AND',
    ['custrecord_pf_transaction_type', 'is', '7'], 'AND', ['isinactive', 'is', 'F']
  ]);
  assert.deepEqual(query.columns[0], { name: 'internalid', sort: 'DESC' });
});

test('global fallback uses newest global row only after all scoped pages are checked', () => {
  const global = harness({ pages: [[setup('30', '', 'New global')], [setup('20', '12', 'Wrong'), setup('10', '', 'Old global')]] });
  assert.equal(global.helper.enrich(global.data, '123').document.footerText, 'New global');
  assert.deepEqual(global.calls.fetches, [0, 1]);
  const scoped = harness({ pages: [[setup('30', '', 'New global')], [setup('20', ['2'], 'Later-page match')]] });
  assert.equal(scoped.helper.enrich(scoped.data, '123').document.footerText, 'Later-page match');
});

test('footer markup becomes plain text with line breaks and single entity decoding', () => {
  const footer = '<div>One &amp; two</div><p>Three<br/>Four &lt;literal&gt; &#xE01;</p><script>bad()</script><style>bad</style>';
  const h = harness({ setups: [setup('10', '2', footer)] });
  assert.equal(h.helper.enrich(h.data, '123').document.footerText, 'One & two\nThree\nFour <literal> ก');
  const encoded = harness({ setups: [setup('10', '2', '&amp;lt;literal&amp;gt; &#0;')] });
  assert.equal(encoded.helper.enrich(encoded.data, '123').document.footerText, '&lt;literal&gt;');
});

test('no matching setup uses the reference generic default footer', () => {
  for (const setups of [[], [setup('10', '12', 'Other subsidiary')]]) {
    const h = harness({ setups });
    const footer = h.helper.enrich(h.data, '123').document.footerText;
    assert.match(footer, /^เอกสารฉบับนี้ออกโดยผู้มีอํานาจ/);
    assert.match(footer, /This document is issued and approved electronically by authorized person via internal system\./);
    assert.match(footer, /Please refer PO no in related documents\.$/);
    assert.equal(footer.split('\n').length, 3);
    assert.doesNotMatch(footer, /Other subsidiary/);
  }
});

test('selected empty subsidiary or global footer stays empty instead of using default prose', () => {
  for (const setups of [
    [setup('11', '2', ''), setup('10', '', 'Global must not replace selected blank')],
    [setup('11', '', '')]
  ]) {
    const h = harness({ setups });
    assert.equal(h.helper.enrich(h.data, '123').document.footerText, '');
    assert.equal(h.data.document.footerText, undefined);
  }
});

test('missing selection context fails loudly', () => {
  const cases = [
    [{ body: { ntype: '' } }, 'PLD_REFERENCE_SETUP_CONTEXT_MISSING'],
    [{ body: { custbody_thl_docprintouttype: '' } }, 'PLD_REFERENCE_SETUP_CONTEXT_MISSING']
  ];
  for (const [options, name] of cases) {
    const h = harness(options);
    assert.throws(() => h.helper.enrich(h.data, '123'), error => error.name === name);
    assert.equal(h.data.document.footerText, undefined);
    assert.equal(h.data.referenceCompany, undefined);
  }
});

test('missing company fields or logo fails instead of substituting unrelated company config', () => {
  const cases = [
    [{ noCompany: true }, 'PLD_REFERENCE_COMPANY_MISSING'],
    [{ company: { custrecord_cba_companyname: '' } }, 'PLD_REFERENCE_COMPANY_INCOMPLETE'],
    [{ company: { custrecord_cba_doclogo: '' } }, 'PLD_REFERENCE_LOGO_MISSING'],
    [{ company: { custrecord_cba_doclogo: 'https://example.invalid/logo.png' } }, 'PLD_REFERENCE_LOGO_MISSING'],
    [{ logoUrl: '' }, 'PLD_REFERENCE_LOGO_MISSING']
  ];
  for (const [options, name] of cases) {
    const h = harness(options);
    assert.throws(() => h.helper.enrich(h.data, '123'), error => error.name === name);
  }
});

test('platform search and file-access errors propagate and leave caller data untouched', () => {
  for (const [options, message] of [[{ searchError: true }, /saved search unavailable/], [{ fileError: true }, /logo permission denied/]]) {
    const h = harness(options);
    assert.throws(() => h.helper.enrich(h.data, '123'), message);
    assert.equal(h.data.referenceCompany, undefined);
  }
});

test('invalid invoice IDs are rejected before any account reads', () => {
  for (const id of ['', '0', '-1', '123 OR 1=1', null]) {
    const h = harness();
    assert.throws(() => h.helper.enrich(h.data, id), error => error.name === 'PLD_REFERENCE_CONTEXT_INVALID');
    assert.equal(h.calls.record.length, 0);
  }
});

test('type-two advance with blank source rate displays zero and never falls back to fxamount', () => {
  const h = harness({
    lines: [item({ custcol_thl_summarytype: '2', quantityuom: '1', fxrate: '', fxamount: '7000' })],
    body: { taxtotal: 17.25 }
  });
  h.data.totals = { gross: '7,000.00', customerPaid: '7,017.25', amountInWords: 'Stale generic words' };
  h.data.item = [{ item: 'Unrelated generic row', amount: 7000 }];
  const before = JSON.stringify(h.data);
  const enriched = h.helper.enrich(h.data, '123');
  assert.equal(enriched.items.length, 1);
  assert.equal(enriched.items[0].quantity, '1.00');
  assert.equal(enriched.items[0].unit_price, '');
  assert.equal(enriched.items[0].discount, '');
  assert.equal(enriched.items[0].amount, '0.00');
  assert.equal(enriched.item[0].rate, null);
  assert.equal(enriched.item[0].amount, 0);
  assert.equal(enriched.item[0].item, enriched.items[0].name);
  assert.equal(enriched.totals.gross, '0.00');
  assert.equal(enriched.totals.baseAmount, '0.00');
  assert.equal(enriched.totals.grandTotal, '17.25');
  assert.equal(enriched.totals.customerPaid, '17.25');
  assert.equal(enriched.totals.amountInWords, 'SEVENTEEN DOLLAR AND TWENTY-FIVE CENT');
  assert.equal(enriched.totalText, '17.25');
  assert.equal(JSON.stringify(h.data), before, 'reference enrichment does not mutate generic caller data');
});

test('legacy item selection, contiguous discount consumption and signed totals agree', () => {
  const h = harness({
    lines: [
      item({ quantityuom: '2', fxrate: '100', fxamount: '999' }),
      item({ custcol_thl_summarytype: '3', fxamount: '-10' }, { custcol_thl_summarytype: 'Discount Item' }),
      item({ custcol_thl_summarytype: '3', fxamount: '-5' }, { custcol_thl_summarytype: 'Discount Item' }),
      item({ custcol_thl_summarytype: '1', quantityuom: '1.5', fxrate: '20' }),
      item({ custcol_thl_summarytype: '2', quantityuom: '1', fxrate: '50' }),
      item({ custcol_thl_summarytype: '4', fxamount: '-40' }),
      item({ custcol_thl_summarytype: '3', fxamount: '-5' }),
      item({ custcol_thl_summarytype: '8', fxamount: '3' }),
      item({ custcol_thl_summarytype: '8', fxamount: '-1' }),
      item({ 'item.type': 'Subtotal', quantityuom: '100', fxrate: '100' }),
      ...['7', '9', '10', '11', '12'].map(type => item({ custcol_thl_summarytype: type, fxamount: '-900' }))
    ],
    summaries: [
      { custrecord_sum_type: '7', custrecord_sum_total: '-4' },
      { custrecord_sum_type: '5', custrecord_sum_taxrate: '0.07' },
      { custrecord_sum_type: '7', custrecord_sum_total: '-6' },
      { custrecord_sum_type: '5', custrecord_sum_taxrate: '7.0' }
    ],
    body: { taxtotal: 11.9 }
  });
  const enriched = h.helper.enrich(h.data, '123');
  assert.equal(enriched.items.length, 3);
  assert.deepEqual(Array.from(enriched.items, row => row.no), [1, 2, 3]);
  assert.equal(enriched.items[0].discount, '-15.00');
  assert.equal(enriched.items[0].amount, '185.00');
  assert.equal(enriched.items[1].quantity, '1.50');
  assert.equal(enriched.items[2].amount, '50.00', 'type-two amount prints but does not enter gross');
  const expected = {
    gross: '215.00', specialDiscount: '-5.00', advanceReceive: '-40.00', baseAmount: '170.00',
    vatRate: '7.0', vat: '11.90', grandTotal: '181.90', wht: '-6.00', cashCoupon: '-2.00', customerPaid: '173.90'
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(enriched.totals[key], value, key);
  assert.equal(enriched.totals.summaryRows.length, 9);
  assert.equal(enriched.totals.summaryRows[6].value, '-6.00');
  assert.equal(enriched.totals.amountInWords, 'ONE HUNDRED SEVENTY-THREE DOLLAR AND NINETY CENT');
  assert.deepEqual(plain(h.summarySaved.filterExpression), [['custrecord_sum_parenttransaction', 'anyof', '123']]);
  assert.deepEqual(h.calls.loadedSearches.map(row => row.id), [
    'customsearch_thl_transactiondataprintinv', 'customsearch_thl_summarytotaldataprint'
  ]);
});

test('positive advance, special-discount and WHT values retain their source signs', () => {
  const h = harness({
    lines: [item(), item({ custcol_thl_summarytype: '4', fxamount: '10' }),
      item({ custcol_thl_summarytype: '3', fxamount: '5' }), item({ custcol_thl_summarytype: '8', fxamount: '-3' })],
    summaries: [{ custrecord_sum_type: '7', custrecord_sum_total: '7' }], body: { taxtotal: 0 }
  });
  const totals = h.helper.enrich(h.data, '123').totals;
  assert.equal(totals.baseAmount, '115.00');
  assert.equal(totals.wht, '7.00');
  assert.equal(totals.cashCoupon, '-3.00');
  assert.equal(totals.customerPaid, '119.00');
});

test('saved-search page boundaries do not interrupt discount lookahead or truncate fifty lines', () => {
  const pages = [[item()], [item({ custcol_thl_summarytype: '3', fxamount: '-5' }, { custcol_thl_summarytype: 'Discount Item' }),
    ...Array.from({ length: 49 }, (_, index) => item({}, { item: 'SAMPLE-' + (index + 2) }))]];
  const h = harness({ invoicePages: pages, body: { taxtotal: 0 } });
  const enriched = h.helper.enrich(h.data, '123');
  assert.deepEqual(h.calls.invoiceFetches, [0, 1]);
  assert.equal(enriched.items.length, 50);
  assert.equal(enriched.item.length, 50);
  assert.equal(enriched.items[0].amount, '95.00');
  assert.equal(enriched.items[49].no, 50);
  assert.equal(enriched.totals.gross, '4,995.00');
});

test('currency words use reference customer-paid amount and saved-search currency', () => {
  const h = harness({ lines: [item({ 'CURRENCY.symbol': 'THB' })] });
  h.data.document.currencyCode = 'USD';
  const enriched = h.helper.enrich(h.data, '123');
  assert.equal(enriched.document.currencyCode, 'THB');
  assert.equal(enriched.totals.amountInWords, 'หนึ่งร้อยเจ็ดบาทถ้วน');
  assert.equal(enriched.totals.summaryRows[8].label, 'Customer Paid / ยอดชำระ (บาท)');
});

test('reference header and footer preserve raw Thai while item text retains word breaking', () => {
  const h = harness({ company: { custrecord_cba_companyname: 'บริษัททดสอบ', custrecord_cba_address: 'ที่อยู่บริษัท\nบรรทัดเพิ่มเติม' },
    breakThai: value => 'SEGMENTED:' + value });
  const enriched = h.helper.enrich(h.data, '123');
  assert.equal(enriched.referenceCompany.name, 'บริษัททดสอบ');
  assert.equal(enriched.referenceCompany.address, 'ที่อยู่บริษัท\nบรรทัดเพิ่มเติม');
  assert.equal(enriched.customer.name, 'ผู้ซื้อตัวอย่าง');
  assert.equal(enriched.customer.address, 'ที่อยู่ลูกค้า\nบรรทัดเพิ่มเติม');
  assert.equal(enriched.shipTo.address, 'ที่อยู่จัดส่ง\nบรรทัดเพิ่มเติม');
  assert.equal(enriched.document.footerText, 'Synthetic configured footer');
  assert.match(enriched.items[0].name, /^SEGMENTED:/);
  assert.match(enriched.items[0].memo, /^SEGMENTED:/);
});

test('invalid reference financial values and missing currency fail without generic fallback', () => {
  const cases = [
    [{ lines: [item({ fxrate: 'invalid' })] }, 'PLD_REFERENCE_NUMBER_INVALID'],
    [{ body: { taxtotal: 'invalid' } }, 'PLD_REFERENCE_NUMBER_INVALID'],
    [{ summaries: [{ custrecord_sum_type: '7', custrecord_sum_total: 'invalid' }] }, 'PLD_REFERENCE_NUMBER_INVALID'],
    [{ lines: [item({ 'CURRENCY.symbol': '' })] }, 'PLD_REFERENCE_CURRENCY_MISSING']
  ];
  for (const [options, name] of cases) {
    const h = harness(options);
    assert.throws(() => h.helper.enrich(h.data, '123'), error => error.name === name);
    assert.equal(h.data.totals, undefined);
  }
  const h = harness({ summaryError: true });
  assert.throws(() => h.helper.enrich(h.data, '123'), /summary search unavailable/);
});

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
function harness(options = {}) {
  const calls = { file: [], record: [], setup: [], companyReads: [], fetches: [] };
  const sourceFilters = [['type', 'anyof', 'CustInvc'], 'OR', ['mainline', 'is', 'F']];
  const saved = {
    filterExpression: sourceFilters,
    columns: [{ name: 'tranid' }],
    run() {
      if (options.searchError) throw new Error('saved search unavailable');
      return { getRange(range) {
        calls.range = range;
        return options.noCompany ? [] : [{ getValue(column) {
          calls.companyReads.push(column);
          return ({ ...COMPANY, ...options.company })[column.name] ?? '';
        } }];
      } };
    }
  };
  const rows = options.setups ?? [setup('10', '2', 'Synthetic configured footer')];
  const pages = options.pages ?? [rows];
  const search = {
    Sort: { DESC: 'DESC' },
    load(args) { calls.savedSearch = args; return saved; },
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
      return ({ ntype: '7', subsidiary: '2', custbody_thl_docprintouttype: '3', ...options.body })[fieldId] ?? '';
    } };
  } };
  const file = { load(args) {
    calls.file.push(args);
    if (options.fileError) throw new Error('logo permission denied');
    return Object.freeze({ url: options.logoUrl ?? '/core/media/media.nl?id=501&c=EXAMPLE' });
  } };
  const helper = loadAmd('pld_lib_invoice_reference', {
    'N/search': search, 'N/record': record, 'N/file': file,
    './pld_lib_thai_wordbreak': { breakThai(value) { return value; } }
  });
  const data = { subsidiaryId: '2', company: { name: 'Unrelated config company' }, document: { number: 'SAMPLE-1' }, items: [] };
  return { helper, data, calls, saved, sourceFilters };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('invoice company search retains existing OR grouping and adds strict invoice ID scope', () => {
  const h = harness();
  const enriched = h.helper.enrich(h.data, 123);
  assert.deepEqual(plain(h.calls.savedSearch), { id: 'customsearch_thl_transactiondataprintinv' });
  assert.deepEqual(plain(h.saved.filterExpression), [h.sourceFilters, 'AND', ['internalid', 'anyof', '123']]);
  assert.deepEqual(plain(h.calls.record), [{ type: 'invoice', id: '123', isDynamic: false }]);
  assert.deepEqual(plain(h.calls.range), { start: 0, end: 1 });
  assert.ok(h.calls.companyReads.every(column => column.join === JOIN));
  assert.equal(h.saved.columns.length, 6);
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

test('missing setup, empty selected footer and missing selection context fail loudly', () => {
  const cases = [
    [{ setups: [] }, 'PLD_REFERENCE_SETUP_MISSING'],
    [{ setups: [setup('10', '12', 'Other subsidiary')] }, 'PLD_REFERENCE_SETUP_MISSING'],
    [{ setups: [setup('11', '2', ''), setup('10', '', 'Global must not replace selected blank')] }, 'PLD_REFERENCE_FOOTER_MISSING'],
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

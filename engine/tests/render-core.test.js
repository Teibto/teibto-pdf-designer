/**
 * pld_lib_render — the one render core (#181).
 *
 * Batch print needs several documents' copies inside ONE <pdfset>, which is only
 * safe if every surface (single Print, live preview, batch) builds its passes the
 * same way. These tests pin the shared core: what a document's render passes look
 * like, that the fast path for a single copy is still one render call, and that a
 * template which resolves to something that is not a <pdf> fails loudly instead of
 * silently dropping a copy from the set (R4).
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadAmd, SRC_DIR } = require('./helpers/amd');
const {
  recordStub, formatStub, companyConfigStub, runtimeStub, searchStub, renderStub,
} = require('./helpers/ns-stubs');

const TPL_XML = '<pdf><body>ok</body></pdf>';
const TWO_COPIES = [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }];

/**
 * @param {Object} opts
 * @param {Array}  opts.templates    search rows for customrecord_pld_template
 * @param {Object} opts.recordValues body fields of the loaded record
 * @param {string} opts.asString     what renderAsString() gives back
 * @param {boolean} opts.curated     whether the record type has curated Thai data
 */
function buildCore({ templates = [], recordValues = {}, asString, curated = false } = {}) {
  const render = renderStub(asString === undefined ? {} : { asString });
  const search = searchStub(templates);
  const rec = recordStub({
    id: 42,
    values: Object.assign({ tranid: 'IF-0001', subsidiary: '2' }, recordValues),
  });
  const curatedCalls = [];
  const referenceCalls = [];
  const stubs = {
    'N/render': render.module,
    'N/record': rec.module,
    'N/search': search.module,
    'N/runtime': runtimeStub(),
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
    './pld_lib_invoice_reference': {
      enrich: (data, id) => { referenceCalls.push(id); return { ...data, referenceCompany: { name: 'Synthetic branch' } }; },
    },
    './pld_lib_invoice_data': {
      isSupportedType: () => curated,
      docTitles: { invoice: { th: 'ใบแจ้งหนี้', en: 'Invoice' } },
      buildTransactionData: (recType, recId, th, en) => {
        curatedCalls.push({ recType, recId, th, en });
        return { document: { number: 'INV-9' }, items: [{ name: 'ไทย' }], subsidiaryId: '2' };
      },
    },
  };
  return { core: loadAmd('./pld_lib_render', stubs), render, search, rec, curatedCalls, referenceCalls };
}

// ─── document → render passes ────────────────────────────────────────────────

test('renderDocumentXml returns one <pdf> document per copy', () => {
  const { core, render } = buildCore();

  const out = core.renderDocumentXml(TPL_XML, 'itemfulfillment', '42', TWO_COPIES, {});

  assert.equal(Array.from(out.docs).length, 2);
  Array.from(out.docs).forEach((doc) => {
    assert.match(doc, /^<pdf>/);
    assert.match(doc, /<\/pdf>$/);
  });
  const copySources = render.calls.dataSources.filter((d) => d.alias === 'copy');
  assert.deepEqual(copySources.map((d) => d.data.th), ['ต้นฉบับ', 'สำเนา']);
});

test('curated copies reuse an immutable snapshot with distinct complete copy bindings', () => {
  const { core, curatedCalls, render } = buildCore({ curated: true });

  const out = core.renderDocumentXml(TPL_XML, 'invoice', '42', TWO_COPIES, {});

  assert.equal(curatedCalls.length, 1);
  const data = render.calls.dataSources.filter((d) => d.alias === 'record').map((d) => d.data);
  assert.equal(data[0].items, data[1].items);
  assert.ok(Object.isFrozen(data[0].items[0]));
  assert.throws(() => { data[0].items[0].name = 'changed'; }, TypeError);
  assert.deepEqual(data.map((d) => d.document.titleTH), ['ใบแจ้งหนี้ (ต้นฉบับ)', 'ใบแจ้งหนี้ (สำเนา)']);
  assert.deepEqual(data.map((d) => d.document.titleEN), ['Invoice (Original)', 'Invoice (Copy)']);
  assert.deepEqual(data.map((d) => d.custbody_doc_copy_label), ['ต้นฉบับ (Original)', 'สำเนา (Copy)']);
  assert.equal(out.tranId, 'INV-9', 'the document number comes from the curated data');
});

test('a raw-record type loads the record once and reuses it for every copy', () => {
  const { core, render, rec } = buildCore();

  core.renderDocumentXml(TPL_XML, 'itemfulfillment', '42', TWO_COPIES, {});

  assert.equal(render.calls.records.length, 2);
  assert.equal(render.calls.records[0].record, render.calls.records[1].record);
  assert.equal(render.calls.records[0].record, rec.rec);
});

test('a template that resolves to something other than <pdf> fails loudly (R4)', () => {
  const { core } = buildCore({ asString: '<html>oops</html>' });

  assert.throws(
    () => core.renderDocumentXml(TPL_XML, 'itemfulfillment', '42', TWO_COPIES, {}),
    /no <pdf> document/,
    'a copy must never be dropped from the set without an error',
  );
});

// ─── combining ───────────────────────────────────────────────────────────────

test('combinePdfDocs wraps the documents in one <pdfset> with the BFO doctype', () => {
  const { core, render } = buildCore();

  core.combinePdfDocs(['<pdf>a</pdf>', '<pdf>b</pdf>']);

  assert.equal(render.calls.xmlToPdf.length, 1);
  const set = render.calls.xmlToPdf[0].xmlString;
  assert.match(set, /<!DOCTYPE pdfset PUBLIC "-\/\/big\.faceless\.org\/\/report"/);
  assert.equal((set.match(/<pdf>/g) || []).length, 2);
  assert.match(set, /<pdfset>[\s\S]*<\/pdfset>/);
});

test('a single copy still renders in one pass — no string round-trip', () => {
  const { core, render } = buildCore();

  core.renderDocument(TPL_XML, 'itemfulfillment', '42', [{ th: 'ต้นฉบับ', en: 'Original' }], {});

  assert.equal(render.calls.renderedAsPdf, 1);
  assert.equal(render.calls.xmlToPdf.length, 0, 'no <pdfset> for a single copy');
});

test('more than one copy comes back as a single combined file', () => {
  const { core, render } = buildCore();
  const tel = {};

  const out = core.renderDocument(TPL_XML, 'itemfulfillment', '42', TWO_COPIES, tel);

  assert.equal(render.calls.renderedAsPdf, 0, 'each pass renders to a string, then combines');
  assert.equal(render.calls.xmlToPdf.length, 1);
  assert.ok(out.pdfFile, 'one file back');
  assert.equal(tel.stage, 'copyset', 'telemetry follows the stage it died in');
});

// ─── template resolution ─────────────────────────────────────────────────────

test('resolveTemplate falls back to the record type default', () => {
  const { core } = buildCore({
    templates: [{ id: '7', values: { custrecord_pld_tpl_xml: TPL_XML, custrecord_pld_tpl_data: '' } }],
  });

  const tpl = core.resolveTemplate('', 'invoice');

  assert.equal(tpl.xml, TPL_XML);
  assert.equal(tpl.copies, null, 'no copy set in the designer JSON → caller applies the default');
  assert.equal(tpl.rectype, 'invoice', 'default lookup is already scoped to this authoritative type');
});

test('no template at all is a hard error, never an empty PDF (R4)', () => {
  const { core } = buildCore({ templates: [] });

  assert.throws(() => core.resolveTemplate('', 'invoice'), /No template found/);
});

test('an explicit tplid wins over the default, and carries its copy set (#92)', () => {
  const { core } = buildCore({
    recordValues: {
      custrecord_pld_tpl_xml: TPL_XML,
      custrecord_pld_tpl_data: JSON.stringify({ copies: TWO_COPIES }),
      custrecord_pld_tpl_rectype: 'itemfulfillment',
    },
  });

  const tpl = core.resolveTemplate('7', 'invoice');

  assert.equal(tpl.xml, TPL_XML);
  assert.deepEqual(Array.from(tpl.copies).map((c) => c.th), ['ต้นฉบับ', 'สำเนา']);
  assert.equal(tpl.rectype, 'itemfulfillment', 'explicit template carries its stored authoritative type');
});

// ─── architecture guard ──────────────────────────────────────────────────────

test('only the core builds render data sources — no second render path', () => {
  // CLAUDE.md: BFO is the one render engine and the binding must not fork. Batch
  // print (#181) is the first caller that could have copied this code instead of
  // calling the core, so pin it: if a new file starts registering data sources,
  // this test fails and the decision has to be made deliberately.
  const owners = fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8').indexOf('addCustomDataSource') !== -1);

  assert.deepEqual(owners, ['pld_lib_render.js']);
});

test('reference enrichment is opt-in and runs for single and multiple real invoice copies', () => {
  const x = buildCore({ curated: true });
  x.core.renderDocument(TPL_XML, 'invoice', 42, TWO_COPIES.slice(0, 1));
  assert.deepEqual(x.referenceCalls, []);
  x.core.renderDocument('<#--\npld:reference-layout\n-->' + TPL_XML, 'invoice', 42, TWO_COPIES.slice(0, 1));
  x.core.renderDocumentXml('<#--\npld:reference-layout\n-->' + TPL_XML, 'invoice', 42, TWO_COPIES);
  assert.deepEqual(x.referenceCalls, [42, 42]);
});

test('copy extraction preserves attributed PDF root required by the bilingual reference', () => {
  const x = buildCore({ asString: '<pdf lang="th" xml:lang="th"><body>test</body></pdf>' });
  const out = x.core.renderDocumentXml(TPL_XML, 'invoice', 42, TWO_COPIES);
  assert.equal(out.docs.length, 2);
  assert.ok(out.docs[0].startsWith('<pdf lang="th"'));
});

test('50-row supplied fixture renders every requested copy without mutating input', () => {
  const x = buildCore();
  const data = { document: { copyTH: 'untouched' }, items: Array.from({ length: 50 }, (_, i) => ({ no: i + 1 })) };
  x.core.renderSampleDocument(TPL_XML, 'invoice', TWO_COPIES, null, data);
  assert.equal(data.document.copyTH, 'untouched');
  assert.deepEqual(x.referenceCalls, []);
  assert.equal(x.render.calls.created, 2);
  const bound = x.render.calls.dataSources.filter(ds => ds.alias === 'record');
  assert.deepEqual(bound.map(ds => ds.data.items.length), [50, 50]);
  assert.deepEqual(bound.map(ds => ds.data.document.copyTH), ['ต้นฉบับ', 'สำเนา']);
});

test('copy work limit rejects 21 copies before loading transactions or creating renderers', () => {
  const { core, render, curatedCalls } = buildCore({ curated: true });
  const copies = Array(21).fill({ th: 'สำเนา', en: 'Copy' });
  assert.throws(() => core.resolveCopies(copies, 'invoice'), /20.*render execution limit/);
  assert.throws(() => core.renderDocumentXml(TPL_XML, 'invoice', '42', copies, {}), /20/);
  assert.throws(() => core.renderDocument(TPL_XML, 'invoice', '42', copies, {}), /20/);
  assert.throws(() => core.renderSampleDocument(TPL_XML, 'invoice', copies, {}), /20/);
  assert.equal(render.calls.created, 0);
  assert.equal(curatedCalls.length, 0);
  assert.equal(core.resolveCopies(null, 'invoice').length, 2);
  assert.equal(core.resolveCopies(Array(20).fill({ th: 'สำเนา' }), 'invoice').length, 20);
});


test('duplicate active defaults fail visibly before rendering rather than choosing arbitrary XML', () => {
  const templates = [
    { id: '7', values: { custrecord_pld_tpl_xml: '<pdf><body>first</body></pdf>' } },
    { id: '8', values: { custrecord_pld_tpl_xml: '<pdf><body>second</body></pdf>' } },
  ];
  const { core, render, search } = buildCore({ templates });
  const requestedRanges = [];
  const create = search.module.create;
  search.module.create = (options) => {
    const query = create(options);
    return { run() {
      const results = query.run().getRange({ start: 0, end: 2 });
      return { getRange(range) { requestedRanges.push(range); return results.slice(range.start, range.end); } };
    } };
  };
  assert.throws(() => core.resolveTemplate('', 'invoice'), /default template มากกว่าหนึ่ง.*invoice.*ผู้ดูแล/);
  assert.equal(requestedRanges[0].end, 2, 'the server must request enough rows to detect ambiguity');
  assert.equal(render.calls.created, 0);
});

test('reference marker must be a metadata line inside one FreeMarker comment', () => {
  const x = buildCore({ curated: true });
  for (const xml of [
    '<#-- normal comment -->\npld:reference-layout\n<#-- another comment -->' + TPL_XML,
    '<#-- mention pld:reference-layout in prose -->' + TPL_XML,
    '<!--\npld:reference-layout\n-->' + TPL_XML,
  ]) x.core.renderDocumentXml(xml, 'invoice', 42, TWO_COPIES);
  assert.deepEqual(x.referenceCalls, []);
  const raw = buildCore();
  assert.throws(() => raw.core.renderDocumentXml('<#--\npld:reference-layout\n-->' + TPL_XML, 'other', 42, TWO_COPIES), /requires a curated invoice/);
});

// Exercise the actual render -> data -> reference graph with one shared N/record
// counter. Per-module stubs cannot detect duplicate loads across those boundaries.
function countingGraph({ subsidiary = '2', denied = false, missingFonts = false, invalidUsage = false, rich = false, dataFailure = false, referenceFailure = false } = {}) {
  const calls = { loads: 0, config: [], searches: 0, queries: 0 };
  let version = 1, usage = 1000;
  const render = renderStub();
  const page = rows => ({ runPaged: () => ({ pageRanges: [{ index: 0 }], fetch: () => ({ data: rows }) }) });
  const row = {
    getValue({ name, join }) {
      if (join === 'CUSTBODY_THL_COMPANYBRANCHADDRESS') return {
        custrecord_cba_companyname: 'Synthetic branch', custrecord_cba_address: 'Test road',
        custrecord_cba_vatregistrationno: '0105500000000', custrecord_cba_branchno: '00000', custrecord_cba_doclogo: '501'
      }[name] || '';
      if (join === 'CURRENCY') return 'THB';
      return { custcol_thl_summarytype: '0', quantityuom: 1, fxrate: 100, fxamount: 100 }[name] || '';
    },
    getText: () => ''
  };
  const stubs = {
    'N/render': render.module,
    'N/record': { load() {
      calls.loads++; usage -= 10;
      if (denied) throw new Error('record permission denied');
      return recordStub({ values: { subsidiary, tranid: 'SYN-' + version, memo: 'revision-' + version,
        taxtotal: 7, subtotal: rich ? 100 : 0, payment: rich ? 57 : 0,
        ntype: '7', custbody_thl_docprintouttype: '3', custbody_synthetic: 'Preserve body' },
        sublists: { item: rich ? [{ itemname: 'SYN-BOX', displayname: 'Synthetic boxes',
          itemdescription: 'Delivered item', quantity: 3, unitsdisplay: 'Box12', custcol_lot: 'SYN-LOT' }] : [],
        apply: rich ? [{ apply: true, refnum: 'SYN-A', applydate: '01/09/2026', total: 107, amount: 50 },
          { apply: false, refnum: 'SYN-UNSELECTED', total: 999, amount: 999 },
          { apply: true, refnum: 'SYN-B', total: 7, amount: 7 }] : [] } }).rec;
    } },
    'N/query': { runSuiteQL({ query }) {
      calls.queries++; usage -= 10;
      if (dataFailure) throw new Error('data query failed');
      if (rich && query.includes('FROM transactionline tl')) {
        const sign = query.includes('-tl.quantity AS quantity') ? -1 : 1;
        return { asMappedResults: () => [{ seq: 1, itemtype: 'InvtPart', item_code: 'SYN-ITEM',
          item_name: 'Synthetic item', memo: 'Line memo', quantity: sign * -2, unit_price: 50,
          unit_name: 'Each', conv: 1, amount: sign * -100 }] };
      }
      if (rich && query.includes('SELECT * FROM transactionline')) {
        return { asMappedResults: () => [{ linesequencenumber: 1, custcol_lot: 'SYN-LOT' }] };
      }
      return { asMappedResults: () => query.includes('FROM transaction WHERE id')
        ? [{ tranid: 'SYN-' + version, currency_code: 'THB' }] : [] };
    } },
    'N/search': { Sort: { DESC: 'DESC' }, createColumn: value => value,
      create: () => page([]), load({ id }) {
        calls.searches++; usage -= 5;
        if (referenceFailure) throw new Error('reference search failed');
        const financeRow = (type, amount) => ({ getText: row.getText,
          getValue(column) { return ({ custcol_thl_summarytype: type, fxamount: amount })[column.name] ?? row.getValue(column); } });
        const lines = rich ? [row, financeRow('3', -10), financeRow('4', -5), financeRow('8', 2)] : [row];
        const summaries = rich ? [{ getValue: ({ name }) => ({ custrecord_sum_type: 7, custrecord_sum_total: -3 })[name] || '' }] : [];
        return Object.assign({ filterExpression: [], columns: [] }, page(id.includes('transactiondataprintinv') ? lines : summaries));
      } },
    'N/file': { load: () => ({ url: '/synthetic-logo' }) },
    'N/format': formatStub,
    'N/runtime': runtimeStub({ usage: () => invalidUsage ? NaN : usage }),
    './pld_lib_company_config': { load(scope, options) {
      calls.config.push({ scope, options }); usage -= 2;
      assert.equal(options.forRender, true);
      if (missingFonts) throw new Error('Thai fonts missing');
      return { ...companyConfigStub.load(), name: 'Config-' + version };
    } }
  };
  return { core: loadAmd('./pld_lib_render', stubs), data: loadAmd('./pld_lib_invoice_data', stubs),
    calls, render, reference: loadAmd('./pld_lib_invoice_reference', stubs), next: () => { version++; } };
}

for (const type of [...countingGraph().data.supportedTypes, 'unsupportedraw']) {
  for (const copies of [1, 2, 20]) {
    test(`shared module graph loads ${type} once for ${copies} copies and reloads next request`, () => {
      const h = countingGraph();
      const labels = Array.from({ length: copies }, (_, i) => ({ th: 'Copy ' + i, en: 'Copy ' + i }));
      const tel = {};
      h.core.renderDocument(TPL_XML, type, '42', labels, tel);
      assert.equal(h.calls.loads, 1);
      assert.equal(h.calls.config.length, 1);
      assert.equal(h.calls.config[0].scope, '2');
      assert.equal(tel.performance.copies, copies);
      assert.equal(tel.performance.phases.data.usage >= 10, true);
      assert.equal(h.render.calls.renderedAsPdf, copies === 1 ? 1 : 0);
      assert.equal(h.render.calls.renderedAsString, copies === 1 ? 0 : copies);
      h.next();
      h.core.renderDocument(TPL_XML, type, '42', labels, {});
      assert.equal(h.calls.loads, 2);
      assert.equal(h.calls.config.length, 2);
      const companies = h.render.calls.dataSources.filter(d => d.alias === 'company');
      assert.equal(companies[0].data.name, 'Config-1');
      assert.equal(companies.at(-1).data.name, 'Config-2');
      const records = h.render.calls.dataSources.filter(d => d.alias === 'record');
      if (records.length) {
        assert.equal(records[0].data.document.number, 'SYN-1');
        assert.equal(records.at(-1).data.document.number, 'SYN-2');
      } else {
        assert.equal(h.render.calls.records.at(-1).record.getValue({ fieldId: 'tranid' }), 'SYN-2');
      }
    });
  }
}

for (const copies of [1, 2, 20]) {
  test(`reference invoice shares real record/data/enricher across ${copies} copies`, () => {
    const h = countingGraph();
    const labels = Array.from({ length: copies }, (_, i) => ({ th: 'Copy ' + i, en: 'Copy ' + i }));
    const tel = {};
    h.core.renderDocument('<#--\npld:reference-layout\n-->' + TPL_XML, 'invoice', '42', labels, tel);
    assert.equal(h.calls.loads, 1);
    assert.equal(h.calls.config.length, 1);
    assert.equal(h.calls.searches, 2);
    assert.equal(tel.performance.phases.reference.usage, 10);
    assert.equal(tel.performance.itemCount, 1);
    const records = h.render.calls.dataSources.filter(d => d.alias === 'record');
    assert.equal(records.length, copies);
    assert.equal(records[0].data.referenceCompany.name, 'Synthetic branch');
    assert.equal(records[0].data.total, 107);
    assert.equal(records.at(-1).data.document.copyEN, 'Copy ' + (copies - 1));
    h.next();
    h.core.renderDocument('<#--\npld:reference-layout\n-->' + TPL_XML, 'invoice', '42', labels, {});
    assert.equal(h.calls.loads, 2);
    assert.equal(h.calls.config.length, 2);
    assert.equal(h.calls.searches, 4);
  });
}

test('request reuse preserves global subsidiary fallback and font failures', () => {
  const h = countingGraph({ subsidiary: '' });
  h.core.renderDocument(TPL_XML, 'invoice', '42', TWO_COPIES, {});
  assert.equal(h.calls.config.length, 1);
  assert.equal(h.calls.config[0].scope, '');
  const fonts = countingGraph({ missingFonts: true });
  assert.throws(() => fonts.core.renderDocument(TPL_XML, 'invoice', '42', TWO_COPIES, {}), /Thai fonts missing/);
  assert.equal(fonts.render.calls.created, 0);
  const denied = countingGraph({ denied: true });
  assert.throws(() => denied.core.renderDocument(TPL_XML, 'invoice', '42', TWO_COPIES, {}), /record permission denied/);
  assert.equal(denied.calls.queries, 0);
  assert.equal(denied.calls.config.length, 0);
});


test('phase metrics expose only bounded aggregate values, including combine', () => {
  const h = countingGraph();
  const tel = {};
  h.core.renderDocument(TPL_XML, 'invoice', '42', TWO_COPIES, tel);
  assert.deepEqual(Object.keys(tel.performance).sort(), ['copies', 'itemCount', 'phases']);
  assert.deepEqual(Object.keys(tel.performance.phases).sort(), ['bfo', 'binding', 'combine', 'data', 'reference']);
  for (const phase of Object.values(tel.performance.phases)) {
    assert.deepEqual(Object.keys(phase).sort(), ['elapsedMs', 'usage']);
    assert.ok(Number.isFinite(phase.elapsedMs) && phase.elapsedMs >= 0);
    assert.ok(Number.isFinite(phase.usage) && phase.usage >= 0);
  }
});


for (const copies of [1, 2, 20]) {
  for (const supplied of [false, true]) {
    test(`sample preview reuses config and reports phases for ${copies} copies, supplied=${supplied}`, () => {
      const h = countingGraph();
      const tel = {};
      const labels = Array.from({ length: copies }, (_, i) => ({ th: 'Copy ' + i, en: 'Copy ' + i }));
      const data = supplied ? { document: { number: 'SYN-SAMPLE', footerText: 'Supplied footer' },
        items: [{ name: 'Supplied item' }], referenceCompany: { name: 'Supplied reference company' } } : undefined;
      const before = JSON.stringify(data);
      h.core.renderSampleDocument(TPL_XML, 'invoice', labels, tel, data);
      assert.equal(h.calls.loads, 0);
      assert.equal(h.calls.queries, 0);
      assert.equal(h.calls.searches, 0);
      assert.equal(h.calls.config.length, 1);
      assert.equal(h.calls.config[0].options.forRender, true);
      assert.equal(tel.performance.copies, copies);
      assert.ok(tel.performance.itemCount > 0);
      for (const phase of ['data', 'binding', 'bfo', ...(copies > 1 ? ['combine'] : [])]) {
        assert.ok(tel.performance.phases[phase].elapsedMs >= 0);
        assert.ok(tel.performance.phases[phase].usage >= 0);
      }
      const records = h.render.calls.dataSources.filter(d => d.alias === 'record');
      assert.equal(records.length, copies);
      assert.equal(records.at(-1).data.document.copyEN, 'Copy ' + (copies - 1));
      assert.equal(records[0].data.items, records.at(-1).data.items);
      if (supplied) {
        assert.equal(JSON.stringify(data), before);
        assert.equal(records.at(-1).data.document.footerText, 'Supplied footer');
        assert.equal(records.at(-1).data.referenceCompany.name, 'Supplied reference company');
      }
      h.next();
      h.core.renderSampleDocument(TPL_XML, 'invoice', labels, {}, data);
      assert.equal(h.calls.loads, 0);
      assert.equal(h.calls.config.length, 2);
      assert.equal(h.render.calls.dataSources.filter(d => d.alias === 'company').at(-1).data.name, 'Config-2');
    });
  }
}

test('sample rendering rejects missing render fonts before generating a PDF', () => {
  const h = countingGraph({ missingFonts: true });
  assert.throws(() => h.core.renderSampleDocument(TPL_XML, 'invoice', TWO_COPIES, {}), /Thai fonts missing/);
  assert.equal(h.calls.loads, 0);
  assert.equal(h.render.calls.created, 0);
});


test('metrics tolerate preinitialized empty performance and invalid governance values', () => {
  const h = countingGraph({ invalidUsage: true });
  const tel = { performance: {} };
  h.core.renderSampleDocument(TPL_XML, 'invoice', TWO_COPIES, tel);
  for (const phase of Object.values(tel.performance.phases)) assert.equal(phase.usage, null);
  const denied = countingGraph({ denied: true });
  assert.throws(() => denied.core.renderDocument(TPL_XML, 'invoice', '42', TWO_COPIES,
    { performance: Object.freeze({}) }), /record permission denied/);
});


for (const type of ['invoice', 'purchaseorder', 'itemfulfillment', 'customerpayment']) {
  for (const copyCount of [1, 2]) {
    test(`request reuse preserves complete standalone ${type} binding with ${copyCount} copies`, () => {
      const h = countingGraph({ rich: true });
      const labels = TWO_COPIES.slice(0, copyCount);
      h.core.renderDocument(TPL_XML, type, '42', labels, {});
      assert.equal(h.calls.loads, 1);
      const records = h.render.calls.dataSources.filter(d => d.alias === 'record');
      for (let index = 0; index < labels.length; index++) {
        const label = labels[index];
        const expected = h.data.buildTransactionData(type, '42', label.th, label.en);
        assert.deepEqual(JSON.parse(JSON.stringify(records[index].data)), JSON.parse(JSON.stringify(expected)));
      }
      const data = records[0].data;
      if (type === 'customerpayment') {
        assert.deepEqual(Array.from(data.apply, item => item.refnum), ['SYN-A', 'SYN-B']);
        assert.equal(data.payment, 57);
      } else if (type === 'itemfulfillment') {
        assert.equal(data.item[0].quantity, 3);
        assert.equal(data.items[0].custcol_lot, 'SYN-LOT');
        assert.equal(data.totalText, '');
      } else {
        assert.equal(data.item[0].quantity, type === 'invoice' ? 2 : -2);
        assert.equal(data.item[0].amount, type === 'invoice' ? 100 : -100);
        assert.equal(data.items[0].custcol_lot, 'SYN-LOT');
      }
    });
  }
}

for (const copyCount of [1, 2]) {
  test(`reference request binding equals full standalone enrichment for ${copyCount} copies`, () => {
    const h = countingGraph({ rich: true });
    const labels = TWO_COPIES.slice(0, copyCount);
    h.core.renderDocument('<#--\npld:reference-layout\n-->' + TPL_XML, 'invoice', '42', labels, {});
    assert.equal(h.calls.loads, 1);
    const records = h.render.calls.dataSources.filter(d => d.alias === 'record');
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      const expected = h.reference.enrich(h.data.buildTransactionData('invoice', '42', label.th, label.en), '42');
      assert.deepEqual(JSON.parse(JSON.stringify(records[index].data)), JSON.parse(JSON.stringify(expected)));
    }
    assert.equal(records[0].data.total, 92);
    assert.equal(records[0].data.discounttotal, -15);
    assert.equal(records[0].data.totals.customerPaid, '87.00');
    assert.equal(records[0].data.item[0].amount, 100);
  });
}

for (const [option, stage, message] of [['dataFailure', 'data', /data query failed/], ['referenceFailure', 'reference', /reference search failed/]]) {
  test(`transaction failure identifies ${stage} phase`, () => {
    const h = countingGraph({ [option]: true });
    const tel = {};
    assert.throws(() => h.core.renderDocument('<#--\npld:reference-layout\n-->' + TPL_XML, 'invoice', '42', TWO_COPIES, tel), message);
    assert.equal(tel.stage, stage);
    assert.ok(tel.performance.phases[stage].elapsedMs >= 0);
    assert.equal(h.render.calls.created, 0);
  });
}

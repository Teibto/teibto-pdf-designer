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

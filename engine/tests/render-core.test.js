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
  const stubs = {
    'N/render': render.module,
    'N/record': rec.module,
    'N/search': search.module,
    'N/runtime': runtimeStub(),
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
    './pld_lib_invoice_data': {
      isSupportedType: () => curated,
      buildTransactionData: (recType, recId, th, en) => {
        curatedCalls.push({ recType, recId, th, en });
        return { document: { number: 'INV-9' }, subsidiaryId: '2' };
      },
    },
  };
  return { core: loadAmd('./pld_lib_render', stubs), render, search, rec, curatedCalls };
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

test('a curated type builds its schema once per copy, so the label reaches the title', () => {
  const { core, curatedCalls } = buildCore({ curated: true });

  const out = core.renderDocumentXml(TPL_XML, 'invoice', '42', TWO_COPIES, {});

  assert.equal(curatedCalls.length, 2);
  assert.deepEqual(curatedCalls.map((c) => c.th), ['ต้นฉบับ', 'สำเนา']);
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
    },
  });

  const tpl = core.resolveTemplate('7', 'invoice');

  assert.equal(tpl.xml, TPL_XML);
  assert.deepEqual(Array.from(tpl.copies).map((c) => c.th), ['ต้นฉบับ', 'สำเนา']);
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

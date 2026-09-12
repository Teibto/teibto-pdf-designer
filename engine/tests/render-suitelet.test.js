/**
 * pld_sl_render_pdf — failure-response shape (#157) + happy-path headers.
 *
 * The Print / Download / Preview buttons open this Suitelet in a browser tab, so a
 * failed render used to dump raw JSON with a stack trace at an accounting user.
 * These tests pin the split: page for the browser, JSON (without stack) for the
 * designer's fetch calls — and that the log still gets the full stack (#149).
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadAmd } = require('./helpers/amd');
const {
  recordStub, formatStub, logStub, companyConfigStub, xmlStub,
  runtimeStub, searchStub, renderStub, fileStub, contextStub,
} = require('./helpers/ns-stubs');

const TPL_XML = '<pdf><body>ok</body></pdf>';

/**
 * @param {Object} opts
 * @param {Array}  opts.templates  search rows for customrecord_pld_template
 */
function buildSuitelet({ templates = [], recordValues = {} } = {}) {
  const log = logStub();
  const render = renderStub();
  const search = searchStub(templates);
  const sampleCalls = [];
  const stubs = {
    'N/render': render.module,
    'N/record': recordStub({
      id: 42,
      values: Object.assign({ tranid: 'IF-0001', subsidiary: '2' }, recordValues),
    }).module,
    'N/search': search.module,
    'N/file': fileStub(),
    'N/runtime': runtimeStub(),
    'N/log': log.module,
    'N/xml': xmlStub,
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
    // no SuiteQL in these tests — the curated builder has its own suite
    './pld_lib_invoice_data': {
      docTitles: { invoice: { th: 'ใบแจ้งหนี้', en: 'Invoice' }, itemfulfillment: { th: 'ใบส่งสินค้า', en: 'Delivery Note' } },
      isSupportedType: () => false,
      buildTransactionData: () => ({}),
      buildSampleData: (recType, th, en) => {
        const data = { rectype: recType, copyTh: th, copyEn: en };
        sampleCalls.push(data);
        return data;
      },
    },
  };
  return { suitelet: loadAmd('./pld_sl_render_pdf', stubs), log, render, search, sampleCalls };
}

test('a failed Print shows an HTML page with the errorId and no stack trace', () => {
  const { suitelet, log } = buildSuitelet({ templates: [] }); // → "No template found"
  const { context, response } = contextStub({
    parameters: { action: 'render', rectype: 'invoice', recid: '42' },
  });

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.match(response.state.headers['Content-Type'], /text\/html/);
  assert.match(body, /^<!DOCTYPE html>/);
  assert.match(body, /สร้าง PDF ไม่สำเร็จ/);
  assert.match(body, /PLD-[a-z0-9]+-[a-z0-9]+/, 'the page must show the errorId to report');
  assert.match(body, /No template found/, 'short message stays visible for the admin');

  assert.doesNotMatch(body, /"error"\s*:\s*true/, 'must not be raw JSON any more');
  assert.doesNotMatch(body, /\bstack\b/i, 'stack must never reach the user');
  assert.doesNotMatch(body, /pld_sl_render_pdf\.js:\d+/, 'no file:line internals on screen');

  // …while the log keeps everything needed to diagnose it (#149)
  const errors = log.entries.filter((e) => e.level === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].title, /PLD render failed \[PLD-/);
  assert.equal(errors[0].details.stage, 'load-template');
  assert.ok(errors[0].details.stack.length > 0, 'stack belongs in the log');
  // the id on screen and the id in the log are the same one
  const shown = body.match(/PLD-[a-z0-9]+-[a-z0-9]+/)[0];
  assert.equal(errors[0].details.errorId, shown);
});

test('the error page escapes a message that contains markup', () => {
  const { suitelet } = buildSuitelet({
    templates: [{ id: '7', values: { custrecord_pld_tpl_xml: '' } }], // → "has no BFO XML"
  });
  const { context, response } = contextStub({
    parameters: { action: 'render', rectype: 'invoice', recid: '42', tplid: '<script>x</script>' },
  });

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.match(response.state.headers['Content-Type'], /text\/html/);
  assert.ok(body.indexOf('<script>x</script>') === -1, 'message must be escaped, not injected');
  assert.match(body, /&lt;script&gt;/);
});

test('designer fetch actions keep the JSON contract but lose the stack', () => {
  const { suitelet } = buildSuitelet();
  const { context, response } = contextStub({
    parameters: { action: 'preview-live' },
    method: 'POST',
    body: JSON.stringify({ rectype: 'invoice', recid: '42' }), // no xml → throws
  });

  suitelet.onRequest(context);

  assert.match(response.state.headers['Content-Type'], /application\/json/);
  const payload = JSON.parse(response.state.body);
  assert.equal(payload.error, true);
  assert.match(payload.message, /preview-live requires xml/);
  assert.match(payload.errorId, /^PLD-/);
  assert.equal('stack' in payload, false, 'stack must not be sent to the client');
  assert.ok(payload.ref.indexOf(payload.errorId) !== -1, 'ref carries the id the user reports');
});

test('preview-live rejects an oversized raw UTF-8 body before parsing or rendering', () => {
  const { suitelet, render, log } = buildSuitelet();
  const { context, response } = contextStub({
    parameters: { action: 'preview-live' },
    method: 'POST',
    // Deliberately malformed JSON: the size error must win over JSON.parse.
    body: 'x'.repeat(8 * 1024 * 1024 + 1),
  });

  suitelet.onRequest(context);

  const payload = JSON.parse(response.state.body);
  assert.equal(payload.error, true);
  assert.match(payload.message, /8 MiB UTF-8 payload limit/);
  assert.equal(render.calls.created, 0, 'N\/render is never reached');
  assert.equal(log.entries.find((e) => e.level === 'error').details.stage, 'parse-body');
});

test('preview-live measures the request budget in UTF-8 bytes, not JavaScript characters', () => {
  const { suitelet, render } = buildSuitelet();
  const raw = JSON.stringify({
    xml: '<pdf><body>ok</body></pdf>',
    rectype: 'itemfulfillment',
    data: { note: 'ก'.repeat(2800000) },
  });
  assert.ok(raw.length < 8 * 1024 * 1024, 'fixture stays below the limit in UTF-16 code units');
  assert.ok(Buffer.byteLength(raw, 'utf8') > 8 * 1024 * 1024, 'but crosses it in UTF-8 bytes');
  const { context, response } = contextStub({
    parameters: { action: 'preview-live' }, method: 'POST', body: raw,
  });

  suitelet.onRequest(context);

  assert.match(JSON.parse(response.state.body).message, /8 MiB UTF-8 payload limit/);
  assert.equal(render.calls.created, 0);
});

test('preview-live accepts 1000000 XML characters and rejects the next character before N/render', () => {
  const atLimit = '<pdf>' + 'a'.repeat(1000000 - 11) + '</pdf>';
  const accepted = buildSuitelet();
  const acceptedContext = contextStub({
    parameters: { action: 'preview-live' }, method: 'POST',
    body: JSON.stringify({ xml: atLimit, rectype: 'itemfulfillment', data: { synthetic: true } }),
  });
  accepted.suitelet.onRequest(acceptedContext.context);
  assert.equal(accepted.render.calls.renderedAsPdf, 1);

  const rejected = buildSuitelet();
  const rejectedContext = contextStub({
    parameters: { action: 'preview-live' }, method: 'POST',
    body: JSON.stringify({ xml: atLimit + 'x', rectype: 'itemfulfillment', data: { synthetic: true } }),
  });
  rejected.suitelet.onRequest(rejectedContext.context);
  const payload = JSON.parse(rejectedContext.response.state.body);
  assert.match(payload.message, /1000000 character limit/);
  assert.equal(rejected.render.calls.created, 0, 'oversized XML is rejected before N\/render');
});

test('an unknown action falls back to the page, not to JSON', () => {
  const { suitelet } = buildSuitelet();
  const { context, response } = contextStub({
    parameters: { rectype: 'invoice', recid: '42' }, // no action → default = render
  });

  suitelet.onRequest(context);

  assert.match(response.state.headers['Content-Type'], /text\/html/);
});

test('a successful render still returns the pdf inline, unchanged', () => {
  const { suitelet, log } = buildSuitelet({
    templates: [{ id: '7', values: { custrecord_pld_tpl_xml: TPL_XML, custrecord_pld_tpl_data: '' } }],
  });
  const { context, response } = contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42' },
  });

  suitelet.onRequest(context);

  assert.equal(response.state.headers['Content-Type'], 'application/pdf');
  assert.match(response.state.headers['Content-Disposition'], /^inline; filename="itemfulfillment_IF-0001\.pdf"$/);
  assert.equal(response.state.files.length, 1);
  assert.equal(response.state.files[0].isInline, true);
  assert.equal(response.state.body, '', 'no error body on the happy path');
  assert.equal(log.entries.filter((e) => e.level === 'error').length, 0);
  assert.equal(log.entries.filter((e) => e.level === 'audit').length, 1);
});

// ─── #159: the copy set applies to EVERY record type ─────────────────────────
// Before this, a rectype the engine does not curate skipped resolveCopies entirely:
// a template configured for ต้นฉบับ + สำเนา silently printed a single copy, and the
// label came from a record field that does not exist → every copy said "ต้นฉบับ".
const TWO_COPIES = JSON.stringify({ copies: [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }] });

function templateWithCopies(dataJson) {
  return [{ id: '7', values: { custrecord_pld_tpl_xml: TPL_XML, custrecord_pld_tpl_data: dataJson } }];
}

test('a raw-record type honors the template copy set instead of dropping it', () => {
  const { suitelet, render, log } = buildSuitelet({ templates: templateWithCopies(TWO_COPIES) });
  const { context } = contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42' },
  });

  suitelet.onRequest(context);

  assert.equal(render.calls.xmlToPdf.length, 1, 'the copies are combined into one <pdfset>');
  const set = render.calls.xmlToPdf[0].xmlString;
  assert.equal((set.match(/<pdf>/g) || []).length, 2, 'two copies rendered');
  assert.equal(log.entries.find((e) => e.level === 'audit').details.copies, 2);
});

test('each copy gets its own label, on the raw-record path too', () => {
  const { suitelet, render } = buildSuitelet({ templates: templateWithCopies(TWO_COPIES) });
  const { context } = contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42' },
  });

  suitelet.onRequest(context);

  const copySources = render.calls.dataSources.filter((d) => d.alias === 'copy');
  assert.equal(copySources.length, 2);
  assert.deepEqual(copySources.map((d) => d.data.label), ['ต้นฉบับ (Original)', 'สำเนา (Copy)']);
  assert.deepEqual(copySources.map((d) => d.data.th), ['ต้นฉบับ', 'สำเนา']);
  assert.deepEqual(copySources.map((d) => d.data.en), ['Original', 'Copy']);
});

test('the raw record is loaded once for the whole copy set, and still binds', () => {
  const { suitelet, render } = buildSuitelet({ templates: templateWithCopies(TWO_COPIES) });
  const { context } = contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42' },
  });

  suitelet.onRequest(context);

  assert.equal(render.calls.records.length, 2, 'each pass binds the record it needs');
  assert.equal(render.calls.records[0].record, render.calls.records[1].record, 'same loaded record reused');
});

test('a single-copy render still gets a copy data source (default ต้นฉบับ)', () => {
  const { suitelet, render } = buildSuitelet({ templates: templateWithCopies('') });
  const { context } = contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42' },
  });

  suitelet.onRequest(context);

  assert.equal(render.calls.xmlToPdf.length, 0, 'no pdfset needed for one copy');
  const copySources = render.calls.dataSources.filter((d) => d.alias === 'copy');
  assert.equal(copySources.length, 1);
  assert.equal(copySources[0].data.label, 'ต้นฉบับ (Original)');
});

test('the copy data source exposes exactly the keys the binding contract declares', () => {
  const contract = loadAmd('./pld_lib_invoice_data', {
    'N/query': {}, 'N/record': {}, 'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
  }).copyBindingKeys;

  const { suitelet, render } = buildSuitelet({ templates: templateWithCopies('') });
  suitelet.onRequest(contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42' },
  }).context);

  const data = render.calls.dataSources.find((d) => d.alias === 'copy').data;
  // Array.from: values coming out of the AMD sandbox are cross-realm, so a bare
  // deepEqual on two arrays fails on prototypes alone.
  assert.deepEqual(Object.keys(data).sort(), Array.from(contract).sort(),
    'engine and contract must not drift — the validator checks templates against the contract');
});

test('download=T still forces an attachment', () => {
  const { suitelet } = buildSuitelet({
    templates: [{ id: '7', values: { custrecord_pld_tpl_xml: TPL_XML } }],
  });
  const { context, response } = contextStub({
    parameters: { action: 'render', rectype: 'itemfulfillment', recid: '42', download: 'T' },
  });

  suitelet.onRequest(context);

  assert.match(response.state.headers['Content-Disposition'], /^attachment; /);
  assert.equal(response.state.files[0].isInline, false);
});

// ─── #181/#191: saved preview uses the same render core as Print ──────────────
test('?action=preview renders the saved template through the canonical sample pipeline', () => {
  const { suitelet, render, sampleCalls, log } = buildSuitelet({
    recordValues: {
      custrecord_pld_tpl_xml: '<pdf><body><#list record.items as line>${line.description!""}</#list></body></pdf>',
      custrecord_pld_tpl_data: TWO_COPIES,
      custrecord_pld_tpl_rectype: 'invoice',
    },
  });
  const { context, response } = contextStub({
    parameters: { action: 'preview', tplid: '7' },
  });

  suitelet.onRequest(context);

  assert.equal(response.state.headers['Content-Type'], 'application/pdf');
  assert.equal(response.state.files.length, 1, 'a PDF must come back, not the error page');
  assert.equal(response.state.body, '', 'no error page');
  assert.equal(render.calls.renderedAsPdf, 0, 'two copies use the core XML-to-pdfset pipeline');
  assert.equal(render.calls.renderedAsString, 2, 'the core renders once per copy');
  assert.equal(render.calls.xmlToPdf.length, 1, 'the core combines both copies into one PDF');
  assert.deepEqual(sampleCalls.map((d) => d.copyTh), ['ต้นฉบับ', 'สำเนา']);
  assert.deepEqual(
    render.calls.dataSources.filter((d) => d.alias === 'record').map((d) => d.data.copyTh),
    ['ต้นฉบับ', 'สำเนา'],
    'preview binds engine sample data instead of deleting FreeMarker expressions'
  );
  assert.equal(log.entries.find((e) => e.level === 'audit').details.copies, 2);
});

test('?action=preview trusts the stored non-invoice rectype and its one-copy default', () => {
  const { suitelet, render, sampleCalls, log } = buildSuitelet({
    recordValues: {
      custrecord_pld_tpl_xml: TPL_XML,
      custrecord_pld_tpl_data: '',
      custrecord_pld_tpl_rectype: 'itemfulfillment',
    },
  });
  const { context, response } = contextStub({
    // A stale/forged caller value cannot turn this saved template into an invoice.
    parameters: { action: 'preview', tplid: '7', rectype: 'invoice' },
  });

  suitelet.onRequest(context);

  assert.equal(response.state.headers['Content-Type'], 'application/pdf');
  assert.equal(render.calls.renderedAsPdf, 1, 'non-invoice defaults to one original copy');
  assert.equal(render.calls.renderedAsString, 0);
  assert.deepEqual(sampleCalls, [{
    rectype: 'itemfulfillment', copyTh: 'ต้นฉบับ', copyEn: 'Original',
  }]);
  const audit = log.entries.find((e) => e.level === 'audit');
  assert.equal(audit.details.rectype, 'itemfulfillment');
  assert.equal(audit.details.copies, 1);
});

test('?action=preview fails closed when the saved template has no rectype', () => {
  const { suitelet, render, log } = buildSuitelet({
    recordValues: { custrecord_pld_tpl_xml: TPL_XML },
  });
  const { context, response } = contextStub({
    parameters: { action: 'preview', tplid: '7', rectype: 'invoice' },
  });

  suitelet.onRequest(context);

  assert.match(response.state.headers['Content-Type'], /text\/html/);
  assert.match(response.state.body, /has no record type/);
  assert.equal(render.calls.created, 0, 'caller rectype must not bypass missing stored metadata');
  assert.equal(log.entries.find((e) => e.level === 'error').details.rectype, '',
    'telemetry must not present the caller value as authoritative');
});

test('the render Suitelet cannot own a direct N/render path', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_sl_render_pdf.js'
  ), 'utf8');

  assert.doesNotMatch(source, /['"]N\/render['"]/, 'only pld_lib_render may depend on N/render');
  assert.doesNotMatch(source, /\brender\.create\s*\(/, 'Suitelet must delegate renderer creation');
  assert.equal(source.includes('.replace(/\\$\\{'), false, 'Suitelet must not strip FreeMarker bindings');
  assert.equal(source.includes('[Sample Data]'), false, 'placeholder substitution creates false-success previews');
  assert.match(source, /pldRender\.renderSampleDocument\(tpl\.xml, recType, copies, tel\)/);
});

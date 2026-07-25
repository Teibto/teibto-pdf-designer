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
function buildSuitelet({ templates = [] } = {}) {
  const log = logStub();
  const render = renderStub();
  const search = searchStub(templates);
  const stubs = {
    'N/render': render.module,
    'N/record': recordStub({ id: 42, values: { tranid: 'IF-0001', subsidiary: '2' } }).module,
    'N/search': search.module,
    'N/file': fileStub(),
    'N/runtime': runtimeStub(),
    'N/log': log.module,
    'N/xml': xmlStub,
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
    // no SuiteQL in these tests — the curated builder has its own suite
    './pld_lib_invoice_data': {
      isSupportedType: () => false,
      buildTransactionData: () => ({}),
    },
  };
  return { suitelet: loadAmd('./pld_sl_render_pdf', stubs), log, render, search };
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

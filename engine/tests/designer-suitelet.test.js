/**
 * pld_sl_designer — Suitelet โฮสต์ SPA ต้องเป็นทางอ่านอย่างเดียว (#189)
 *
 * เดิมไฟล์นี้มี CRUD ชุดที่สองของเทมเพลต (`save-template`) และ `generate-bfo` ที่เขียน
 * ไฟล์ XML ลง File Cabinet **โฟลเดอร์ตามที่ผู้เรียกส่งมา** โดยไม่ตรวจสิทธิ์เลย ทั้งคู่ไม่มี
 * client เรียกจริง เทสชุดนี้กันไม่ให้ทางเขียนงอกกลับมาที่นี่ และกันธง canEditTemplates
 * ที่ SPA ใช้ตัดสินว่าจะขึ้นโหมดอ่านอย่างเดียวหรือไม่
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAmd } = require('./helpers/amd');
const {
  logStub, companyConfigStub, runtimeStub, contextStub,
  recordStoreStub, storeSearchStub,
} = require('./helpers/ns-stubs');

const CFG_TYPE = 'customrecord_pld_config';
const ADMIN = 3;
const CLERK = 1042;

function buildDesigner({
  role = ADMIN,
  editorRoles = '',
  companyConfig = companyConfigStub,
  scriptParameters = {},
  invoiceData = { isSupportedType: () => false, buildTransactionData: () => ({}) },
  usage,
} = {}) {
  const store = recordStoreStub({
    [`${CFG_TYPE}:1`]: { custrecord_pld_cfg_editor_roles: editorRoles },
  });
  const log = logStub();
  const stubs = {
    'N/file': {
      load: ({ id }) => ({
        getContents: () => '<html><head></head><body></body></html>',
        url: `/core/media/media.nl?id=${String(id).length}`,
      }),
      create: () => { throw new Error('designer Suitelet must not create files'); },
      Type: { XMLDOC: 'XMLDOC' },
    },
    'N/runtime': runtimeStub({
      user: { id: 9, name: 'QA Tester', email: 'qa@example.test', role, subsidiary: 2 },
      parameters: scriptParameters,
      usage,
    }),
    'N/url': { resolveScript: () => '/app/site/hosting/scriptlet.nl?script=1&deploy=1' },
    'N/search': storeSearchStub(store).module,
    'N/record': store.module,
    'N/log': log.module,
    './pld_lib_company_config': companyConfig,
    './pld_lib_invoice_data': invoiceData,
  };
  return { suitelet: loadAmd('./pld_sl_designer', stubs), store, log };
}

/** ค่าที่ฉีดเข้า window.__NS_CONTEXT__ ของหน้าที่เสิร์ฟออกไป */
function injectedContext(html) {
  return JSON.parse(html.match(/window\.__NS_CONTEXT__ = (\{.*?\});window\./)[1]);
}

test('POST ทุกแบบถูกปฏิเสธ — ไม่มีทางเขียนเทมเพลตหรือไฟล์ผ่าน Suitelet นี้', () => {
  const { suitelet, store } = buildDesigner();

  for (const action of ['save-template', 'generate-bfo', 'anything']) {
    const { context, response } = contextStub({
      parameters: { action },
      method: 'POST',
      body: JSON.stringify({ name: 'x', xml: '<pdf/>', folderId: 12 }),
    });

    suitelet.onRequest(context);

    const body = JSON.parse(response.state.body);
    assert.equal(body.error, true, `${action} ต้องไม่ทำงาน`);
    assert.match(body.message, /อ่านอย่างเดียว/);
  }

  assert.equal(store.saved.length, 0);
});

test('หน้าที่เสิร์ฟบอก SPA ว่า role นี้แก้เทมเพลตได้หรือไม่', () => {
  const editor = buildDesigner({ role: CLERK, editorRoles: '1042' });
  const ctxA = contextStub({ parameters: {} });
  editor.suitelet.onRequest(ctxA.context);
  assert.equal(injectedContext(ctxA.response.state.body).canEditTemplates, true);

  const viewer = buildDesigner({ role: CLERK });
  const ctxB = contextStub({ parameters: {} });
  viewer.suitelet.onRequest(ctxB.context);
  const ctx = injectedContext(ctxB.response.state.body);
  assert.equal(ctx.canEditTemplates, false, 'ไม่ได้อยู่ใน allowlist = อ่านอย่างเดียว');
  assert.equal(ctx.role, CLERK, 'role ที่ส่งให้ SPA คือ role ที่ engine ใช้ตัดสินจริง');
});

test('bootstrap font context uses the same render-required company config and ignores legacy parameters', () => {
  const loads = [];
  const configured = buildDesigner({
    companyConfig: {
      load: (subsidiaryId, options) => {
        loads.push({ subsidiaryId, forRender: options && options.forRender });
        return { fontRegular: '/cfg/regular.ttf', fontBold: '/cfg/bold.ttf' };
      },
    },
    scriptParameters: {
      custscript_pld_font_regular: '/legacy/regular.ttf',
      custscript_pld_font_bold: '/legacy/bold.ttf',
    },
  });
  const page = contextStub({ parameters: {} });

  configured.suitelet.onRequest(page.context);

  const ctx = injectedContext(page.response.state.body);
  assert.deepEqual(loads, [{ subsidiaryId: 2, forRender: true }]);
  assert.equal(ctx.fontRegularUrl, '/cfg/regular.ttf');
  assert.equal(ctx.fontBoldUrl, '/cfg/bold.ttf');
});

test('broken render company config leaves bootstrap fonts empty despite legacy parameters', () => {
  const broken = buildDesigner({
    companyConfig: { load: () => { throw new Error('missing required Thai font'); } },
    scriptParameters: {
      custscript_pld_font_regular: '/legacy/regular.ttf',
      custscript_pld_font_bold: '/legacy/bold.ttf',
    },
  });
  const page = contextStub({ parameters: {} });

  broken.suitelet.onRequest(page.context);

  const ctx = injectedContext(page.response.state.body);
  assert.equal(ctx.fontRegularUrl, null, 'SPA must keep the missing-font warning visible');
  assert.equal(ctx.fontBoldUrl, null, 'legacy deployment params cannot make preview look configured');
});

test('load-record measures server work without changing the data contract or exposing identifiers', () => {
  let usage = 1000;
  const data = { document: { number: 'SYNTHETIC-PRIVATE' }, items: [{ description: 'ทดสอบ' }] };
  const { suitelet } = buildDesigner({
    usage: () => usage,
    invoiceData: {
      isSupportedType: () => true,
      buildTransactionData: () => { usage -= 23; return data; },
    },
  });
  const { context, response } = contextStub({ parameters: { action: 'load-record', rectype: 'invoice', recid: '42' } });
  suitelet.onRequest(context);
  assert.deepEqual(JSON.parse(response.state.body), data);
  assert.match(response.state.headers['Server-Timing'], /^data;dur=\d+, serialize;dur=\d+$/);
  assert.equal(response.state.headers['X-PLD-Usage'], '23');
  assert.doesNotMatch(response.state.headers['Server-Timing'], /SYNTHETIC-PRIVATE|recid/);
});

test('load-record leaves unavailable governance absent instead of claiming zero', () => {
  const { suitelet } = buildDesigner({
    usage: () => { throw new Error('unavailable'); },
    invoiceData: { isSupportedType: () => true, buildTransactionData: () => ({ items: [] }) },
  });
  const { context, response } = contextStub({ parameters: { action: 'load-record', rectype: 'invoice', recid: '42' } });
  suitelet.onRequest(context);
  assert.deepEqual(JSON.parse(response.state.body), { items: [] });
  assert.equal(response.state.headers['X-PLD-Usage'], undefined);
});

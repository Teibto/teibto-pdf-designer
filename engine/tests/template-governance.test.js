/**
 * Template governance (#189) — สิทธิ์แก้ไข · ประวัติเวอร์ชัน/กู้คืน · audit trail
 *
 * เทมเพลตหนึ่งตัวคุมหน้าตาเอกสารตามกฎหมายของทั้ง account การเขียนทับหรือลบมันจึงต้อง
 * (1) มีคนที่ทำได้จำกัด (2) ถอยกลับได้ (3) ทิ้งร่องรอยว่าใครทำ เทสชุดนี้ยึดพฤติกรรมทั้งสาม
 * ไว้กับ **ผลลัพธ์บน store จริง** ไม่ใช่กับการเรียกฟังก์ชัน — คำถามทุกข้อคือ "หลังจากยิง
 * request นี้ ข้อมูลบน account เป็นอย่างไร"
 *
 * สิ่งที่เทสชุดนี้พิสูจน์ไม่ได้ (โดยธรรมชาติ เหมือนบทเรียน SuiteQL ของ #174):
 * `runtime.getCurrentUser().role` บน deployment ที่ตั้ง run-as = Administrator คืน role
 * ของผู้ใช้จริงหรือคืน role 3 — ต้อง login ด้วย role ที่ไม่ใช่ admin บน SB2 แล้วอ่าน
 * roleId จาก audit line เท่านั้น (ดู docs/RUNBOOK.md)
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAmd } = require('./helpers/amd');
const {
  formatStub, logStub, companyConfigStub, xmlStub,
  runtimeStub, renderStub, fileStub, contextStub,
  recordStoreStub, storeSearchStub,
} = require('./helpers/ns-stubs');

const TPL_TYPE = 'customrecord_pld_template';
const VER_TYPE = 'customrecord_pld_tpl_version';
const CFG_TYPE = 'customrecord_pld_config';

const ADMIN = 3;
const CLERK = 1042;   // role ที่ไม่ได้อยู่ใน allowlist
const DESIGNER = 1017; // role ที่ผู้ดูแลเปิดสิทธิ์ให้

const OLD_XML = '<pdf><body>version หนึ่ง</body></pdf>';
const NEW_XML = '<pdf><body>version สอง</body></pdf>';

/** เทมเพลตหนึ่งตัวใน store */
function seedTemplate(id, over = {}) {
  return {
    [`${TPL_TYPE}:${id}`]: {
      name: 'ใบแจ้งหนี้',
      custrecord_pld_tpl_name: 'ใบแจ้งหนี้',
      custrecord_pld_tpl_xml: OLD_XML,
      custrecord_pld_tpl_data: '{"copies":[]}',
      custrecord_pld_tpl_rectype: 'invoice',
      custrecord_pld_tpl_default: true,
      ...over,
    },
  };
}

/** แถวเวอร์ชันหนึ่งแถว (ใช้ seed สถานะที่สร้างเองยาก เช่น เวอร์ชันที่ถูก prune แล้ว) */
function seedVersion(recId, tplId, no, over = {}) {
  return {
    [`${VER_TYPE}:${recId}`]: {
      custrecord_pld_ver_tplid: tplId,
      custrecord_pld_ver_no: no,
      custrecord_pld_ver_action: 'update',
      custrecord_pld_ver_name: 'ใบแจ้งหนี้',
      custrecord_pld_ver_rectype: 'invoice',
      custrecord_pld_ver_userid: '9',
      custrecord_pld_ver_username: 'QA Tester',
      custrecord_pld_ver_roleid: String(ADMIN),
      custrecord_pld_ver_xml: OLD_XML,
      custrecord_pld_ver_data: '{}',
      custrecord_pld_ver_note: '',
      custrecord_pld_ver_pruned: false,
      ...over,
    },
  };
}

function buildSuitelet({ role = ADMIN, editorRoles = '', seed = {} } = {}) {
  const store = recordStoreStub({
    [`${CFG_TYPE}:1`]: { custrecord_pld_cfg_editor_roles: editorRoles },
    ...seed,
  });
  const search = storeSearchStub(store);
  const log = logStub();
  const stubs = {
    'N/render': renderStub().module,
    'N/record': store.module,
    'N/search': search.module,
    'N/file': fileStub(),
    'N/runtime': runtimeStub({ user: { id: 9, name: 'QA Tester', email: 'qa@example.test', role } }),
    'N/log': log.module,
    'N/xml': xmlStub,
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
    './pld_lib_invoice_data': { isSupportedType: () => false, buildTransactionData: () => ({}) },
  };
  return { suitelet: loadAmd('./pld_sl_render_pdf', stubs), store, log, search };
}

/** เวอร์ชันทั้งหมดของ template หนึ่งตัว เรียงจากเก่าไปใหม่ */
function versionsOf(store, tplId) {
  return store.rowsOf(VER_TYPE)
    .filter((r) => Number(r.values.custrecord_pld_ver_tplid) === Number(tplId))
    .sort((a, b) => a.values.custrecord_pld_ver_no - b.values.custrecord_pld_ver_no)
    .map((r) => ({ id: r.id, ...r.values }));
}

const savePayload = (over = {}) => JSON.stringify({
  id: '7', name: 'ใบแจ้งหนี้', data: '{"copies":[]}', xml: NEW_XML, rectype: 'invoice', ...over,
});

const auditLines = (log, title) => log.entries.filter((e) => e.title === title);

// ═══════════════════════════════════════════════════
// 1) สิทธิ์
// ═══════════════════════════════════════════════════

test('role ที่ไม่อยู่ใน allowlist บันทึกเทมเพลตไม่ได้ และเทมเพลตไม่ถูกแตะ', () => {
  const { suitelet, store, log } = buildSuitelet({ role: CLERK, seed: seedTemplate(7) });
  const { context, response } = contextStub({
    parameters: { action: 'save' }, method: 'POST', body: savePayload(),
  });

  suitelet.onRequest(context);

  const body = JSON.parse(response.state.body);
  assert.equal(body.denied, true);
  assert.match(body.message, /ไม่มีสิทธิ์แก้ไขเทมเพลต/);
  assert.match(body.message, /Template Editor Roles/, 'ต้องบอกทางแก้ ไม่ใช่แค่ปฏิเสธ');

  // ของบน account ต้องเหมือนเดิมทุกอย่าง
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, OLD_XML);
  assert.equal(versionsOf(store, 7).length, 0, 'ถูกปฏิเสธแล้วต้องไม่มีเวอร์ชันงอกมา');

  const denied = auditLines(log, 'PLD template write denied');
  assert.equal(denied.length, 1);
  assert.deepEqual({ ...denied[0].details }, {
    action: 'save', allowed: false, userId: '9', userName: 'QA Tester',
    roleId: String(CLERK), tplid: '', rectype: '',
  });
});

test('role ที่ไม่อยู่ใน allowlist ลบเทมเพลตไม่ได้ — record ยังอยู่', () => {
  const { suitelet, store } = buildSuitelet({ role: CLERK, seed: seedTemplate(7) });
  const { context, response } = contextStub({
    parameters: { action: 'delete', tplid: '7' }, method: 'POST',
  });

  suitelet.onRequest(context);

  assert.equal(JSON.parse(response.state.body).denied, true);
  assert.ok(store.records[`${TPL_TYPE}:7`], 'เทมเพลตต้องยังอยู่');
  assert.equal(store.deleted.length, 0);
});

test('allowlist ว่าง = เฉพาะ Administrator (fail-closed) และ admin ทำได้เสมอ', () => {
  const denied = buildSuitelet({ role: DESIGNER, seed: seedTemplate(7) });
  const ctxA = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  denied.suitelet.onRequest(ctxA.context);
  assert.equal(JSON.parse(ctxA.response.state.body).denied, true, 'ยังไม่ได้ตั้ง config = แก้ไม่ได้');

  const admin = buildSuitelet({ role: ADMIN, seed: seedTemplate(7) });
  const ctxB = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  admin.suitelet.onRequest(ctxB.context);
  assert.equal(JSON.parse(ctxB.response.state.body).success, true, 'Administrator ห้ามถูกล็อกออกจากระบบตัวเอง');
});

test('role ที่ผู้ดูแลใส่ไว้ใน config แก้ได้ และรับตัวคั่นอะไรก็ได้', () => {
  const { suitelet, store } = buildSuitelet({
    role: DESIGNER, editorRoles: '1042 / 1017', seed: seedTemplate(7),
  });
  const { context, response } = contextStub({
    parameters: { action: 'save' }, method: 'POST', body: savePayload(),
  });

  suitelet.onRequest(context);

  assert.equal(JSON.parse(response.state.body).success, true);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, NEW_XML);
});

test('งานพิมพ์ไม่ถูกกระทบ — role เดียวกันยัง list / get / history ได้', () => {
  const { suitelet } = buildSuitelet({ role: CLERK, seed: seedTemplate(7) });

  const list = contextStub({ parameters: { action: 'list', rectype: 'invoice' } });
  suitelet.onRequest(list.context);
  assert.equal(JSON.parse(list.response.state.body).length, 1);

  const get = contextStub({ parameters: { action: 'get', tplid: '7' } });
  suitelet.onRequest(get.context);
  assert.equal(JSON.parse(get.response.state.body).xml, OLD_XML);

  const history = contextStub({ parameters: { action: 'history', tplid: '7' } });
  suitelet.onRequest(history.context);
  const seen = JSON.parse(history.response.state.body);
  assert.equal(seen.canEdit, false, 'อ่านประวัติได้ แต่ต้องรู้ตัวว่าแก้ไม่ได้');
  assert.deepEqual(seen.versions, []);
});

// ═══════════════════════════════════════════════════
// 2) ประวัติเวอร์ชัน
// ═══════════════════════════════════════════════════

test('omitted save metadata preserves stored type/default and complete version metadata', () => {
  const { suitelet, store, log } = buildSuitelet({ seed: seedTemplate(7) });
  const { context, response } = contextStub({ parameters: { action: 'save' }, method: 'POST',
    body: JSON.stringify({ id: '7', xml: NEW_XML }) });
  suitelet.onRequest(context);
  assert.equal(JSON.parse(response.state.body).success, true);
  const saved = store.records[`${TPL_TYPE}:7`];
  assert.equal(saved.custrecord_pld_tpl_rectype, 'invoice');
  assert.equal(saved.custrecord_pld_tpl_default, true);
  assert.equal(saved.custrecord_pld_tpl_name, 'ใบแจ้งหนี้');
  const latest = versionsOf(store, 7).at(-1);
  assert.equal(latest.custrecord_pld_ver_rectype, 'invoice');
  assert.equal(latest.custrecord_pld_ver_data, '{"copies":[]}');
  assert.ok(log.entries.some((e) => e.details && e.details.isDefault === true));
});

test('explicit false removes default while omitted type remains invoice', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const { context, response } = contextStub({ parameters: { action: 'save' }, method: 'POST',
    body: JSON.stringify({ id: '7', xml: NEW_XML, isDefault: false }) });
  suitelet.onRequest(context);
  assert.equal(JSON.parse(response.state.body).success, true);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_default, false);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_rectype, 'invoice');
});

test('promoting a template with omitted type clears only defaults of its stored type', () => {
  const { suitelet, store } = buildSuitelet({ seed: {
    ...seedTemplate(7, { custrecord_pld_tpl_default: false }), ...seedTemplate(8),
    ...seedTemplate(9, { custrecord_pld_tpl_rectype: 'purchaseorder' }),
  } });
  const { context, response } = contextStub({ parameters: { action: 'save' }, method: 'POST',
    body: JSON.stringify({ id: '7', xml: NEW_XML, isDefault: true }) });
  suitelet.onRequest(context);
  assert.equal(JSON.parse(response.state.body).success, true);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_default, true);
  assert.equal(store.records[`${TPL_TYPE}:8`].custrecord_pld_tpl_default, false);
  assert.equal(store.records[`${TPL_TYPE}:9`].custrecord_pld_tpl_default, true);
});

test('invalid default metadata is rejected before template or history mutations', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const { context, response } = contextStub({ parameters: { action: 'save' }, method: 'POST',
    body: savePayload({ isDefault: 'false' }) });
  suitelet.onRequest(context);
  assert.match(response.state.body, /isDefault must be a boolean/);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, OLD_XML);
  assert.equal(versionsOf(store, 7).length, 0);
});

test('default cleanup failure returns durable ID and warning with a complete new version', () => {
  const { suitelet, store, log } = buildSuitelet({ seed: {
    ...seedTemplate(7, { custrecord_pld_tpl_default: false }), ...seedTemplate(8),
  } });
  store.module.submitFields = () => { throw new Error('Permission denied on other template'); };
  const { context, response } = contextStub({ parameters: { action: 'save' }, method: 'POST',
    body: JSON.stringify({ id: '7', xml: NEW_XML, isDefault: true }) });
  suitelet.onRequest(context);
  const result = JSON.parse(response.state.body);
  assert.equal(String(result.id), '7');
  assert.equal(result.success, true, 'content was saved: client must retain its identity');
  assert.match(result.warning, /บันทึกเนื้อหาแล้ว.*default/);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, NEW_XML);
  assert.equal(versionsOf(store, 7).at(-1).custrecord_pld_ver_xml, NEW_XML);
  assert.equal(store.records[`${TPL_TYPE}:8`].custrecord_pld_tpl_default, true);
  assert.ok(log.entries.some((e) => e.title === 'PLD saved template default reconciliation failed'));
});

test('สร้างเทมเพลตใหม่ได้เวอร์ชัน 1 พร้อมชื่อผู้แก้และ role', () => {
  const { suitelet, store } = buildSuitelet({});
  const { context, response } = contextStub({
    parameters: { action: 'save' }, method: 'POST', body: savePayload({ id: null }),
  });

  suitelet.onRequest(context);
  const saved = JSON.parse(response.state.body);
  assert.equal(saved.success, true);
  assert.equal(saved.version, 1);

  const versions = versionsOf(store, saved.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].custrecord_pld_ver_action, 'create');
  assert.equal(versions[0].custrecord_pld_ver_xml, NEW_XML);
  assert.equal(versions[0].custrecord_pld_ver_username, 'QA Tester');
  assert.equal(versions[0].custrecord_pld_ver_roleid, String(ADMIN));
  assert.equal(versions[0].custrecord_pld_ver_rectype, 'invoice');
});

test('เทมเพลตที่มีอยู่ก่อนฟีเจอร์นี้ ถูกเก็บ baseline ก่อนโดนเขียนทับ', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const { context } = contextStub({
    parameters: { action: 'save' }, method: 'POST', body: savePayload(),
  });

  suitelet.onRequest(context);

  const versions = versionsOf(store, 7);
  assert.equal(versions.length, 2, 'ของเดิม + ของใหม่');
  assert.equal(versions[0].custrecord_pld_ver_action, 'baseline');
  assert.equal(versions[0].custrecord_pld_ver_xml, OLD_XML, 'XML ที่ใช้พิมพ์อยู่ต้องไม่หายไปกับการ save ครั้งแรก');
  assert.equal(versions[1].custrecord_pld_ver_action, 'update');
  assert.equal(versions[1].custrecord_pld_ver_xml, NEW_XML);
});

test('save ครั้งถัดไปไม่เก็บ baseline ซ้ำ และเลขเวอร์ชันเดินหน้าทีละ 1', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });

  for (const xml of ['<pdf>a</pdf>', '<pdf>b</pdf>', '<pdf>c</pdf>']) {
    const { context } = contextStub({
      parameters: { action: 'save' }, method: 'POST', body: savePayload({ xml }),
    });
    suitelet.onRequest(context);
  }

  const versions = versionsOf(store, 7);
  assert.deepEqual(versions.map((v) => v.custrecord_pld_ver_no), [1, 2, 3, 4]);
  assert.deepEqual(
    versions.map((v) => v.custrecord_pld_ver_action),
    ['baseline', 'update', 'update', 'update'],
  );
});

test('ลบเทมเพลตแล้วเนื้อไฟล์ยังอยู่ในประวัติ — snapshot ถูกเขียนก่อนลบ', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const { context, response } = contextStub({
    parameters: { action: 'delete', tplid: '7' }, method: 'POST',
  });

  suitelet.onRequest(context);

  const body = JSON.parse(response.state.body);
  assert.equal(body.success, true);
  assert.equal(body.wasDefault, true, 'ต้องยังเตือนว่า record type นี้เหลือไม่มี default');

  assert.equal(store.records[`${TPL_TYPE}:7`], undefined, 'เทมเพลตถูกลบจริง');
  const versions = versionsOf(store, 7);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].custrecord_pld_ver_action, 'delete');
  assert.equal(versions[0].custrecord_pld_ver_xml, OLD_XML);
  assert.match(versions[0].custrecord_pld_ver_note, /default/);
});

test('history คืน metadata ที่อ่านรู้เรื่อง เรียงใหม่ไปเก่า และไม่แบก XML มาด้วย', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const save = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  suitelet.onRequest(save.context);

  const { context, response } = contextStub({ parameters: { action: 'history', tplid: '7' } });
  suitelet.onRequest(context);

  const body = JSON.parse(response.state.body);
  assert.equal(body.canEdit, true);
  assert.equal(body.keepPayload, 20);
  assert.deepEqual(body.versions.map((v) => v.version), [2, 1]);
  assert.deepEqual(body.versions.map((v) => v.action), ['update', 'baseline']);
  assert.equal(body.versions[0].userName, 'QA Tester');
  assert.equal(body.versions[0].roleId, String(ADMIN));
  assert.equal(body.versions[0].hasPayload, true);
  assert.ok(body.versions[0].created, 'ต้องมีเวลาให้อ่าน');
  assert.equal(Object.prototype.hasOwnProperty.call(body.versions[0], 'xml'), false);

  assert.equal(versionsOf(store, 7).length, 2);
});

// ═══════════════════════════════════════════════════
// 3) กู้คืน
// ═══════════════════════════════════════════════════

test('rollback คืนเนื้อของเวอร์ชันเก่า โดยเขียนเป็นเวอร์ชันใหม่ ไม่ลบประวัติ', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const save = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  suitelet.onRequest(save.context);

  const { context, response } = contextStub({
    parameters: { action: 'rollback', tplid: '7', version: '1' }, method: 'POST',
  });
  suitelet.onRequest(context);

  const body = JSON.parse(response.state.body);
  assert.equal(body.success, true);
  assert.equal(body.restoredFrom, 1);
  assert.equal(body.version, 3);
  assert.equal(body.recreated, false);

  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, OLD_XML, 'เทมเพลตกลับไปเป็นของเดิม');

  const versions = versionsOf(store, 7);
  assert.deepEqual(versions.map((v) => v.custrecord_pld_ver_action), ['baseline', 'update', 'rollback']);
  assert.equal(versions[2].custrecord_pld_ver_xml, OLD_XML);
  assert.match(versions[2].custrecord_pld_ver_note, /ย้อนกลับไปเวอร์ชัน 1/);
});

test('rollback ย้อน rollback ได้ — เวอร์ชันที่เพิ่งทับก็ยังอยู่ในประวัติ', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const save = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  suitelet.onRequest(save.context);

  const back = contextStub({ parameters: { action: 'rollback', tplid: '7', version: '1' }, method: 'POST' });
  suitelet.onRequest(back.context);

  const forward = contextStub({ parameters: { action: 'rollback', tplid: '7', version: '2' }, method: 'POST' });
  suitelet.onRequest(forward.context);

  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, NEW_XML);
  assert.equal(versionsOf(store, 7).length, 4);
});

test('rollback เทมเพลตที่ถูกลบไปแล้ว สร้างกลับมาเป็น record ใหม่ที่ไม่ใช่ default', () => {
  const { suitelet, store } = buildSuitelet({ seed: seedTemplate(7) });
  const del = contextStub({ parameters: { action: 'delete', tplid: '7' }, method: 'POST' });
  suitelet.onRequest(del.context);

  const { context, response } = contextStub({
    parameters: { action: 'rollback', tplid: '7', version: '1' }, method: 'POST',
  });
  suitelet.onRequest(context);

  const body = JSON.parse(response.state.body);
  assert.equal(body.success, true);
  assert.equal(body.recreated, true);
  assert.notEqual(String(body.id), '7', 'record เดิมถูกลบไปแล้ว จึงเป็น id ใหม่');

  const restored = store.records[`${TPL_TYPE}:${body.id}`];
  assert.equal(restored.custrecord_pld_tpl_xml, OLD_XML);
  assert.equal(restored.custrecord_pld_tpl_rectype, 'invoice');
  assert.ok(!restored.custrecord_pld_tpl_default, 'การกู้คืนต้องไม่แย่ง Print กลับไปเงียบ ๆ');
});

test('rollback ไปเวอร์ชันที่เนื้อถูกตัดแล้ว ล้มดัง ๆ ไม่ใช่คืน XML ว่าง (R4)', () => {
  const { suitelet, store } = buildSuitelet({
    seed: {
      ...seedTemplate(7),
      ...seedVersion(900, 7, 1, { custrecord_pld_ver_xml: '', custrecord_pld_ver_data: '', custrecord_pld_ver_pruned: true }),
    },
  });

  const { context, response } = contextStub({
    parameters: { action: 'rollback', tplid: '7', version: '1' }, method: 'POST',
  });
  suitelet.onRequest(context);

  const body = JSON.parse(response.state.body);
  assert.equal(body.error, true);
  assert.match(body.message, /ไม่มีเนื้อไฟล์ให้กู้คืน/);
  assert.equal(store.records[`${TPL_TYPE}:7`].custrecord_pld_tpl_xml, OLD_XML, 'เทมเพลตต้องไม่ถูกแตะ');
});

test('rollback ไปเวอร์ชันที่ไม่มีอยู่ ตอบว่าหาไม่เจอ', () => {
  const { suitelet } = buildSuitelet({ seed: seedTemplate(7) });
  const { context, response } = contextStub({
    parameters: { action: 'rollback', tplid: '7', version: '99' }, method: 'POST',
  });
  suitelet.onRequest(context);

  assert.match(JSON.parse(response.state.body).message, /ไม่พบเวอร์ชัน 99/);
});

// ═══════════════════════════════════════════════════
// 4) โควตาพื้นที่ vs ร่องรอย
// ═══════════════════════════════════════════════════

test('เกิน 20 เวอร์ชันแล้วเนื้อไฟล์ของตัวเก่าถูกตัด แต่แถว audit ยังอยู่ครบ', () => {
  const seed = { ...seedTemplate(7) };
  for (let no = 1; no <= 20; no += 1) {
    Object.assign(seed, seedVersion(800 + no, 7, no));
  }

  const { suitelet, store } = buildSuitelet({ seed });
  const { context } = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  suitelet.onRequest(context);

  const versions = versionsOf(store, 7);
  assert.equal(versions.length, 21, 'แถวไม่เคยถูกลบ');
  assert.equal(versions[20].custrecord_pld_ver_no, 21, 'ของใหม่ต่อท้าย');

  const oldest = versions[0];
  assert.equal(oldest.custrecord_pld_ver_pruned, true);
  assert.equal(oldest.custrecord_pld_ver_xml, '');
  assert.equal(oldest.custrecord_pld_ver_username, 'QA Tester', 'ใครแก้เมื่อไหร่ยังตอบได้');

  assert.equal(versions[1].custrecord_pld_ver_xml, OLD_XML, 'เวอร์ชันที่ 2 ยังกู้คืนได้');
});

// ═══════════════════════════════════════════════════
// 5) audit trail
// ═══════════════════════════════════════════════════

test('ทุกการเขียนทิ้ง audit line ที่ระบุคน role และเวอร์ชัน', () => {
  const { suitelet, log } = buildSuitelet({ seed: seedTemplate(7) });

  const save = contextStub({ parameters: { action: 'save' }, method: 'POST', body: savePayload() });
  suitelet.onRequest(save.context);
  const back = contextStub({ parameters: { action: 'rollback', tplid: '7', version: '1' }, method: 'POST' });
  suitelet.onRequest(back.context);
  const del = contextStub({ parameters: { action: 'delete', tplid: '7' }, method: 'POST' });
  suitelet.onRequest(del.context);

  const updated = auditLines(log, 'PLD template update');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].details.userId, '9');
  assert.equal(updated[0].details.roleId, String(ADMIN));
  assert.equal(updated[0].details.tplid, '7');
  assert.equal(updated[0].details.rectype, 'invoice');
  assert.equal(updated[0].details.version, 2);

  assert.equal(auditLines(log, 'PLD template rollback')[0].details.restoredFrom, 1);
  assert.equal(auditLines(log, 'PLD template delete')[0].details.wasDefault, true);

  // ผ่านด่านสิทธิ์ก็บันทึกเหมือนกัน — roleId ในบรรทัดนี้คือค่าที่ใช้ยืนยันสดบน SB2
  const allowed = auditLines(log, 'PLD template write allowed');
  assert.deepEqual(allowed.map((e) => e.details.action), ['save', 'rollback', 'delete']);
  assert.ok(allowed.every((e) => e.details.roleId === String(ADMIN)));
});

/**
 * pld_sl_batch_print — พิมพ์เป็นชุด (#181)
 *
 * สิ่งที่ test ชุดนี้ตรึงไว้คือสัญญากับผู้ใช้ ไม่ใช่หน้าตาของ HTML:
 *  - ครบทุกใบเท่านั้นถึงจะได้ PDF · ไม่ครบเมื่อไหร่ต้องเป็นหน้าสรุปที่บอกว่าใบไหน
 *    หายและเพราะอะไร (R4 — ห้ามส่งไฟล์ที่ขาดใบไปเงียบ ๆ)
 *  - ใบเดียวพังไม่ล้มทั้งชุด
 *  - เพดานจำนวนใบมาจากการ **วัด** usage จริงต่อใบ ไม่ใช่ค่าคงที่
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAmd } = require('./helpers/amd');
const {
  formatStub, logStub, companyConfigStub, xmlStub, runtimeStub, renderStub, contextStub,
  fileSystemStub, taskStub,
} = require('./helpers/ns-stubs');

const TPL_XML = '<pdf><body>ok</body></pdf>';
const TWO_COPIES = JSON.stringify({ copies: [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }] });

const DOC_TITLES = {
  invoice: { th: 'ใบแจ้งหนี้/ใบกำกับภาษี', en: 'INVOICE/TAX INVOICE' },
  itemfulfillment: { th: 'ใบส่งสินค้า', en: 'DELIVERY NOTE' },
};

/** N/search stub that answers per searched record type (documents vs templates). */
function typedSearchStub(byType) {
  const created = [];
  const columns = [];
  const wrap = (rows) => rows.map((r) => ({
    id: r.id,
    getValue: (f) => {
      const key = typeof f === 'object' && f ? f.name : f;
      return Object.prototype.hasOwnProperty.call(r.values || {}, key) ? r.values[key] : '';
    },
    getText: (f) => {
      const key = typeof f === 'object' && f ? f.name : f;
      return Object.prototype.hasOwnProperty.call(r.texts || {}, key) ? r.texts[key] : '';
    },
  }));
  return {
    created,
    columns,
    module: {
      Sort: { ASC: 'ASC', DESC: 'DESC' },
      createColumn(opts) { columns.push(opts); return opts; },
      create(opts) {
        created.push(opts);
        const rows = wrap(byType[opts.type] || []);
        return {
          run: () => ({
            getRange: () => rows.slice(),
            each: (fn) => { rows.every((row) => fn(row) !== false); },
          }),
        };
      },
    },
  };
}

/**
 * @param {Object} opts
 * @param {Array}  opts.documents  transaction rows the screen lists
 * @param {Array}  opts.templates  customrecord_pld_template rows
 * @param {Array}  opts.failIds    record ids whose record.load blows up
 * @param {Function} opts.usage    getRemainingUsage() sequence
 */
function buildBatch({
  documents = [], templates = [], failIds = [], usage, asString, folders = [],
} = {}) {
  const log = logStub();
  const render = renderStub(asString === undefined ? {} : { asString });
  const search = typedSearchStub({
    itemfulfillment: documents,
    invoice: documents,
    customrecord_pld_template: templates,
    folder: folders,
  });
  const files = fileSystemStub({
    // the deploy stamp: where the engine lives on this account (#181)
    files: { '/SuiteScripts/pdf-layout-designer/pld_version.txt': { folder: '55', getContents: () => '{}' } },
  });
  const task = taskStub();
  const folderRecords = [];
  const stubs = {
    'N/search': search.module,
    'N/runtime': runtimeStub({ usage }),
    'N/log': log.module,
    'N/xml': xmlStub,
    'N/format': formatStub,
    'N/render': render.module,
    'N/file': files.module,
    'N/task': task.module,
    'N/record': {
      Type: {},
      create: ({ type }) => {
        const values = {};
        folderRecords.push({ type, values });
        return {
          setValue: ({ fieldId, value }) => { values[fieldId] = value; },
          save: () => '77',
        };
      },
      load: ({ id }) => {
        if (failIds.indexOf(String(id)) !== -1) {
          throw new Error('This record does not exist: ' + id);
        }
        return {
          id,
          getValue: ({ fieldId }) => {
            if (fieldId === 'tranid') return 'IF-' + id;
            if (fieldId === 'subsidiary') return '2';
            if (fieldId === 'custrecord_pld_tpl_xml') return TPL_XML;
            if (fieldId === 'custrecord_pld_tpl_data') return TWO_COPIES;
            return '';
          },
          getText: () => '',
        };
      },
    },
    './pld_lib_company_config': companyConfigStub,
    './pld_lib_invoice_data': {
      isSupportedType: () => false,
      buildTransactionData: () => ({}),
      docTitles: DOC_TITLES,
    },
  };
  const rows = require('./helpers/batch-store').batchStore(stubs, files);
  return { openSnapshot: (text) => JSON.parse(JSON.stringify(loadAmd('./pld_lib_batch_integrity', stubs).open('snapshot', text))), stubs, rows, suitelet: loadAmd('./pld_sl_batch_print', stubs), log, render, search, files, task, folderRecords };
}

const DOCS = [
  { id: '11', values: { tranid: 'IF-0011', trandate: '25/7/2026', total: '1,070.00' }, texts: { entity: 'ลูกค้า ก' } },
  { id: '12', values: { tranid: 'IF-0012', trandate: '25/7/2026', total: '2,140.00' }, texts: { entity: 'ลูกค้า ข' } },
  { id: '13', values: { tranid: 'IF-0013', trandate: '24/7/2026', total: '535.00' }, texts: { entity: 'ลูกค้า ค' } },
];

const TEMPLATES = [
  {
    id: '7',
    values: {
      custrecord_pld_tpl_name: 'ใบส่งสินค้ามาตรฐาน',
      custrecord_pld_tpl_default: true,
      custrecord_pld_tpl_xml: TPL_XML,
      custrecord_pld_tpl_data: TWO_COPIES,
    },
  },
];

function printRequest(ids, extra = {}) {
  return contextStub({
    method: 'POST',
    parameters: Object.assign(
      { action: 'print', rectype: 'itemfulfillment', docids: ids.join(',') },
      extra,
    ),
  });
}

// ─── หน้าจอ ──────────────────────────────────────────────────────────────────

test('หน้าแรกให้เลือกประเภทเอกสารเป็นภาษาไทย และยังไม่ยิง search', () => {
  const { suitelet, search } = buildBatch();
  const { context, response } = contextStub({ parameters: {} });

  suitelet.onRequest(context);

  assert.match(response.state.headers['Content-Type'], /text\/html/);
  assert.match(response.state.body, /พิมพ์เอกสารเป็นชุด/);
  assert.match(response.state.body, /ใบส่งสินค้า \(DELIVERY NOTE\)/, 'ชื่อเอกสารมาจาก DOC_TITLES ที่เดียว');
  assert.equal(search.created.length, 0, 'ยังไม่เลือกประเภท ก็ยังไม่ต้องค้น');
});

test('เลือกประเภทแล้วได้รายการพร้อม checkbox ต่อใบ', () => {
  const { suitelet } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context, response } = contextStub({
    parameters: { rectype: 'itemfulfillment', from: '2026-07-01', to: '2026-07-31' },
  });

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.match(body, /IF-0011/);
  assert.match(body, /ลูกค้า ก/);
  assert.equal((body.match(/class="pldpick"/g) || []).length, 3, 'หนึ่ง checkbox ต่อหนึ่งใบ');
  assert.match(body, /ใบส่งสินค้ามาตรฐาน ★/, 'เลือก template ได้ และเห็นว่าตัวไหนเป็นค่าเริ่มต้น');
  assert.match(body, /พบ 3 รายการ/);
});

test('ช่วงวันที่กลายเป็น filter ในรูปแบบวันที่ของ account ไม่ใช่สตริงดิบ', () => {
  const { suitelet, search } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context } = contextStub({
    parameters: { rectype: 'itemfulfillment', from: '2026-07-01', to: '2026-07-31' },
  });

  suitelet.onRequest(context);

  const docSearch = search.created.find((s) => s.type === 'itemfulfillment');
  const flat = JSON.stringify(docSearch.filters);
  assert.match(flat, /"mainline","is","T"/, 'หนึ่งแถวต่อหนึ่งเอกสาร');
  assert.match(flat, /"trandate","onorafter","01\/07\/2026"/);
  assert.match(flat, /"trandate","onorbefore","31\/07\/2026"/);
});

test('เอกสารที่ไม่มียอดเงินตามกฎหมาย ไม่ขอคอลัมน์ total เลย (#170)', () => {
  const { suitelet, search } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context } = contextStub({ parameters: { rectype: 'itemfulfillment' } });

  suitelet.onRequest(context);

  assert.equal(search.columns.filter((c) => c.name === 'total').length, 0);
});

test('เอกสารที่มียอดเงิน ขอคอลัมน์ total และแสดงในตาราง', () => {
  const { suitelet, search } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context, response } = contextStub({ parameters: { rectype: 'invoice' } });

  suitelet.onRequest(context);

  assert.equal(search.columns.filter((c) => c.name === 'total').length, 1);
  assert.match(response.state.body, /1,070\.00/);
});

// ─── พิมพ์ครบ ────────────────────────────────────────────────────────────────

test('เลือกหลายใบแล้วได้ PDF ก้อนเดียวที่มีทุกใบ ทุกชุดสำเนา', () => {
  const { suitelet, render, log } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context, response } = printRequest(['11', '12', '13'], { tplid: '7' });

  suitelet.onRequest(context);

  assert.equal(response.state.files.length, 1, 'ไฟล์เดียว');
  assert.equal(response.state.headers['Content-Type'], 'application/pdf');
  assert.match(response.state.headers['Content-Disposition'], /filename="batch_itemfulfillment_3\.pdf"/);

  assert.equal(render.calls.xmlToPdf.length, 1, 'รวมครั้งเดียวเป็น <pdfset> เดียว');
  const set = render.calls.xmlToPdf[0].xmlString;
  assert.equal((set.match(/<pdf>/g) || []).length, 6, '3 ใบ × 2 สำเนา');

  const audit = log.entries.find((e) => e.level === 'audit');
  assert.equal(audit.details.printed, 3);
  assert.equal(audit.details.failed, 0);
  assert.equal(audit.details.copies, 2);
});

test('ทุกใบวิ่งผ่าน render core ตัวเดียวกับปุ่ม Print — ป้ายสำเนาถูกต้องทุกใบ', () => {
  const { suitelet, render } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context } = printRequest(['11', '12']);

  suitelet.onRequest(context);

  const labels = render.calls.dataSources.filter((d) => d.alias === 'copy').map((d) => d.data.th);
  assert.deepEqual(labels, ['ต้นฉบับ', 'สำเนา', 'ต้นฉบับ', 'สำเนา']);
});

// ─── ไม่ครบ ──────────────────────────────────────────────────────────────────

test('ใบเดียวพังไม่ล้มทั้งชุด — ได้หน้าสรุปแทน PDF ที่ขาดใบ', () => {
  const { suitelet, log } = buildBatch({ documents: DOCS, templates: TEMPLATES, failIds: ['12'] });
  const { context, response } = printRequest(['11', '12', '13']);

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.equal(response.state.files.length, 0, 'ห้ามส่ง PDF ที่ขาดใบไปเงียบ ๆ (R4)');
  assert.match(response.state.headers['Content-Type'], /text\/html/);
  assert.match(body, /พิมพ์เป็นชุดไม่ครบ/);
  assert.match(body, /สร้างสำเร็จ 2 ใบ/);
  assert.match(body, /ล้มเหลว 1 ใบ/);
  assert.match(body, /This record does not exist: 12/, 'บอกด้วยว่าใบไหนและเพราะอะไร');
  assert.match(body, /PLD-[a-z0-9]+-[a-z0-9]+/, 'มีรหัสอ้างอิงให้แจ้งทีม');
  assert.doesNotMatch(body, /\bstack\b/i, 'stack ห้ามโผล่หน้าจอ (#157)');
  assert.match(body, /พิมพ์ 2 ใบที่สร้างสำเร็จ/, 'พิมพ์ต่อได้โดยไม่ต้องเริ่มใหม่ทั้งหมด');

  const errors = log.entries.filter((e) => e.level === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].details.recid, '12');
  assert.ok(errors[0].details.stack.length > 0, 'stack อยู่ใน log');
});

test('โควตาใกล้หมดแล้วหยุดเอง พร้อมบอกว่าเหลือกี่ใบ — วัด usage จริงต่อใบ', () => {
  // ใบละ 400 units (1000 → 600 → 250) — ก่อนใบที่สาม เหลือ 250 ซึ่งน้อยกว่า
  // 400 (ต้นทุนที่วัดได้ต่อใบ) + 100 (สำรองไว้รวมไฟล์) จึงต้องหยุดตรงนั้น
  const budget = [1000, 600, 600, 250, 250];
  let i = 0;
  const { suitelet, log } = buildBatch({
    documents: DOCS,
    templates: TEMPLATES,
    usage: () => (i < budget.length ? budget[i++] : 400),
  });
  const { context, response } = printRequest(['11', '12', '13']);

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.equal(response.state.files.length, 0);
  assert.match(body, /สร้างสำเร็จ 2 ใบ/);
  assert.match(body, /ยังไม่ได้พิมพ์ 1 ใบ/);
  assert.match(body, /ประมาณ 400 units ต่อใบ/, 'ตัวเลขมาจากการวัด ไม่ใช่ค่าคงที่');
  assert.match(body, /พิมพ์ 1 ใบที่เหลือ/);

  const audit = log.entries.find((e) => e.level === 'audit');
  assert.equal(audit.details.pending, 1);
  assert.equal(audit.details.partial, true);
});

test('ใบแรกได้สิทธิ์ลองเสมอ แม้โควตาที่เหลือจะดูน้อย', () => {
  const { suitelet, render } = buildBatch({
    documents: DOCS, templates: TEMPLATES, usage: () => 120,
  });
  const { context } = printRequest(['11', '12']);

  suitelet.onRequest(context);

  assert.ok(render.calls.dataSources.length > 0, 'ต้องได้ลองใบแรกก่อนจะบอกว่าไม่ไหว');
});

// ─── ล้มทั้งคำสั่ง ────────────────────────────────────────────────────────────

test('ไม่ได้ติ๊กใบไหนเลย — บอกเป็นภาษาไทย ไม่ใช่ JSON ดิบ', () => {
  const { suitelet } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context, response } = printRequest([]);

  suitelet.onRequest(context);

  assert.match(response.state.headers['Content-Type'], /text\/html/);
  assert.match(response.state.body, /ยังไม่ได้เลือกเอกสารที่จะพิมพ์/);
});

test('ไม่มี template ของประเภทนี้ = error ที่เห็นได้ ไม่ใช่ PDF เปล่า (R4)', () => {
  const { suitelet, log } = buildBatch({ documents: DOCS, templates: [] });
  const { context, response } = printRequest(['11']);

  suitelet.onRequest(context);

  assert.equal(response.state.files.length, 0);
  assert.match(response.state.body, /พิมพ์เป็นชุดไม่สำเร็จ/);
  assert.match(response.state.body, /No template found/);
  const shown = response.state.body.match(/PLD-[a-z0-9]+-[a-z0-9]+/)[0];
  const error = log.entries.find((e) => e.level === 'error');
  assert.equal(error.details.errorId, shown, 'รหัสบนหน้าจอกับใน log เป็นตัวเดียวกัน');
  assert.equal(error.details.stage, 'load-template');
});

// ─── บั๊กที่ QA บน SB2 จับได้ (2026-07-25) ─────────────────────────────────────

test('id ที่ติ๊กไว้ส่งเป็นฟิลด์เดียว — checkbox ชื่อซ้ำถึง Suitelet แค่ค่าแรก', () => {
  // อาการจริงบน SB2: สั่งพิมพ์ 25 ใบแล้วได้ PDF ใบเดียว โดยสคริปต์เข้าใจว่าครบแล้ว
  // (จึงไม่ขึ้นหน้าสรุปด้วย) เพราะ request.parameters.docid ของ field ที่ซ้ำชื่อกัน
  // คืนมาแค่ค่าแรก
  const { suitelet } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context, response } = contextStub({ parameters: { rectype: 'itemfulfillment' } });

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.match(body, /name="docids"/, 'ส่งเป็นฟิลด์เดียวคั่นจุลภาค');
  assert.ok(body.indexOf('name="docid"') === -1, 'ห้ามมี field ชื่อซ้ำกันหลายตัวอีก');
  assert.match(body, /hidden\.value\s*=\s*ids\.join\(","\)/, 'หน้าจอรวมค่าที่ติ๊กตอน submit');
});

test('เอกสารที่ resolve เป็น XML เสีย ถูกรายงานเป็นใบที่ล้ม ไม่ล้มทั้งชุด (#184)', () => {
  // เคสจริงบน SB2: คำอธิบายสินค้ามี & แล้ว template bind โดยไม่ผ่าน ?xml → เอกสาร
  // ใบนั้น resolve เป็น XML ที่ parse ไม่ผ่าน ถ้าไม่จับตรงนี้ ตัวที่พังคือขั้นตอน
  // รวมไฟล์ ซึ่งอยู่นอก try ของแต่ละใบ = ทั้งชุดล่มโดยไม่รู้ว่าใบไหนเป็นต้นเหตุ
  const { suitelet, log } = buildBatch({
    documents: DOCS,
    templates: TEMPLATES,
    // 2 สำเนาต่อใบ → pass 2,3 คือใบที่สอง
    asString: (i) => (i === 2 || i === 3
      ? '<pdf><body>Laser & Inkjet</body></pdf>'
      : '<pdf><body>ok</body></pdf>'),
  });
  const { context, response } = printRequest(['11', '12', '13']);

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.equal(response.state.files.length, 0);
  assert.match(body, /สร้างสำเร็จ 2 ใบ/);
  assert.match(body, /ล้มเหลว 1 ใบ/);
  assert.match(body, /BFO อ่านไม่ได้/);
  assert.match(body, /#184/, 'บอกสาเหตุที่พบบ่อยให้ผู้ดูแลระบบตามต่อได้');
  assert.equal(log.entries.filter((e) => e.level === 'error')[0].details.recid, '12');
});

test('ยอดเงินในตารางจัดรูปให้อ่านออก — search คืนค่าดิบ', () => {
  const { suitelet } = buildBatch({
    documents: [{ id: '11', values: { tranid: 'INV-1', trandate: '25/7/2026', total: '53.261' } }],
    templates: TEMPLATES,
  });
  const { context, response } = contextStub({ parameters: { rectype: 'invoice' } });

  suitelet.onRequest(context);

  assert.match(response.state.body, /53\.26/);
  assert.ok(response.state.body.indexOf('53.261') === -1, 'ไม่โชว์ค่าดิบจาก search');
});

// ─── ส่งชุดใหญ่เข้าคิว Map/Reduce (#181) ──────────────────────────────────────

function queueRequest(ids, extra = {}) {
  return contextStub({
    method: 'POST',
    parameters: Object.assign(
      { action: 'queue', rectype: 'itemfulfillment', docids: ids.join(',') },
      extra,
    ),
  });
}

test('ชุดใหญ่ถูกส่งเป็น job ให้ Map/Reduce พร้อมรายการเอกสารครบ', () => {
  const { suitelet, openSnapshot, files, task } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const ids = ['11', '12', '13', '14', '15', '16', '17', '18'];
  const { context, response } = queueRequest(ids, { tplid: '7' });

  suitelet.onRequest(context);

  const jobFile = files.created.find((f) => /^pld_job_/.test(f.name));
  assert.ok(jobFile, 'ต้องเขียน job spec ลง File Cabinet');
  const job = openSnapshot(jobFile.contents);
  assert.deepEqual(job.ids, ids, 'รายการเอกสารต้องครบ — parameter เดียวใส่ไม่พอสำหรับชุดใหญ่');
  assert.equal(job.rectype, 'itemfulfillment');
  assert.equal(job.tplid, '7');
  assert.ok(job.requester.id, 'ต้องรู้ว่าใครสั่ง เพื่ออีเมลผลกลับ');

  assert.equal(task.submitted.length, 1);
  assert.equal(task.submitted[0].taskType, 'MAP_REDUCE');
  assert.equal(task.submitted[0].scriptId, 'customscript_pld_batch_mr');
  assert.equal(task.submitted[0].params.custscript_pld_mr_job, job.jobId,
    'MR ต้องได้ file id ของ job spec');

  assert.equal(response.state.files.length, 0, 'หน้าจอไม่รอผล — ไม่มี PDF ตรงนี้');
  assert.match(response.state.body, /ส่งเข้าคิวแล้ว/);
  assert.match(response.state.body, /501/, 'บอกหมายเลขงานให้ตามต่อได้');
});

test('ไม่มี template = ไม่ส่งงานเข้าคิว (ไม่งั้น map พังทีละใบทั้งชุด)', () => {
  const { suitelet, task } = buildBatch({ documents: DOCS, templates: [] });
  const { context, response } = queueRequest(['11', '12']);

  suitelet.onRequest(context);

  assert.equal(task.submitted.length, 0);
  assert.match(response.state.body, /No template found/);
});

test('เกินเพดานต่อหนึ่ง job = บอกให้แบ่งส่ง ไม่ใช่ตัดให้เงียบ ๆ', () => {
  const { suitelet, task } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const many = [];
  for (let i = 0; i < 501; i += 1) many.push(String(1000 + i));
  const { context, response } = queueRequest(many);

  suitelet.onRequest(context);

  assert.equal(task.submitted.length, 0);
  assert.match(response.state.body, /ไม่เกิน 500 ใบ/);
  assert.match(response.state.body, /501/);
});

test('queue creates a fresh private job folder before saving snapshot', () => {
  const { suitelet, openSnapshot, files, rows } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  suitelet.onRequest(queueRequest(['11', '12']).context);
  assert.equal(rows.get('502').isprivate, true);
  assert.equal(rows.get('502').owner, 9);
  assert.equal(rows.get('502').parent, 55);
  assert.equal(files.created[0].folder, '502');
  assert.equal(rows.get('501').custrecord_pld_job_snapshot, files.created[0].id);
});

test('ปุ่มส่งเข้าคิวอยู่บนหน้าจอ และสลับปลายทางผ่าน hidden field เดียว', () => {
  const { suitelet } = buildBatch({ documents: DOCS, templates: TEMPLATES });
  const { context, response } = contextStub({ parameters: { rectype: 'itemfulfillment' } });

  suitelet.onRequest(context);
  const body = response.state.body;

  assert.match(body, /ส่งเข้าคิว \(ชุดใหญ่\)/);
  assert.equal((body.match(/name="action"/g) || []).length, 1,
    'ปลายทางต้องมาจาก field เดียว — field ชื่อซ้ำส่งถึง Suitelet แค่ค่าแรก');
  assert.match(body, /act\.value="queue"/);
});


test('queue freezes server-resolved XML and copies, ignoring request snapshot fields', () => {
  const { suitelet, openSnapshot, files } = buildBatch({ templates: TEMPLATES });
  const { context } = queueRequest(['11'], {
    templateSnapshot: JSON.stringify({ xml: '<pdf>injected</pdf>', copies: [] }),
    xml: '<pdf>injected</pdf>', copies: '[]', schemaVersion: '1',
  });
  suitelet.onRequest(context);
  const job = openSnapshot(files.created.find((f) => /^pld_job_/.test(f.name)).contents);
  assert.equal(job.schemaVersion, 4);
  assert.equal(job.templateSnapshot.xml, TPL_XML);
  assert.deepEqual(job.templateSnapshot.copies, JSON.parse(TWO_COPIES).copies);
});

test('task submission failure deletes job spec and reports the failure', () => {
  const { suitelet, openSnapshot, files, task } = buildBatch({ templates: TEMPLATES });
  task.module.create = () => ({ submit() { throw new Error('QUEUE_FULL'); } });
  const { context, response } = queueRequest(['11']);
  suitelet.onRequest(context);
  const job = files.created.find((f) => /^pld_job_/.test(f.name));
  assert.ok(files.deleted.includes(job.id));
  assert.match(response.state.body, /QUEUE_FULL/);
  assert.doesNotMatch(response.state.body, /ส่งเข้าคิวแล้ว/);
});

test('oversized resolved template is rejected before queue file creation', () => {
  const oversized = [{ id: '7', values: { custrecord_pld_tpl_xml: 'x'.repeat(1000001), custrecord_pld_tpl_data: TWO_COPIES } }];
  const { suitelet, openSnapshot, files, task } = buildBatch({ templates: oversized });
  const { context, response } = queueRequest(['11']);
  suitelet.onRequest(context);
  assert.equal(files.created.length, 0);
  assert.equal(task.submitted.length, 0);
  assert.match(response.state.body, /1000000/);
});


test('queue accepts a valid saved template larger than the former snapshot cap', () => {
  const largeXml = '<pdf><body>' + 'ก'.repeat(989900) + '</body></pdf>';
  const templates = [{ id: '7', values: { custrecord_pld_tpl_xml: largeXml, custrecord_pld_tpl_data: JSON.stringify({ copies: [{ th: 'สำเนา', en: '' }] }) } }];
  const { suitelet, openSnapshot, files, task } = buildBatch({ templates });
  suitelet.onRequest(queueRequest(['11']).context);
  const job = openSnapshot(files.created.find((f) => /^pld_job_/.test(f.name)).contents);
  assert.equal(job.templateSnapshot.xml, largeXml);
  assert.equal(job.templateSnapshot.copies[0].th, 'สำเนา');
  assert.equal(task.submitted.length, 1);
});


test('immediate and queued print reject 21 copies before render work or job creation', () => {
  const templates = [{ id: '7', values: { custrecord_pld_tpl_xml: TPL_XML, custrecord_pld_tpl_data: JSON.stringify({ copies: Array(21).fill({ th: 'สำเนา' }) }) } }];
  for (const request of [printRequest, queueRequest]) {
    const { suitelet, openSnapshot, files, render, task } = buildBatch({ templates });
    const { context, response } = request(['11']);
    suitelet.onRequest(context);
    assert.match(response.state.body, /20/);
    assert.match(response.state.body, /render execution limit/);
    assert.equal(render.calls.created, 0);
    assert.equal(files.created.length, 0);
    assert.equal(task.submitted.length, 0);
  }
});

test('enqueue pre-submit failures persist FAILED and only clean authorized snapshots', () => {
  for (const stage of ['create', 'save', 'readback', 'metadata']) {
    const f = buildBatch({ templates: TEMPLATES });
    const create = f.files.module.create;
    const load = f.files.module.load;
    const submit = f.stubs['N/record'].submitFields;
    if (stage === 'create') f.files.module.create = () => { throw new Error('snapshot create failure'); };
    if (stage === 'save') f.files.module.create = (opts) => ({ ...create(opts), save() { throw new Error('snapshot save failure'); } });
    if (stage === 'readback') {
      let failed = false;
      f.files.module.load = (opts) => {
        if (opts.id === '1000' && !failed) { failed = true; throw new Error('snapshot readback failure'); }
        return load(opts);
      };
    }
    if (stage === 'metadata') f.stubs['N/record'].submitFields = (opts) => {
      if (opts.values.custrecord_pld_job_snapshot) throw new Error('snapshot metadata failure');
      return submit(opts);
    };
    const ctx = queueRequest(['11']); f.suitelet.onRequest(ctx.context);
    assert.equal(f.task.submitted.length, 0, stage);
    assert.equal(f.rows.get('501').custrecord_pld_job_status, 'FAILED', stage);
    assert.match(ctx.response.state.body, new RegExp('snapshot ' + stage + ' failure'));
    assert.equal(f.files.deleted.length, ['readback', 'metadata'].includes(stage) ? 1 : 0, stage);
  }
});

test('enqueue preserves original failure when state persistence and cleanup also fail', () => {
  const f = buildBatch({ templates: TEMPLATES });
  const submit = f.stubs['N/record'].submitFields;
  f.stubs['N/record'].submitFields = (opts) => {
    if (opts.values.custrecord_pld_job_status === 'FAILED') throw new Error('state unavailable');
    return submit(opts);
  };
  f.task.module.create = () => ({ submit() { throw new Error('QUEUE_FULL original'); } });
  f.files.module.delete = () => { throw new Error('cleanup unavailable'); };
  const ctx = queueRequest(['11']); f.suitelet.onRequest(ctx.context);
  assert.match(ctx.response.state.body, /QUEUE_FULL original/);
  assert.doesNotMatch(ctx.response.state.body, /cleanup unavailable|state unavailable/);
  assert.ok(f.log.entries.some((e) => e.title === 'PLD queue failure state unavailable'));
  assert.ok(f.log.entries.some((e) => e.title === 'PLD queue job cleanup failed'));
});

test('accepted task with task metadata persistence failure keeps snapshot and shows tracking warning', () => {
  const f = buildBatch({ templates: TEMPLATES });
  const submit = f.stubs['N/record'].submitFields;
  f.stubs['N/record'].submitFields = (opts) => {
    if (opts.values.custrecord_pld_job_task) throw new Error('task persistence unavailable');
    return submit(opts);
  };
  const ctx = queueRequest(['11']); f.suitelet.onRequest(ctx.context);
  assert.equal(f.task.submitted.length, 1);
  assert.equal(f.files.deleted.length, 0);
  assert.equal(f.rows.get('501').custrecord_pld_job_status, 'QUEUED');
  assert.equal(f.rows.get('501').custrecord_pld_job_snapshot, '1000');
  assert.match(ctx.response.state.body, /ส่งเข้าคิวแล้ว/);
  assert.match(ctx.response.state.body, /ไม่ต้องส่งซ้ำ/);
  assert.match(ctx.response.state.body, /action=status.*job=501/);
});

test('snapshot save rechecks folder privacy after file construction and cleanup rejects moved file', () => {
  for (const move of [false, true]) {
    const f = buildBatch({ templates: TEMPLATES });
    const create = f.files.module.create;
    f.files.module.create = (opts) => {
      const out = create(opts);
      if (!move) f.rows.get('502').isprivate = false;
      else {
        const save = out.save;
        out.save = () => { const id = save(); f.files.created[0].folder = '999'; return id; };
      }
      return out;
    };
    const ctx = queueRequest(['11']); f.suitelet.onRequest(ctx.context);
    assert.equal(f.task.submitted.length, 0);
    assert.equal(f.files.created.length, move ? 1 : 0);
    assert.equal(f.files.deleted.length, 0);
    assert.equal(f.rows.get('501').custrecord_pld_job_status, 'FAILED');
    assert.match(ctx.response.state.body, move ? /storage mismatch/ : /privacy\/owner\/parent/);
  }
});

test('enqueue rejects changed native folder or parent references before saving to allocated folder', () => {
  for (const changedField of ['folder', 'parent']) {
    const f = buildBatch({ templates: TEMPLATES });
    const create = f.files.module.create;
    f.files.module.create = (opts) => {
      const snapshot = create(opts);
      // Native metadata changed after JSON and file allocation: the alternate
      // folder remains private and caller-owned, so privacy alone is insufficient.
      f.rows.set('503', { owner: 9, parent: 55, isprivate: true });
      f.rows.get('501')['custrecord_pld_job_' + changedField] = changedField === 'folder' ? '503' : '99';
      if (changedField === 'parent') f.rows.get('502').parent = 99;
      return snapshot;
    };
    const ctx = queueRequest(['11']); f.suitelet.onRequest(ctx.context);
    assert.equal(f.files.created.length, 0, changedField);
    assert.equal(f.task.submitted.length, 0, changedField);
    assert.equal(f.rows.get('501').custrecord_pld_job_status, 'PREPARING');
    assert.match(ctx.response.state.body, /integrity mismatch/);
    // Native tampering invalidates the entire state; the catch must not reseal it.
  }
});

test('queued snapshot is authenticated and in-place XML tampering invalidates it', () => {
  const f = buildBatch({ templates: TEMPLATES });
  f.suitelet.onRequest(queueRequest(['11']).context);
  const saved = f.files.created[0].contents;
  assert.equal(f.openSnapshot(saved).schemaVersion, 4);
  const altered = saved.replace('<body>ok</body>', '<body>injected</body>');
  assert.notEqual(saved, altered);
  assert.throws(() => f.openSnapshot(altered), /integrity|authentication/i);
});

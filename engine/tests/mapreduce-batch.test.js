/**
 * pld_mr_batch_print — พิมพ์เป็นชุดขนาดใหญ่ผ่าน Map/Reduce (#181)
 *
 * สัญญาที่ test ชุดนี้ตรึงไว้:
 *  - หนึ่งเอกสาร = หนึ่ง key (map ได้ 1,000 units ต่อ key ชุดใหญ่จึงไม่ชนโควตา)
 *  - ลำดับเอกสารในไฟล์รวมต้องตรงกับที่ผู้ใช้เลือก
 *  - ใบที่พังต้องถูกรายงานรายใบ ไม่ใช่หายไปจากชุดเงียบ ๆ (R4)
 *  - ไฟล์ชั่วคราวต้องไม่ค้างใน File Cabinet
 *  - อีเมลแจ้งผลส่งไม่ออก ต้องไม่ทำให้ไฟล์ที่สร้างแล้วสูญไปด้วย
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAmd } = require('./helpers/amd');
const {
  logStub, companyConfigStub, runtimeStub, renderStub, formatStub, fileSystemStub,
} = require('./helpers/ns-stubs');

const TPL_XML = '<pdf><body>ok</body></pdf>';
const TWO_COPIES = JSON.stringify({ copies: [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }] });

const JOB = {
  jobId: 'j1',
  rectype: 'itemfulfillment',
  tplid: '7',
  ids: ['11', '12', '13'],
  folder: '77',
  requester: { id: '9', name: 'QA Tester', email: 'qa@example.test' },
};

/**
 * @param {Object} opts
 * @param {Object} opts.job        job spec (null → ไม่มี parameter)
 * @param {Array}  opts.failIds    record ids ที่ record.load พัง
 * @param {boolean} opts.emailFails  ให้ email.send โยน error
 */
function buildMr({ job = JOB, failIds = [], emailFails = false } = {}) {
  const log = logStub();
  const files = fileSystemStub({
    files: job ? { '900': { getContents: () => JSON.stringify(job) } } : {},
  });
  const render = renderStub({ fileSystem: files });
  const emails = [];
  const stubs = {
    'N/file': files.module,
    'N/render': render.module,
    'N/runtime': runtimeStub({ script: { getParameter: () => (job ? '900' : '') } }),
    'N/log': log.module,
    'N/email': {
      send(opts) {
        emails.push(opts);
        if (emailFails) throw new Error('SSS_MISSING_REQD_ARGUMENT: author');
      },
    },
    'N/url': { HostType: { APPLICATION: 'APPLICATION' }, resolveDomain: () => 'acct.app.netsuite.com' },
    'N/format': formatStub,
    'N/search': { create: () => ({ run: () => ({ getRange: () => [], each: () => {} }) }) },
    'N/record': {
      Type: {},
      load: ({ id }) => {
        if (failIds.indexOf(String(id)) !== -1) throw new Error('This record does not exist: ' + id);
        return {
          id,
          getValue: ({ fieldId }) => {
            if (fieldId === 'tranid') return 'IF-' + id;
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
      docTitles: {},
    },
  };
  return { mr: loadAmd('./pld_mr_batch_print', stubs), log, render, files, emails };
}

/** map context ที่จดสิ่งที่ถูก write ออกไป */
function mapContext(entry) {
  const written = [];
  return { written, context: { value: JSON.stringify(entry), write: (kv) => written.push(kv) } };
}

/** summary object ของ Map/Reduce (output + error iterator) */
function summaryStub({ output = [], errors = [] } = {}) {
  return {
    seconds: 42,
    usage: 1234,
    output: { iterator: () => ({ each: (fn) => { output.every(([k, v]) => fn(k, v) !== false); } }) },
    mapSummary: {
      errors: { iterator: () => ({ each: (fn) => { errors.every(([k, e]) => fn(k, e) !== false); } }) },
    },
  };
}

// ─── getInputData ────────────────────────────────────────────────────────────

test('หนึ่งเอกสาร = หนึ่ง key — map จึงได้โควตาเต็มต่อใบ', () => {
  const { mr } = buildMr();

  const entries = Array.from(mr.getInputData()).map((e) => ({ ...e }));

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.recid), ['11', '12', '13']);
  assert.deepEqual(entries.map((e) => e.seq), [0, 1, 2]);
  assert.equal(entries[0].rectype, 'itemfulfillment');
  assert.equal(entries[0].folder, '77');
});

test('ไม่มี job parameter = ล้มตั้งแต่ต้น ไม่ใช่จบด้วย "สำเร็จ 0 ใบ"', () => {
  const { mr } = buildMr({ job: null });

  assert.throws(() => mr.getInputData(), /job file/);
});

// ─── map ─────────────────────────────────────────────────────────────────────

test('map เขียน XML ของใบตัวเองเป็นไฟล์ชั่วคราว แล้วส่งต่อแค่ file id', () => {
  const { mr, files } = buildMr();
  const { written, context } = mapContext({
    seq: 2, recid: '13', jobId: 'j1', rectype: 'itemfulfillment', tplid: '7', folder: '77',
  });

  mr.map(context);

  const part = files.created[0];
  assert.match(part.name, /^pld_part_j1_000002\.txt$/);
  assert.equal(part.folder, '77');
  assert.equal(part.encoding, 'UTF-8', 'ข้อความไทยใน XML ต้องไม่เพี้ยนตอนอ่านกลับ');
  assert.equal((part.contents.match(/<pdf>/g) || []).length, 2, 'สองสำเนาอยู่ในไฟล์เดียวของใบนี้');

  assert.equal(written.length, 1);
  assert.equal(written[0].key, '000002', 'key ต้องเรียงแบบสตริงได้');
  assert.equal(JSON.parse(written[0].value).partId, part.id);
});

test('ใบที่ render ไม่ได้ ต้องโยน error ให้ Map/Reduce จดเป็นความล้มเหลวของ key นั้น', () => {
  const { mr } = buildMr({ failIds: ['12'] });
  const { context } = mapContext({
    seq: 1, recid: '12', jobId: 'j1', rectype: 'itemfulfillment', tplid: '7', folder: '77',
  });

  assert.throws(() => mr.map(context), /does not exist: 12/);
});

// ─── summarize ───────────────────────────────────────────────────────────────

function partValue(files, seq, recid, contents) {
  const id = files.module.create({
    name: 'pld_part_j1_' + seq, fileType: 'PLAINTEXT', contents, folder: '77',
  }).save();
  return JSON.stringify({ partId: id, recid: recid, tranId: 'IF-' + recid });
}

test('รวมเป็นไฟล์เดียวตามลำดับที่ผู้ใช้เลือก แล้วลบไฟล์ชั่วคราวทิ้ง', () => {
  const { mr, render, files, emails } = buildMr();
  const a = partValue(files, '000000', '11', '<pdf>A</pdf>');
  const b = partValue(files, '000001', '12', '<pdf>B</pdf>');
  const c = partValue(files, '000002', '13', '<pdf>C</pdf>');
  // iterator ของ Map/Reduce ไม่รับประกันลำดับ — จงใจสลับ
  const summary = summaryStub({ output: [['000002', c], ['000000', a], ['000001', b]] });

  mr.summarize(summary);

  assert.equal(render.calls.xmlToPdf.length, 1, 'รวมครั้งเดียว');
  const set = render.calls.xmlToPdf[0].xmlString;
  assert.ok(set.indexOf('<pdf>A</pdf>') < set.indexOf('<pdf>B</pdf>'), 'ลำดับต้องตาม key');
  assert.ok(set.indexOf('<pdf>B</pdf>') < set.indexOf('<pdf>C</pdf>'));

  const pdf = files.created.find((f) => /\.pdf$/.test(f.name || ''));
  assert.ok(!pdf, 'ไฟล์ PDF มาจาก render ไม่ใช่ file.create');
  assert.equal(files.deleted.length, 4, 'ลบ part ทั้งสาม + job spec');

  assert.equal(emails.length, 1);
  assert.match(emails[0].body, /สร้างสำเร็จ: 3 ใบ/);
  assert.match(emails[0].body, /https:\/\/acct\.app\.netsuite\.com\/core\/media/, 'ลิงก์ไฟล์กดได้จากอีเมล');
});

test('ใบที่พังถูกรายงานรายใบในอีเมล พร้อมสาเหตุ', () => {
  const { mr, files, emails } = buildMr();
  const a = partValue(files, '000000', '11', '<pdf>A</pdf>');
  const summary = summaryStub({
    output: [['000000', a]],
    errors: [['000001', JSON.stringify({ message: 'This record does not exist: 12' })]],
  });

  mr.summarize(summary);

  assert.match(emails[0].body, /สร้างสำเร็จ: 1 ใบ/);
  assert.match(emails[0].body, /ล้มเหลว: 1 ใบ/);
  assert.match(emails[0].body, /This record does not exist: 12/);
  assert.match(emails[0].subject, /1\/3 ใบ/, 'หัวเรื่องบอกสัดส่วนที่ได้จริง');
});

test('อีเมลส่งไม่ออก ไม่ทำให้ไฟล์ที่สร้างแล้วหายไปด้วย', () => {
  const { mr, log, render, files } = buildMr({ emailFails: true });
  const a = partValue(files, '000000', '11', '<pdf>A</pdf>');

  mr.summarize(summaryStub({ output: [['000000', a]] }));

  assert.equal(render.calls.xmlToPdf.length, 1, 'ไฟล์รวมยังถูกสร้าง');
  const errors = log.entries.filter((e) => e.level === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].title, /ส่งอีเมลแจ้งผลไม่สำเร็จ/);
  const audit = log.entries.filter((e) => e.level === 'audit').pop();
  assert.equal(audit.details.printed, 1, 'ผลลัพธ์ยังถูกบันทึกไว้ใน log');
});

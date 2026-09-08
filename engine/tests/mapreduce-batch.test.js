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
  schemaVersion: 2,
  templateSnapshot: { xml: TPL_XML, copies: JSON.parse(TWO_COPIES).copies },
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


test('oversize job fails before any map inputs are returned', () => {
  const { mr } = buildMr({ job: { ...JOB, ids: Array(501).fill('11') } });
  assert.throws(() => mr.getInputData(), /500/);
});

test('merge failure cleans parts and spec, notifies zero printed, and remains a failed job', () => {
  const { mr, render, files, emails } = buildMr();
  const a = partValue(files, '000000', '11', '<pdf>A</pdf>');
  render.module.xmlToPdf = () => { throw new Error('BFO merge failed'); };
  assert.throws(() => mr.summarize(summaryStub({ output: [['000000', a]] })), /BFO merge failed/);
  assert.equal(files.deleted.length, 2);
  assert.match(emails[0].body, /สร้างสำเร็จ: 0 ใบ/);
  assert.match(emails[0].body, /ล้มเหลว: 3 ใบ/);
  assert.match(emails[0].body, /BFO merge failed/);
});

test('input-stage failure is reported and cleaned instead of success zero', () => {
  const { mr, files, emails } = buildMr();
  const summary = summaryStub();
  summary.inputSummary = { error: 'input failure' };
  assert.throws(() => mr.summarize(summary), /input failure/);
  assert.deepEqual(files.deleted, ['900']);
  assert.match(emails[0].body, /input failure/);
  assert.match(emails[0].subject, /0\/3/);
});

test('aggregate UTF-8 limit accounts for Thai and aborts merge with cleanup', () => {
  const { mr, render, files, emails } = buildMr();
  const a = partValue(files, '000000', '11', '<pdf>' + 'ก'.repeat(1500000) + '</pdf>');
  const b = partValue(files, '000001', '12', '<pdf>' + 'ก'.repeat(1500000) + '</pdf>');
  assert.throws(() => mr.summarize(summaryStub({ output: [['000000', a], ['000001', b]] })), /8 MiB/);
  assert.equal(render.calls.xmlToPdf.length, 0);
  assert.equal(files.deleted.length, 3);
  assert.match(emails[0].body, /8 MiB/);
});

test('failed map output write deletes its already saved part', () => {
  const { mr, files } = buildMr();
  const { context } = mapContext({ seq: 0, recid: '11', jobId: 'j1', rectype: 'itemfulfillment', tplid: '7', folder: '77' });
  context.write = () => { throw new Error('output failure'); };
  assert.throws(() => mr.map(context), /output failure/);
  assert.equal(files.deleted.length, 1);
  assert.equal(files.deleted[0], files.created[0].id);
});


test('known oversized part is rejected before reading contents into memory', () => {
  const { mr, files } = buildMr();
  const originalLoad = files.module.load;
  let contentReads = 0;
  files.module.load = (options) => options.id === 'large' ? {
    size: 8 * 1024 * 1024 + 1,
    getContents() { contentReads++; throw new Error('must not read'); },
  } : originalLoad(options);
  const output = [['000000', JSON.stringify({ partId: 'large', recid: '11' })]];
  assert.throws(() => mr.summarize(summaryStub({ output })), /8 MiB/);
  assert.equal(contentReads, 0);
  assert.ok(files.deleted.includes('large'));
});


test('unreadable job spec still cleans all known output parts', () => {
  for (const contents of [null, '{broken']) {
    const { mr, files } = buildMr();
    const a = partValue(files, '000000', '11', '<pdf>A</pdf>');
    const b = partValue(files, '000001', '12', '<pdf>B</pdf>');
    const originalLoad = files.module.load;
    files.module.load = (options) => {
      if (options.id !== '900') return originalLoad(options);
      if (contents === null) throw new Error('Job spec missing');
      return { getContents: () => contents };
    };
    assert.throws(() => mr.summarize(summaryStub({ output: [['000000', a], ['000001', b]] })));
    assert.equal(files.deleted.length, 3);
    assert.ok(files.deleted.includes(JSON.parse(a).partId));
    assert.ok(files.deleted.includes(JSON.parse(b).partId));
  }
});

test('malformed output does not prevent later valid parts from being cleaned', () => {
  const { mr, files, emails, render } = buildMr();
  const a = partValue(files, '000000', '11', '<pdf>A</pdf>');
  const b = partValue(files, '000002', '13', '<pdf>B</pdf>');
  const output = [['000000', a], ['000001', '{broken'], ['000002', b]];
  assert.throws(() => mr.summarize(summaryStub({ output })), /Invalid batch output/);
  assert.equal(files.deleted.length, 3);
  assert.equal(render.calls.xmlToPdf.length, 0);
  assert.match(emails[0].body, /Invalid batch output/);
});

test('saved PDF survives failed URL lookup with file ID reported for recovery', () => {
  const { mr, files, emails, log } = buildMr();
  const a = partValue(files, '000000', '11', '<pdf>A</pdf>');
  const partId = JSON.parse(a).partId;
  const originalLoad = files.module.load;
  files.module.load = (options) => {
    if (options.id !== '900' && options.id !== partId) throw new Error('URL lookup failed');
    return originalLoad(options);
  };
  mr.summarize(summaryStub({ output: [['000000', a]] }));
  const audit = log.entries.filter((e) => e.level === 'audit').pop();
  assert.equal(audit.details.printed, 1);
  assert.ok(audit.details.pdfId);
  assert.ok(!files.deleted.includes(audit.details.pdfId));
  assert.match(emails[0].body, /สร้างสำเร็จ: 1 ใบ/);
  assert.ok(emails[0].body.includes('file ID: ' + audit.details.pdfId));
  assert.ok(log.entries.some((e) => e.title === 'PLD batch PDF link unavailable'));
});


test('legacy queued jobs fail visibly without resolving a mutable template', () => {
  const { schemaVersion, templateSnapshot, ...legacy } = JOB;
  const { mr, files, emails } = buildMr({ job: legacy });
  assert.throws(() => mr.getInputData(), /template snapshot/);
  const summary = summaryStub();
  summary.inputSummary = { error: 'งานคิวรุ่นเก่าไม่มี template snapshot — ส่งงานใหม่' };
  assert.throws(() => mr.summarize(summary), /template snapshot/);
  assert.match(emails[0].body, /ส่งงานใหม่/);
  assert.ok(files.deleted.includes('900'));
});

test('workers use frozen enqueue XML and copy labels even when template is unavailable', () => {
  const frozen = { xml: '<pdf><body>Frozen</body></pdf>', copies: [{ th: 'สำเนาคงที่', en: 'Frozen copy' }] };
  const { mr, render, files } = buildMr({ job: { ...JOB, templateSnapshot: frozen }, failIds: ['7'] });
  const originalCreate = render.module.create;
  const boundXml = [];
  render.module.create = () => {
    const renderer = originalCreate();
    renderer.renderAsString = function () { boundXml.push(this.templateContent); return this.templateContent; };
    return renderer;
  };
  const entries = mr.getInputData();
  mr.map(mapContext(entries[0]).context);
  mr.map(mapContext(entries[1]).context);
  assert.deepEqual(boundXml, [frozen.xml, frozen.xml]);
  assert.deepEqual(render.calls.dataSources.filter((s) => s.alias === 'copy').map((s) => s.data.th), ['สำเนาคงที่', 'สำเนาคงที่']);
  assert.equal(files.created.length, 2);
});

test('snapshot and job metadata bounds are validated before scheduling maps', () => {
  const invalid = [
    { templateSnapshot: { ...JOB.templateSnapshot, xml: 'x'.repeat(1000001) } },
    { templateSnapshot: { ...JOB.templateSnapshot, copies: [] } },
    { templateSnapshot: { ...JOB.templateSnapshot, copies: [{ th: '', en: '' }] } },
    { templateSnapshot: { ...JOB.templateSnapshot, copies: [{ th: 123, en: 'A' }] } },
    { ids: ['invalid'] }, { folder: '-1' }, { jobId: '../other' },
  ];
  for (const change of invalid) {
    const { mr } = buildMr({ job: { ...JOB, ...change } });
    assert.throws(() => mr.getInputData(), /Invalid/);
  }
});


test('snapshot accepts established XML size and one-language copy labels', () => {
  const xml = '<pdf><body>' + 'ก'.repeat(989900) + '</body></pdf>';
  for (const copy of [{ th: 'สำเนา', en: '' }, { th: '', en: 'Copy' }, { en: 'Copy' }]) {
    const { mr, render } = buildMr({ job: { ...JOB, templateSnapshot: { xml, copies: [copy] } } });
    const entries = mr.getInputData();
    mr.map(mapContext(entries[0]).context);
    assert.equal(render.calls.renderedAsString, 1);
  }
});

test('serialized job UTF-8 budget accepts escaped XML and rejects oversize copy payload', () => {
  const xml = '<pdf>' + '\t'.repeat(989900) + '</pdf>';
  const accepted = buildMr({ job: { ...JOB, templateSnapshot: { xml, copies: [{ th: 'A' }] } } });
  assert.equal(accepted.mr.getInputData().length, 3);
  const oversized = buildMr({ job: { ...JOB, templateSnapshot: { xml: TPL_XML, copies: [{ th: 'ก'.repeat(2800000) }] } } });
  assert.throws(() => oversized.mr.getInputData(), /8 MiB/);
});


test('persisted excessive copies are rejected before scheduling or rendering', () => {
  const { mr, render } = buildMr({ job: { ...JOB, templateSnapshot: { xml: TPL_XML, copies: Array(21).fill({ en: 'Copy' }) } } });
  assert.throws(() => mr.getInputData(), /20.*render execution limit/);
  assert.throws(() => mr.map(mapContext({ seq: 0, recid: '11' }).context), /20.*render execution limit/);
  assert.equal(render.calls.created, 0);
});

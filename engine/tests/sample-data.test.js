/**
 * ข้อมูลตัวอย่าง + พรีวิวโดยไม่ต้องมี record (#191)
 *
 * คนที่เปิดดีไซเนอร์จากเมนู (ไม่ได้มาจาก transaction) ต้องออกแบบและพรีวิวผ่าน BFO จริงได้
 * เงื่อนไขที่ทำให้มันไม่กลายเป็นกับดักใหม่คือ **ตัวอย่างต้องพูดภาษาเดียวกับ engine** —
 * ถ้า sample ขาด key ที่ contract ประกาศไว้ ผู้ใช้จะออกแบบตามสิ่งที่เห็นแล้วไปพิมพ์ว่าง
 * บนเอกสารจริง ซึ่งคือ #155 ซ้ำรอบสอง เทสชุดนี้จึงผูก sample เข้ากับ contract โดยตรง
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

/** โหลด pld_lib_invoice_data ของจริง (buildSampleData ไม่แตะ SuiteQL) */
function loadInvoiceData() {
  return loadAmd('./pld_lib_invoice_data', {
    'N/query': { runSuiteQL: () => { throw new Error('buildSampleData must not query the account'); } },
    'N/record': recordStub().module,
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
  });
}

// ═══════════════════════════════════════════════════
// ตัวอย่างต้องครอบ contract ครบ
// ═══════════════════════════════════════════════════

test('ตัวอย่างมีทุก key ที่ binding contract ประกาศไว้ — ไม่มี key ไหนหายเงียบ', () => {
  const lib = loadInvoiceData();
  const sample = lib.buildSampleData('invoice');

  const missing = Array.from(lib.bindingKeys).filter(
    (key) => !Object.prototype.hasOwnProperty.call(sample, key),
  );
  assert.deepEqual(missing, [], 'key ใน contract ที่ไม่มีในตัวอย่าง');
});

test('ทุกแถวของตัวอย่างมีทุก key ของ ITEM_BINDING_KEYS (ว่างได้ แต่ต้องมี)', () => {
  const lib = loadInvoiceData();
  const rows = lib.buildSampleData('invoice').items;

  assert.ok(rows.length >= 2, 'ต้องมีหลายแถวให้เห็นว่าตารางขึ้นบรรทัดอย่างไร');
  for (const row of rows) {
    const missing = Array.from(lib.itemBindingKeys).filter(
      (key) => !Object.prototype.hasOwnProperty.call(row, key),
    );
    assert.deepEqual(missing, [], 'key ในแถวที่หายไป');
  }
});

test('คำอธิบายสินค้ามี & อยู่จริง — พรีวิวจึงจับ binding ที่ไม่ผ่าน ?xml ได้ (#184)', () => {
  const sample = loadInvoiceData().buildSampleData('invoice');
  assert.ok(
    sample.items.some((r) => String(r.description).indexOf('&') !== -1),
    'ถ้าตัวอย่างไม่มี & กับดักที่ทำให้ทั้งใบพิมพ์ไม่ออกจะไม่ถูกจับตอนพรีวิว',
  );
});

test('ยอดในตัวอย่างสอดคล้องกันทั้งใบ และ format แล้วเหมือนข้อมูลจริง', () => {
  const sample = loadInvoiceData().buildSampleData('invoice');

  assert.equal(sample.totals.baseAmount, '150,000.00');
  assert.equal(sample.totals.vat, '10,500.00');
  assert.equal(sample.totals.grandTotal, '160,500.00');
  assert.equal(sample.totalText, '160,500.00');
  assert.match(sample.totals.bahtText, /บาทถ้วน$/);
  // แถวสินค้ารวมกันได้เท่ากับยอดก่อนหักส่วนลด
  const sum = sample.items.reduce((acc, r) => acc + Number(r.amount || 0), 0);
  assert.equal(sum, 152500);
});

test('ป้ายชุดสำเนาถูกประทับลงชื่อเอกสารของตัวอย่าง', () => {
  const lib = loadInvoiceData();
  const original = lib.buildSampleData('invoice');
  const copy = lib.buildSampleData('invoice', 'สำเนา', 'Copy');

  assert.match(original.document.titleTH, /\(ต้นฉบับ\)$/);
  assert.equal(original.document.copyEN, 'Original');
  assert.match(copy.document.titleTH, /\(สำเนา\)$/);
  assert.equal(copy.document.copyEN, 'Copy');
  assert.equal(copy.custbody_doc_copy_label, 'สำเนา (Copy)');
});

test('เอกสารที่ไม่มี VAT breakdown ได้ยอดเป็นค่าว่าง ไม่ใช่ 0.00 (#170)', () => {
  const sample = loadInvoiceData().buildSampleData('itemfulfillment');

  assert.equal(sample.totals.grandTotal, '');
  assert.equal(sample.totals.vat, '');
  assert.equal(sample.totalText, '');
  assert.deepEqual(Array.from(sample.totals.summaryRows), [], 'กล่องสรุปต้องหายไปทั้งกล่อง');
  assert.match(sample.document.titleTH, /ใบส่งสินค้า|ใบส่งของ|Delivery/i);
});

test('ใบเสร็จรับเงินได้แถวเป็นเอกสารที่ตัดชำระ ไม่ใช่บรรทัดสินค้า (#170)', () => {
  const sample = loadInvoiceData().buildSampleData('customerpayment');

  assert.ok(sample.items.length > 0);
  assert.ok(sample.items[0].refnum, 'แถวของใบเสร็จคือเลขที่เอกสารที่ตัดชำระ');
  assert.equal(sample.items[0].item, '', 'ช่องสินค้าต้องว่าง แต่ต้องมี key อยู่');
  assert.ok(sample.paymentText, 'ยอดที่รับมาต้องมีค่า');
  sample.apply.forEach((row) => {
    assert.notEqual(row.amount, '', 'ทุกเอกสารที่ตัดชำระต้องมียอดรับชำระ');
    assert.ok(Number(row.amount) > 0, 'ยอดรับชำระของแต่ละแถวต้องเป็นจำนวนบวก');
    assert.ok(row.amountText, 'template พิมพ์ paid amount จาก amountText');
  });
  const paid = sample.apply.reduce((sum, row) => sum + Number(row.amount), 0);
  assert.equal(paid, sample.payment, 'ยอดรับชำระรายแถวต้องรวมตรงกับ payment');
  assert.equal(sample.paymentText, '160,500.00');
  assert.ok(sample.apply.some((row) => Number(row.total) !== Number(row.amount)),
    'document total ต้องยังแยกจาก paid amount เพื่อครอบเคสชำระบางส่วน');
  assert.notEqual(sample.apply.reduce((sum, row) => sum + Number(row.total), 0), sample.payment,
    'ห้ามเอาผลรวม document total มาใช้เป็นยอดรับชำระ');
});

test('rectype ที่ engine ไม่รู้จัก ยังได้เอกสารตัวอย่างที่ใช้ออกแบบได้', () => {
  const sample = loadInvoiceData().buildSampleData('somethingelse');
  assert.ok(sample.document.titleTH);
  assert.ok(sample.items.length > 0);
});

// ═══════════════════════════════════════════════════
// Suitelet: action=sample-data และพรีวิวด้วยตัวอย่าง
// ═══════════════════════════════════════════════════

function buildSuitelet() {
  const log = logStub();
  const render = renderStub();
  const stubs = {
    'N/render': render.module,
    'N/record': recordStub({
      id: 42,
      values: { tranid: 'IF-0001', subsidiary: '2' },
    }).module,
    'N/search': searchStub([]).module,
    'N/file': fileStub(),
    'N/runtime': runtimeStub(),
    'N/log': log.module,
    'N/xml': xmlStub,
    'N/format': formatStub,
    'N/query': { runSuiteQL: () => { throw new Error('sample preview must not query the account'); } },
    './pld_lib_company_config': companyConfigStub,
  };
  return { suitelet: loadAmd('./pld_sl_render_pdf', stubs), render, log };
}

test('?action=sample-data คืนทั้งข้อมูลตัวอย่างและ contract ที่ engine จ่ายจริง', () => {
  const { suitelet } = buildSuitelet();
  const { context, response } = contextStub({
    parameters: { action: 'sample-data', rectype: 'invoice' },
  });

  suitelet.onRequest(context);
  const body = JSON.parse(response.state.body);

  assert.equal(body.rectype, 'invoice');
  assert.equal(body.curated, true);
  assert.ok(body.data.document.number);
  assert.ok(body.contract.record.includes('totalText'), 'contract ต้องมากับข้อมูล — SPA จะได้ไม่ถือลิสต์เอง');
  assert.ok(body.contract.line.includes('amountText'));
  assert.deepEqual(body.contract.copy, ['th', 'en', 'label']);
});

test('พรีวิวด้วยตัวอย่างไม่แตะ record ของ account เลย และคืน PDF', () => {
  const { suitelet, render } = buildSuitelet();
  const { context, response } = contextStub({
    method: 'POST',
    parameters: { action: 'preview-live' },
    body: JSON.stringify({ xml: '<pdf><body>x</body></pdf>', rectype: 'invoice', sample: true, copies: [{ th: 'ต้นฉบับ', en: 'Original' }] }),
  });

  suitelet.onRequest(context);

  assert.equal(response.state.headers['Content-Type'], 'application/pdf');
  assert.equal(response.state.files.length, 1);
  assert.equal(render.calls.renderedAsPdf, 1, 'ชุดเดียวต้อง render ตรง ไม่ต้องวนผ่าน string');
  assert.equal(render.calls.renderedAsString, 0);
});

test('พรีวิวด้วยตัวอย่างเคารพชุดสำเนาเหมือน Print — ได้ไฟล์เดียวที่มีทุกชุด', () => {
  const { suitelet, render } = buildSuitelet();
  const { context } = contextStub({
    method: 'POST',
    parameters: { action: 'preview-live' },
    body: JSON.stringify({
      xml: '<pdf><body>x</body></pdf>',
      rectype: 'invoice',
      sample: true,
      copies: [{ th: 'ต้นฉบับ', en: 'Original' }, { th: 'สำเนา', en: 'Copy' }],
    }),
  });

  suitelet.onRequest(context);

  assert.equal(render.calls.renderedAsString, 2, 'หนึ่ง pass ต่อหนึ่งชุด');
  assert.equal(render.calls.xmlToPdf.length, 1, 'รวมเป็นไฟล์เดียวผ่าน <pdfset>');
  assert.match(render.calls.xmlToPdf[0].xmlString, /<pdfset>/);

  // ป้ายของแต่ละ pass ต้องต่างกัน — ไม่งั้นสำเนาจะขึ้นว่า "ต้นฉบับ" (#159)
  const labels = render.calls.dataSources
    .filter((ds) => ds.alias === 'copy')
    .map((ds) => ds.data.th);
  assert.deepEqual(labels, ['ต้นฉบับ', 'สำเนา']);
});

test('พรีวิวที่ไม่มีทั้ง record และ sample ยังบอกให้ชัดว่าต้องทำอย่างไร (R4)', () => {
  const { suitelet } = buildSuitelet();
  const { context, response } = contextStub({
    method: 'POST',
    parameters: { action: 'preview-live' },
    body: JSON.stringify({ xml: '<pdf/>', rectype: 'invoice' }),
  });

  suitelet.onRequest(context);
  const body = JSON.parse(response.state.body);
  assert.equal(body.error, true);
  assert.match(body.message, /sample:true/);
});

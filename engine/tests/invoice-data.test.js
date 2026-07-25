/**
 * pld_lib_invoice_data — binding contract tests (#155).
 *
 * What these pin down: every supported record type binds THIS object as `record`,
 * so a key the master pack uses but this object doesn't provide prints BLANK
 * (null-safe bindings swallow it) instead of failing. The tests therefore assert
 * on the built object, not on a declared list.
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
const { queryStub, recordStub, formatStub, companyConfigStub } = require('./helpers/ns-stubs');

const MASTER_DIR = path.join(__dirname, '..', '..', 'templates', 'master');

// ─── fixture: one invoice with a discount line and an item-less charge line ───
const HDR = {
  tranid: 'INV2026-0007',
  trandate: '25/07/2026',
  duedate: '24/08/2026',
  otherrefnum: 'PO-8842',
  customer_name: '02901 บริษัท ผู้ซื้อทดสอบ จำกัด',
  created_by: '105 สมชาย ทดสอบ',
  created_from: 'Sales Order #SO2026-0044',
};

const SUMS = [
  { sumtype: 'Product/Service Total', total: 12000, taxrate: null },
  { sumtype: 'Special Discount', total: -2000, taxrate: null },
  { sumtype: 'Base Total', total: 10000, taxrate: null },
  { sumtype: 'Tax Total', total: 700, taxrate: 0.07 },
  { sumtype: 'Net Total', total: 10700, taxrate: null },
];

const LINES = [
  {
    seq: 1, itemtype: 'InvtPart', item_code: 'PD0001', item_name: 'สินค้าทดสอบ ก',
    memo: 'รายละเอียดเพิ่มเติมของสินค้า', quantity: 12, unit_price: 1000,
    unit_name: 'Pack12', conv: 12, amount: 12000,
  },
  { seq: 2, itemtype: 'Discount', item_code: null, item_name: null, memo: '', quantity: null, unit_price: null, unit_name: null, conv: null, amount: -2000 },
  { seq: 3, itemtype: 'Markup', item_code: null, item_name: null, memo: 'ค่าดำเนินการ', quantity: null, unit_price: null, unit_name: null, conv: null, amount: 0 },
];

const BODY_VALUES = {
  subsidiary: '2',
  billaddress: 'บริษัท ผู้ซื้อทดสอบ จำกัด\n1 ถนนสุขุมวิท กรุงเทพฯ',
  shipaddress: 'คลังสินค้า บางนา',
  memo: 'ชำระโดยโอนเข้าบัญชี',
  terms: '2',
  salesrep: '77',
  employee: '88',
  subtotal: 10000,
  taxtotal: 700,
  custbody_thl_entvatregistrationno: '0994000000000',
  custbody_thl_entbranchno: '00000',
  custbody_thl_withholdingtaxtotal: 0,
};

const BODY_TEXTS = { terms: 'Net 30', salesrep: 'สุดา ขายเก่ง', employee: 'อนงค์ จัดซื้อ' };

/** Returns the module plus the query stub, so a test can assert on the SQL issued. */
function buildLibWith(overrides = {}) {
  const values = { ...BODY_VALUES, ...(overrides.values || {}) };
  const q = queryStub([
    { match: 'FROM transaction WHERE id', rows: [HDR] },
    { match: 'customrecord_thl_summarytotal', rows: overrides.sums || SUMS },
    { match: 'FROM transactionline tl', rows: overrides.lines || LINES },
    { match: 'SELECT * FROM transactionline', rows: [] },
  ]);
  const stubs = {
    'N/query': q,
    'N/record': recordStub({ id: 42, values, texts: BODY_TEXTS }).module,
    'N/format': formatStub,
    './pld_lib_company_config': companyConfigStub,
  };
  return { lib: loadAmd('./pld_lib_invoice_data', stubs), query: q };
}

function buildLib(overrides = {}) {
  return buildLibWith(overrides).lib;
}

/** ZWSP is inserted by the Thai wordbreak helper — strip it for comparisons. */
const plain = (s) => String(s).replace(/​/g, '');

test('raw-record aliases carry the same values as the curated schema', () => {
  const lib = buildLib();
  const data = lib.buildTransactionData('invoice', 42);

  assert.equal(data.tranid, 'INV2026-0007');
  assert.equal(data.tranid, data.document.number);
  assert.equal(data.trandate, data.document.date);
  assert.equal(data.duedate, data.document.dueDate);
  assert.equal(data.otherrefnum, data.document.refNo);
  assert.equal(data.entity, data.customer.name);
  assert.equal(plain(data.entity), 'บริษัท ผู้ซื้อทดสอบ จำกัด');
  assert.equal(data.billaddress, data.customer.address);
  assert.equal(data.shipaddress, data.shipTo.address);
  assert.equal(data.memo, 'ชำระโดยโอนเข้าบัญชี');
  assert.equal(data.terms, 'Net 30');
  assert.equal(data.salesrep, 'สุดา ขายเก่ง');
  assert.equal(data.employee, 'อนงค์ จัดซื้อ');
});

test('numeric totals stay numbers and add up the way the master pack prints them', () => {
  const data = buildLib().buildTransactionData('invoice', 42);

  for (const key of ['subtotal', 'discounttotal', 'taxtotal', 'total']) {
    assert.equal(typeof data[key], 'number', `${key} must be a number for ?string["#,##0.00"] / pldBahtText()`);
  }
  assert.equal(data.subtotal, 12000);
  assert.equal(data.discounttotal, -2000);
  assert.equal(data.taxtotal, 700);
  assert.equal(data.total, 10700);
  // master: Net Amount row = subtotal + discounttotal, must equal the statutory Base Total
  assert.equal(data.subtotal + data.discounttotal, 10000);
  // and Base + VAT = Grand Total
  assert.equal(data.subtotal + data.discounttotal + data.taxtotal, data.total);
});

test('subtotal falls back to Base Total when the transaction has no summary rows', () => {
  const data = buildLib({ sums: [] }).buildTransactionData('invoice', 42);

  assert.equal(data.subtotal, 10000, 'body subtotal is the fallback');
  assert.equal(data.discounttotal, 0, 'no summary rows → no discount row in the master');
  assert.equal(data.taxtotal, 700);
  assert.equal(data.total, 10700);
});

test('record.item rows are numeric and cover every row the item table prints', () => {
  const data = buildLib().buildTransactionData('invoice', 42);

  assert.ok(Array.isArray(data.item), 'record.item must be a list for <#list (record.item)![]>');
  assert.equal(data.item.length, data.items.length, 'alias rows must match the curated rows');
  assert.equal(data.item.length, 2, 'the Discount line folds into the row above, like the curated schema');

  const [first, second] = data.item;
  assert.equal(plain(first.item), 'PD0001 สินค้าทดสอบ ก');
  assert.equal(plain(first.description), 'รายละเอียดเพิ่มเติมของสินค้า');
  assert.equal(first.quantity, 1, 'base qty 12 ÷ uom conversion 12');
  assert.equal(first.units, 'Pack12');
  assert.equal(first.rate, 1000);
  assert.equal(first.amount, 12000);

  for (const row of data.item) {
    for (const key of ['quantity', 'rate', 'amount']) {
      const v = row[key];
      assert.ok(v === null || typeof v === 'number',
        `item.${key} must be number|null (a display string breaks ?string["#,##0.00"]), got ${typeof v}`);
    }
  }
  // an item-less charge line still prints, with no qty/rate
  assert.equal(second.quantity, null);
  assert.equal(second.rate, null);
  assert.equal(second.amount, 0);
});

// ─── #165: money must arrive PRE-FORMATTED ─────────────────────────────────────
// render.DataSource.OBJECT hands every value to FreeMarker as a string (proven on
// SB2: `${record.total?is_number}` → NO), so a template cannot format a number:
// `?string("#,##0.00")` on a string returns EMPTY with no error. Anything printed
// has to be formatted here.
test('formatted money text is present, comma-grouped and 2dp', () => {
  const data = buildLib().buildTransactionData('invoice', 42);

  assert.equal(data.subtotalText, '12,000.00');
  assert.equal(data.netAmountText, '10,000.00', 'subtotal − discount, as the master prints it');
  assert.equal(data.taxtotalText, '700.00');
  assert.equal(data.totalText, '10,700.00');
  for (const key of ['subtotalText', 'netAmountText', 'taxtotalText', 'totalText', 'bahtText']) {
    assert.equal(typeof data[key], 'string', `${key} must be a string — FreeMarker cannot format`);
  }
});

test('discount text is empty when there is no discount (template branches on it)', () => {
  const withDiscount = buildLib().buildTransactionData('invoice', 42);
  assert.equal(withDiscount.discounttotalText, '2,000.00', 'printed as a positive figure');

  const noSummary = buildLib({ sums: [] }).buildTransactionData('invoice', 42);
  assert.equal(noSummary.discounttotalText, '', 'empty → the master hides the discount rows');
});

test('amount in words comes from the engine, in Thai', () => {
  const data = buildLib().buildTransactionData('invoice', 42);

  assert.equal(typeof data.bahtText, 'string');
  assert.ok(data.bahtText.indexOf('บาท') !== -1, `expected Thai baht text, got "${data.bahtText}"`);
  assert.equal(data.bahtText, data.totals.bahtText, 'same value the curated schema exposes');
});

test('item rows carry formatted text next to the raw numbers', () => {
  const [first, second] = buildLib().buildTransactionData('invoice', 42).item;

  assert.equal(first.quantityText, '1');
  assert.equal(first.rateText, '1,000.00');
  assert.equal(first.amountText, '12,000.00');
  // an item-less charge line prints blank, not 0.00
  assert.equal(second.quantityText, '');
  assert.equal(second.rateText, '');
  assert.equal(second.amountText, '');
});

test('copy label follows the copy being rendered, not a stored field', () => {
  const lib = buildLib();

  assert.equal(lib.buildTransactionData('invoice', 42).custbody_doc_copy_label, 'ต้นฉบับ (Original)');
  assert.equal(
    lib.buildTransactionData('invoice', 42, 'สำเนา', 'Copy').custbody_doc_copy_label,
    'สำเนา (Copy)',
    'the second copy of a Thai tax invoice must not print ต้นฉบับ',
  );
  // document.* keeps its own labels for designer-built templates
  const copy = lib.buildTransactionData('invoice', 42, 'สำเนา', 'Copy');
  assert.equal(copy.document.copyTH, 'สำเนา');
  assert.equal(copy.document.copyEN, 'Copy');
  assert.ok(copy.document.titleTH.indexOf('สำเนา') !== -1);
});

// ─── #170: record types that reuse the transaction-line builder as-is ────────
test('every curated type prints its own Thai document title', () => {
  const lib = buildLib();
  const titles = {
    cashsale: ['ใบเสร็จรับเงิน/ใบกำกับภาษี', 'RECEIPT/TAX INVOICE'],
    vendorbill: ['ใบรับวางบิล', 'VENDOR BILL'],
    returnauthorization: ['ใบรับคืนสินค้า', 'RETURN AUTHORIZATION'],
  };

  for (const [rectype, [th, en]] of Object.entries(titles)) {
    const data = lib.buildTransactionData(rectype, 42);
    assert.equal(data.document.titleTH, `${th} (ต้นฉบับ)`);
    assert.equal(data.document.titleEN, `${en} (Original)`);

    const copy = lib.buildTransactionData(rectype, 42, 'สำเนา', 'Copy');
    assert.ok(copy.document.titleTH.indexOf(th) === 0,
      `${rectype} must keep its own title on the copy, got "${copy.document.titleTH}"`);
    assert.equal(copy.custbody_doc_copy_label, 'สำเนา (Copy)');
  }
});

test('an unknown record type never silently prints as an invoice', () => {
  const lib = buildLib();
  assert.equal(lib.isSupportedType('cashsale'), true);
  assert.equal(lib.isSupportedType('customerpayment'), false,
    'still raw-path — the render suitelet must keep binding the raw record for it (#170)');
});

test('purchase-side lines keep their record sign, sales-side lines are negated', () => {
  // The GL sign lives in the SQL (`-tl.quantity`), so this asserts on the query text:
  // a vendor bill printing negative quantities is the failure being pinned.
  const purchase = buildLibWith();
  purchase.lib.buildTransactionData('vendorbill', 42);
  const purchaseSql = purchase.query.seen.map((s) => s.query).join('\n');
  assert.ok(purchaseSql.indexOf('-tl.quantity') === -1,
    'vendorbill is purchase-side — its lines are already positive');

  const sales = buildLibWith();
  sales.lib.buildTransactionData('cashsale', 42);
  const salesSql = sales.query.seen.map((s) => s.query).join('\n');
  assert.ok(salesSql.indexOf('-tl.quantity') !== -1,
    'cashsale is sales-side — transactionline stores it GL-negative (#67)');
});

test('custbody_* stay bound at the top level when a type becomes curated', () => {
  // Flipping a type into DOC_TITLES swaps NetSuite's raw record binding for this
  // object, so ${record.custbody_xxx} in a template already live on an account
  // must keep resolving — otherwise it prints blank with no error (#155).
  const data = buildLib({
    values: { custbody_thl_project_ref: 'PRJ-2026-014' },
  }).buildTransactionData('cashsale', 42);

  assert.equal(data.custbody_thl_project_ref, 'PRJ-2026-014');
  assert.equal(data.custbody_thl_entvatregistrationno, '0994000000000');
  assert.equal(data.fields.custbody_thl_project_ref, 'PRJ-2026-014',
    'the #79 fields.* path keeps working alongside the top-level alias');
});

test('a stored copy-label field never overrides the copy being rendered', () => {
  // The passthrough above must not resurrect the #159 bug where every copy printed
  // "ต้นฉบับ" because a stored body field won over the render pass.
  const data = buildLib({
    values: { custbody_doc_copy_label: 'ต้นฉบับ (Original)' },
  }).buildTransactionData('cashsale', 42, 'สำเนา', 'Copy');

  assert.equal(data.custbody_doc_copy_label, 'สำเนา (Copy)');
});

// ─── #170: a document that moves goods, not money ────────────────────────────
test('an item fulfillment prints no money at all — blank, never 0.00', () => {
  // The fixture deliberately has full invoice amounts on it: the blanking must come
  // from the record TYPE, not from the data happening to be empty.
  const data = buildLib().buildTransactionData('itemfulfillment', 42);

  for (const key of ['subtotalText', 'discounttotalText', 'netAmountText',
    'taxtotalText', 'totalText', 'bahtText']) {
    assert.equal(data[key], '', `${key} must be blank on a delivery note, got "${data[key]}"`);
  }
  for (const key of ['gross', 'baseAmount', 'vat', 'grandTotal', 'wht', 'customerPaid',
    'vatRate', 'bahtText', 'subtotal', 'tax', 'total']) {
    assert.equal(data.totals[key], '', `totals.${key} must be blank, got "${data.totals[key]}"`);
  }
  // length, not deepEqual: the module runs in its own vm context, so its Array has a
  // different prototype and deepStrictEqual([], []) fails across the realm boundary.
  assert.equal(data.totals.summaryRows.length, 0,
    'the 9-row statutory summary must disappear, not render nine empty rows');
  assert.ok(data.bahtText.indexOf('ศูนย์') === -1,
    'a delivery note must never read "(ศูนย์บาทถ้วน)"');
});

test('an item fulfillment still prints its lines, quantities and units', () => {
  const data = buildLib().buildTransactionData('itemfulfillment', 42);

  assert.equal(data.document.titleTH, 'ใบส่งสินค้า (ต้นฉบับ)');
  assert.ok(data.item.length > 0, 'the item table is the whole point of a delivery note');
  assert.equal(data.item[0].quantityText, '1');
  assert.equal(data.item[0].units, 'Pack12');
  assert.equal(plain(data.item[0].item), 'PD0001 สินค้าทดสอบ ก');
});

test('the money-blanking is per record type, not global', () => {
  const lib = buildLib();
  assert.equal(lib.buildTransactionData('invoice', 42).totalText, '10,700.00');
  assert.equal(lib.buildTransactionData('itemfulfillment', 42).totalText, '');
});

test('createdfrom carries the source document for the delivery note', () => {
  const data = buildLib().buildTransactionData('itemfulfillment', 42);
  assert.equal(data.createdfrom, 'Sales Order #SO2026-0044');
});

test('buyer tax id / branch prefer the account field and fall back to Thai-Loc values', () => {
  const fallback = buildLib().buildTransactionData('invoice', 42);
  assert.equal(fallback.custbody_buyer_taxid, '0994000000000');
  assert.equal(fallback.custbody_buyer_branch, 'สำนักงานใหญ่');

  const own = buildLib({
    values: { custbody_buyer_taxid: '0107000000000', custbody_buyer_branch: '00012' },
  }).buildTransactionData('invoice', 42);
  assert.equal(own.custbody_buyer_taxid, '0107000000000');
  assert.equal(own.custbody_buyer_branch, '00012');
});

test('every key in the declared binding contract exists on the built object', () => {
  const lib = buildLib();
  const data = lib.buildTransactionData('invoice', 42);

  for (const key of lib.bindingKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(data, key),
      `bindingKeys lists "${key}" but buildTransactionData() does not provide it`);
  }
  for (const row of data.item) {
    for (const key of lib.itemBindingKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, key),
        `itemBindingKeys lists "${key}" but the item row does not provide it`);
    }
  }
});

// ─── the regression that #155 was reported for ───────────────────────────────
test('every binding the master pack uses resolves for the record types it targets', () => {
  const lib = buildLib();
  const supported = new Set(lib.supportedTypes);
  const masters = fs.readdirSync(MASTER_DIR).filter((f) => f.endsWith('.xml'));
  assert.ok(masters.length >= 6, 'expected the full Standard Template Pack');

  let curatedChecked = 0;
  for (const file of masters) {
    const src = fs.readFileSync(path.join(MASTER_DIR, file), 'utf8');
    const marker = src.match(/pld:rectype\s+([A-Za-z_][A-Za-z0-9_]*)/);
    assert.ok(marker, `${file} has no "pld:rectype <type>" marker — the validator and this test need it`);

    const rectype = marker[1];
    // Types the engine does not curate keep NetSuite's raw record binding, where
    // ${record.tranid} / <#list record.item> resolve natively (see #159).
    if (!supported.has(rectype)) continue;
    curatedChecked += 1;

    const data = lib.buildTransactionData(rectype, 42);
    const used = new Set((src.match(/record\.[A-Za-z_][A-Za-z0-9_]*/g) || [])
      .map((m) => m.slice('record.'.length)));
    for (const key of used) {
      assert.ok(Object.prototype.hasOwnProperty.call(data, key),
        `${file} binds \${record.${key}} but the engine binds none — it would print blank (#155)`);
    }

    const lineKeys = new Set((src.match(/line\.[A-Za-z_][A-Za-z0-9_]*/g) || [])
      .map((m) => m.slice('line.'.length)));
    if (lineKeys.size) {
      const row = data.item[0];
      assert.ok(row, `${file} loops record.item but the fixture produced no rows`);
      for (const key of lineKeys) {
        assert.ok(Object.prototype.hasOwnProperty.call(row, key),
          `${file} binds \${line.${key}} but an item row has no such key (#155)`);
      }
    }
  }
  assert.ok(curatedChecked >= 4, 'expected the invoice/tax-invoice/PO/quotation masters to be checked');
});

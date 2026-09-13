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
  // counterparty contact details (#215) — the entity row behind t.entity
  entity_email: 'buyer@example.test',
  entity_phone: '02-000-1234',
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
    unit_name: 'Pack12', conv: 12, amount: 12000, expected_receipt_date: '30/07/2026',
  },
  { seq: 2, itemtype: 'Discount', item_code: null, item_name: null, memo: '', quantity: null, unit_price: null, unit_name: null, conv: null, amount: -2000, expected_receipt_date: null },
  { seq: 3, itemtype: 'Markup', item_code: null, item_name: null, memo: 'ค่าดำเนินการ', quantity: null, unit_price: null, unit_name: null, conv: null, amount: 0, expected_receipt_date: null },
];

const BODY_VALUES = {
  subsidiary: '2',
  billaddress: 'บริษัท ผู้ซื้อทดสอบ จำกัด\n1 ถนนสุขุมวิท กรุงเทพฯ',
  shipaddress: 'คลังสินค้า บางนา',
  memo: 'ชำระโดยโอนเข้าบัญชี',
  terms: '2',
  salesrep: '77',
  employee: '88',
  // select fields whose DISPLAY text the requisition header prints (#215)
  department: '12',
  location: '5',
  currency: '1',
  subtotal: 10000,
  taxtotal: 700,
  createdfrom: '9911',
  // receipt body fields (#170) — 10,700 + 1,000 = the two ticked apply lines
  payment: 11700,
  paymentmethod: '3',
  checknum: 'CHQ-556677',
  custbody_thl_entvatregistrationno: '0994000000000',
  custbody_thl_entbranchno: '00000',
  custbody_thl_withholdingtaxtotal: 0,
};

const BODY_TEXTS = {
  terms: 'Net 30', salesrep: 'สุดา ขายเก่ง', employee: 'อนงค์ จัดซื้อ',
  createdfrom: 'Sales Order #SO2026-0044',
  paymentmethod: 'โอนเงินผ่านธนาคาร',
  department: 'ฝ่ายจัดซื้อ', location: 'คลังกลาง', currency: 'THB',
};

/**
 * `apply` sublist of a customer payment (#170) — two invoices ticked, one open
 * invoice of the same customer left unticked. The unticked row is the point: it must
 * never reach the receipt, or the payer is told they settled a document they did not.
 */
const APPLY_LINES = [
  { apply: true, refnum: 'INV2026-0007', applydate: new Date(2026, 6, 25), total: 10700, amount: 10700 },
  { apply: false, refnum: 'INV2026-0009', applydate: new Date(2026, 6, 26), total: 5000, amount: 0 },
  { apply: true, refnum: 'INV2026-0011', applydate: new Date(2026, 6, 27), total: 3210, amount: 1000 },
];

/**
 * `item` sublist of an item fulfillment (#176). Quantities here are in DISPLAY units
 * and carry their own unit text — unlike transactionline, which stores base units and
 * an accounting pair per shipped item. A custcol_* rides along to pin that #89 keeps
 * working on this path too.
 */
const ITEM_LINES = [
  {
    itemname: 'CHOP-001', displayname: 'ปลากระป๋องอบแห้ง', itemdescription: 'ล็อตผลิตเดือนกรกฎาคม',
    quantity: 7, unitsdisplay: 'Tray24', custcol_lot_no: 'LOT-2607',
  },
  {
    itemname: 'CHOP-002', displayname: 'น้ำพริกเผา', itemdescription: '',
    quantity: 1200, unitsdisplay: 'ขวด', custcol_lot_no: 'LOT-2608',
  },
];

// Pin only the print-time service boundary to the baseline's capture date.
// Transaction/apply DATE formatting remains unchanged; DATETIME is exclusively
// document.printedDate in this builder and must not depend on the runner's day.
const invoiceFormatStub = {
  ...formatStub,
  format(options) {
    if (options.type === formatStub.Type.DATETIME) {
      assert.equal(Object.prototype.toString.call(options.value), '[object Date]');
      return '13/09/2026 10:30';
    }
    return formatStub.format(options);
  },
};

/** Returns the module plus the query stub, so a test can assert on the SQL issued. */
function buildLibWith(overrides = {}) {
  const values = { ...BODY_VALUES, ...(overrides.values || {}) };
  const texts = { ...BODY_TEXTS, ...(overrides.texts || {}) };
  const header = { ...HDR, ...(overrides.header || {}) };
  const q = queryStub([
    { match: 'FROM transaction t LEFT JOIN customrecord_thl_summarytotal', rows:
      (overrides.sums || SUMS).length ? (overrides.sums || SUMS).map((summary, index) => ({
        ...header, summary_id: index + 1, summary_type: summary.sumtype,
        summary_total: summary.total, summary_taxrate: summary.taxrate
      })) : [{ ...header, summary_id: null, summary_type: null, summary_total: null, summary_taxrate: null }] },
    { match: 'FROM transactionline tl', rows: overrides.lines || LINES },
    { match: 'SELECT * FROM transactionline', rows: [] },
  ]);
  const stubs = {
    'N/query': q,
    'N/record': recordStub({
      id: 42,
      values,
      texts,
      sublists: {
        apply: overrides.apply || APPLY_LINES,
        item: overrides.itemLines || ITEM_LINES,
      },
    }).module,
    'N/format': invoiceFormatStub,
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
    purchaserequisition: ['ใบขอให้ซื้อ', 'PURCHASE REQUISITION'],
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

test('a type the engine does not curate is reported as unsupported', () => {
  // isSupportedType is the gate pld_sl_render_pdf uses to choose curated data over
  // NetSuite's raw record binding — it must answer for the type asked about, not
  // fall through to the invoice schema.
  const lib = buildLib();
  assert.equal(lib.isSupportedType('cashsale'), true);
  assert.equal(lib.isSupportedType('customerpayment'), true);
  assert.equal(lib.isSupportedType('journalentry'), false);
  assert.equal(lib.isSupportedType(''), false);
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
  assert.equal(data.item.length, 2, 'one row per shipped item — see #176');
  assert.equal(data.item[0].quantityText, '7');
  assert.equal(data.item[0].units, 'Tray24');
  assert.equal(plain(data.item[0].item), 'CHOP-001 ปลากระป๋องอบแห้ง');
  assert.equal(plain(data.item[0].description), 'ล็อตผลิตเดือนกรกฎาคม');
  assert.equal(data.item[1].quantityText, '1,200', 'display quantity is comma-grouped');
});

// ─── #176: transactionline is the wrong line source for some record types ────
test('a delivery note prints one row per shipped item, never the accounting pair', () => {
  // transactionline stores the item line AND its Cost of Sales counterpart for a
  // fulfillment — both mainline='F' taxline='F'. Printing both put the same product
  // on the delivery note twice, once with a negative quantity and no unit.
  const built = buildLibWith();
  const data = built.lib.buildTransactionData('itemfulfillment', 42);

  for (const row of data.item) {
    assert.ok(String(row.quantityText).indexOf('-') === -1,
      `a delivery note must never print a negative quantity, got "${row.quantityText}"`);
    assert.notEqual(row.units, '', 'the unit column must not be blank');
  }
  const names = data.item.map((r) => plain(r.item));
  assert.equal(new Set(names).size, names.length, 'no product may appear twice');
});

test('a delivery note asks transactionline for nothing at all', () => {
  const built = buildLibWith();
  built.lib.buildTransactionData('itemfulfillment', 42);

  for (const { query } of built.query.seen) {
    assert.ok(query.indexOf('transactionline') === -1,
      `the item sublist is the source for a fulfillment, not transactionline (#176):\n${query}`);
  }
});

test('custcol_* still ride on the row when lines come from the sublist', () => {
  // custcol_* live on the curated rows (`items`), the ones the designer column picker
  // lists — same as the transactionline path, not on the raw `item` aliases.
  const row = buildLib().buildTransactionData('itemfulfillment', 42).items[0];
  assert.equal(plain(row.custcol_lot_no), 'LOT-2607', '#89 must keep working on this path');
});

test('a return authorization keeps the sign the record stores', () => {
  // QA on SB2 (CR-TTL-260100001) proved the record stores +0.5 — negating it like a
  // sales invoice printed -0.5 on the customer's copy.
  const built = buildLibWith();
  built.lib.buildTransactionData('returnauthorization', 42);
  const sql = built.query.seen.map((s) => s.query).join('\n');

  assert.ok(sql.indexOf('-tl.quantity') === -1,
    'returnauthorization quantities are already positive — do not negate them (#176)');
});

test('the money-blanking is per record type, not global', () => {
  const lib = buildLib();
  assert.equal(lib.buildTransactionData('invoice', 42).totalText, '10,700.00');
  assert.equal(lib.buildTransactionData('itemfulfillment', 42).totalText, '');
});

test('createdfrom carries the source document for the delivery note', () => {
  const data = buildLib().buildTransactionData('itemfulfillment', 42);
  assert.equal(data.createdfrom, 'Sales Order #SO2026-0044',
    'display text of the record field, not the internal id');
});

// ─── #174: the column that took the whole account's printing down ────────────
test('no query asks the transaction table for createdfrom', () => {
  // `createdfrom` is not an identifier SuiteQL accepts on `transaction`. Selecting it
  // threw "Unknown identifier 'createdfrom'" on the FIRST query of every curated
  // render, so one added column stopped every document on the account from printing —
  // invoices included, not just the delivery note the column was added for.
  //
  // A stub cannot tell a real column from an invented one (it matches SQL by
  // substring and hands back a fixture), so this asserts on the SQL text itself:
  // body fields come off the loaded record, never out of the header SELECT.
  const built = buildLibWith();
  built.lib.buildTransactionData('itemfulfillment', 42);

  for (const { query } of built.query.seen) {
    assert.ok(query.indexOf('createdfrom') === -1,
      `SuiteQL must not reference createdfrom — read it off the record instead (#174):\n${query}`);
  }
});

// ─── #170: a receipt, whose rows are documents rather than items ─────────────
test('a receipt lists only the documents the payment actually settles', () => {
  const data = buildLib().buildTransactionData('customerpayment', 42);

  assert.equal(data.item.length, 2, 'the unticked open invoice must not appear');
  assert.equal(data.apply, data.item, 'record.apply and record.item are the same rows');

  const [first, second] = data.apply;
  assert.equal(first.refnum, 'INV2026-0007');
  assert.equal(first.applydate, '25/07/2026');
  assert.equal(first.totalText, '10,700.00');
  assert.equal(first.amountText, '10,700.00');
  assert.equal(second.refnum, 'INV2026-0011');
  assert.equal(second.totalText, '3,210.00', 'the document total, not the amount paid');
  assert.equal(second.amountText, '1,000.00', 'a partial settlement prints what was paid');

  for (const row of data.apply) {
    assert.ok(row.refnum.indexOf('INV2026-0009') === -1,
      'an open invoice that was NOT ticked would tell the payer they settled it');
  }
});

test('a receipt prints the amount received and its Thai words', () => {
  const data = buildLib().buildTransactionData('customerpayment', 42);

  assert.equal(data.document.titleTH, 'ใบเสร็จรับเงิน (ต้นฉบับ)');
  assert.equal(data.paymentText, '11,700.00');
  assert.equal(data.payment, 11700, 'numeric alias stays numeric like the other amounts');
  assert.equal(data.totals.customerPaid, '11,700.00');
  assert.equal(data.checknum, 'CHQ-556677');
  assert.equal(data.paymentmethod, 'โอนเงินผ่านธนาคาร');

  // the words describe the amount RECEIVED, not an invoice grand total (#170)
  assert.ok(data.bahtText.indexOf('บาท') !== -1, `expected Thai baht text, got "${data.bahtText}"`);
  assert.ok(data.bahtText.indexOf('ศูนย์บาท') === -1);
  assert.equal(data.bahtText, data.totals.bahtText);
});

test('a receipt prints no statutory VAT breakdown', () => {
  const data = buildLib().buildTransactionData('customerpayment', 42);

  for (const key of ['subtotalText', 'netAmountText', 'taxtotalText', 'totalText']) {
    assert.equal(data[key], '', `${key} must be blank on a receipt, got "${data[key]}"`);
  }
  assert.equal(data.totals.summaryRows.length, 0);
});

test('a receipt with nothing applied prints an empty table, not a wrong one', () => {
  const data = buildLib({ apply: [] }).buildTransactionData('customerpayment', 42);
  assert.equal(data.apply.length, 0);
  assert.equal(data.paymentText, '11,700.00', 'the amount received still stands on its own');
});

test('settlement keys exist and stay blank on an item row', () => {
  // one row shape everywhere (#170): binding ${line.refnum} on an invoice prints
  // nothing, it does not blow up or vanish from the contract
  const row = buildLib().buildTransactionData('invoice', 42).item[0];
  assert.equal(row.refnum, '');
  assert.equal(row.applydate, '');
  assert.equal(row.totalText, '');
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

// ─── #215: purchase requisition — header contacts and expected receipt dates ──
const REQUISITION_HEADER_KEYS = ['department', 'location', 'currency', 'createdby', 'entityEmail', 'entityPhone'];

test('requisition header aliases carry real values on every curated type', () => {
  // Declared for every type so a template never binds a key that vanishes on one
  // record type (#155). The fixture gives each a value: an alias that is present
  // but always empty would pass a hasOwnProperty check and still print blank.
  const lib = buildLib();
  for (const type of lib.supportedTypes) {
    const data = lib.buildTransactionData(type, 42);
    assert.equal(data.department, 'ฝ่ายจัดซื้อ', `${type}: display text of the record field`);
    assert.equal(data.location, 'คลังกลาง', type);
    assert.equal(data.currency, 'THB', `${type}: currency display text, not the internal id`);
    assert.equal(data.createdby, 'สมชาย ทดสอบ', `${type}: BUILTIN.DF prefix dropped`);
    assert.equal(data.createdby, data.issuer.createdBy);
    assert.equal(data.entityEmail, 'buyer@example.test', type);
    assert.equal(data.entityPhone, '02-000-1234', type);
    for (const key of REQUISITION_HEADER_KEYS) {
      assert.equal(typeof data[key], 'string', `${type}.${key} must be a string`);
    }
  }
});

test('requisition header aliases are empty strings, never absent, when the record has none', () => {
  const data = buildLib({
    values: { department: '', location: '', currency: '' },
    texts: { department: '', location: '', currency: '' },
    header: { entity_email: null, entity_phone: null },
  }).buildTransactionData('purchaserequisition', 42);
  for (const key of REQUISITION_HEADER_KEYS.filter((k) => k !== 'createdby')) {
    assert.ok(Object.prototype.hasOwnProperty.call(data, key), `${key} must exist`);
    assert.equal(data[key], '', `${key} must be "" — a null would print "null" through ?xml`);
  }
});

test('a requisition with no summary rows and no subtotal body field prints its body total, not 0.00 (#215)', () => {
  // NetSuite's purchaserequisition has `total` but no `subtotal`/`taxtotal`; the
  // record stub returns '' for an unknown field exactly like N/record does here.
  const data = buildLib({
    values: { subtotal: '', taxtotal: '', total: 2255 },
    sums: [],
  }).buildTransactionData('purchaserequisition', 42);
  assert.equal(data.subtotalText, '2,255.00');
  assert.equal(data.taxtotalText, '0.00');
  assert.equal(data.totalText, '2,255.00');
  assert.equal(data.subtotal, 2255);
  // an invoice that DOES carry a subtotal keeps using it
  const inv = buildLib({ values: { subtotal: 10000, taxtotal: 700, total: 10700 }, sums: [] })
    .buildTransactionData('invoice', 42);
  assert.equal(inv.subtotalText, '10,000.00');
});

test('counterparty contact details come off the entity row of t.entity in the header query', () => {
  // Employee for a requisition, vendor/customer elsewhere — the `entity` table is the
  // one view that covers all of them, so no per-type record load is needed and the
  // per-type SuiteQL call count stays at three.
  const built = buildLibWith();
  built.lib.buildTransactionData('purchaserequisition', 42);
  const header = built.query.seen[0].query;
  assert.match(header, /\(SELECT e\.email FROM entity e WHERE e\.id = t\.entity\) AS entity_email/);
  assert.match(header, /\(SELECT e\.phone FROM entity e WHERE e\.id = t\.entity\) AS entity_phone/);
  assert.equal(built.query.seen.length, 3, 'header + summaries, printed lines, custom line fields — no extra call');
});

test('every item row carries expectedreceiptdate — formatted on line rows, blank elsewhere', () => {
  const lib = buildLib();
  for (const type of lib.supportedTypes) {
    for (const row of lib.buildTransactionData(type, 42).item) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, 'expectedreceiptdate'), `${type}: key must exist`);
      assert.equal(typeof row.expectedreceiptdate, 'string', `${type}: must be text, never null`);
    }
  }
  const [first, second] = lib.buildTransactionData('purchaserequisition', 42).item;
  assert.equal(first.expectedreceiptdate, '30/07/2026', 'DD/MM/YYYY from TO_CHAR in the line query');
  assert.equal(second.expectedreceiptdate, '', 'an item-less charge line has no receipt date');
  assert.equal(lib.buildTransactionData('customerpayment', 42).apply[0].expectedreceiptdate, '');
  assert.equal(lib.buildTransactionData('itemfulfillment', 42).item[0].expectedreceiptdate, '');
});

test('a purchase requisition prints its own title and keeps the stored line sign', () => {
  const built = buildLibWith();
  const data = built.lib.buildTransactionData('purchaserequisition', 42);
  assert.equal(data.document.titleTH, 'ใบขอให้ซื้อ (ต้นฉบับ)');
  assert.equal(data.document.titleEN, 'PURCHASE REQUISITION (Original)');
  assert.equal(built.lib.isSupportedType('purchaserequisition'), true);

  const sql = built.query.seen.map((s) => s.query).join('\n');
  assert.ok(sql.indexOf('-tl.quantity') === -1,
    'requisition lines are stored positive like a purchase order — do not negate them');
  assert.match(sql, /TO_CHAR\(tl\.expectedreceiptdate,'DD\/MM\/YYYY'\) AS expected_receipt_date/);
  assert.equal(data.item[0].quantity, 1, 'display units, positive');
  assert.equal(data.item[0].amountText, '12,000.00');
  // the statutory box still prints (not a NO_TOTALS type) and the summary path is shared
  assert.equal(data.totalText, '10,700.00');
  assert.equal(data.totals.summaryRows.length, 9);
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

test('line queries exclude the COGS/asset rows an inventory item generates (#185)', () => {
  // transactionline stores THREE rows per inventory item on an invoice — revenue,
  // Cost of Sales and inventory relief — all `mainline='F' AND taxline='F'`, so the
  // filter that reads right returns our own cost figures as extra printed lines
  // (proven on SB2 inv 1094914: 12 rows for a 4-line invoice). The two extra rows
  // are exactly the ones with iscogs='T'.
  //
  // This asserts on the SQL the engine FIRES, not on what the stub returns — a stub
  // that matches by substring can never prove a column filter by itself (#174).
  const built = buildLibWith();
  built.lib.buildTransactionData('invoice', 42);

  const lineQueries = built.query.seen
    .map((s) => s.query)
    .filter((q) => q.indexOf('transactionline') !== -1);

  assert.ok(lineQueries.length > 0, 'the invoice must read its lines from transactionline');
  for (const q of lineQueries) {
    assert.ok(/iscogs/.test(q),
      'every transactionline read must exclude COGS/asset rows (#185): ' + q.slice(0, 120));
  }
});

test('reference invoice fields reflect native source, legal buyer and settlement deductions', () => {
  const data = buildLib({ values: { custbody_thl_entlegalname: 'บริษัท ผู้ซื้อสังเคราะห์ จำกัด', custbody_thl_entbranchno: '00007' }, sums: [...SUMS, { sumtype: 'Cash Coupon', total: -100 }, { sumtype: 'Withholding Tax', total: -300 }] }).buildTransactionData('invoice', 42);
  assert.equal(data.document.refSo, 'SO2026-0044');
  assert.equal(data.document.docInfoRows[3].value, data.document.refSo);
  assert.equal(data.customer.branchCode, '00007');
  assert.equal(plain(data.customer.name), 'บริษัท ผู้ซื้อสังเคราะห์ จำกัด');
  assert.equal(data.totals.customerPaid, '10,300.00');
});


const summaryBaseline = require('./fixtures-invoice-summary-baseline.json');
for (const fixture of summaryBaseline.cases) {
  test(`joined header/summary matches pre-fusion financial/header output: ${fixture.name}`, () => {
    const { lib, query } = buildLibWith({ sums: fixture.sums });
    const data = lib.buildTransactionData('invoice', 42);
    const selected = Object.fromEntries(summaryBaseline.keys.map(key => [key, data[key]]));
    assert.deepEqual(JSON.parse(JSON.stringify(selected)), fixture.expected);
    assert.equal(query.seen.length, 3, 'header + summaries, printed lines, custom line fields only');
    const joined = query.seen.filter(call => call.query.includes('customrecord_thl_summarytotal'));
    assert.equal(joined.length, 1);
    assert.match(joined[0].query, /FROM transaction t LEFT JOIN customrecord_thl_summarytotal s/);
    assert.match(joined[0].query, /ON s.custrecord_sum_parenttransaction = t.id WHERE t.id = \?/);
    assert.deepEqual(Array.from(joined[0].params), [42]);
  });
}

test('all curated types use one header-summary query and keep the header without summary rows', () => {
  for (const type of buildLib().supportedTypes) {
    const { lib, query } = buildLibWith({ sums: [] });
    const data = lib.buildTransactionData(type, 42);
    assert.equal(data.document.number, HDR.tranid);
    assert.equal(data.document.date, HDR.trandate);
    assert.equal(query.seen.filter(call => call.query.includes('customrecord_thl_summarytotal')).length, 1);
    assert.equal(query.seen.length, ['customerpayment', 'itemfulfillment'].includes(type) ? 1 : 3);
  }
});


test('joined header retains currency, creator, dates and reference fields', () => {
  const { lib, query } = buildLibWith({ header: { currency_code: 'USD', created_by: '105 Synthetic Issuer' }, sums: [] });
  const data = lib.buildTransactionData('invoice', 42);
  assert.equal(data.document.currencyCode, 'USD');
  assert.equal(data.issuer.createdBy, 'Synthetic Issuer');
  assert.equal(data.document.date, HDR.trandate);
  assert.equal(data.document.dueDate, HDR.duedate);
  assert.equal(data.document.refNo, HDR.otherrefnum);
  assert.match(query.seen[0].query, /currency.id = t.currency/);
  assert.match(query.seen[0].query, /BUILTIN.DF\(t.createdby\) AS created_by/);
});


test('baseline print-time stub is independent of current day and preserves transaction dates', () => {
  for (const instant of ['2000-01-01T00:00:00Z', '2026-09-12T23:30:00Z', '2040-12-31T23:59:59Z']) {
    assert.equal(invoiceFormatStub.format({ value: new Date(instant), type: formatStub.Type.DATETIME }), '13/09/2026 10:30');
  }
  assert.equal(invoiceFormatStub.format({ value: new Date(2026, 6, 25), type: formatStub.Type.DATE }), '25/07/2026');
});

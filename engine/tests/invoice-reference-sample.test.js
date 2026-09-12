/** @author Wichit Wongta @since 2026-09-13 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../../templates/samples/invoice-reference-50.sample.json'), 'utf8'));
const money = x => Number(String(x).replaceAll(',', ''));
test('reference fixture has exactly 50 ordered unique Thai rows and matching raw aliases', () => {
  const r = sample.record;
  assert.equal(r.items.length, 50);
  assert.equal(r.item.length, 50);
  const codes = new Set();
  r.items.forEach((line, i) => {
    assert.equal(Number(line.no), i + 1);
    assert.match(line.name, /[ก-๙]/);
    codes.add(line.code);
    assert.equal(line.name, r.item[i].item);
    assert.equal(money(line.amount), r.item[i].amount);
    assert.equal(money(line.quantity), r.item[i].quantity);
    assert.equal(money(line.unit_price), r.item[i].rate);
  });
  assert.equal(codes.size, 50);
  assert.ok(r.items.filter(x => x.memo.includes('\n')).length >= 3);
  const gross = r.item.reduce((sum, x) => sum + x.amount, 0);
  assert.equal(gross, money(r.totals.gross));
  assert.equal(gross - money(r.totals.specialDiscount) - money(r.totals.advanceReceive), money(r.totals.baseAmount));
  assert.equal(money(r.totals.baseAmount) * money(r.totals.vatRate) / 100, money(r.totals.vat));
  assert.equal(money(r.totals.baseAmount) + money(r.totals.vat), money(r.totals.grandTotal));
  assert.equal(money(r.totals.grandTotal) - money(r.totals.wht) - money(r.totals.cashCoupon), money(r.totals.customerPaid));
  assert.equal(r.referenceCompany.logo, '');
  assert.equal(sample.company.fontRegular, '');
});

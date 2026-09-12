/** @author Wichit Wongta @since 2026-09-13 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./helpers/amd');
const words = loadAmd('./pld_lib_baht_text', {});
test('foreign currency words use the payment currency and round cents across whole units', () => {
  assert.equal(words.amountInWords(654.21, 'USD'), 'SIX HUNDRED FIFTY-FOUR DOLLAR AND TWENTY-ONE CENT');
  assert.equal(words.amountInWords(999.999, 'USD'), 'ONE THOUSAND DOLLAR ONLY');
  assert.equal(words.amountInWords(-1.05, 'USD'), 'MINUS ONE DOLLAR AND FIVE CENT');
  assert.equal(words.amountInWords(0, 'USD'), 'ZERO DOLLAR ONLY');
  assert.equal(words.amountInWords(5350, 'THB'), words.bahtText(5350));
  assert.equal(words.amountInWords(5350, ''), '');
  assert.throws(() => words.amountInWords(Infinity, 'USD'), /supported/);
});

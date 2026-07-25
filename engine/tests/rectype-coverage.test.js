/**
 * Record-type coverage across the three places that declare it (#159).
 *
 * The product declares record types in three runtimes that cannot import each other:
 *   1. pld_ue_button.js       SUPPORTED_TYPES — where the Print/Design buttons appear
 *   2. pld_lib_invoice_data.js DOC_TITLES     — which types get the curated Thai schema
 *   3. designer/src/constants/record-types.ts — what a consultant can save a template as
 *
 * They drifted (a button with no selectable template type, a curated type missing from
 * the dropdown), so this test reads all three as text and pins the relationship. The
 * intentional gap — types that print through the RAW record binding — is listed
 * explicitly, so adding a button forces a decision instead of a silent half-support.
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SRC_DIR } = require('./helpers/amd');
const DESIGNER_CONSTANTS = path.join(
  __dirname, '..', '..', 'designer', 'src', 'constants', 'record-types.ts',
);

/**
 * Types that print through the raw record binding — no curated Thai document data yet.
 *
 * Shrinking as #170 lands: tier A (vendorbill/cashsale/returnauthorization) reuses the
 * transaction-line builder as-is. What is left needs a DIFFERENT line source, which is
 * why it is not simply "more of the same": an itemfulfillment has lines but no rate or
 * amount, and a customerpayment has no item lines at all — its rows are the invoices
 * being paid.
 */
const RAW_PATH_TYPES = [
  'itemfulfillment', 'customerpayment',
];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function jsArrayStrings(src, varName) {
  const m = src.match(new RegExp('var\\s+' + varName + '\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;'));
  assert.ok(m, `${varName} not found`);
  return (m[1].replace(/\/\/[^\n]*/g, '').match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
}

function jsObjectKeys(src, varName) {
  const m = src.match(new RegExp('var\\s+' + varName + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\s*;'));
  assert.ok(m, `${varName} not found`);
  return (m[1].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || [])
    .map((s) => s.replace(/[\s:]/g, ''));
}

const buttonTypes = jsArrayStrings(read(path.join(SRC_DIR, 'pld_ue_button.js')), 'SUPPORTED_TYPES');
const curatedTypes = jsObjectKeys(read(path.join(SRC_DIR, 'pld_lib_invoice_data.js')), 'DOC_TITLES');
const designerTypes = (read(DESIGNER_CONSTANTS).match(/value:\s*'([^']+)'/g) || [])
  .map((s) => s.replace(/value:\s*'|'/g, ''));

test('the three declarations are all readable (the test itself must not rot)', () => {
  assert.ok(buttonTypes.length >= 5, `button types: ${buttonTypes.join(',')}`);
  assert.ok(curatedTypes.length >= 5, `curated types: ${curatedTypes.join(',')}`);
  assert.ok(designerTypes.length >= 5, `designer types: ${designerTypes.join(',')}`);
});

test('every curated type has a Print button', () => {
  for (const t of curatedTypes) {
    assert.ok(buttonTypes.indexOf(t) !== -1,
      `${t} gets curated Thai data but no button — nobody can print it from the record`);
  }
});

test('every type with a button can be saved as a template from the designer', () => {
  for (const t of buttonTypes) {
    assert.ok(designerTypes.indexOf(t) !== -1,
      `${t} has a Print button but is not selectable in the save dialog — the button leads nowhere`);
  }
});

test('the curated/raw split is exactly as declared — a new button forces a decision', () => {
  const raw = buttonTypes.filter((t) => curatedTypes.indexOf(t) === -1).sort();
  assert.deepEqual(raw, RAW_PATH_TYPES.slice().sort(),
    'a button type that is neither curated nor listed in RAW_PATH_TYPES: decide which it is ' +
    '(add curated data in pld_lib_invoice_data.js, or add it to RAW_PATH_TYPES here) — #159');
});

test('raw-path types still print a real copy label (no curated data needed)', () => {
  // the ${copy.*} data source is added on every render pass, so the label no longer
  // depends on the curated schema — see pld_sl_render_pdf.js copyBinding() (#159)
  const suitelet = read(path.join(SRC_DIR, 'pld_sl_render_pdf.js'));
  assert.match(suitelet, /alias: 'copy'/, 'copy data source must be registered');
  assert.match(suitelet, /function copyBinding/);
  assert.ok(suitelet.indexOf('renderWithCopies') !== -1, 'one copy path for all record types');
});

test('master templates bind the copy label through ${copy.*}', () => {
  const masterDir = path.join(__dirname, '..', '..', 'templates', 'master');
  const masters = fs.readdirSync(masterDir).filter((f) => f.endsWith('.xml'));

  for (const file of masters) {
    const src = read(path.join(masterDir, file));
    assert.match(src, /\$\{copy\.label!/, `${file} must print the copy label via \${copy.label}`);
    assert.ok(src.indexOf('record.custbody_doc_copy_label') === -1,
      `${file} still reads the copy label off the record — that only ever worked on curated types`);
  }
});

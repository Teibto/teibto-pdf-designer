/** Authenticated storage adversarial cases using real Node SHA256/HMAC.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadAmd } = require('./helpers/amd');
const { installBatchCrypto } = require('./helpers/batch-crypto');
function fixture() {
  const stubs = {};
  const control = installBatchCrypto(stubs);
  return { stubs, control, api: loadAmd('./pld_lib_batch_integrity', stubs) };
}
function wire(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(wire).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + wire(value[k])).join(',') + '}';
}

test('all domains round-trip deterministic canonical JSON without changing Thai, Unicode, or whitespace', () => {
  const { api } = fixture();
  const data = { z: ['ใบกำกับภาษี\r\n กำ กํา 😀', null, true, 12.5], a: { y: 2, x: 1 } };
  for (const domain of ['job', 'snapshot', 'part', 'result', 'artifact', 'plan', 'manifest', 'cleanup']) {
    const sealed = api.seal(domain, data);
    assert.equal(sealed, api.seal(domain, { a: { x: 1, y: 2 }, z: data.z }));
    assert.deepEqual(JSON.parse(JSON.stringify(api.open(domain, sealed))), data);
    const envelope = JSON.parse(sealed);
    const mac = envelope.mac;
    delete envelope.mac;
    assert.equal(mac, crypto.createHmac('sha256', 'synthetic-batch-test-key-never-use-in-an-account').update(wire(envelope), 'utf8').digest('hex'));
    for (const other of ['artifact','plan','manifest','cleanup']) if (other !== domain) assert.throws(() => api.open(other,sealed), /integrity/);
  }
});

test('domain, account, environment, key, version and every data change fail authentication', () => {
  const { api, stubs, control } = fixture();
  const sealed = api.seal('job', { id: '501', owner: '9' });
  for (const [key, value] of Object.entries({ domain: 'snapshot', accountId: 'OTHER', environment: 'PRODUCTION', keyId: 'v2', version: 2, data: { id: '501', owner: '10' } })) {
    const altered = JSON.parse(sealed); altered[key] = value;
    assert.throws(() => api.open('job', wire(altered)), /integrity/);
  }
  assert.throws(() => api.open('result', sealed), /integrity/);
  for (const domain of ['', '__proto__', 'toString', 'custom']) {
    assert.throws(() => api.seal(domain, {}), /integrity/);
    assert.throws(() => api.open(domain, sealed), /integrity/);
  }
  stubs['N/runtime'].accountId = 'OTHER';
  assert.throws(() => api.open('job', sealed), /integrity/);
  stubs['N/runtime'].accountId = 'SYNTHETIC_SB1';
  stubs['N/runtime'].envType = 'PRODUCTION';
  assert.throws(() => api.open('job', sealed), /integrity/);
  stubs['N/runtime'].envType = '';
  assert.throws(() => api.seal('job', {}), /integrity/);
  assert.ok(control.secretCalls > 0);
});

test('secret denial fails both creation and reading; no cached key bypass', () => {
  const { api, control } = fixture();
  const sealed = api.seal('snapshot', { xml: '<pdf>ไทย</pdf>' });
  control.denySecret = true;
  assert.throws(() => api.seal('job', {}), /integrity/);
  assert.throws(() => api.open('snapshot', sealed), /integrity/);
  assert.equal(control.secretCalls, 3);
});

test('malformed, missing, extra, duplicate and prototype wire keys fail closed', () => {
  const { api } = fixture();
  const sealed = api.seal('part', { ordinal: 0 });
  for (const text of ['', 'null', '{}', '[]', '{', sealed + ' ', sealed.replace('"version":1', '"version":1,"version":1'), sealed.replace('"data":', '"__proto__":{},"data":')]) {
    assert.throws(() => api.open('part', text), /integrity/);
  }
  for (const key of Object.keys(JSON.parse(sealed))) {
    const altered = JSON.parse(sealed); delete altered[key];
    assert.throws(() => api.open('part', wire(altered)), /integrity/);
  }
  for (const badMac of [null, 12, '', 'a'.repeat(63), 'a'.repeat(65), 'G'.repeat(64), 'A'.repeat(64)]) {
    const altered = JSON.parse(sealed); altered.mac = badMac;
    assert.throws(() => api.open('part', wire(altered)), /integrity/);
  }
  for (const index of [0, 31, 63]) {
    const altered = JSON.parse(sealed);
    altered.mac = altered.mac.slice(0, index) + (altered.mac[index] === '0' ? '1' : '0') + altered.mac.slice(index + 1);
    assert.throws(() => api.open('part', wire(altered)), /integrity/);
  }
});

test('unsupported data is rejected instead of silently dropped or transformed', () => {
  const { api } = fixture();
  const cycle = {}; cycle.self = cycle;
  const sparse = new Array(2);
  const arrayExtra = [1]; arrayExtra.extra = 2;
  const hidden = {}; Object.defineProperty(hidden, 'x', { value: 1 });
  const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { throw new Error('must not invoke'); } });
  for (const data of [undefined, NaN, Infinity, -Infinity, -0, 1n, () => 1, Symbol('x'), new Date(), new Map(), new Set(), /x/, new (class A {})(), cycle, sparse, arrayExtra, hidden, getter, { a: undefined }, { [Symbol('x')]: 1 }, { constructor: 1 }, { prototype: 1 }, JSON.parse('{"__proto__":{}}'), '\ud800', '\udfff']) {
    assert.throws(() => api.seal('job', data), /integrity/);
  }
  const repeated = { x: 1 };
  assert.doesNotThrow(() => api.seal('job', { a: repeated, b: repeated }));
  assert.doesNotThrow(() => api.seal('job', Object.assign(Object.create(null), { a: 1 })));
});

test('text hashing uses exact UTF8 and PDF hashing decodes binary base64', () => {
  const { api } = fixture();
  const text = 'ใบกำกับภาษี 😀\r\n';
  assert.equal(api.digest(text), crypto.createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.notEqual(api.digest('กำ'), api.digest('กํา'));
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 255, 128, 13, 10]);
  const b64 = bytes.toString('base64');
  assert.equal(api.digestPdf(b64), crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.notEqual(api.digestPdf(b64), api.digest(b64));
  for (const invalid of ['', 'AA', 'AA=', 'AA===', 'AB==', 'AAB=', 'AAAA\n', '****', 1]) assert.throws(() => api.digestPdf(invalid), /integrity/);
  for (const valid of ['AA==', 'AAA=', 'AAAA']) assert.doesNotThrow(() => api.digestPdf(valid));
  const large = Buffer.alloc(8 * 1024 * 1024, 255);
  assert.equal(api.digestPdf(large.toString('base64')), crypto.createHash('sha256').update(large).digest('hex'));
});

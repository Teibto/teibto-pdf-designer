/** Real cryptographic primitive adapter for synthetic batch tests.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function installBatchCrypto(stubs) {
  const runtime = stubs['N/runtime'] || (stubs['N/runtime'] = {});
  if (runtime.accountId === undefined) runtime.accountId = 'SYNTHETIC_SB1';
  if (runtime.envType === undefined) runtime.envType = 'SANDBOX';
  const state = { denySecret: false, secretCalls: 0 };
  const secret = 'synthetic-batch-test-key-never-use-in-an-account';
  const keys = new WeakSet();
  const encoding = { UTF_8: 'utf8', BASE_64: 'base64', HEX: 'hex' };
  function adapter(hash) {
    return {
      update({ input, inputEncoding }) {
        assert.ok([encoding.UTF_8, encoding.BASE_64].includes(inputEncoding));
        hash.update(Buffer.from(input, inputEncoding));
      },
      digest({ outputEncoding }) {
        assert.equal(outputEncoding, encoding.HEX);
        return hash.digest('hex');
      },
    };
  }
  stubs['N/encode'] = { Encoding: encoding };
  stubs['N/crypto'] = {
    HashAlg: { SHA256: 'SHA256' },
    createSecretKey(options) {
      state.secretCalls++;
      assert.deepEqual(options && { ...options }, { secret: 'custsecret_pld_batch_v1', encoding: encoding.UTF_8 });
      if (state.denySecret) throw new Error('Synthetic secret access denied');
      const key = {};
      keys.add(key);
      return key;
    },
    createHmac({ algorithm, key }) {
      assert.equal(algorithm, 'SHA256');
      assert.ok(keys.has(key));
      if (state.denySecret) throw new Error('Synthetic secret access denied');
      return adapter(crypto.createHmac('sha256', secret));
    },
    createHash({ algorithm }) {
      assert.equal(algorithm, 'SHA256');
      return adapter(crypto.createHash('sha256'));
    },
  };
  return state;
}
module.exports = { installBatchCrypto };

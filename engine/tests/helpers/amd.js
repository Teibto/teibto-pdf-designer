/**
 * Minimal AMD loader so the SuiteScript libraries under
 * engine/src/FileCabinet/SuiteScripts/pdf-layout-designer can be unit-tested in
 * plain Node (`node --test engine/tests`) — the engine had no automated coverage
 * at all before #155, only `node --check` + manual QA on SB2.
 *
 * Rules of the harness:
 *  - NetSuite modules (`N/*`) MUST be stubbed by the test; a missing stub throws
 *    instead of silently returning undefined.
 *  - sibling modules (`./pld_lib_*`) load from the REAL source by default, so a
 *    test exercises the real dependency chain (e.g. baht text + Thai wordbreak);
 *    pass an entry in `stubs` under the same id to override one.
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.join(
  __dirname, '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'pdf-layout-designer',
);

/**
 * Load one AMD module (`define([deps], factory)`) and return its exports.
 *
 * @param {string} moduleId  './pld_lib_invoice_data' or 'pld_lib_invoice_data'
 * @param {Object} [stubs]   module id → replacement (N/* required, './pld_*' optional)
 * @param {Map}    [cache]   shared instance cache for one load graph
 */
function loadAmd(moduleId, stubs, cache) {
  stubs = stubs || {};
  cache = cache || new Map();

  const id = String(moduleId).replace(/^\.\//, '').replace(/\.js$/, '');
  if (Object.prototype.hasOwnProperty.call(stubs, moduleId)) return stubs[moduleId];
  if (Object.prototype.hasOwnProperty.call(stubs, './' + id)) return stubs['./' + id];
  if (cache.has(id)) return cache.get(id);

  const file = path.join(SRC_DIR, id + '.js');
  const code = fs.readFileSync(file, 'utf8');

  let exported;
  const sandbox = {
    console,
    define(deps, factory) {
      // define(factory) — no dependencies
      if (typeof deps === 'function') {
        exported = deps();
        return;
      }
      const resolved = deps.map((dep) => {
        if (String(dep).indexOf('./') === 0) return loadAmd(dep, stubs, cache);
        if (!Object.prototype.hasOwnProperty.call(stubs, dep)) {
          throw new Error('no stub for NetSuite module "' + dep + '" required by ' + id);
        }
        return stubs[dep];
      });
      exported = factory.apply(null, resolved);
    },
  };

  vm.runInNewContext(code, sandbox, { filename: file });
  if (exported === undefined) throw new Error(id + ' did not export anything from define()');

  cache.set(id, exported);
  return exported;
}

module.exports = { loadAmd, SRC_DIR };

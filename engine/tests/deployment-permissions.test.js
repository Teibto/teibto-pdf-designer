/**
 * Prevent packaging a privilege-elevated PDF endpoint or anonymous data access.
 * Account readback and restricted-role QA must prove runtime enforcement.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest declares EXTREMELIST as an optional custom-record dependency', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '../src/manifest.xml'), 'utf8');
  const matches = [...manifest.matchAll(/<feature\s+required="([^"]+)">EXTREMELIST<\/feature>/g)];

  assert.equal(matches.length, 1, 'EXTREMELIST dependency must be declared exactly once');
  assert.equal(matches[0][1], 'false', 'validation dependency must not force the feature on every account');
});

test('packaged PDF deployments do not pin a role and Suitelets prohibit anonymous access', () => {
  const folder = path.join(__dirname, '../src/Objects');
  const files = fs.readdirSync(folder).filter((name) => name.startsWith('customscript_') && name.endsWith('.xml'));
  assert.ok(files.length >= 4);
  for (const filename of files) {
    const xml = fs.readFileSync(path.join(folder, filename), 'utf8');
    for (const deployment of xml.matchAll(/<scriptdeployment\b[^>]*>([\s\S]*?)<\/scriptdeployment>/g)) {
      // Empty fields preserve the intended upgrade instruction for user-facing
      // deployments. MR caller-role inheritance comes from programmatic submission;
      // this XML assertion cannot prove its effective execution role.
      assert.match(deployment[1], /<runasrole\s*(?:\/\s*>|>\s*<\/runasrole>)/, filename);
      assert.doesNotMatch(deployment[1], /<runasrole>\s*[^<\s]/, filename);
      if (xml.includes('<suitelet ')) {
        assert.match(deployment[1], /<isonline>F<\/isonline>/, filename);
        assert.doesNotMatch(deployment[1], /<audslctrole>[^<]*ONLINE_FORM_USER/, filename);
      }
    }
  }
});

test('render and merge each package two distinct on-demand deployments with bounded processing settings', () => {
  const deployments = new Set();
  for (const stage of ['mr', 'merge']) {
    const xml = fs.readFileSync(path.join(__dirname, '../src/Objects/customscript_pld_batch_' + stage + '.xml'), 'utf8');
    const rows = [...xml.matchAll(/<scriptdeployment\s+scriptid="([^"]+)"[^>]*>([\s\S]*?)<\/scriptdeployment>/g)];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row[1]), ['customdeploy_pld_batch_' + stage, 'customdeploy_pld_batch_' + stage + '_2']);
    for (const [, id, body] of rows) {
      assert.ok(!deployments.has(id), 'stage deployments must not collide'); deployments.add(id);
      for (const [field, value] of Object.entries({ isdeployed: 'T', status: 'NOTSCHEDULED', buffersize: '1', concurrencylimit: '1', loglevel: 'AUDIT' })) {
        assert.match(body, new RegExp('<' + field + '>' + value + '</' + field + '>'), id + ':' + field);
      }
      assert.doesNotMatch(body, /<recurrence\b/);
    }
  }
});

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

test('all packaged PDF deployments explicitly clear role elevation', () => {
  const folder = path.join(__dirname, '../src/Objects');
  const files = fs.readdirSync(folder).filter((name) => name.startsWith('customscript_') && name.endsWith('.xml'));
  assert.ok(files.length >= 4);
  for (const filename of files) {
    const xml = fs.readFileSync(path.join(folder, filename), 'utf8');
    for (const deployment of xml.matchAll(/<scriptdeployment\b[^>]*>([\s\S]*?)<\/scriptdeployment>/g)) {
      // Absence is not equivalent: an upgrade may preserve the deployed old role.
      assert.match(deployment[1], /<runasrole\s*(?:\/\s*>|>\s*<\/runasrole>)/, filename);
      assert.doesNotMatch(deployment[1], /<runasrole>\s*[^<\s]/, filename);
      if (xml.includes('<suitelet ')) {
        assert.match(deployment[1], /<isonline>F<\/isonline>/, filename);
        assert.doesNotMatch(deployment[1], /<audslctrole>[^<]*ONLINE_FORM_USER/, filename);
      }
    }
  }
});

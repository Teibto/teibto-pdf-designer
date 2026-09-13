/**
 * Catch missing transaction entry points and unintended execution scope in SDF.
 * Live account validation and role QA remain required after packaging checks.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../src');
const xml = fs.readFileSync(path.join(root, 'Objects/customscript_pld_ue_btn.xml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'FileCabinet/SuiteScripts/pdf-layout-designer/pld_ue_button.js'), 'utf8');
const deployments = [...xml.matchAll(/<scriptdeployment scriptid="([^"]+)">([\s\S]*?)<\/scriptdeployment>/g)];

test('SDF registers the documented button script and one deployment per supported transaction', () => {
  assert.match(xml, /<usereventscript scriptid="customscript_pld_ue_btn">/);
  assert.match(xml, /<scriptfile>\[\/SuiteScripts\/pdf-layout-designer\/pld_ue_button\.js\]<\/scriptfile>/);
  const supported = [...source.match(/var SUPPORTED_TYPES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)]
    .map(match => match[1].toUpperCase()).sort();
  const packaged = deployments.map(([, , body]) => body.match(/<recordtype>([^<]+)<\/recordtype>/)[1]).sort();
  assert.deepEqual(packaged, supported, 'missing or duplicated deployment leaves transaction entry points unavailable');
  assert.equal(new Set(deployments.map(row => row[1])).size, deployments.length);
  assert.match(deployments.find(row => row[1] === 'customdeploy_pld_ue_btn')[2], /<recordtype>INVOICE<\/recordtype>/);
  for (const [, id] of deployments) assert.ok(id.length <= 40, id + ': SDF scriptid limit');
  // #215: the natural id (customdeploy_pld_ue_btn_purchaserequisition, 43 chars) breaks the limit above
  assert.match(deployments.find(row => row[1] === 'customdeploy_pld_ue_btn_purchreq')[2], /<recordtype>PURCHASEREQUISITION<\/recordtype>/);
});

test('buttons run only on authenticated internal-role UI views without privilege elevation', () => {
  for (const [, id, body] of deployments) {
    for (const [field, value] of Object.entries({
      allroles: 'T', isdeployed: 'T', status: 'RELEASED',
      eventtype: 'VIEW', executioncontext: 'USERINTERFACE', loglevel: 'AUDIT',
    })) assert.match(body, new RegExp('<' + field + '>' + value + '</' + field + '>'), id);
    assert.match(body, /<runasrole>\s*<\/runasrole>/, id);
    assert.doesNotMatch(body, /<(?:audslctrole|allpartners|isonline)>/, 'no external audience or anonymous endpoint');
  }
  assert.doesNotMatch(xml, /<(?:beforesubmitfunction|aftersubmitfunction)>/);
});

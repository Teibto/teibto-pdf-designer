/** @author Wichit Wongta @since 2026-09-13 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/service.mjs';

const fixture = Buffer.from('%PDF-1.4\ntransport test only\n%%EOF\n');
test('canonical catalog needs no session and maps record types from XML', async () => {
  const result = await createService().listTemplates();
  assert.equal(result.templates.length, 7);
  assert.deepEqual(result.templates.find(t => t.id === 'invoice-reference'), { id: 'invoice-reference', rectype: 'invoice' });
  assert.deepEqual(result.templates.find(t => t.id === 'receipt'), { id: 'receipt', rectype: 'customerpayment' });
});
test('render uses exact master XML and copy labels; output is exclusive and bounded', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'pld-service-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  let request;
  const service = createService({ outputDir, account: '123_SB1', transport: { render: async input => { request = input; return fixture; } } });
  const result = await service.render({ template: 'invoice', outputName: 'test.pdf', copies: 2 });
  assert.equal(result.copies, 2);
  assert.equal(request.rectype, 'invoice');
  assert.equal(request.copies[1].en, 'Copy 1');
  assert.equal(request.xml, await readFile(new URL('../../templates/master/invoice.xml', import.meta.url), 'utf8'));
  assert.deepEqual(await readFile(result.path), fixture);
  await assert.rejects(service.render({ template: 'invoice', outputName: 'test.pdf' }), /already exists/);
  for (const outputName of ['../out.pdf', 'C:\\out.pdf', 'x.pdf:evil', 'CON.pdf', 'x.txt']) {
    await assert.rejects(service.render({ template: 'invoice', outputName }), /filename/);
  }
  await assert.rejects(service.render({ template: '../invoice', outputName: 'a.pdf' }), /template ID/);
  await assert.rejects(service.render({ template: 'unknown', outputName: 'a.pdf' }), /Unknown/);
  await assert.rejects(service.render({ template: 'invoice', outputName: 'a.pdf', copies: 11 }), /Copies/);
});
test('failed/invalid render leaves no placeholder and does not disclose remote error body', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'pld-service-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  for (const render of [async () => Buffer.from('<html>login</html>'), async () => { throw new Error('SECRET_CUSTOMER_BODY'); }]) {
    const service = createService({ outputDir, transport: { render } });
    await assert.rejects(service.render({ template: 'invoice', outputName: 'fail.pdf' }), error => !error.message.includes('SECRET_CUSTOMER_BODY'));
    assert.deepEqual(await readdir(outputDir), []);
  }
  await writeFile(path.join(outputDir, 'keep.pdf'), 'existing');
  await assert.rejects(createService({ outputDir }).render({ template: 'invoice', outputName: 'keep.pdf' }));
  assert.equal(await readFile(path.join(outputDir, 'keep.pdf'), 'utf8'), 'existing');
});
test('final PDF is absent until complete and concurrent output publication never overwrites', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'pld-service-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const render = async () => { entered(); await new Promise(resolve => { release = resolve; }); return fixture; };
  const service = createService({ outputDir, transport: { render } });
  const pending = service.render({ template: 'invoice', outputName: 'atomic.pdf' });
  await ready;
  assert.equal((await readdir(outputDir)).includes('atomic.pdf'), false);
  await writeFile(path.join(outputDir, 'atomic.pdf'), 'other writer', { flag: 'wx' });
  release();
  await assert.rejects(pending, /already exists/);
  assert.equal(await readFile(path.join(outputDir, 'atomic.pdf'), 'utf8'), 'other writer');
  assert.deepEqual(await readdir(outputDir), ['atomic.pdf']);
});
test('record mode requires operator opt-in and forwards only a validated record identifier', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'pld-service-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  await assert.rejects(createService({ outputDir, allowRecords: false }).render({ template: 'invoice', outputName: 'r.pdf', recordId: '1' }), /disabled/);
  let request;
  const service = createService({ outputDir, allowRecords: true, transport: { render: async input => { request = input; return fixture; } } });
  for (const recordId of ['0', '-1', '../1', 1]) await assert.rejects(service.render({ template: 'invoice', outputName: 'r.pdf', recordId }), /Record ID/);
  const result = await service.render({ template: 'invoice', outputName: 'r.pdf', recordId: '1' });
  assert.equal(result.mode, 'record');
  assert.equal(request.recordId, '1');
});

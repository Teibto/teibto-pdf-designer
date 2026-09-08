/** Requester boundaries and durable batch publication.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./helpers/amd');
const { runtimeStub, fileSystemStub, xmlStub, contextStub, logStub } = require('./helpers/ns-stubs');
const { batchStore } = require('./helpers/batch-store');
function fixture() {
  const user = { id: 9, role: 3 };
  const files = fileSystemStub({ files: {
    '/SuiteScripts/pdf-layout-designer/pld_version.txt': { folder: '55' },
    '900': { name: 'pld_job_501.json', folder: '77', isOnline: false, getContents: () => '{}' },
    '901': { name: 'batch_invoice_1_501.pdf', folder: '77', isOnline: false },
    '902': { name: 'other.pdf', folder: '88', isOnline: false },
    '903': { name: 'public.pdf', folder: '77', isOnline: true },
  } });
  let filters;
  const stubs = {
    'N/runtime': runtimeStub({ user }), 'N/file': files.module, 'N/xml': xmlStub,
    'N/log': logStub().module, 'N/task': {}, 'N/format': {},
    'N/record': { load() { throw new Error('Record unavailable'); } },
    'N/search': { Sort: { DESC: 'DESC' }, createColumn: (x) => x, create(opts) {
      filters = opts.filters;
      return { run: () => ({ getRange: () => [{ id: '501' }] }) };
    } },
    './pld_lib_render': {}, './pld_lib_invoice_data': {},
  };
  const rows = batchStore(stubs, files, { ids: ['11'] });
  rows.set('88', { owner: '10', parent: '55', isprivate: true });
  const job = rows.get('501');
  Object.assign(job, { custrecord_pld_job_status: 'COMPLETE', custrecord_pld_job_result: '901', custrecord_pld_job_printed: 1 });
  return { user, files, rows, job, stubs, jobs: loadAmd('./pld_lib_batch_jobs', stubs), filters: () => filters };
}

test('two users cannot read each other job metadata, snapshot, or PDF, including administrator role', () => {
  const f = fixture();
  assert.equal(f.jobs.download('501').name, 'batch_invoice_1_501.pdf');
  f.user.id = 10;
  for (const fn of [() => f.jobs.load('501'), () => f.jobs.download('501')]) assert.throws(fn, /unavailable/);
  assert.throws(() => f.jobs.load('../501'), /Invalid/);
  f.user.id = 9; f.user.role = 4;
  assert.throws(() => f.jobs.download('501'), /unavailable/);
});

test('forged requester and job owner fields cannot confer access to another private folder', () => {
  const f = fixture();
  f.user.id = 10;
  f.job.custrecord_pld_job_requester = '10';
  assert.throws(() => f.jobs.download('501'), /unavailable/);
  f.job.owner = '10';
  assert.throws(() => f.jobs.download('501'), /privacy\/owner\/parent/);
});

test('forged result and folder references reject cross-folder, public, owner and parent mismatch', () => {
  const f = fixture();
  f.job.custrecord_pld_job_result = '902';
  assert.throws(() => f.jobs.download('501'), /storage mismatch/);
  f.job.custrecord_pld_job_result = '903';
  assert.throws(() => f.jobs.download('501'), /storage mismatch/);
  f.job.custrecord_pld_job_folder = '88';
  assert.throws(() => f.jobs.download('501'), /privacy\/owner\/parent/);
  f.job.custrecord_pld_job_folder = '77';
  f.rows.get('77').parent = '99';
  assert.throws(() => f.jobs.download('501'), /privacy\/owner\/parent/);
  f.rows.get('77').parent = '55'; f.rows.get('77').isprivate = false;
  assert.throws(() => f.jobs.download('501'), /privacy\/owner\/parent/);
});

test('download is bound to committed job output and ignores arbitrary file request parameters', () => {
  const f = fixture(); const sl = loadAmd('./pld_sl_batch_print', f.stubs);
  const first = contextStub({ parameters: { action: 'download', job: '501', file: '902', fileid: '902' } });
  sl.onRequest(first.context);
  assert.equal(first.response.state.files[0].file.name, 'batch_invoice_1_501.pdf');
  f.job.custrecord_pld_job_status = 'RUNNING';
  const second = contextStub({ parameters: { action: 'download', job: '501', file: '901' } });
  sl.onRequest(second.context);
  assert.equal(second.response.state.files.length, 0);
  assert.match(second.response.state.body, /not committed/);
});

test('files page searches only requester plus role plus native owner and never exposes cabinet URLs', () => {
  const f = fixture(); const sl = loadAmd('./pld_sl_batch_print', f.stubs);
  const ctx = contextStub({ parameters: { action: 'files' } }); sl.onRequest(ctx.context);
  assert.deepEqual(JSON.parse(JSON.stringify(f.filters())), [
    ['custrecord_pld_job_requester', 'is', '9'], 'AND', ['custrecord_pld_job_role', 'is', '3'], 'AND', ['owner', 'anyof', '9'],
  ]);
  assert.match(ctx.response.state.body, /action=download/);
  assert.doesNotMatch(ctx.response.state.body, /media\.nl|\.json|\.xml|fileid=/);
  f.user.id = 10;
  const forbidden = contextStub({ parameters: { action: 'status', job: '501' } }); sl.onRequest(forbidden.context);
  assert.match(forbidden.response.state.body, /unavailable/);
  assert.doesNotMatch(forbidden.response.state.body, /batch_invoice/);
});

test('private folder must pass readback before create returns authority to write snapshot', () => {
  const f = fixture();
  const original = f.stubs['N/record'].load;
  f.stubs['N/record'].load = (opts) => {
    const rec = original(opts);
    if (opts.type === 'folder') {
      const getValue = rec.getValue;
      rec.getValue = (o) => o.fieldId === 'isprivate' ? false : getValue(o);
    }
    return rec;
  };
  assert.throws(() => f.jobs.create(2), /privacy\/owner\/parent/);
  assert.equal(f.files.created.length, 0);
});

test('folder setup failure marks already created job FAILED, preserving original error if status write fails', () => {
  for (const statusFails of [false, true]) {
    const f = fixture();
    f.rows.clear();
    const create = f.stubs['N/record'].create;
    f.stubs['N/record'].create = (opts) => {
      if (opts.type === 'folder') throw new Error('folder setup failed');
      return create(opts);
    };
    if (statusFails) f.stubs['N/record'].submitFields = () => { throw new Error('state write failed'); };
    assert.throws(() => f.jobs.create(2), /folder setup failed/);
    assert.equal(f.files.created.length, 0);
    assert.equal(f.rows.get('501').custrecord_pld_job_status, statusFails ? 'PREPARING' : 'FAILED');
  }
});

/** Requester boundaries and durable batch publication.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./helpers/amd');
const { runtimeStub, fileSystemStub, xmlStub, contextStub, logStub } = require('./helpers/ns-stubs');
const { batchStore, signJob } = require('./helpers/batch-store');
function fixture() {
  const user = { id: 9, role: 3 };
  const files = fileSystemStub({ files: {
    '/SuiteScripts/pdf-layout-designer/pld_version.txt': { folder: '55' },
    '900': { name: 'pld_job_501.json', folder: '77', isOnline: false, getContents: () => '{}' },
    '901': { name: 'batch_invoice_1_501.pdf', folder: '77', isOnline: false, size: 21, getContents: () => Buffer.from('%PDF-1.4 synthetic QA').toString('base64') },
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
  Object.assign(job, { custrecord_pld_job_status: 'COMPLETE', custrecord_pld_job_result: '901', custrecord_pld_job_printed: 1, custrecord_pld_job_failed: 0 });
  const integrity = loadAmd('./pld_lib_batch_integrity', stubs);
  job.custrecord_pld_job_resultseal = integrity.seal('result', { jobId: '501', folder: '77', fileId: '901', name: 'batch_invoice_1_501.pdf',
    contentsHash: integrity.digestPdf(Buffer.from('%PDF-1.4 synthetic QA').toString('base64')), size: 21, printed: 1, failed: 0, sequences: [0] });
  signJob(stubs, '501', job);
  return { integrity, user, files, rows, job, stubs, jobs: loadAmd('./pld_lib_batch_jobs', stubs), filters: () => filters };
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

test('coordinated requester, native owner, role and folder edits cannot forge authority', () => {
  const f = fixture();
  f.user.id = 10; f.user.role = 4;
  Object.assign(f.job, { owner: '10', custrecord_pld_job_requester: '10', custrecord_pld_job_role: '4', custrecord_pld_job_folder: '88' });
  assert.throws(() => f.jobs.download('501'), /integrity/);
  assert.throws(() => f.jobs.update('501', { task: 'forged' }), /integrity/);
  assert.equal(f.job.custrecord_pld_job_task, undefined);
});

test('signed job state rejects native result, folder, status and count edits', () => {
  for (const key of ['result', 'folder', 'parent', 'status', 'requested', 'printed', 'failed', 'task', 'snapshot', 'resultseal']) {
    const f = fixture(); f.job['custrecord_pld_job_' + key] = 'forged';
    assert.throws(() => f.jobs.load('501'), /integrity/, key);
    assert.throws(() => f.jobs.update('501', { task: 'new' }), /integrity/, key);
  }
});

test('authenticated job still requires actual folder privacy, owner and parent', () => {
  for (const change of [{ parent: '99' }, { owner: '10' }, { isprivate: false }]) {
    const f = fixture(); Object.assign(f.rows.get('77'), change);
    assert.throws(() => f.jobs.download('501'), /privacy\/owner\/parent/);
  }
});

test('download is bound to committed job output and ignores arbitrary file request parameters', () => {
  const f = fixture(); const sl = loadAmd('./pld_sl_batch_print', f.stubs);
  const first = contextStub({ parameters: { action: 'download', job: '501', file: '902', fileid: '902' } });
  sl.onRequest(first.context);
  assert.equal(first.response.state.files[0].file.name, 'batch_invoice_1_501.pdf');
  f.job.custrecord_pld_job_status = 'RUNNING';
  signJob(f.stubs, '501', f.job);
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
    if (statusFails) {
      const submit = f.stubs['N/record'].submitFields;
      f.stubs['N/record'].submitFields = (opts) => {
        if (opts.values.custrecord_pld_job_status === 'FAILED') throw new Error('state write failed');
        return submit(opts);
      };
    }
    assert.throws(() => f.jobs.create(2), /folder setup failed/);
    assert.equal(f.files.created.length, 0);
    assert.equal(f.rows.get('501').custrecord_pld_job_status, statusFails ? 'PREPARING' : 'FAILED');
  }
});

test('unsigned legacy rows, swapped seals, and missing secret access fail closed', () => {
  for (const auth of ['', '{}']) {
    const f = fixture(); f.job.custrecord_pld_job_auth = auth;
    assert.throws(() => f.jobs.load('501'));
    assert.throws(() => f.jobs.update('501', { status: 'COMPLETE' }));
  }
  const f = fixture();
  f.rows.set('502', { ...f.job });
  assert.throws(() => f.jobs.load('502'), /integrity/);
  f.stubs['N/crypto'].createHmac = () => { throw new Error('secret access denied'); };
  assert.throws(() => f.jobs.download('501'), /secret|integrity/i);
});

test('initial state seal precedes private folder creation and binds only original creation values', () => {
  const f = fixture(); f.rows.clear();
  const create = f.stubs['N/record'].create;
  f.stubs['N/record'].create = (opts) => {
    if (opts.type === 'folder') {
      assert.equal(f.jobs.load('501').status, 'PREPARING');
      assert.ok(f.rows.get('501').custrecord_pld_job_auth);
    }
    return create(opts);
  };
  assert.equal(f.jobs.create(1).folder, '502');
  const hostile = fixture(); hostile.rows.clear();
  const submit = hostile.stubs['N/record'].submitFields;
  hostile.stubs['N/record'].submitFields = (opts) => {
    // Simulates an edit between initial save and sealing, before the first reread.
    hostile.rows.get('501').custrecord_pld_job_role = '4';
    return submit(opts);
  };
  assert.throws(() => hostile.jobs.create(1), /RCRD_HAS_BEEN_CHANGED/);
  assert.equal(hostile.rows.size, 1, 'no folder/file after forged initial row');
  assert.equal(hostile.files.created.length, 0);
});

test('updates reseal authenticated prior state and cannot launder concurrent native edits', () => {
  const f = fixture();
  const before = f.job.custrecord_pld_job_auth;
  f.jobs.update('501', { task: 'task-new' });
  assert.equal(f.jobs.load('501').task, 'task-new');
  assert.notEqual(f.job.custrecord_pld_job_auth, before);
  const submit = f.stubs['N/record'].submitFields;
  f.stubs['N/record'].submitFields = (opts) => {
    f.job.custrecord_pld_job_requested = 99;
    return submit(opts);
  };
  assert.throws(() => f.jobs.update('501', { task: 'task-next' }), /integrity/);
  assert.throws(() => f.jobs.load('501'), /integrity/);
});

test('PDF bytes and metadata are verified before returning a new unsaved response file', () => {
  const f = fixture();
  const pdf = f.jobs.download('501');
  assert.equal(pdf.contents, Buffer.from('%PDF-1.4 synthetic QA').toString('base64'));
  assert.equal(pdf.isOnline, false);
  assert.equal(f.files.created.length, 0, 'download must not persist a new file');
  const original = f.files.module.load;
  f.files.module.load = (opts) => {
    const out = original(opts);
    if (String(opts.id) === '901') out.getContents = () => Buffer.from('%PDF-1.4 synthetic XX').toString('base64');
    return out;
  };
  assert.throws(() => f.jobs.download('501'), /contents integrity/);
});

test('oversized PDF is rejected before reading contents and signed result identity must match job', () => {
  const f = fixture(); const original = f.files.module.load; let reads = 0;
  f.files.module.load = (opts) => {
    const out = original(opts);
    if (String(opts.id) === '901') {
      out.size = 10 * 1024 * 1024 + 1;
      out.getContents = () => { reads++; return ''; };
    }
    return out;
  };
  assert.throws(() => f.jobs.download('501'), /Invalid batch result/);
  assert.equal(reads, 0);
  const other = fixture();
  const manifest = other.integrity.open('result', other.job.custrecord_pld_job_resultseal);
  manifest.fileId = '902';
  other.job.custrecord_pld_job_resultseal = other.integrity.seal('result', manifest);
  signJob(other.stubs, '501', other.job); // Trusted-but-inconsistent producer fixture.
  assert.throws(() => other.jobs.download('501'), /result integrity/);
});

test('optimistic locking retries authenticated concurrent worker updates without mixing signatures', () => {
  const f = fixture(); f.job.custrecord_pld_job_status = 'RUNNING'; signJob(f.stubs, '501', f.job);
  const submit = f.stubs['N/record'].submitFields; let raced = false; let taskAttempts = 0;
  f.stubs['N/record'].submitFields = (opts) => {
    if (opts.values.custrecord_pld_job_task) {
      taskAttempts++;
      if (!raced) { raced = true; f.jobs.update('501', { status: 'COMPLETE' }); }
    }
    return submit(opts);
  };
  const saved = f.jobs.update('501', { task: 'accepted-task' });
  assert.equal(taskAttempts, 2);
  assert.equal(saved.status, 'COMPLETE');
  assert.equal(saved.task, 'accepted-task');
  assert.equal(f.jobs.load('501').status, 'COMPLETE');
});

test('only named optimistic conflicts retry and retries stop after three attempts', () => {
  for (const conflict of [true, false]) {
    const f = fixture(); let attempts = 0;
    f.stubs['N/record'].submitFields = () => {
      attempts++; const e = new Error('save failed');
      if (conflict) e.name = 'RCRD_HAS_BEEN_CHANGED';
      throw e;
    };
    assert.throws(() => f.jobs.update('501', { task: 'next-task' }), /save failed/);
    assert.equal(attempts, conflict ? 3 : 1);
    assert.equal(f.jobs.load('501').status, 'COMPLETE');
  }
});

test('missing signing secret leaves newly created identity unsigned with no folder or snapshot', () => {
  const f = fixture(); f.rows.clear();
  f.stubs['N/crypto'].createHmac = () => { throw new Error('secret access denied'); };
  assert.throws(() => f.jobs.create(1), /secret|integrity/i);
  assert.equal(f.rows.size, 1);
  assert.equal(f.rows.get('501').custrecord_pld_job_auth, undefined);
  assert.equal(f.files.created.length, 0);
  assert.throws(() => f.jobs.load('501'));
});

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

test('a native create-only handle is never reused to update the saved job', () => {
  const f = fixture(); f.rows.clear();
  const create = f.stubs['N/record'].create;
  f.stubs['N/record'].create = options => {
    const rec = create(options);
    if (options.type === 'customrecord_pld_batch_job') {
      const save = rec.save; let saved = false;
      rec.save = () => {
        if (saved) throw new Error('Native create handle cannot update the saved identity');
        saved = true; return save();
      };
    }
    return rec;
  };
  const job = f.jobs.create(1);
  assert.equal(job.id, '501');
  assert.equal(f.jobs.load(job.id).status, 'PREPARING');
  assert.equal(f.rows.size, 2, 'one job and one private folder');
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

function publishChunks(f, groups, requested = 4) {
  const snapshotDigest = 'a'.repeat(64);
  const printed = groups.flat().length;
  const outputs = groups.map((sequences, ordinal) => ({ ordinal, fileId:'901',
    proof:f.integrity.seal('result', {jobId:'501',snapshotDigest,ordinal,folder:'77',fileId:'901',
      name:'batch_invoice_1_501.pdf',contentsHash:f.integrity.digestPdf(Buffer.from('%PDF-1.4 synthetic QA').toString('base64')),
      size:21,printed:sequences.length,failed:0,sequences,partRefs:[]}) }));
  Object.assign(f.job,{custrecord_pld_job_snapshotdigest:snapshotDigest,custrecord_pld_job_requested:requested,
    custrecord_pld_job_printed:printed,custrecord_pld_job_failed:requested-printed,
    custrecord_pld_job_status:printed===requested?'COMPLETE':'PARTIAL',
    custrecord_pld_job_outputs:f.integrity.seal('manifest',{jobId:'501',snapshotDigest,folder:'77',requested,
      printed,failed:requested-printed,outputs})});
  signJob(f.stubs,'501',f.job);
}

test('multiple published chunks require explicit ordinal and status shows ordered ranges plus missing sequences', () => {
  const f=fixture(); publishChunks(f,[[0,1],[3]]);
  assert.throws(()=>f.jobs.download('501'),/หมายเลขไฟล์/);
  assert.equal(f.jobs.download('501','1').getContents(),Buffer.from('%PDF-1.4 synthetic QA').toString('base64'));
  assert.throws(()=>f.jobs.download('501','2'),/หมายเลขไฟล์/);
  assert.throws(()=>f.jobs.download('501','../901'),/หมายเลขไฟล์/);
  assert.deepEqual(Array.from(f.jobs.failedSequences('501')),[2]);
  const sl=loadAmd('./pld_sl_batch_print',f.stubs),ctx=contextStub({parameters:{action:'status',job:'501'}});
  sl.onRequest(ctx.context);
  assert.match(ctx.response.state.body,/ไฟล์ 1 จาก 2/);
  assert.match(ctx.response.state.body,/chunk=1/);
  assert.match(ctx.response.state.body,/ลำดับเอกสารที่ไม่สำเร็จ: 3/);
  assert.doesNotMatch(ctx.response.state.body,/media.nl/);
});

test('signed but inconsistent output manifests cannot publish duplicate, unordered or missing accounting', () => {
  for(const groups of [[[0,1],[1]],[[2],[0]],[[0],[4]]]) {
    const f=fixture(); publishChunks(f,groups);
    assert.throws(()=>f.jobs.results('501'),/sequence/);
    assert.throws(()=>f.jobs.download('501','0'),/sequence/);
  }
  const f=fixture(); publishChunks(f,[[0],[1]]);
  f.job.custrecord_pld_job_status='RUNNING'; signJob(f.stubs,'501',f.job);
  assert.throws(()=>f.jobs.download('501','0'),/not committed/);
});

function recoveryFixture(status = 'FAILED') {
  const f=fixture(), submitted=[], checked=[];
  Object.assign(f.job,{custrecord_pld_job_status:'FAILED',custrecord_pld_job_phase:'MERGE_FAILED',custrecord_pld_job_result:'',custrecord_pld_job_resultseal:'',
    custrecord_pld_job_mergetask:'OLD_MERGE_TASK',custrecord_pld_job_snapshotdigest:'a'.repeat(64),
    custrecord_pld_job_plan:f.integrity.seal('plan',{jobId:'501',snapshotDigest:'a'.repeat(64),chunks:[{ordinal:0,sequences:[0]}]})});
  signJob(f.stubs,'501',f.job);
  f.stubs['N/task']={TaskType:{MAP_REDUCE:'MAP_REDUCE'},TaskStatus:{COMPLETE:'COMPLETE',FAILED:'FAILED'},
    checkStatus(opts){checked.push(opts.taskId);return{status};},
    create(opts){return{submit(){submitted.push(opts);return'NEW_MERGE_TASK';}};}};
  f.sl=loadAmd('./pld_sl_batch_print',f.stubs);
  f.issueToken=()=>{
    const ctx=contextStub({parameters:{action:'status',job:'501'}});f.sl.onRequest(ctx.context);
    const found=ctx.response.state.body.match(/name="token" value="([^"]+)"/);
    return found ? found[1].replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&') : '';
  };
  f.recoveryToken=f.issueToken();
  f.request=(method='POST',token=f.recoveryToken,extra={})=>{const ctx=contextStub({method,parameters:{action:'recover',job:'501',token,...extra}});f.sl.onRequest(ctx.context);return ctx.response.state;};
  return Object.assign(f,{submitted,checked});
}

test('merge recovery requires POST, authoritative terminal task and a single atomic claim', () => {
  for(const status of ['COMPLETE','FAILED']) {
    const f=recoveryFixture(status);
    assert.match(f.request('GET').body,/requires POST/);
    assert.equal(f.checked.length,0);
    assert.match(f.request().body,/ส่งเข้าคิวแล้ว/);
    assert.deepEqual(f.checked,['OLD_MERGE_TASK']);
    assert.equal(f.submitted.length,1);
    assert.equal(f.submitted[0].scriptId,'customscript_pld_batch_merge');
    assert.equal(Object.hasOwn(f.submitted[0],'deploymentId'),false);
    assert.equal(f.submitted[0].params.custscript_pld_merge_job,'501');
    assert.equal(f.jobs.load('501').mergetask,'NEW_MERGE_TASK');
    f.request();assert.equal(f.submitted.length,1,'double submission must not acquire a second claim');
  }
  for(const status of ['PROCESSING','PENDING',null]) {
    const f=recoveryFixture(status);f.request();
    assert.equal(f.submitted.length,0);
    assert.equal(f.jobs.load('501').phase,'MERGE_FAILED');
  }
});

test('merge recovery rejects changed claims and unknown submission is never retried automatically', () => {
  const raced=recoveryFixture();
  raced.stubs['N/task'].checkStatus=()=>{
    raced.jobs.update('501',{status:'RUNNING',phase:'MERGE_SUBMITTING',mergetask:''});return{status:'COMPLETE'};
  };
  assert.match(raced.request().body,/changed/);assert.equal(raced.submitted.length,0);
  const unknown=recoveryFixture();let attempts=0;
  unknown.stubs['N/task'].create=()=>({submit(){attempts++;throw new Error('uncertain submission');}});
  assert.match(unknown.request().body,/ไม่ต้องส่งซ้ำ/);
  assert.equal(unknown.jobs.load('501').phase,'MERGE_SUBMIT_UNKNOWN');
  assert.equal(unknown.jobs.load('501').mergetask,'');
  unknown.request();assert.equal(attempts,1);
});

test('accepted recovery with task metadata failure never retains old task identity for a later retry', () => {
  const f=recoveryFixture(),submit=f.stubs['N/record'].submitFields;
  f.stubs['N/record'].submitFields=opts=>{
    if(opts.values.custrecord_pld_job_mergetask==='NEW_MERGE_TASK')throw new Error('metadata unavailable');
    return submit(opts);
  };
  assert.match(f.request().body,/ระบบรับงานแล้ว/);
  assert.equal(f.submitted.length,1);
  assert.equal(f.jobs.load('501').mergetask,'');
  assert.equal(f.jobs.load('501').status,'RUNNING');
});

function renderRecoveryFixture(status='FAILED') {
  const f=recoveryFixture(status);
  const snapshot=f.integrity.seal('snapshot',{schemaVersion:5,jobId:'501',folder:'77',requester:{id:'9',role:'3'},ids:['11'],
    rectype:'invoice',templateSnapshot:{xml:'<pdf>synthetic</pdf>',copies:[{en:'Original'}]}});
  Object.assign(f.job,{custrecord_pld_job_phase:'DONE',custrecord_pld_job_plan:'',custrecord_pld_job_outputs:'',custrecord_pld_job_mergetask:'',
    custrecord_pld_job_task:'OLD_RENDER_TASK',custrecord_pld_job_result:'',custrecord_pld_job_resultseal:'',custrecord_pld_job_snapshotdigest:f.integrity.digest(snapshot)});
  signJob(f.stubs,'501',f.job);
  const load=f.files.module.load;
  f.files.module.load=(opts)=>String(opts.id)==='900'?{name:'pld_job_501.json',folder:'77',isOnline:false,size:Buffer.byteLength(snapshot),getContents:()=>snapshot}:load(opts);
  f.stubs['N/task'].create=opts=>({submit(){f.submitted.push(opts);return'NEW_RENDER_TASK';}});
  f.recoveryToken=f.issueToken();
  return f;
}

test('both recovery phases require an action-specific initial signature before task inspection',()=>{
  for(const build of [recoveryFixture,renderRecoveryFixture]) {
    for(const token of [null,'', '{}']) {
      const f=build();f.request('POST',token);
      assert.equal(f.checked.length,0);assert.equal(f.submitted.length,0);
    }
    const f=build();const forged=f.recoveryToken.replace('recover','forged');
    assert.notEqual(forged,f.recoveryToken);f.request('POST',forged);
    assert.equal(f.submitted.length,0);
    f.request('POST',f.integrity.seal('cleanup',{jobId:'501'}));assert.equal(f.submitted.length,0);
  }
});

test('known-terminal render recovery claims same immutable job once and ignores caller phase',()=>{
  for(const status of ['COMPLETE','FAILED']) {
    const f=renderRecoveryFixture(status);
    assert.match(f.request('GET').body,/requires POST/);
    assert.match(f.request('POST',f.recoveryToken,{kind:'MERGE',phase:'MERGE_FAILED'}).body,/ส่งเข้าคิวแล้ว/);
    assert.deepEqual(f.checked,['OLD_RENDER_TASK']);assert.equal(f.submitted.length,1);
    assert.equal(f.submitted[0].scriptId,'customscript_pld_batch_mr');
    assert.equal(Object.hasOwn(f.submitted[0],'deploymentId'),false);
    assert.equal(f.submitted[0].params.custscript_pld_mr_job,'501');
    const job=f.jobs.load('501');assert.equal(job.phase,'RENDER_SUBMITTING');assert.equal(job.task,'NEW_RENDER_TASK');assert.equal(job.plan,'');
    f.request();assert.equal(f.submitted.length,1);
  }
});

test('render recovery excludes active/unknown tasks, sealed plans, outputs, missing identity, and terminal successes',()=>{
  for(const status of ['PROCESSING','PENDING',null]) {const f=renderRecoveryFixture(status);f.request();assert.equal(f.submitted.length,0);}
  for(const change of [{task:''},{plan:'sealed-plan'},{outputs:'sealed-results'},{mergetask:'OLD_MERGE'},{status:'COMPLETE'},{status:'PARTIAL'},{phase:'RENDER_SUBMIT_UNKNOWN'}]) {
    const f=renderRecoveryFixture();
    for(const [key,value] of Object.entries(change))f.job['custrecord_pld_job_'+key]=value;
    signJob(f.stubs,'501',f.job);
    f.request();assert.equal(f.submitted.length,0,JSON.stringify(change));
  }
});

test('stale recovery token or different current user/role cannot claim a worker',()=>{
  const f=renderRecoveryFixture();f.jobs.update('501',{task:'REPLACED_RENDER_TASK'});
  assert.match(f.request().body,/token identity mismatch/);assert.equal(f.submitted.length,0);
  for(const actor of [{id:10,role:3},{id:9,role:4}]) {
    const other=renderRecoveryFixture();Object.assign(other.user,actor);
    assert.match(other.request().body,/unavailable/);assert.equal(other.submitted.length,0);
  }
});

test('render recovery validates snapshot bytes before claiming and rejects a concurrent signed plan',()=>{
  const altered=renderRecoveryFixture();const load=altered.files.module.load;
  altered.files.module.load=opts=>{const result=load(opts);if(String(opts.id)==='900')result.getContents=()=>'{corrupt';return result;};
  assert.match(altered.request().body,/snapshot digest mismatch/);assert.equal(altered.submitted.length,0);assert.equal(altered.jobs.load('501').task,'OLD_RENDER_TASK');
  const raced=renderRecoveryFixture();
  raced.stubs['N/task'].checkStatus=()=>{raced.jobs.update('501',{plan:raced.integrity.seal('plan',{jobId:'501'})});return{status:'COMPLETE'};};
  assert.match(raced.request().body,/changed/);assert.equal(raced.submitted.length,0);
});

test('render submission ambiguity fences retries and accepted metadata failure preserves active worker phase',()=>{
  for(const empty of [false,true]) {
    const f=renderRecoveryFixture();let attempts=0;
    f.stubs['N/task'].create=()=>({submit(){attempts++;if(empty)return'';throw new Error('unknown outcome');}});
    assert.match(f.request().body,/ไม่ต้องส่งซ้ำ/);assert.equal(f.jobs.load('501').phase,'RENDER_SUBMIT_UNKNOWN');assert.equal(f.jobs.load('501').task,'');
    f.request();assert.equal(attempts,1);
  }
  const f=renderRecoveryFixture(), submit=f.stubs['N/record'].submitFields;
  f.stubs['N/task'].create=opts=>({submit(){f.submitted.push(opts);f.jobs.update('501',{phase:'RENDERING'});return'NEW_RENDER_TASK';}});
  f.stubs['N/record'].submitFields=opts=>{if(opts.values.custrecord_pld_job_task==='NEW_RENDER_TASK')throw new Error('metadata failed');return submit(opts);};
  assert.match(f.request().body,/ระบบรับงานแล้ว/);assert.equal(f.submitted.length,1);assert.equal(f.jobs.load('501').phase,'RENDERING');assert.equal(f.jobs.load('501').task,'');
});

test('unknown recovery outcome has a status link without claiming PDF creation failed',()=>{
  const f=renderRecoveryFixture();
  f.stubs['N/task'].create=()=>({submit(){throw new Error('submission outcome unavailable');}});
  const response=f.request();
  assert.match(response.body,/ยังยืนยันการทำงานต่อไม่ได้/);
  assert.match(response.body,/action=status.*job=501/);
  assert.match(response.body,/รหัสอ้างอิง/);
  assert.doesNotMatch(response.body,/ระบบสร้างไฟล์ PDF ของชุดนี้ไม่ได้/);
  assert.doesNotMatch(response.body,/setTimeout|\.submit\(\)/);
});

test('definite recovery rejection waits for explicit signed retry in both stages without requiring a missing old task',()=>{
  for(const build of [recoveryFixture,renderRecoveryFixture]) {
    const f=build();const merge=f.jobs.load('501').phase==='MERGE_FAILED';let attempts=0;let reject=true;
    f.stubs['N/task'].create=()=>({submit(){attempts++;if(reject){const e=new Error('rejected');e.code='FAILED_TO_SUBMIT_JOB_REQUEST_1';throw e;}return'RETRY_ACCEPTED';}});
    assert.match(f.request().body,/ระบบยังไม่รับงานรอบนี้/);
    assert.equal(f.jobs.load('501').phase,merge?'MERGE_WAITING':'RENDER_WAITING');
    assert.equal(f.jobs.load('501').status,merge?'RUNNING':'QUEUED');
    assert.equal(f.checked.length,1);
    f.request('POST',null);assert.equal(attempts,1);
    assert.match(f.request('POST',f.issueToken()).body,/ระบบยังไม่รับงานรอบนี้/);
    assert.equal(f.checked.length,1,'no old task inspection for signed WAITING');
    reject=false;const token=f.issueToken();assert.match(f.request('POST',token).body,/ส่งเข้าคิวแล้ว/);
    assert.equal(f.jobs.load('501')[merge?'mergetask':'task'],'RETRY_ACCEPTED');
    f.request('POST',token);assert.equal(attempts,3);
  }
});

test('native unsigned WAITING state and caller-supplied waiting hints cannot authorize retry',()=>{
  const f=renderRecoveryFixture();
  f.job.custrecord_pld_job_status='QUEUED';f.job.custrecord_pld_job_phase='RENDER_WAITING';f.job.custrecord_pld_job_task='';
  assert.match(f.request().body,/integrity/);assert.equal(f.submitted.length,0);
  const unknown=renderRecoveryFixture();unknown.jobs.update('501',{status:'RUNNING',phase:'RENDER_SUBMIT_UNKNOWN',task:''});
  unknown.request('POST',unknown.recoveryToken,{phase:'RENDER_WAITING',waiting:'true'});assert.equal(unknown.submitted.length,0);
});


test('malformed recovery task identities remain unknown in both stages',()=>{
  for(const build of [recoveryFixture,renderRecoveryFixture]) for(const value of ['   ',42,{},true]) {
    const f=build();const kind=f.jobs.load('501').phase==='MERGE_FAILED'?'MERGE':'RENDER';let attempts=0;
    f.stubs['N/task'].create=()=>({submit(){attempts++;return value;}});
    assert.match(f.request().body,/ไม่ต้องส่งซ้ำ/);
    assert.equal(f.jobs.load('501').phase,kind+'_SUBMIT_UNKNOWN');
    assert.equal(f.jobs.load('501')[kind==='MERGE'?'mergetask':'task'],'');
    f.request('POST',f.issueToken());assert.equal(attempts,1);
  }
});

test('rejected recovery without durable WAITING cannot issue retry permission',()=>{
  const f=renderRecoveryFixture(), save=f.stubs['N/record'].submitFields;let attempts=0;
  f.stubs['N/task'].create=()=>({submit(){attempts++;throw Object.assign(new Error('rejected'),{name:'FAILED_TO_SUBMIT_JOB_REQUEST_1'});}});
  f.stubs['N/record'].submitFields=opts=>{if(opts.values.custrecord_pld_job_phase==='RENDER_WAITING')throw new Error('state write failed');return save(opts);};
  assert.match(f.request().body,/ระบบยังไม่รับงานรอบนี้/);
  assert.equal(f.jobs.load('501').phase,'RENDER_SUBMITTING');
  f.request('POST',f.issueToken());assert.equal(attempts,1);
});

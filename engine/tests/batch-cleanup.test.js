/** Bounded cleanup with real job, manifest, artifact, and HMAC verification.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./helpers/amd');
const { fileSystemStub, runtimeStub, logStub, xmlStub, contextStub } = require('./helpers/ns-stubs');
const { batchStore, signJob } = require('./helpers/batch-store');
const { installArtifactStore } = require('./helpers/batch-artifact-store');

function fixture({ count = 5, missing = [] } = {}) {
  const user = { id: 9, role: 3 }, files = fileSystemStub(), logs = logStub();
  const taskStates = { render: 'COMPLETE', merge: 'COMPLETE' }, checked = [];
  let usage = 1000;
  const stubs = {
    'N/runtime': runtimeStub({ user, usage: () => usage }), 'N/file': files.module, 'N/log': logs.module,
    'N/task': { checkStatus({ taskId }) { checked.push(taskId); return { status: taskStates[taskId] }; } },
    'N/xml': xmlStub, 'N/format': {}, './pld_lib_render': {}, './pld_lib_invoice_data': {},
    'N/record': { load() { throw new Error('Missing record'); } },
    'N/search': { Sort: { ASC: 'ASC' }, createColumn: x => x, create(opts) {
      assert.equal(opts.type, 'file');
      const id = String(opts.filters[0][2]);
      return { run: () => ({ getRange: () => Object.hasOwn(files.contents, id) ? [{ id }] : [] }) };
    } },
  };
  const ids = Array.from({ length: count }, (_, i) => String(11 + i));
  const rows = batchStore(stubs, files, { ids }), job = rows.get('501');
  const integrity = loadAmd('./pld_lib_batch_integrity', stubs);
  const save = (name, contents, fileType = 'PLAINTEXT', size = Buffer.byteLength(contents)) =>
    files.module.create({ name, contents, fileType, size, folder: '77', isOnline: false }).save();
  const spec = integrity.seal('snapshot', { schemaVersion: 5, jobId: '501', folder: '77', requester: { id: 9, role: 3 }, ids });
  job.custrecord_pld_job_snapshot = save('pld_job_501.json', spec, 'JSON');
  job.custrecord_pld_job_snapshotdigest = integrity.digest(spec);
  job.custrecord_pld_job_task = 'render'; job.custrecord_pld_job_mergetask = 'merge';
  signJob(stubs, '501', job);
  const artifactRows = installArtifactStore(stubs), ledger = loadAmd('./pld_lib_batch_artifacts', stubs);
  const ctx = { jobId: '501', snapshotDigest: integrity.digest(spec), folder: '77', ids };
  const parts = ids.map((recid, seq) => {
    const key = String(seq).padStart(6, '0'), name = 'pld_part_501_' + key + '.txt', contents = '<pdf>ทดสอบ ' + seq + '</pdf>';
    const partId = save(name, contents), tranId = 'SYNTHETIC-' + seq;
    const proof = integrity.seal('part', { jobId: '501', snapshotDigest: ctx.snapshotDigest, folder: '77', seq, recid, tranId,
      partId, name, bytes: Buffer.byteLength(contents), contentsHash: integrity.digest(contents) });
    const part = { partId, recid, tranId, key, proof };
    ledger.commit(ctx, 'PART', seq, part); return part;
  });
  const raw = '%PDF-1.4 synthetic QA', body = Buffer.from(raw).toString('base64');
  const pdfId = save('batch_501_chunk_0.pdf', body, 'PDF', Buffer.byteLength(raw));
  const sequences = ids.map((_, i) => i).filter(i => !missing.includes(i));
  const output = { ordinal: 0, fileId: pdfId, proof: integrity.seal('result', { jobId: '501', snapshotDigest: ctx.snapshotDigest,
    folder: '77', ordinal: 0, fileId: pdfId, name: 'batch_501_chunk_0.pdf', size: Buffer.byteLength(raw),
    contentsHash: integrity.digestPdf(body), printed: sequences.length, failed: 0, sequences,
    partRefs: sequences.map(seq => ({ seq, partId: parts[seq].partId, contentsHash: integrity.open('part', parts[seq].proof).contentsHash })) }) };
  const manifest = { jobId: '501', snapshotDigest: ctx.snapshotDigest, folder: '77', requested: count,
    printed: sequences.length, failed: missing.length, outputs: [output] };
  function publish() {
    Object.assign(job, { custrecord_pld_job_status: missing.length ? 'PARTIAL' : 'COMPLETE', custrecord_pld_job_phase: 'DONE',
      custrecord_pld_job_printed: sequences.length, custrecord_pld_job_failed: missing.length,
      custrecord_pld_job_outputs: integrity.seal('manifest', manifest) });
    signJob(stubs, '501', job);
  }
  publish();
  const originalLoad = files.module.load;
  files.module.load = opts => {
    const out = originalLoad(opts), metadata = files.created.find(x => String(x.id) === String(opts.id));
    return { ...out, fileType: metadata?.fileType };
  };
  files.module.delete = ({ id }) => {
    assert.ok(Object.hasOwn(files.contents, id), 'delete only existing files');
    files.deleted.push(String(id)); delete files.contents[id];
  };
  const cleanup = loadAmd('./pld_lib_batch_cleanup', stubs), jobs = loadAmd('./pld_lib_batch_jobs', stubs);
  return { user, files, rows, job, integrity, artifactRows, stubs, parts, pdfId, manifest, publish, cleanup, jobs, taskStates, checked,
    setUsage: v => { usage = v; }, reseal: () => signJob(stubs, '501', job) };
}

test('cleanup is bounded, resumes signed cursor, retains published PDF and snapshot, and replays safely', () => {
  const f = fixture(), token = f.cleanup.token('501');
  const first = f.cleanup.run('501', token);
  assert.equal(first.deleted, 3); assert.equal(first.next, 3); assert.ok(first.token);
  const replay = f.cleanup.run('501', token);
  assert.equal(replay.deleted, 0); assert.equal(replay.unavailable, 3);
  const last = f.cleanup.run('501', first.token);
  assert.equal(last.deleted, 2); assert.equal(last.next, 5); assert.equal(last.token, '');
  assert.equal(f.files.deleted.length, 5);
  assert.ok(f.files.contents[f.job.custrecord_pld_job_snapshot]);
  assert.equal(f.jobs.download('501', 0).name, 'batch_501_chunk_0.pdf');
  assert.deepEqual(f.checked.slice(0, 2), ['render', 'merge']);
});

test('partial jobs retain unpublished inputs and unrelated orphan files', () => {
  const f = fixture({ count: 3, missing: [1] });
  const orphan = f.files.module.create({ name: 'orphan.txt', contents: 'keep', folder: '77', isOnline: false }).save();
  const out = f.cleanup.run('501', f.cleanup.token('501'));
  assert.equal(out.deleted, 2); assert.equal(out.retained, 1);
  assert.ok(f.files.contents[f.parts[1].partId]); assert.ok(f.files.contents[orphan]);
});

test('first POST requires an action-specific untampered token bound to current owner and role', () => {
  const f = fixture(), token = f.cleanup.token('501');
  for (const value of [undefined, '', token.replace('cleanup', 'recover'), f.integrity.seal('plan', {})])
    assert.throws(() => f.cleanup.run('501', value), /token|integrity/i);
  for (const actor of [{ id: 10, role: 3 }, { id: 9, role: 4 }]) {
    Object.assign(f.user, actor); assert.throws(() => f.cleanup.run('501', token), /unavailable/);
  }
  assert.equal(f.files.deleted.length, 0);
});

test('running, failed, unknown and missing task identities cannot clean even a published job', () => {
  for (const state of ['PENDING', 'PROCESSING', undefined]) {
    const f = fixture(); f.taskStates.render = state;
    assert.throws(() => f.cleanup.run('501', f.cleanup.token('501')), /ยังไม่หยุด/); assert.equal(f.files.deleted.length, 0);
  }
  for (const field of ['task', 'mergetask']) {
    const f = fixture(); f.job['custrecord_pld_job_' + field] = ''; f.reseal();
    assert.throws(() => f.cleanup.run('501', f.cleanup.token('501')), /ยังไม่หยุด/);
  }
  for (const status of ['FAILED', 'RUNNING', 'QUEUED']) {
    const f = fixture(), token = f.cleanup.token('501'); f.job.custrecord_pld_job_status = status; f.reseal();
    assert.throws(() => f.cleanup.run('501', token), /เผยแพร่ PDF/); assert.equal(f.files.deleted.length, 0);
  }
});

test('changed generation or manifest invalidates an earlier continuation', () => {
  for (const field of ['snapshotdigest', 'outputs']) {
    const f = fixture(), token = f.cleanup.token('501'); f.job['custrecord_pld_job_' + field] += 'changed'; f.reseal();
    assert.throws(() => f.cleanup.run('501', token), /token identity/); assert.equal(f.files.deleted.length, 0);
  }
});

test('altered PDF, part contents, private folder, type and ledger prevent deletion', () => {
  const mutations = [
    f => { f.files.contents[f.pdfId] = Buffer.from('tampered').toString('base64'); },
    f => { f.files.contents[f.parts[0].partId] = '<pdf>changed</pdf>'; },
    f => { f.rows.get('77').isprivate = false; },
    f => { f.files.created.find(x => x.id === f.parts[0].partId).fileType = 'PDF'; },
    f => { f.artifactRows.values().next().value.custrecord_pld_art_payload = '{}'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(), token = f.cleanup.token('501'); mutate(f);
    assert.throws(() => f.cleanup.run('501', token), /integrity|metadata|privacy|contents/i);
    assert.equal(f.files.deleted.length, 0);
  }
});

test('signed but incorrect chunk references cannot authorize unrelated part deletion', () => {
  for (const mutate of [p => { p.partRefs[0].partId = '9999'; }, p => { p.partRefs[0].contentsHash = 'a'.repeat(64); },
    p => { p.partRefs[0].seq = 1; }, p => { delete p.partRefs; }]) {
    const f = fixture(), output = f.manifest.outputs[0];
    const proof = f.integrity.open('result', output.proof); mutate(proof);
    output.proof = f.integrity.seal('result', proof); f.publish();
    assert.throws(() => f.cleanup.run('501', f.cleanup.token('501')), /reference/i); assert.equal(f.files.deleted.length, 0);
  }
});

test('low governance stops before deletes, and a concurrent authenticated state change stops deletion', () => {
  const f = fixture(), token = f.cleanup.token('501'); f.setUsage(249);
  assert.throws(() => f.cleanup.run('501', token), /โควตา/); assert.equal(f.files.deleted.length, 0);
  const g = fixture(), second = g.cleanup.token('501'), load = g.files.module.load;
  g.files.module.load = opts => {
    const out = load(opts);
    if (String(opts.id) === g.pdfId) { g.job.custrecord_pld_job_mergetask = 'different'; g.reseal(); }
    return out;
  };
  assert.throws(() => g.cleanup.run('501', second), /changed during cleanup/); assert.equal(g.files.deleted.length, 0);
});

test('Suitelet requires POST and issues signed continuation forms after an explicit start', () => {
  const f = fixture(), sl = loadAmd('./pld_sl_batch_print', f.stubs);
  const get = contextStub({ parameters: { action: 'cleanup', job: '501' } }); sl.onRequest(get.context);
  assert.match(get.response.state.body, /Cleanup requires POST/); assert.equal(f.files.deleted.length, 0);
  const status = contextStub({ parameters: { action: 'status', job: '501' } }); sl.onRequest(status.context);
  assert.match(status.response.state.body, /name="token"/); assert.doesNotMatch(status.response.state.body, /setTimeout/);
  const post = contextStub({ method: 'POST', parameters: { action: 'cleanup', job: '501', token: f.cleanup.token('501') } });
  sl.onRequest(post.context);
  assert.equal(f.files.deleted.length, 3); assert.match(post.response.state.body, /setTimeout/);
  assert.match(post.response.state.body, /หยุดและกลับไปดูงาน/);
});

test('concurrent deletion is reported unavailable while permission errors remain visible', () => {
  for (const stage of ['load', 'delete']) {
    const f = fixture({ count: 1 }), token = f.cleanup.token('501'), id = f.parts[0].partId;
    const original = f.files.module[stage];
    f.files.module[stage] = opts => {
      if (String(opts.id) === id) { delete f.files.contents[id]; throw new Error('Concurrent disappearance'); }
      return original(opts);
    };
    const out = f.cleanup.run('501', token);
    assert.equal(out.unavailable, 1); assert.equal(out.deleted, 0); assert.equal(out.token, '');
  }
  const f = fixture(), token = f.cleanup.token('501');
  f.files.module.delete = () => { throw new Error('Delete permission denied'); };
  assert.throws(() => f.cleanup.run('501', token), /permission denied/);
  assert.equal(f.files.deleted.length, 0);
});

test('governance depleted by PDF verification stops before reading or deleting a part', () => {
  const f = fixture(), token = f.cleanup.token('501'), load = f.files.module.load;
  f.files.module.load = opts => {
    const out = load(opts);
    if (String(opts.id) === f.pdfId) f.setUsage(100);
    return out;
  };
  assert.throws(() => f.cleanup.run('501', token), /โควตา/); assert.equal(f.files.deleted.length, 0);
});

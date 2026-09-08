/** Linked retries preserve source results and submit each reserved child at most once.
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/file', 'N/search', 'N/task', 'N/log', './pld_lib_batch_jobs', './pld_lib_batch_integrity', './pld_lib_batch_selection'],
function (file, search, task, log, jobs, integrity, selection) {
  function binding(source) {
    return { action: 'retry_failed', sourceJobId: source.job.id, requester: source.job.requester, role: source.job.role,
      snapshotDigest: source.sourceSnapshotDigest, planDigest: source.sourcePlanDigest,
      outputsDigest: source.sourceOutputsDigest, sequences: source.sequences };
  }
  // Stable across signing-key rotation; binding constructs a fixed property order.
  function key(source) { return 'pld-retry-' + integrity.digest(JSON.stringify(binding(source))); }
  function token(jobId) {
    var source = selection.read(jobId);
    return integrity.seal('retry', { binding: binding(source), state: integrity.digest(integrity.seal('job', source.job)) });
  }
  function bytes(text) {
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) total++;
      else if (c < 2048) total += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { total += 4; i++; }
      else total += 3;
    }
    return total;
  }
  function verifySnapshot(job, id, name, contents, digest) {
    var stored = jobs.loadFile(job, id);
    if (stored.name !== name || stored.fileType !== file.Type.JSON || Number(stored.size) !== bytes(contents) ||
      integrity.digest(stored.getContents()) !== digest) throw new Error('Retry snapshot integrity mismatch');
    return String(id);
  }
  function candidates(job, name, contents, digest) {
    var rows = search.create({ type: 'file', filters: [['folder', 'anyof', String(job.folder)], 'AND', ['name', 'is', name]], columns: ['internalid'] })
      .run().getRange({ start: 0, end: 4 });
    if (rows.length > 3) throw new Error('Retry snapshot candidate limit');
    var ids = rows.map(function (row) { return verifySnapshot(job, row.id, name, contents, digest); });
    ids.sort(function (a, b) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); });
    return ids[0] || '';
  }
  function snapshot(source, job) {
    var contents = integrity.seal('snapshot', {
      schemaVersion: 5, jobId: job.id, folder: job.folder, rectype: source.rectype, tplid: source.tplid,
      ids: source.ids, templateSnapshot: source.templateSnapshot,
      requester: { id: job.requester, role: job.role }, lineage: binding(source),
    });
    if (bytes(contents) > 8 * 1024 * 1024) throw new Error('Retry snapshot exceeds 8 MiB');
    var name = 'pld_job_' + job.id + '.json', digest = integrity.digest(contents);
    if (job.snapshot) {
      if (job.snapshotdigest !== digest) throw new Error('Retry snapshot identity mismatch');
      verifySnapshot(job, job.snapshot, name, contents, digest);
      return job;
    }
    var id = candidates(job, name, contents, digest);
    if (!id) {
      jobs.assertFolder(jobs.load(job.id));
      try {
        id = String(file.create({ name: name, fileType: file.Type.JSON, contents: contents, encoding: file.Encoding.UTF8,
          folder: job.folder, isOnline: false }).save());
      } catch (error) {
        id = candidates(jobs.load(job.id), name, contents, digest);
        if (!id) throw error;
      }
      verifySnapshot(jobs.load(job.id), id, name, contents, digest);
    }
    try {
      return jobs.update(job.id, { snapshot: id, snapshotdigest: digest },
        { status: 'PREPARING', phase: 'PROVISIONING', snapshot: '', snapshotdigest: '', folder: job.folder });
    } catch (error) {
      var current = jobs.load(job.id);
      if (!current.snapshot || current.snapshotdigest !== digest) throw error;
      verifySnapshot(current, current.snapshot, name, contents, digest);
      return current;
    }
  }
  function run(jobId, supplied) {
    var source = selection.read(jobId);
    if (typeof supplied !== 'string' || supplied.length > 16384) throw new Error('Invalid linked retry token');
    var opened = integrity.open('retry', supplied);
    var expected = { binding: binding(source), state: integrity.digest(integrity.seal('job', source.job)) };
    if (integrity.seal('retry', opened) !== integrity.seal('retry', expected)) throw new Error('Linked retry token identity mismatch');
    var job = jobs.createReserved(source.ids.length, key(source));
    if (job.status !== 'PREPARING' || job.phase !== 'PROVISIONING') return { job: job };
    job = snapshot(source, job);
    if (job.status !== 'PREPARING' || job.phase !== 'PROVISIONING') return { job: job };
    var pending = task.create({ taskType: task.TaskType.MAP_REDUCE, scriptId: 'customscript_pld_batch_mr', params: { custscript_pld_mr_job: job.id } });
    if (!pending || typeof pending.submit !== 'function') throw new Error('Retry task preparation failed');
    try {
      job = jobs.update(job.id, { status: 'QUEUED', phase: 'RENDER_SUBMITTING' },
        { status: 'PREPARING', phase: 'PROVISIONING', snapshot: job.snapshot, snapshotdigest: job.snapshotdigest, task: '', plan: '', outputs: '' });
    } catch (error) {
      var winner = jobs.load(job.id);
      if (winner.status !== 'PREPARING' || winner.phase !== 'PROVISIONING') return { job: winner };
      throw error;
    }
    var taskId;
    try {
      taskId = pending.submit();
      if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('Missing retry task identity');
    } catch (error) {
      var rejected = !!error && (error.name === 'FAILED_TO_SUBMIT_JOB_REQUEST_1' || error.code === 'FAILED_TO_SUBMIT_JOB_REQUEST_1');
      try {
        jobs.update(job.id, { phase: rejected ? 'RENDER_WAITING' : 'RENDER_SUBMIT_UNKNOWN' },
          { status: 'QUEUED', phase: 'RENDER_SUBMITTING', task: '', snapshot: job.snapshot, snapshotdigest: job.snapshotdigest, plan: '', outputs: '', result: '' });
      } catch (stateError) {
        log.error({ title: 'PLD linked retry outcome persistence failed', details: { jobId: job.id, message: stateError.message } });
      }
      log.error({ title: rejected ? 'PLD linked retry deferred' : 'PLD linked retry submission unknown', details: { jobId: job.id, message: error.message } });
      return { job: jobs.load(job.id) };
    }
    try { jobs.update(job.id, { task: taskId }, { task: '' }); }
    catch (error) {
      log.error({ title: 'PLD linked retry accepted; task identity not persisted', details: { jobId: job.id, taskId: taskId, message: error.message } });
      return { job: jobs.load(job.id), warning: 'ระบบรับงานแล้ว แต่บันทึกหมายเลขประมวลผลไม่สำเร็จ' };
    }
    return { job: jobs.load(job.id) };
  }
  function origin(jobId) {
    var job = jobs.load(jobId);
    if (!/^pld-retry-[a-f0-9]{64}$/.test(job.externalid || '')) return null;
    var stored = jobs.loadFile(job, job.snapshot);
    if (stored.name !== 'pld_job_' + job.id + '.json' || stored.fileType !== file.Type.JSON ||
      !Number.isSafeInteger(Number(stored.size)) || Number(stored.size) < 1 || Number(stored.size) > 8 * 1024 * 1024) throw new Error('Retry lineage snapshot invalid');
    var contents = stored.getContents();
    if (typeof contents !== 'string' || bytes(contents) > 8 * 1024 * 1024 || integrity.digest(contents) !== job.snapshotdigest) throw new Error('Retry lineage snapshot mismatch');
    var spec = integrity.open('snapshot', contents), lineage = spec.lineage;
    if (String(spec.jobId) !== job.id || String(spec.folder) !== job.folder || !spec.requester ||
      String(spec.requester.id) !== job.requester || String(spec.requester.role) !== job.role || !lineage ||
      !Array.isArray(lineage.sequences) || lineage.sequences.length !== Number(job.requested)) throw new Error('Retry lineage identity mismatch');
    var parent = jobs.load(lineage.sourceJobId);
    if (lineage.sequences.some(function (seq, i, all) { return !Number.isInteger(seq) || seq < 0 || seq >= Number(parent.requested) || (i && seq <= all[i - 1]); })) throw new Error('Retry lineage sequences invalid');
    var source = { job: parent, sequences: lineage.sequences, sourceSnapshotDigest: parent.snapshotdigest,
      sourcePlanDigest: integrity.digest(parent.plan), sourceOutputsDigest: integrity.digest(parent.outputs || '') };
    if (key(source) !== job.externalid || integrity.seal('retry', lineage) !== integrity.seal('retry', binding(source))) throw new Error('Retry source identity mismatch');
    return { jobId: parent.id, sequences: lineage.sequences };
  }
  return { token: token, run: run, origin: origin };
});

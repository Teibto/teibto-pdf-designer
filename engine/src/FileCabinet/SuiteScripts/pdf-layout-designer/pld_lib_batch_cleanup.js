/** Owner-requested cleanup of published batch inputs, bounded per request.
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/file', 'N/search', 'N/task', 'N/runtime', 'N/log', './pld_lib_batch_jobs', './pld_lib_batch_artifacts', './pld_lib_batch_integrity'],
function (file, search, task, runtime, log, jobs, artifacts, integrity) {
  var LIMIT = 3;
  function terminal(job) {
    if (['COMPLETE', 'PARTIAL'].indexOf(job.status) < 0 || !job.outputs || !job.snapshotdigest)
      throw new Error('ล้างไฟล์ชั่วคราวได้เฉพาะงานที่เผยแพร่ PDF แล้ว');
  }
  function binding(job, next) {
    return { action: 'cleanup', jobId: job.id, requester: job.requester, role: job.role,
      snapshotDigest: job.snapshotdigest, outputsDigest: integrity.digest(job.outputs), next: next };
  }
  function token(jobId) {
    var job = jobs.load(jobId);
    terminal(job);
    jobs.results(jobId);
    return integrity.seal('cleanup', binding(job, 0));
  }
  function stopped(job) {
    [job.task, job.mergetask].forEach(function (taskId) {
      if (!taskId || ['COMPLETE', 'FAILED'].indexOf(task.checkStatus({ taskId: taskId }).status) < 0)
        throw new Error('งานเบื้องหลังยังไม่หยุดหรือยังยืนยันสถานะไม่ได้ กรุณาลองล้างไฟล์ภายหลัง');
    });
  }
  function unchanged(initial) {
    var current = jobs.load(initial.id);
    ['status', 'phase', 'snapshot', 'snapshotdigest', 'outputs', 'task', 'mergetask', 'folder', 'parent'].forEach(function (k) {
      if (current[k] !== initial[k]) throw new Error('Batch job changed during cleanup');
    });
    terminal(current);
    jobs.assertFolder(current);
    return current;
  }
  function snapshot(job) {
    var stored = jobs.loadFile(job, job.snapshot);
    if (Number(stored.size) > 8 * 1024 * 1024) throw new Error('Batch snapshot size limit');
    var text = stored.getContents();
    if (typeof text !== 'string' || text.length > 8 * 1024 * 1024 || integrity.digest(text) !== job.snapshotdigest)
      throw new Error('Batch snapshot digest mismatch');
    var spec = integrity.open('snapshot', text);
    if (!spec || spec.schemaVersion !== 5 || String(spec.jobId) !== job.id || String(spec.folder) !== job.folder ||
      !spec.requester || String(spec.requester.id) !== job.requester || String(spec.requester.role) !== job.role ||
      !Array.isArray(spec.ids) || !spec.ids.length || spec.ids.length > 500 || spec.ids.length !== Number(job.requested) ||
      spec.ids.some(function (id) { return !/^[1-9][0-9]*$/.test(String(id)); })) throw new Error('Batch cleanup snapshot identity mismatch');
    return { jobId: job.id, folder: job.folder, snapshotDigest: job.snapshotdigest, ids: spec.ids };
  }
  function run(jobId, sealed) {
    var started = Date.now();
    function budget() { return runtime.getCurrentScript().getRemainingUsage() >= 250 && Date.now() - started <= 20000; }
    function present(partId) {
      var found = search.create({ type: 'file', filters: [['internalid', 'anyof', partId]], columns: ['internalid'] })
        .run().getRange({ start: 0, end: 2 });
      if (found.length && (found.length !== 1 || String(found[0].id) !== partId)) throw new Error('Ambiguous cleanup file');
      return found.length === 1;
    }
    var job = jobs.load(jobId);
    terminal(job);
    if (typeof sealed !== 'string' || sealed.length > 4096) throw new Error('Invalid cleanup token');
    var cursor = integrity.open('cleanup', sealed);
    if (!cursor || !Number.isInteger(cursor.next) || cursor.next < 0 || cursor.next >= Number(job.requested)) throw new Error('Invalid cleanup cursor');
    var expected = binding(job, cursor.next);
    if (Object.keys(cursor).length !== Object.keys(expected).length || Object.keys(expected).some(function (k) { return cursor[k] !== expected[k]; }))
      throw new Error('Cleanup token identity mismatch');
    stopped(job);
    var ctx = snapshot(job);
    jobs.results(jobId); // Full manifest validation before reading its producer references.
    var manifest = integrity.open('manifest', job.outputs);
    var bySequence = {}, protectedIds = {};
    protectedIds[job.snapshot] = true;
    if (job.result) protectedIds[job.result] = true;
    manifest.outputs.forEach(function (output) {
      var proof = integrity.open('result', output.proof);
      protectedIds[String(output.fileId)] = true;
      if (!Array.isArray(proof.partRefs) || proof.partRefs.length !== proof.sequences.length) throw new Error('Invalid cleanup chunk references');
      proof.sequences.forEach(function (seq, index) {
        var ref = proof.partRefs[index];
        if (!ref || ref.seq !== seq || !/^[1-9][0-9]*$/.test(String(ref.partId)) || !/^[a-f0-9]{64}$/.test(ref.contentsHash))
          throw new Error('Invalid cleanup part reference');
        bySequence[seq] = { ordinal: output.ordinal, ref: ref };
      });
    });
    var next = cursor.next, deleted = 0, unavailable = 0, retained = 0;
    var verified = {};
    for (; next < ctx.ids.length && next < cursor.next + LIMIT; next++) {
      if (!budget()) break;
      var published = bySequence[next];
      if (!published) { retained++; continue; }
      var part = artifacts.get(ctx, 'PART', next);
      if (!part) throw new Error('Committed cleanup part is missing');
      var proof = integrity.open('part', part.proof);
      if (published.ref.partId !== part.partId || published.ref.contentsHash !== proof.contentsHash || protectedIds[part.partId])
        throw new Error('Cleanup part reference mismatch');
      // Search absence means unavailable, not proof that this invocation deleted it.
      if (!present(part.partId)) { unavailable++; continue; }
      if (!verified[published.ordinal]) {
        jobs.download(job.id, published.ordinal); // Verify bytes, then release the unsaved PDF.
        verified[published.ordinal] = true;
      }
      if (!budget()) break;
      var current = unchanged(job);
      var stored;
      try { stored = jobs.loadFile(current, part.partId); }
      catch (loadError) {
        unchanged(job);
        if (!present(part.partId)) { unavailable++; continue; }
        throw loadError;
      }
      if (stored.name !== proof.name || Number(stored.size) !== proof.bytes || stored.fileType !== file.Type.PLAINTEXT)
        throw new Error('Cleanup part file metadata mismatch');
      var contents = stored.getContents();
      if (typeof contents !== 'string' || contents.length > 8 * 1024 * 1024 || integrity.digest(contents) !== proof.contentsHash)
        throw new Error('Cleanup part contents mismatch');
      contents = null; stored = null;
      if (!budget()) break;
      unchanged(job);
      // N/file has no conditional delete: native Cabinet edits between validation
      // and deletion remain an account permission/operational boundary.
      try { file.delete({ id: part.partId }); }
      catch (deleteError) {
        unchanged(job);
        if (!present(part.partId)) { unavailable++; continue; }
        throw deleteError;
      }
      deleted++;
      log.audit({ title: 'PLD batch input cleaned', details: { jobId: job.id, sequence: next, partId: part.partId } });
    }
    if (next === cursor.next) throw new Error('เวลาหรือโควตาไม่พอสำหรับล้างไฟล์ กรุณาลองใหม่');
    var continuation = next < ctx.ids.length ? integrity.seal('cleanup', binding(job, next)) : '';
    return { deleted: deleted, unavailable: unavailable, retained: retained, examined: next - cursor.next,
      next: next, total: ctx.ids.length, token: continuation };
  }
  return { token: token, run: run };
});

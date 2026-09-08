/** Authenticated failed-sequence selection for linked retries.
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['./pld_lib_batch_jobs', './pld_lib_batch_integrity', './pld_lib_render'], function (jobs, integrity, render) {
  function invalid(reason) { throw new Error('Batch retry selection ' + reason); }
  function positive(value) { return /^[1-9][0-9]*$/.test(String(value)); }
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
  function read(jobId) {
    var job = jobs.load(jobId);
    if (job.phase !== 'DONE' || ['PARTIAL','FAILED'].indexOf(job.status) < 0) invalid('job is not eligible');
    if (!positive(job.snapshot) || !/^[a-f0-9]{64}$/.test(job.snapshotdigest) || !job.plan) invalid('source identity missing');
    var requested = Number(job.requested), printed = Number(job.printed), failed = Number(job.failed);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 500 || !Number.isSafeInteger(printed) || printed < 0 ||
      !Number.isSafeInteger(failed) || failed < 1 || printed + failed !== requested) invalid('counts invalid');
    if (job.status === 'FAILED' && (job.outputs || job.result || job.resultseal || printed !== 0 || failed !== requested)) invalid('failed result state invalid');
    var file = jobs.loadFile(job, job.snapshot);
    if (file.name !== 'pld_job_' + job.id + '.json' || !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 1 || Number(file.size) > 8 * 1024 * 1024) invalid('snapshot file invalid');
    var text = file.getContents();
    if (typeof text !== 'string' || text.length > 8 * 1024 * 1024 || bytes(text) > 8 * 1024 * 1024 || integrity.digest(text) !== job.snapshotdigest) invalid('snapshot digest mismatch');
    var snapshot = integrity.open('snapshot', text);
    if (!snapshot || snapshot.schemaVersion !== 5 || String(snapshot.jobId) !== job.id || String(snapshot.folder) !== job.folder ||
      !snapshot.requester || String(snapshot.requester.id) !== job.requester || String(snapshot.requester.role) !== job.role ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(snapshot.rectype) || !Array.isArray(snapshot.ids) || snapshot.ids.length !== requested ||
      !snapshot.ids.every(positive) || (snapshot.tplid !== '' && !positive(snapshot.tplid))) invalid('snapshot identity mismatch');
    var template = snapshot.templateSnapshot;
    if (!template || typeof template.xml !== 'string' || !template.xml.trim() || template.xml.length > 1000000 ||
      !Array.isArray(template.copies) || !template.copies.length || template.copies.some(function (copy) {
        return !copy || (copy.th !== undefined && typeof copy.th !== 'string') || (copy.en !== undefined && typeof copy.en !== 'string') || (!copy.th && !copy.en);
      })) invalid('template snapshot invalid');
    render.resolveCopies(template.copies, snapshot.rectype);
    var plan = integrity.open('plan', job.plan);
    if (!plan || plan.jobId !== job.id || plan.snapshotDigest !== job.snapshotdigest || plan.requested !== requested ||
      !Array.isArray(plan.chunks) || plan.chunks.length > requested || !Array.isArray(plan.failed) || plan.failed.length !== failed) invalid('plan identity mismatch');
    var seen = {}, successes = [], prior = -1;
    plan.chunks.forEach(function (chunk, index) {
      if (!chunk || chunk.ordinal !== index || !Array.isArray(chunk.sequences) || !chunk.sequences.length || chunk.sequences.length > 25) invalid('chunk plan invalid');
      chunk.sequences.forEach(function (seq) {
        if (!Number.isInteger(seq) || seq < 0 || seq >= requested || seen[seq] || seq <= prior) invalid('sequence partition invalid');
        seen[seq] = true; prior = seq; successes.push(seq);
      });
    });
    prior = -1;
    var failures = plan.failed.map(function (failure) {
      if (!failure || !Number.isInteger(failure.seq) || failure.seq < 0 || failure.seq >= requested || seen[failure.seq] || failure.seq <= prior ||
        failure.recid !== String(snapshot.ids[failure.seq]) || ['RENDER_FAILED','NO_COMMITTED_PART'].indexOf(failure.code) < 0) invalid('failure partition invalid');
      seen[failure.seq] = true; prior = failure.seq;
      return {seq: failure.seq, recid: failure.recid, code: failure.code};
    });
    if (Object.keys(seen).length !== requested || successes.length !== printed) invalid('incomplete partition');
    if (job.status === 'PARTIAL') {
      var outputs = jobs.results(job.id);
      if (outputs.length !== plan.chunks.length || outputs.some(function (output, index) {
        return output.ordinal !== index || output.count !== plan.chunks[index].sequences.length || JSON.stringify(output.sequences) !== JSON.stringify(plan.chunks[index].sequences);
      })) invalid('published plan mismatch');
    } else if (plan.chunks.length) invalid('all-failed plan required');
    var current = jobs.load(job.id);
    if (Object.keys(job).length !== Object.keys(current).length || Object.keys(job).some(function (key) { return job[key] !== current[key]; })) invalid('source changed during selection');
    var sequences = failures.map(function (failure) { return failure.seq; });
    return {job: job, sourceSnapshotDigest: job.snapshotdigest, sourcePlanDigest: integrity.digest(job.plan), sourceOutputsDigest: integrity.digest(job.outputs || ''),
      sequences: sequences, ids: sequences.map(function (seq) { return String(snapshot.ids[seq]); }), failures: failures,
      templateSnapshot: template, rectype: snapshot.rectype, tplid: snapshot.tplid};
  }
  return {read: read};
});

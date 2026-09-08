/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * Durable batch identity and requester-scoped storage.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/record', 'N/search', 'N/runtime', 'N/file', 'N/url', 'N/log', './pld_lib_batch_integrity'], function (record, search, runtime, file, url, log, integrity) {
  var TYPE = 'customrecord_pld_batch_job';
  var F = {};
  ['requester','role','status','folder','parent','snapshot','result','requested','printed','failed','task','resultseal'].forEach(function (k) { F[k] = 'custrecord_pld_job_' + k; });
  function id(value) {
    if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error('Invalid batch job reference');
    return String(value);
  }
  function actor() { var u = runtime.getCurrentUser(); return { requester: id(u.id), role: id(u.role) }; }
  var AUTH = 'custrecord_pld_job_auth';
  function canonical(input) {
    var out = {};
    ['id', 'owner'].concat(Object.keys(F)).forEach(function (k) {
      out[k] = input[k] == null ? '' : String(input[k]);
    });
    return out;
  }
  function values(rec) {
    var out = { id: String(rec.id), owner: String(rec.getValue({ fieldId: 'owner' })) };
    Object.keys(F).forEach(function (k) { out[k] = rec.getValue({ fieldId: F[k] }); });
    return canonical(out);
  }
  function authorized(job) {
    var u = actor();
    if (String(job.requester) !== u.requester || String(job.owner) !== u.requester || String(job.role) !== u.role) throw new Error('Batch job unavailable for this user or role');
    return job;
  }
  function authenticated(rec) {
    var persisted = values(rec);
    var sealed = integrity.open('job', rec.getValue({ fieldId: AUTH }));
    if (!sealed || typeof sealed !== 'object' || Object.keys(sealed).length !== Object.keys(persisted).length ||
      Object.keys(persisted).some(function (k) { return sealed[k] !== persisted[k]; })) throw new Error('Batch job integrity mismatch');
    return authorized(persisted);
  }
  function load(jobId) { return authenticated(record.load({ type: TYPE, id: id(jobId) })); }
  function update(jobId, fields) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var rec = record.load({ type: TYPE, id: id(jobId) });
      var prior = authenticated(rec);
      var next = canonical(prior);
      var mapped = {};
      Object.keys(fields).forEach(function (k) {
        if (!F[k] || ['requester','role','parent','requested'].indexOf(k) >= 0) throw new Error('Immutable batch identity');
        if ((k === 'folder' || k === 'snapshot') && (prior[k] || prior.status !== 'PREPARING')) throw new Error('Immutable batch storage identity');
        next[k] = fields[k] == null ? '' : String(fields[k]);
        mapped[F[k]] = fields[k];
      });
      mapped[AUTH] = integrity.seal('job', next);
      Object.keys(mapped).forEach(function (fieldId) { rec.setValue({ fieldId: fieldId, value: mapped[fieldId] }); });
      try { rec.save(); }
      catch (saveError) {
        if ((saveError.name === 'RCRD_HAS_BEEN_CHANGED' || saveError.code === 'RCRD_HAS_BEEN_CHANGED') && attempt < 2) continue;
        throw saveError;
      }
      return load(jobId);
    }
  }
  function assertFolder(job) {
    authorized(job);
    var folder = record.load({ type: 'folder', id: id(job.folder) });
    var priv = folder.getValue({ fieldId: 'isprivate' });
    if ((priv !== true && priv !== 'T') || String(folder.getValue({ fieldId: 'owner' })) !== String(job.requester) ||
      String(folder.getValue({ fieldId: 'parent' })) !== String(job.parent)) throw new Error('Batch folder privacy/owner/parent mismatch');
  }
  function loadFile(job, fileId) {
    assertFolder(job);
    var out = file.load({ id: id(fileId) });
    if (String(out.folder) !== String(job.folder) || out.isOnline !== false) throw new Error('Batch file storage mismatch');
    return out;
  }
  function create(requested) {
    var u = actor();
    var parent = id(file.load({ id: '/SuiteScripts/pdf-layout-designer/pld_version.txt' }).folder);
    var rec = record.create({ type: TYPE });
    rec.setValue({ fieldId: 'name', value: 'Batch ' + Date.now() });
    rec.setValue({ fieldId: 'owner', value: Number(u.requester) });
    var initial = { requester: u.requester, role: u.role, parent: parent, status: 'PREPARING', requested: requested, printed: 0, failed: 0 };
    Object.keys(initial).forEach(function (k) { rec.setValue({ fieldId: F[k], value: initial[k] }); });
    var jobId = id(rec.save());
    try {
      // Bind only the initial values selected by this invocation, never values
      // reread from a mutable native row. Until this succeeds the row is inert.
      var initialState = canonical(Object.assign({ id: jobId, owner: u.requester }, initial));
      rec.setValue({ fieldId: AUTH, value: integrity.seal('job', initialState) });
      rec.save();
      load(jobId);
      var folder = record.create({ type: 'folder' });
      folder.setValue({ fieldId: 'name', value: 'pld-job-' + jobId });
      folder.setValue({ fieldId: 'parent', value: Number(parent) });
      folder.setValue({ fieldId: 'isprivate', value: true });
      folder.setValue({ fieldId: 'owner', value: Number(u.requester) });
      var job = update(jobId, { folder: id(folder.save()) });
      assertFolder(job); // No sensitive file may be created until readback passes.
      return job;
    } catch (setupError) {
      // The durable identity already exists, even if folder creation/readback
      // failed. No sensitive file has been created by this function.
      try { update(jobId, { status: 'FAILED', failed: requested }); }
      catch (stateError) { log.error({ title: 'PLD batch setup failure persistence failed', details: { jobId: jobId, message: stateError.message } }); }
      throw setupError;
    }
  }
  function list() {
    var u = actor();
    return search.create({ type: TYPE, filters: [[F.requester,'is',u.requester], 'AND', [F.role,'is',u.role], 'AND', ['owner','anyof',u.requester]],
      columns: [search.createColumn({ name: 'internalid', sort: search.Sort.DESC })]
    }).run().getRange({ start: 0, end: 40 }).map(function (r) { return load(r.id); });
  }
  function route(jobId, action) {
    return url.resolveScript({ scriptId: 'customscript_pld_batch', deploymentId: 'customdeploy_pld_batch', returnExternalUrl: false,
      params: { action: action || 'status', job: id(jobId) } });
  }
  function download(jobId) {
    var job = load(jobId);
    if (['COMPLETE','PARTIAL'].indexOf(job.status) < 0 || !job.result || Number(job.printed) < 1) throw new Error('Batch result is not committed');
    var result = integrity.open('result', job.resultseal);
    var printed = Number(job.printed);
    var failed = Number(job.failed);
    var requested = Number(job.requested);
    if (!Number.isSafeInteger(printed) || !Number.isSafeInteger(failed) || !Number.isSafeInteger(requested) ||
      printed < 1 || failed < 0 || requested !== printed + failed || requested > 500 ||
      (job.status === 'COMPLETE' && failed !== 0) || (job.status === 'PARTIAL' && failed === 0) ||
      !result || String(result.jobId) !== job.id || String(result.folder) !== job.folder || String(result.fileId) !== job.result ||
      Number(result.printed) !== printed || Number(result.failed) !== failed ||
      !Array.isArray(result.sequences) || result.sequences.length !== printed ||
      result.sequences.some(function (seq, index, all) { return !Number.isInteger(seq) || seq < 0 || seq >= requested || all.indexOf(seq) !== index; })) {
      throw new Error('Batch result integrity mismatch');
    }
    var pdf = loadFile(job, job.result);
    if (!/\.pdf$/i.test(pdf.name || '') || pdf.name !== result.name ||
      !Number.isSafeInteger(Number(pdf.size)) || Number(pdf.size) < 1 || Number(pdf.size) > 10 * 1024 * 1024 ||
      Number(pdf.size) !== Number(result.size)) throw new Error('Invalid batch result file');
    var contents = pdf.getContents();
    if (typeof contents !== 'string' || contents.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 ||
      integrity.digestPdf(contents) !== result.contentsHash) throw new Error('Batch result contents integrity mismatch');
    // Stream the verified bytes, never reload/stream a mutable Cabinet file.
    return file.create({ name: pdf.name, fileType: file.Type.PDF, contents: contents, isOnline: false });

  }
  return { create: create, load: load, update: update, assertFolder: assertFolder, loadFile: loadFile, list: list, route: route, download: download };
});

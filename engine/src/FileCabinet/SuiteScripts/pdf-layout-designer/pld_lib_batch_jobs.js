/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * Durable batch identity and requester-scoped storage.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/record', 'N/search', 'N/runtime', 'N/file', 'N/url', 'N/log'], function (record, search, runtime, file, url, log) {
  var TYPE = 'customrecord_pld_batch_job';
  var F = {};
  ['requester','role','status','folder','parent','snapshot','result','requested','printed','failed','task'].forEach(function (k) { F[k] = 'custrecord_pld_job_' + k; });
  function id(value) {
    if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error('Invalid batch job reference');
    return String(value);
  }
  function actor() { var u = runtime.getCurrentUser(); return { requester: id(u.id), role: id(u.role) }; }
  function values(rec) {
    var out = { id: String(rec.id), owner: String(rec.getValue({ fieldId: 'owner' })) };
    Object.keys(F).forEach(function (k) { out[k] = rec.getValue({ fieldId: F[k] }); });
    return out;
  }
  function authorized(job) {
    var u = actor();
    if (String(job.requester) !== u.requester || String(job.owner) !== u.requester || String(job.role) !== u.role) throw new Error('Batch job unavailable for this user or role');
    return job;
  }
  function load(jobId) { return authorized(values(record.load({ type: TYPE, id: id(jobId) }))); }
  function update(jobId, fields) {
    load(jobId);
    var mapped = {};
    Object.keys(fields).forEach(function (k) {
      if (!F[k] || ['requester','role','parent'].indexOf(k) >= 0) throw new Error('Immutable batch identity');
      mapped[F[k]] = fields[k];
    });
    record.submitFields({ type: TYPE, id: id(jobId), values: mapped });
    return load(jobId);
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
    var pdf = loadFile(job, job.result);
    if (!/\.pdf$/i.test(pdf.name || '')) throw new Error('Invalid batch result file');
    return pdf;
  }
  return { create: create, load: load, update: update, assertFolder: assertFolder, loadFile: loadFile, list: list, route: route, download: download };
});

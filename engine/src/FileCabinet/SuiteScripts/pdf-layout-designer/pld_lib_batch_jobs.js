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
  ['requester','role','status','folder','parent','snapshot','result','requested','printed','failed','task','resultseal','snapshotdigest','phase','plan','mergetask','outputs'].forEach(function (k) { F[k] = 'custrecord_pld_job_' + k; });
  function id(value) {
    if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error('Invalid batch job reference');
    return String(value);
  }
  function actor() { var u = runtime.getCurrentUser(); return { requester: id(u.id), role: id(u.role) }; }
  var AUTH = 'custrecord_pld_job_auth';
  function canonical(input) {
    var out = {};
    ['id', 'owner', 'externalid'].concat(Object.keys(F)).forEach(function (k) {
      out[k] = input[k] == null ? '' : String(input[k]);
    });
    return out;
  }
  function values(rec) {
    var out = { id: String(rec.id), owner: String(rec.getValue({ fieldId: 'owner' })), externalid: rec.getValue({fieldId:'externalid'}) };
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
    if (sealed && persisted.externalid === '' && !Object.prototype.hasOwnProperty.call(sealed, 'externalid')) sealed.externalid = '';
    if (!sealed || typeof sealed !== 'object' || Object.keys(sealed).length !== Object.keys(persisted).length ||
      Object.keys(persisted).some(function (k) { return sealed[k] !== persisted[k]; })) throw new Error('Batch job integrity mismatch');
    return authorized(persisted);
  }
  function load(jobId) { return authenticated(record.load({ type: TYPE, id: id(jobId) })); }
  function update(jobId, fields, expected) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var rec = record.load({ type: TYPE, id: id(jobId) });
      var prior = authenticated(rec);
      if (expected && Object.keys(expected).some(function (k) { return prior[k] !== String(expected[k]); })) {
        throw new Error('Batch job changed; reload its current status');
      }
      var next = canonical(prior);
      var mapped = {};
      Object.keys(fields).forEach(function (k) {
        if (!F[k] || ['requester','role','parent','requested'].indexOf(k) >= 0) throw new Error('Immutable batch identity');
        if ((k === 'folder' || k === 'snapshot' || k === 'snapshotdigest') && (prior[k] || prior.status !== 'PREPARING')) throw new Error('Immutable batch storage identity');
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
      // A native create handle must not be reused as an update after save().
      // Reload the returned ID, but sign only the original expected values.
      rec = record.load({ type: TYPE, id: jobId });
      var persistedInitial = values(rec);
      if (Object.keys(initialState).some(function (key) { return persistedInitial[key] !== initialState[key]; })) {
        throw new Error('Batch initial state changed before sealing');
      }
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
  function reservationKey(key) {
    if (typeof key !== 'string' || !/^pld-retry-[a-f0-9]{64}$/.test(key)) throw new Error('Invalid batch reservation key');
    return key;
  }
  function ranges(type, filters) {
    return search.create({type:type, filters:filters, columns:['internalid']}).run().getRange({start:0,end:2});
  }
  function reservedRows(key) { return ranges(TYPE,[['externalidstring','is',reservationKey(key)]]); }
  function optimistic(error) { return !!error && (error.name === 'RCRD_HAS_BEEN_CHANGED' || error.code === 'RCRD_HAS_BEEN_CHANGED'); }
  function authenticatedInit(rec, key) {
    reservationKey(key);
    var state=values(rec), initial=Object.assign({},state); delete initial.id;
    var sealed=integrity.open('job-init',rec.getValue({fieldId:AUTH}));
    if (!sealed || Object.keys(sealed).length !== Object.keys(initial).length || Object.keys(initial).some(function(k){return initial[k]!==sealed[k];}) ||
      state.externalid!==key || state.status!=='PREPARING' || state.phase!=='PROVISIONING' || !/^[1-9][0-9]*$/.test(state.parent) ||
      !Number.isInteger(Number(state.requested)) || Number(state.requested)<1 || Number(state.requested)>500 || state.printed!=='0' || state.failed!=='0' ||
      ['folder','snapshot','result','task','resultseal','snapshotdigest','plan','mergetask','outputs'].some(function(k){return state[k]!=='';})) throw new Error('Batch reservation initialization integrity mismatch');
    authorized(state);
    return state;
  }
  function promote(jobId, key) {
    for (var attempt=0; attempt<3; attempt++) {
      var rec=record.load({type:TYPE,id:id(jobId)}), job;
      try { job=authenticated(rec); }
      catch (normalError) {
        var state=authenticatedInit(rec,key);
        rec.setValue({fieldId:AUTH,value:integrity.seal('job',state)});
        try { rec.save(); }
        catch(error) {
          // A save acknowledgment may be lost after the normal seal is durable.
          try { var winner=load(jobId); if(winner.externalid===key)return winner; } catch(readError) { /* Still init or unavailable: retain original failure. */ }
          if(optimistic(error) && attempt<2)continue;
          throw error;
        }
        job=load(jobId);
      }
      if(job.externalid!==key)throw new Error('Batch reservation identity mismatch');
      return job;
    }
  }
  function findReserved(key) {
    var rows=reservedRows(key);
    if(rows.length>1)throw new Error('Duplicate batch reservation key');
    return rows.length ? promote(rows[0].id,key) : null;
  }
  function checkedReservedFolder(job, folderId) {
    var candidate=Object.assign({},job,{folder:id(folderId)}); assertFolder(candidate);
    var folder=record.load({type:'folder',id:candidate.folder});
    if(folder.getValue({fieldId:'name'})!=='pld-job-'+job.id)throw new Error('Batch reserved folder name mismatch');
    return candidate.folder;
  }
  function resumeFolder(job) {
    var filters=[['name','is','pld-job-'+job.id],'AND',['parent','anyof',job.parent]];
    var found=ranges('folder',filters), folderId;
    if(job.folder) {
      if(found.length!==1 || String(found[0].id)!==job.folder)throw new Error('Duplicate or missing batch reserved folder');
      checkedReservedFolder(job,job.folder); return job;
    }
    if(job.status!=='PREPARING' || job.phase!=='PROVISIONING')throw new Error('Batch reservation is not provisioning');
    if(found.length>1)throw new Error('Duplicate batch reserved folders');
    if(found.length)folderId=checkedReservedFolder(job,found[0].id);
    else {
      var folder=record.create({type:'folder'});
      folder.setValue({fieldId:'name',value:'pld-job-'+job.id});
      folder.setValue({fieldId:'parent',value:Number(job.parent)});
      folder.setValue({fieldId:'owner',value:Number(job.requester)});
      folder.setValue({fieldId:'isprivate',value:true});
      try { folderId=id(folder.save()); }
      catch(error) {
        found=ranges('folder',filters);
        if(found.length>1)throw new Error('Duplicate batch reserved folders');
        if(!found.length)throw error;
        folderId=checkedReservedFolder(job,found[0].id);
      }
      // Folder names are not unique. A competing creation must be visible,
      // never resolved by choosing a convenient native ID.
      found=ranges('folder',filters);
      if(found.length!==1 || String(found[0].id)!==folderId)throw new Error('Duplicate or missing batch reserved folder');
      checkedReservedFolder(job,folderId);
    }
    try { job=update(job.id,{folder:folderId},job); }
    catch(error) {
      var current=load(job.id);
      if(!current.folder)throw error;
      checkedReservedFolder(current,current.folder);
      if(current.folder!==folderId)throw new Error('Batch reserved folder binding changed');
      return current;
    }
    checkedReservedFolder(job,job.folder);return job;
  }
  function createReserved(requested,key) {
    reservationKey(key);
    if(!Number.isInteger(requested) || requested<1 || requested>500)throw new Error('Invalid batch reservation count');
    var job=findReserved(key);
    if(!job) {
      var u=actor(), parent=id(file.load({id:'/SuiteScripts/pdf-layout-designer/pld_version.txt'}).folder);
      var initial=canonical({owner:u.requester,externalid:key,requester:u.requester,role:u.role,parent:parent,status:'PREPARING',phase:'PROVISIONING',requested:requested,printed:0,failed:0});
      delete initial.id;
      var rec=record.create({type:TYPE});
      rec.setValue({fieldId:'name',value:'Batch retry '+key.slice(-16)});
      rec.setValue({fieldId:'owner',value:Number(u.requester)});rec.setValue({fieldId:'externalid',value:key});
      Object.keys(F).forEach(function(k){rec.setValue({fieldId:F[k],value:initial[k]});});
      rec.setValue({fieldId:AUTH,value:integrity.seal('job-init',initial)});
      try { rec.save(); }
      catch(error) { job=findReserved(key);if(!job)throw error; }
      if(!job)job=findReserved(key);
      if(!job)throw new Error('Batch reservation readback missing');
    }
    if(Number(job.requested)!==requested)throw new Error('Batch reservation count mismatch');
    return resumeFolder(job);
  }
  function list() {
    var u = actor();
    var results = search.create({ type: TYPE, filters: [[F.requester,'is',u.requester], 'AND', [F.role,'is',u.role], 'AND', ['owner','anyof',u.requester]],
      columns: [search.createColumn({ name: 'internalid', sort: search.Sort.DESC })]
    }).run().getRange({ start: 0, end: 40 });
    var out = []; out.provisioningCount = 0;
    results.forEach(function (result) {
      var rec=record.load({type:TYPE,id:id(result.id)});
      try { out.push(authenticated(rec)); }
      catch(error) {
        // An authenticated first-save reservation is recoverable by explicit
        // POST, but listing must neither promote it nor hide corrupt records.
        authenticatedInit(rec,String(rec.getValue({fieldId:'externalid'})));
        out.provisioningCount++;
      }
    });
    return out;
  }
  function route(jobId, action, chunk) {
    var params = { action: action || 'status', job: id(jobId) };
    if (chunk !== undefined) params.chunk = String(chunk);
    return url.resolveScript({ scriptId: 'customscript_pld_batch', deploymentId: 'customdeploy_pld_batch', returnExternalUrl: false,
      params: params });
  }
  function published(job) {
    if (['COMPLETE','PARTIAL'].indexOf(job.status) < 0) throw new Error('Batch result is not committed');
    var manifest = integrity.open('manifest', job.outputs);
    var requested = Number(job.requested), printed = Number(job.printed), failed = Number(job.failed);
    if (!manifest || !/^[0-9a-f]{64}$/.test(job.snapshotdigest) || manifest.jobId !== job.id || manifest.snapshotDigest !== job.snapshotdigest || manifest.folder !== job.folder ||
      !Number.isSafeInteger(requested) || requested < 1 || requested > 500 ||
      !Number.isSafeInteger(printed) || printed < 1 || !Number.isSafeInteger(failed) || failed < 0 ||
      printed + failed !== requested || manifest.requested !== requested || manifest.printed !== printed || manifest.failed !== failed ||
      (job.status === 'COMPLETE' && failed !== 0) || (job.status === 'PARTIAL' && failed === 0) ||
      !Array.isArray(manifest.outputs) || !manifest.outputs.length || manifest.outputs.length > 500) throw new Error('Batch manifest integrity mismatch');
    var seen = {}, count = 0, last = -1;
    var outputs = manifest.outputs.map(function (output, index) {
      var result = integrity.open('result', output.proof);
      if (output.ordinal !== index || !result || result.ordinal !== index || result.jobId !== job.id ||
        result.snapshotDigest !== job.snapshotdigest || result.folder !== job.folder || result.fileId !== String(output.fileId) ||
        !Array.isArray(result.sequences) || !result.sequences.length || result.printed !== result.sequences.length || result.failed !== 0) throw new Error('Batch chunk integrity mismatch');
      result.sequences.forEach(function (seq) {
        if (!Number.isInteger(seq) || seq < 0 || seq >= requested || seen[seq] || seq <= last) throw new Error('Batch chunk sequence mismatch');
        seen[seq] = true; last = seq; count++;
      });
      return result;
    });
    if (count !== printed) throw new Error('Batch manifest count mismatch');
    return outputs;
  }
  function results(jobId) {
    return published(load(jobId)).map(function (result) {
      return { ordinal: result.ordinal, sequences: result.sequences, count: result.printed };
    });
  }
  function failedSequences(jobId) {
    var job = load(jobId), seen = {};
    published(job).forEach(function (result) { result.sequences.forEach(function (seq) { seen[seq] = true; }); });
    var missing = [];
    for (var seq = 0; seq < Number(job.requested); seq++) if (!seen[seq]) missing.push(seq);
    return missing;
  }
  function download(jobId, ordinal) {
    var job = load(jobId);
    if (job.outputs) {
      var outputs = published(job);
      if ((ordinal === undefined || ordinal === '') && outputs.length === 1) ordinal = 0;
      if (!/^(0|[1-9][0-9]*)$/.test(String(ordinal)) || !outputs[Number(ordinal)]) throw new Error('กรุณาเลือกหมายเลขไฟล์ PDF ของงานนี้');
      var chunk = outputs[Number(ordinal)];
      return verifiedPdf(job, chunk, chunk.fileId);
    }
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
    return verifiedPdf(job, result, job.result);
  }
  function verifiedPdf(job, result, fileId) {
    var pdf = loadFile(job, fileId);
    if (!/\.pdf$/i.test(pdf.name || '') || pdf.name !== result.name ||
      !Number.isSafeInteger(Number(pdf.size)) || Number(pdf.size) < 1 || Number(pdf.size) > 10 * 1024 * 1024 ||
      Number(pdf.size) !== Number(result.size)) throw new Error('Invalid batch result file');
    var contents = pdf.getContents();
    if (typeof contents !== 'string' || contents.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 ||
      integrity.digestPdf(contents) !== result.contentsHash) throw new Error('Batch result contents integrity mismatch');
    // Stream the verified bytes, never reload/stream a mutable Cabinet file.
    return file.create({ name: pdf.name, fileType: file.Type.PDF, contents: contents, isOnline: false });

  }
  return { create: create, createReserved: createReserved, findReserved: findReserved, load: load, update: update, assertFolder: assertFolder, loadFile: loadFile, list: list, route: route, download: download, results: results, failedSequences: failedSequences };
});

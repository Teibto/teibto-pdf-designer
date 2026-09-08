/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * Authenticated batch artifact reservations and committed publication.
 * Orphan adoption requires the signed intent plus verified private file bytes.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/record', 'N/search', 'N/file', './pld_lib_batch_jobs', './pld_lib_batch_integrity'], function (record, search, file, jobs, integrity) {
  var TYPE = 'customrecord_pld_batch_artifact';
  var PREFIX = 'custrecord_pld_art_';
  var FIELDS = ['job','generation','kind','ordinal','state','payload'];
  var MAX_ROWS = 500;
  var MAX_PAYLOAD = 128 * 1024;
  function invalid(message) { throw new Error('Batch artifact ' + message); }
  function positive(value) { return /^[1-9][0-9]*$/.test(String(value)); }
  function hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
  function authorize(ctx, kind) {
    if (!ctx || !positive(ctx.jobId) || !hash(ctx.snapshotDigest) || !positive(ctx.folder) ||
      !Array.isArray(ctx.ids) || !ctx.ids.length || ctx.ids.length > MAX_ROWS || !ctx.ids.every(positive) ||
      (kind !== 'PART' && kind !== 'CHUNK')) invalid('context invalid');
    var parent = jobs.load(ctx.jobId);
    if (String(parent.id) !== String(ctx.jobId) || String(parent.folder) !== String(ctx.folder) ||
      parent.snapshotdigest !== ctx.snapshotDigest || Number(parent.requested) !== ctx.ids.length) invalid('generation mismatch');
    jobs.assertFolder(parent);
    return parent;
  }
  function ordinalValue(ctx, ordinal) {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= ctx.ids.length) invalid('ordinal invalid');
    return ordinal;
  }
  function key(ctx, kind, ordinal) { return 'pld-art-' + ctx.jobId + '-' + ctx.snapshotDigest + '-' + kind.toLowerCase() + '-' + ordinal; }
  function sortKey(seq) { return ('00000' + seq).slice(-6); }
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
  function payloadFor(ctx, kind, ordinal, payload, parent, verifyFile) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.proof !== 'string' || payload.proof.length > MAX_PAYLOAD) invalid('payload invalid');
    var proof = integrity.open(kind === 'PART' ? 'part' : 'result', payload.proof);
    if (!proof || proof.jobId !== String(ctx.jobId) || proof.snapshotDigest !== ctx.snapshotDigest || proof.folder !== String(ctx.folder) ||
      typeof proof.name !== 'string' || !proof.name || proof.name.length > 255 || !hash(proof.contentsHash)) invalid('proof identity mismatch');
    var normalized;
    var fileId;
    var expectedBytes;
    if (kind === 'PART') {
      if (proof.seq !== ordinal || proof.recid !== String(ctx.ids[ordinal]) || proof.partId !== String(payload.partId) ||
        proof.recid !== String(payload.recid) || !positive(proof.partId) || (proof.name !== 'pld_part_' + ctx.jobId + '_' + sortKey(ordinal) + '.txt' && proof.name !== name(ctx, kind, ordinal, proof.contentsHash)) ||
        !Number.isSafeInteger(proof.bytes) || proof.bytes < 1 || proof.bytes > 8 * 1024 * 1024 ||
        typeof proof.tranId !== 'string' || proof.tranId.length > 300 || payload.tranId !== proof.tranId ||
        (payload.key !== undefined && payload.key !== sortKey(ordinal))) invalid('part proof mismatch');
      normalized = { partId: proof.partId, recid: proof.recid, tranId: proof.tranId, proof: payload.proof, key: sortKey(ordinal) };
      fileId = proof.partId; expectedBytes = proof.bytes;
    } else {
      if (proof.ordinal !== ordinal || !positive(proof.fileId) || proof.fileId !== String(payload.fileId) || !/\.pdf$/i.test(proof.name) ||
        !Number.isSafeInteger(proof.size) || proof.size < 1 || proof.size > 10 * 1024 * 1024 ||
        !Array.isArray(proof.sequences) || !proof.sequences.length || proof.sequences.length > MAX_ROWS ||
        proof.printed !== proof.sequences.length || !Number.isInteger(proof.failed) || proof.failed < 0 || proof.failed + proof.printed > ctx.ids.length ||
        !Array.isArray(proof.partRefs) || proof.partRefs.length !== proof.sequences.length ||
        proof.sequences.some(function (seq, index, all) {
          var ref = proof.partRefs[index];
          return !Number.isInteger(seq) || seq < 0 || seq >= ctx.ids.length || (index > 0 && seq <= all[index - 1]) ||
            !ref || ref.seq !== seq || !positive(ref.partId) || !hash(ref.contentsHash);
        })) invalid('chunk proof mismatch');
      normalized = { fileId: proof.fileId, proof: payload.proof };
      fileId = proof.fileId; expectedBytes = proof.size;
    }
    // Do not sign caller-added metadata that was not covered by the producer proof.
    if (Object.keys(payload).some(function (k) { return !Object.prototype.hasOwnProperty.call(normalized, k); })) invalid('unexpected payload field');
    if (verifyFile) {
      var stored = jobs.loadFile(parent, fileId);
      if (stored.name !== proof.name || !Number.isSafeInteger(Number(stored.size)) || Number(stored.size) !== expectedBytes) invalid('file metadata mismatch');
      var contents = stored.getContents();
      if (typeof contents !== 'string' || contents.length > (kind === 'PART' ? 8 * 1024 * 1024 : Math.ceil(10 * 1024 * 1024 / 3) * 4)) invalid('file size limit');
      if (kind === 'PART' ? (bytes(contents) !== expectedBytes || integrity.digest(contents) !== proof.contentsHash) : integrity.digestPdf(contents) !== proof.contentsHash) invalid('file contents mismatch');
    }
    return normalized;
  }
  function rowsFor(filters, limit) {
    return search.create({ type: TYPE, filters: filters, columns: [search.createColumn({ name: PREFIX + 'ordinal', sort: search.Sort.ASC })] })
      .run().getRange({ start: 0, end: limit });
  }
  function exactRows(ctx, kind, ordinal) { return rowsFor([['externalidstring', 'is', key(ctx, kind, ordinal)]], 2); }
  function name(ctx, kind, ordinal, contentsHash) {
    ordinalValue(ctx, ordinal);
    if (!positive(ctx.jobId) || !hash(contentsHash) || (kind !== 'PART' && kind !== 'CHUNK')) invalid('name identity invalid');
    return (kind === 'PART' ? 'pld_part_' : 'batch_') + ctx.jobId + (kind === 'PART' ? '_' : '_chunk_') + sortKey(ordinal) + '_' + contentsHash + (kind === 'PART' ? '.txt' : '.pdf');
  }
  function active(parent, kind) {
    if (parent.status !== 'RUNNING' || parent.phase !== (kind === 'PART' ? 'RENDERING' : 'MERGING') || parent.outputs || parent.result || (kind === 'PART' && parent.plan) || (kind === 'CHUNK' && !parent.plan)) invalid('parent stage is not writable');
  }
  function intentFor(ctx, kind, ordinal, intent, parent) {
    var keys = kind === 'PART' ? ['jobId','snapshotDigest','folder','seq','recid','tranId','name','bytes','contentsHash'] : ['jobId','snapshotDigest','folder','ordinal','sequences','partRefs','name','size','printed','failed','contentsHash'];
    if (!intent || Object.keys(intent).length !== keys.length || keys.some(function (k) { return !Object.prototype.hasOwnProperty.call(intent, k); })) invalid('intent schema invalid');
    if (intent.name !== name(ctx, kind, ordinal, intent.contentsHash)) invalid('intent name mismatch');
    if (kind === 'CHUNK' && Array.isArray(intent.partRefs) && intent.partRefs.some(function (ref) {
      return !ref || Object.keys(ref).length !== 3 || !Object.prototype.hasOwnProperty.call(ref,'seq') || !Object.prototype.hasOwnProperty.call(ref,'partId') || !Object.prototype.hasOwnProperty.call(ref,'contentsHash');
    })) invalid('intent part reference schema invalid');
    var proof = Object.assign({}, intent); proof[kind === 'PART' ? 'partId' : 'fileId'] = '1';
    var payload = kind === 'PART' ? { partId: '1', recid: intent.recid, tranId: intent.tranId } : { fileId: '1' };
    payload.proof = integrity.seal(kind === 'PART' ? 'part' : 'result', proof);
    payloadFor(ctx, kind, ordinal, payload, parent, false);
    return JSON.parse(JSON.stringify(intent));
  }
  function same(a, b) { return integrity.digest(integrity.seal('artifact', a)) === integrity.digest(integrity.seal('artifact', b)); }
  function read(ctx, kind, ordinal, rowId, parent) {
    var rec = record.load({ type: TYPE, id: rowId });
    var state = { externalid: String(rec.getValue({ fieldId: 'externalid' })), owner: String(rec.getValue({ fieldId: 'owner' })) };
    FIELDS.forEach(function (k) { var v = rec.getValue({ fieldId: PREFIX + k }); state[k] = v == null ? '' : String(v); });
    var auth = rec.getValue({ fieldId: PREFIX + 'auth' });
    var sealed = integrity.open('artifact', auth);
    if (!sealed || typeof sealed !== 'object' || Object.keys(sealed).length !== Object.keys(state).length ||
      Object.keys(state).some(function (k) { return sealed[k] !== state[k]; }) || state.externalid !== key(ctx, kind, ordinal) ||
      state.owner !== String(parent.owner) || state.job !== String(ctx.jobId) || state.generation !== ctx.snapshotDigest ||
      state.kind !== kind || state.ordinal !== String(ordinal)) invalid('ledger integrity mismatch');
    if (state.state !== 'COMMITTED' && state.state !== 'WRITING') invalid('state invalid');
    if (state.payload.length > MAX_PAYLOAD) invalid('payload limit');
    var parsed = JSON.parse(state.payload);
    if (state.state === 'COMMITTED') return {rec: rec, state: state, payload: payloadFor(ctx, kind, ordinal, parsed, parent, false)};
    var wrapperKeys = kind === 'CHUNK' ? ['revision','intent','planDigest'] : ['revision','intent'];
    if (!parsed || Object.keys(parsed).length !== wrapperKeys.length || wrapperKeys.some(function (k) {return !Object.prototype.hasOwnProperty.call(parsed,k);}) || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1) invalid('writing reservation invalid');
    if (kind === 'CHUNK' && (!parent.plan || parsed.planDigest !== integrity.digest(parent.plan))) invalid('writing plan mismatch');
    return { rec: rec, state: state, token: integrity.digest(auth), revision: parsed.revision, payload: intentFor(ctx, kind, ordinal, parsed.intent, parent) };
  }
  function existing(ctx, kind, ordinal, parent) {
    var rows = exactRows(ctx, kind, ordinal);
    if (rows.length > 1) invalid('duplicate logical key; recovery required');
    return rows.length ? read(ctx, kind, ordinal, rows[0].id, parent) : null;
  }
  function persist(ctx, kind, ordinal, parent, prior, status, payload) {
    var state = { externalid: key(ctx, kind, ordinal), owner: String(parent.owner), job: String(ctx.jobId),
      generation: ctx.snapshotDigest, kind: kind, ordinal: String(ordinal), state: status, payload: JSON.stringify(payload) };
    if (state.payload.length > MAX_PAYLOAD) invalid('payload limit');
    var rec = prior ? prior.rec : record.create({ type: TYPE });
    if (!prior) {
      rec.setValue({ fieldId: 'name', value: state.externalid });
      rec.setValue({ fieldId: 'externalid', value: state.externalid });
      rec.setValue({ fieldId: 'owner', value: Number(state.owner) });
    }
    FIELDS.forEach(function (k) { rec.setValue({ fieldId: PREFIX + k, value: state[k] }); });
    rec.setValue({ fieldId: PREFIX + 'auth', value: integrity.seal('artifact', state) });
    rec.save();
  }
  function conflict(error) { return !!error && (error.name === 'RCRD_HAS_BEEN_CHANGED' || error.code === 'RCRD_HAS_BEEN_CHANGED'); }
  function get(ctx, kind, ordinal) {
    var parent = authorize(ctx, kind); ordinalValue(ctx, ordinal);
    var row = existing(ctx, kind, ordinal, parent);
    return row && row.state.state === 'COMMITTED' ? row.payload : null;
  }
  function prepare(ctx, kind, ordinal, intent) {
    ordinalValue(ctx, ordinal);
    for (var attempt = 0; attempt < 3; attempt++) {
      var parent = authorize(ctx, kind), row = existing(ctx, kind, ordinal, parent);
      if (row && row.state.state === 'COMMITTED') return { committed: row.payload };
      active(parent, kind); var normalized = intentFor(ctx, kind, ordinal, intent, parent);
      if (row && same(row.payload, normalized)) return { token: row.token, intent: row.payload };
      var wrapper = {revision: row ? row.revision + 1 : 1, intent: normalized};
      if (!Number.isSafeInteger(wrapper.revision)) invalid('reservation revision limit');
      if (kind === 'CHUNK') wrapper.planDigest = integrity.digest(parent.plan);
      try { persist(ctx, kind, ordinal, parent, row, 'WRITING', wrapper); }
      catch (error) {
        var raced = existing(ctx, kind, ordinal, authorize(ctx, kind));
        if (raced && raced.state.state === 'COMMITTED') return { committed: raced.payload };
        if ((conflict(error) || (!row && raced)) && attempt < 2) continue;
        throw error;
      }
      var saved = existing(ctx, kind, ordinal, authorize(ctx, kind));
      if (!saved) invalid('prepare readback missing');
      if (saved.state.state === 'COMMITTED') return { committed: saved.payload };
      if (!same(saved.payload, normalized)) invalid('intent changed during reservation');
      return { token: saved.token, intent: saved.payload };
    }
  }
  function commit(ctx, kind, ordinal, payload, token) {
    ordinalValue(ctx, ordinal);
    for (var attempt = 0; attempt < 3; attempt++) {
      var parent = authorize(ctx, kind), row = existing(ctx, kind, ordinal, parent);
      if (row && row.state.state === 'COMMITTED') return row.payload;
      var normalized = payloadFor(ctx, kind, ordinal, payload, parent, true);
      if (row) {
        active(parent, kind);
        if (typeof token !== 'string' || token !== row.token) invalid('stale intent token');
        var proof = integrity.open(kind === 'PART' ? 'part' : 'result', normalized.proof);
        delete proof[kind === 'PART' ? 'partId' : 'fileId'];
        if (!same(proof, row.payload)) invalid('intent metadata mismatch');
        var stored = jobs.loadFile(parent, kind === 'PART' ? normalized.partId : normalized.fileId);
        if (stored.fileType !== (kind === 'PART' ? file.Type.PLAINTEXT : file.Type.PDF)) invalid('file type mismatch');
      } else if (token !== undefined) invalid('intent missing');
      try { persist(ctx, kind, ordinal, parent, row, 'COMMITTED', normalized); }
      catch (error) {
        var raced = existing(ctx, kind, ordinal, authorize(ctx, kind));
        if (raced && raced.state.state === 'COMMITTED') return raced.payload;
        if (conflict(error) && attempt < 2) continue;
        throw error;
      }
      var saved = existing(ctx, kind, ordinal, authorize(ctx, kind));
      if (!saved || saved.state.state !== 'COMMITTED') invalid('commit readback missing; recovery required');
      return saved.payload;
    }
  }
  function recover(ctx, kind, ordinal) {
    var parent = authorize(ctx, kind); ordinalValue(ctx, ordinal);
    var row = existing(ctx, kind, ordinal, parent);
    if (!row) return null;
    if (row.state.state === 'COMMITTED') return row.payload;
    active(parent, kind);
    var candidates = search.create({ type: 'file', filters: [['folder','anyof',String(ctx.folder)], 'AND', ['name','is',row.payload.name]], columns: ['internalid'] }).run().getRange({start:0,end:4});
    if (candidates.length > 3) invalid('recovery candidate limit');
    var payloads = candidates.map(function (candidate) {
      var id = String(candidate.id); if (!positive(id)) invalid('recovery file identity invalid');
      var proof = Object.assign({}, row.payload); proof[kind === 'PART' ? 'partId' : 'fileId'] = id;
      var payload = kind === 'PART' ? {partId:id,recid:proof.recid,tranId:proof.tranId} : {fileId:id};
      payload.proof = integrity.seal(kind === 'PART' ? 'part' : 'result', proof);
      var stored = jobs.loadFile(parent, id);
      if (stored.fileType !== (kind === 'PART' ? file.Type.PLAINTEXT : file.Type.PDF)) invalid('file type mismatch');
      return payloadFor(ctx, kind, ordinal, payload, parent, true);
    });
    payloads.sort(function (a,b) { var x = String(a.partId || a.fileId), y = String(b.partId || b.fileId); return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0); });
    return payloads.length ? commit(ctx, kind, ordinal, payloads[0], row.token) : null;
  }
  function list(ctx, kind) {
    var parent = authorize(ctx, kind);
    var rows = rowsFor([[PREFIX + 'job', 'is', String(ctx.jobId)], 'AND', [PREFIX + 'generation', 'is', ctx.snapshotDigest], 'AND', [PREFIX + 'kind', 'is', kind]], MAX_ROWS + 1);
    if (rows.length > MAX_ROWS) invalid('row limit');
    var seen = {};
    var all = rows.map(function (row) {
      var ordinal = Number(row.getValue({ name: PREFIX + 'ordinal' })); ordinalValue(ctx, ordinal);
      if (seen[ordinal]) invalid('duplicate logical key; recovery required');
      seen[ordinal] = true;
      var loaded = read(ctx, kind, ordinal, row.id, parent);
      return { ordinal: ordinal, payload: loaded.state.state === 'COMMITTED' ? loaded.payload : null };
    });
    all.sort(function (a, b) { return a.ordinal - b.ordinal; });
    return all.filter(function (entry) { return !!entry.payload; }).map(function (entry) { return entry.payload; });
  }
  return { get: get, commit: commit, list: list, prepare: prepare, recover: recover, name: name };
});

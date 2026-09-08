/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * Authenticated committed batch artifacts. File writes precede publication;
 * missing rows remain incomplete work, never inferred successes from filenames.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/record', 'N/search', './pld_lib_batch_jobs', './pld_lib_batch_integrity'], function (record, search, jobs, integrity) {
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
        proof.recid !== String(payload.recid) || !positive(proof.partId) || proof.name !== 'pld_part_' + ctx.jobId + '_' + sortKey(ordinal) + '.txt' ||
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
  function read(ctx, kind, ordinal, rowId, parent) {
    var rec = record.load({ type: TYPE, id: rowId });
    var state = { externalid: String(rec.getValue({ fieldId: 'externalid' })), owner: String(rec.getValue({ fieldId: 'owner' })) };
    FIELDS.forEach(function (k) { var v = rec.getValue({ fieldId: PREFIX + k }); state[k] = v == null ? '' : String(v); });
    var sealed = integrity.open('artifact', rec.getValue({ fieldId: PREFIX + 'auth' }));
    if (!sealed || typeof sealed !== 'object' || Object.keys(sealed).length !== Object.keys(state).length ||
      Object.keys(state).some(function (k) { return sealed[k] !== state[k]; }) || state.externalid !== key(ctx, kind, ordinal) ||
      state.owner !== String(parent.owner) || state.job !== String(ctx.jobId) || state.generation !== ctx.snapshotDigest ||
      state.kind !== kind || state.ordinal !== String(ordinal)) invalid('ledger integrity mismatch');
    if (state.state !== 'COMMITTED') invalid('is not committed; recovery required');
    if (state.payload.length > MAX_PAYLOAD) invalid('payload limit');
    return payloadFor(ctx, kind, ordinal, JSON.parse(state.payload), parent, false);
  }
  function existing(ctx, kind, ordinal, parent) {
    var rows = exactRows(ctx, kind, ordinal);
    if (rows.length > 1) invalid('duplicate logical key; recovery required');
    return rows.length ? read(ctx, kind, ordinal, rows[0].id, parent) : null;
  }
  function get(ctx, kind, ordinal) {
    var parent = authorize(ctx, kind); ordinalValue(ctx, ordinal);
    return existing(ctx, kind, ordinal, parent);
  }
  function commit(ctx, kind, ordinal, payload) {
    var parent = authorize(ctx, kind); ordinalValue(ctx, ordinal);
    var winner = existing(ctx, kind, ordinal, parent);
    if (winner) return winner;
    var normalized = payloadFor(ctx, kind, ordinal, payload, parent, true);
    var payloadText = JSON.stringify(normalized);
    if (payloadText.length > MAX_PAYLOAD) invalid('payload limit');
    for (var attempt = 0; attempt < 3; attempt++) {
      var state = { externalid: key(ctx, kind, ordinal), owner: String(parent.owner), job: String(ctx.jobId),
        generation: ctx.snapshotDigest, kind: kind, ordinal: String(ordinal), state: 'COMMITTED', payload: payloadText };
      var rec = record.create({ type: TYPE });
      rec.setValue({ fieldId: 'name', value: state.externalid });
      rec.setValue({ fieldId: 'externalid', value: state.externalid });
      rec.setValue({ fieldId: 'owner', value: Number(state.owner) });
      FIELDS.forEach(function (k) { rec.setValue({ fieldId: PREFIX + k, value: state[k] }); });
      rec.setValue({ fieldId: PREFIX + 'auth', value: integrity.seal('artifact', state) });
      try { rec.save(); }
      catch (saveError) {
        // A competing unique-key save may have won. Never guess vendor duplicate
        // error codes or treat an unverified record as a successful publication.
        var committed = existing(ctx, kind, ordinal, authorize(ctx, kind));
        if (committed) return committed;
        if ((saveError.name === 'RCRD_HAS_BEEN_CHANGED' || saveError.code === 'RCRD_HAS_BEEN_CHANGED') && attempt < 2) continue;
        throw saveError;
      }
      var saved = existing(ctx, kind, ordinal, authorize(ctx, kind));
      if (!saved) invalid('commit readback missing; recovery required');
      return saved;
    }
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
      return { ordinal: ordinal, payload: read(ctx, kind, ordinal, row.id, parent) };
    });
    all.sort(function (a, b) { return a.ordinal - b.ordinal; });
    return all.map(function (entry) { return entry.payload; });
  }
  return { get: get, commit: commit, list: list };
});

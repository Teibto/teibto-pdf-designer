/** Durable artifact publication and authorization failure injection.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./helpers/amd');
const { fileSystemStub, runtimeStub, logStub } = require('./helpers/ns-stubs');
const { batchStore, signJob } = require('./helpers/batch-store');
const { installArtifactStore } = require('./helpers/batch-artifact-store');
function fixture() {
  const user = { id: 9, role: 3 };
  const files = fileSystemStub();
  const stubs = { 'N/runtime': runtimeStub({ user }), 'N/file': files.module, 'N/log': logStub().module,
    'N/record': { load() { throw new Error('Record unavailable'); } },
    'N/search': { Sort: { ASC: 'ASC' }, createColumn: (opts) => opts, create() { throw new Error('Unexpected search'); } } };
  const ids = ['11', '12', '11'];
  const jobs = batchStore(stubs, files, { ids });
  const integrity = loadAmd('./pld_lib_batch_integrity', stubs);
  const ctx = { jobId: '501', folder: '77', ids, snapshotDigest: integrity.digest('synthetic signed snapshot') };
  jobs.get('501').custrecord_pld_job_snapshotdigest = ctx.snapshotDigest;
  signJob(stubs, '501', jobs.get('501'));
  const rows = installArtifactStore(stubs);
  const ledger = loadAmd('./pld_lib_batch_artifacts', stubs);
  function part(seq, contents = '<pdf>ภาษาไทย</pdf>') {
    const name = 'pld_part_501_' + ('00000' + seq).slice(-6) + '.txt';
    const partId = files.module.create({ name, contents, folder: '77', isOnline: false }).save();
    const payload = { partId, recid: ids[seq], tranId: 'SYNTHETIC-' + ids[seq], key: ('00000' + seq).slice(-6) };
    payload.proof = integrity.seal('part', { jobId: '501', snapshotDigest: ctx.snapshotDigest, folder: '77', seq,
      recid: payload.recid, tranId: payload.tranId, partId, name, bytes: Buffer.byteLength(contents), contentsHash: integrity.digest(contents) });
    return payload;
  }
  function chunk(ordinal, sequences = [0, 1]) {
    const raw = '%PDF-1.4 synthetic QA'; const contents = Buffer.from(raw).toString('base64');
    const name = 'batch_501_chunk_' + ordinal + '.pdf';
    const fileId = files.module.create({ name, contents, folder: '77', isOnline: false, size: Buffer.byteLength(raw) }).save();
    const proof = { jobId: '501', snapshotDigest: ctx.snapshotDigest, folder: '77', ordinal, fileId, name,
      contentsHash: integrity.digestPdf(contents), size: Buffer.byteLength(raw), printed: sequences.length, failed: 0,
      sequences, partRefs: sequences.map(seq => ({ seq, partId: String(2000 + seq), contentsHash: integrity.digest('part-' + seq) })) };
    return { fileId, proof: integrity.seal('result', proof) };
  }
  return { user, files, stubs, jobs, ctx, rows, integrity, ledger, part, chunk };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('PART commit survives lost context output and repeated transaction occurrences remain distinct', () => {
  const f = fixture();
  assert.equal(f.ledger.get(f.ctx, 'PART', 0), null);
  const first = f.part(0); const last = f.part(2);
  const committed = f.ledger.commit(f.ctx, 'PART', 0, first);
  assert.deepEqual(plain(committed), first);
  assert.throws(() => { throw new Error('context.write lost'); });
  assert.deepEqual(plain(f.ledger.get(f.ctx, 'PART', 0)), first);
  f.ledger.commit(f.ctx, 'PART', 2, last);
  assert.deepEqual(plain(f.ledger.list(f.ctx, 'PART')).map(p => p.key), ['000000', '000002']);
  assert.equal(f.rows.size, 2);
  assert.equal(first.recid, last.recid);
  assert.notEqual(first.partId, last.partId);
});

test('CHUNK metadata commits ordered sequences and authenticated part references', () => {
  const f = fixture(); const chunk = f.chunk(0);
  assert.deepEqual(plain(f.ledger.commit(f.ctx, 'CHUNK', 0, chunk)), chunk);
  assert.deepEqual(plain(f.ledger.list(f.ctx, 'CHUNK')), [chunk]);
});

test('saved files before ledger failure remain uncommitted and are never inferred as successes', () => {
  const f = fixture(); const payload = f.part(0);
  f.rows.beforeSave = () => { throw new Error('ledger save unavailable'); };
  assert.throws(() => f.ledger.commit(f.ctx, 'PART', 0, payload), /ledger save unavailable/);
  assert.equal(f.ledger.get(f.ctx, 'PART', 0), null);
  assert.equal(f.ledger.list(f.ctx, 'PART').length, 0);
  assert.equal(f.files.created.length, 1);
  assert.equal(f.files.deleted.length, 0);
});

test('artifact seal and committed state are present before the only native create save', () => {
  const f = fixture(); let saves = 0;
  f.rows.beforeSave = ({ fields, fresh }) => {
    saves++; assert.equal(fresh, true); assert.equal(fields.custrecord_pld_art_state, 'COMMITTED');
    const auth = f.integrity.open('artifact', fields.custrecord_pld_art_auth);
    assert.equal(auth.externalid, fields.externalid); assert.equal(auth.owner, '9');
    assert.equal(auth.payload, fields.custrecord_pld_art_payload);
  };
  f.ledger.commit(f.ctx, 'PART', 0, f.part(0));
  assert.equal(saves, 1);
});

test('competing unique-key saves reuse the authenticated winner without overwriting it', () => {
  const f = fixture(); const earlier = f.part(0, '<pdf>earlier</pdf>'); const winner = f.part(0, '<pdf>winner</pdf>');
  let raced = false;
  f.rows.beforeSave = () => {
    if (!raced) { raced = true; f.ledger.commit(f.ctx, 'PART', 0, winner); }
  };
  assert.deepEqual(plain(f.ledger.commit(f.ctx, 'PART', 0, earlier)), winner);
  assert.equal(f.rows.size, 1);
  assert.deepEqual(plain(f.ledger.commit(f.ctx, 'PART', 0, earlier)), winner);
});

test('ambiguous duplicate logical keys fail closed on lookup and listing', () => {
  const f = fixture(); f.ledger.commit(f.ctx, 'PART', 0, f.part(0));
  f.rows.set('9999', { ...f.rows.values().next().value });
  assert.throws(() => f.ledger.get(f.ctx, 'PART', 0), /duplicate logical key/);
  assert.throws(() => f.ledger.list(f.ctx, 'PART'), /duplicate logical key/);
});

test('native owner, generation, ordinal, payload and unsigned edits invalidate artifact authority', () => {
  for (const field of ['owner', 'custrecord_pld_art_generation', 'custrecord_pld_art_ordinal', 'custrecord_pld_art_payload', 'custrecord_pld_art_auth']) {
    const f = fixture(); f.ledger.commit(f.ctx, 'PART', 0, f.part(0));
    f.rows.values().next().value[field] = 'forged';
    assert.throws(() => f.ledger.get(f.ctx, 'PART', 0), /integrity|authentication/i, field);
  }
});

test('parent user/role authorization and immutable snapshot generation precede every artifact access', () => {
  const f = fixture(); const payload = f.part(0); f.ledger.commit(f.ctx, 'PART', 0, payload);
  for (const change of [{ id: 10, role: 3 }, { id: 9, role: 4 }]) {
    Object.assign(f.user, change);
    for (const invoke of [() => f.ledger.get(f.ctx, 'PART', 0), () => f.ledger.list(f.ctx, 'PART'), () => f.ledger.commit(f.ctx, 'PART', 0, payload)]) assert.throws(invoke, /unavailable/);
  }
  Object.assign(f.user, { id: 9, role: 3 });
  assert.throws(() => f.ledger.get({ ...f.ctx, snapshotDigest: 'a'.repeat(64) }, 'PART', 0), /generation mismatch/);
  assert.throws(() => f.ledger.get({ ...f.ctx, folder: '88' }, 'PART', 0), /generation mismatch/);
});

test('forged producer proof, sequence substitution, unverified metadata and file edits cannot be published', () => {
  for (const mutation of ['proof', 'sequence', 'metadata', 'file']) {
    const f = fixture(); const p = f.part(0);
    if (mutation === 'proof') p.proof = p.proof.replace('SYNTHETIC', 'FORGED');
    if (mutation === 'metadata') p.extra = 'unverified';
    if (mutation === 'file') f.files.contents[p.partId] = '<pdf>tampered</pdf>';
    assert.throws(() => f.ledger.commit(f.ctx, 'PART', mutation === 'sequence' ? 2 : 0, p), /integrity|authentication|proof|metadata|contents|payload/i);
    assert.equal(f.rows.size, 0);
  }
});

test('chunk proof rejects duplicate/out-of-order sequences and mismatched part references', () => {
  for (const sequences of [[1, 0], [0, 0]]) {
    const f = fixture(); assert.throws(() => f.ledger.commit(f.ctx, 'CHUNK', 0, f.chunk(0, sequences)), /chunk proof/);
  }
  const f = fixture(); const c = f.chunk(0); const proof = f.integrity.open('result', c.proof);
  proof.partRefs[0].seq = 2; c.proof = f.integrity.seal('result', proof);
  assert.throws(() => f.ledger.commit(f.ctx, 'CHUNK', 0, c), /chunk proof/);
});

test('named optimistic conflicts retry at most three times; unrelated save errors retain original failure', () => {
  for (const conflict of [true, false]) {
    const f = fixture(); let attempts = 0;
    f.rows.beforeSave = () => { attempts++; const e = new Error('original save failure'); if (conflict) e.name = 'RCRD_HAS_BEEN_CHANGED'; throw e; };
    assert.throws(() => f.ledger.commit(f.ctx, 'PART', 0, f.part(0)), /original save failure/);
    assert.equal(attempts, conflict ? 3 : 1);
    assert.equal(f.rows.size, 0);
  }
});

test('saved publication with lost acknowledgement is recovered from authenticated exact-key readback', () => {
  const f = fixture(); const payload = f.part(0);
  f.rows.beforeSave = ({ id, fields }) => {
    f.rows.set(id, { ...fields });
    throw new Error('save acknowledgement lost');
  };
  assert.deepEqual(plain(f.ledger.commit(f.ctx, 'PART', 0, payload)), payload);
  assert.equal(f.rows.size, 1);
});

test('signed metadata list does not reread part file contents during planning', () => {
  const f = fixture(); const p = f.part(0); f.ledger.commit(f.ctx, 'PART', 0, p);
  const load = f.files.module.load;
  f.files.module.load = (opts) => {
    if (String(opts.id) === p.partId) throw new Error('planning must not load XML');
    return load(opts);
  };
  assert.deepEqual(plain(f.ledger.list(f.ctx, 'PART')), [p]);
});


function intentFixture(kind = 'PART') {
  const f = fixture();
  f.jobs.get('501').custrecord_pld_job_status = 'RUNNING';
  f.jobs.get('501').custrecord_pld_job_phase = kind === 'PART' ? 'RENDERING' : 'MERGING';
  if (kind === 'CHUNK') f.jobs.get('501').custrecord_pld_job_plan = f.integrity.seal('plan',{synthetic:true});
  signJob(f.stubs, '501', f.jobs.get('501'));
  const load = f.files.module.load;
  f.files.module.load = opts => Object.assign(load(opts), {fileType: f.files.created.find(row => row.id === String(opts.id))?.fileType});
  const search = f.stubs['N/search'].create;
  f.stubs['N/search'].create = opts => {
    if (opts.type !== 'file') return search(opts);
    assert.deepEqual(plain(opts.filters), [['folder','anyof','77'],'AND',['name','is',f.searchName]]);
    return {run:()=>({getRange:({start,end})=>f.files.created.filter(row=>String(row.folder)==='77' && row.name===f.searchName).slice(start,end)})};
  };
  f.makeIntent = (contents = '<pdf>synthetic recovery</pdf>') => {
    const raw = kind === 'PART' ? contents : Buffer.from(contents).toString('base64');
    const contentsHash = kind === 'PART' ? f.integrity.digest(raw) : f.integrity.digestPdf(raw);
    const name = f.ledger.name(f.ctx,kind,0,contentsHash); f.searchName = name;
    const intent = kind === 'PART' ? {jobId:'501',snapshotDigest:f.ctx.snapshotDigest,folder:'77',seq:0,recid:'11',tranId:'SYNTHETIC',name,bytes:Buffer.byteLength(contents),contentsHash}
      : {jobId:'501',snapshotDigest:f.ctx.snapshotDigest,folder:'77',ordinal:0,sequences:[0],partRefs:[{seq:0,partId:'2000',contentsHash:f.integrity.digest('part')}],name,size:Buffer.byteLength(contents),printed:1,failed:0,contentsHash};
    const save = () => {
      const id = f.files.module.create({name,contents:raw,folder:'77',isOnline:false,fileType:kind==='PART'?'PLAINTEXT':'PDF',size:Buffer.byteLength(contents)}).save();
      const proof = {...intent,[kind==='PART'?'partId':'fileId']:id};
      return kind==='PART' ? {partId:id,recid:'11',tranId:'SYNTHETIC',key:'000000',proof:f.integrity.seal('part',proof)} : {fileId:id,proof:f.integrity.seal('result',proof)};
    };
    return {intent,save};
  };
  return f;
}

test('WRITING reservation is authenticated before save, invisible to list, and commits the same row',()=>{
  for(const kind of ['PART','CHUNK']) {
    const f=intentFixture(kind), producer=f.makeIntent();
    const reservation=f.ledger.prepare(f.ctx,kind,0,producer.intent);
    const id=[...f.rows.keys()][0];
    assert.equal(f.integrity.open('artifact',f.rows.get(id).custrecord_pld_art_auth).state,'WRITING');
    assert.equal(f.ledger.get(f.ctx,kind,0),null);assert.deepEqual(plain(f.ledger.list(f.ctx,kind)),[]);
    assert.equal(f.ledger.recover(f.ctx,kind,0),null);
    const payload=producer.save();
    assert.deepEqual(plain(f.ledger.commit(f.ctx,kind,0,payload,reservation.token)),payload);
    assert.equal(f.rows.size,1);assert.equal([...f.rows.keys()][0],id);
    assert.equal(f.rows.get(id).custrecord_pld_art_state,'COMMITTED');
    assert.deepEqual(plain(f.ledger.prepare(f.ctx,kind,0,producer.intent).committed),payload);
  }
});

test('saved orphan recovery validates actual bytes and deterministically adopts the lowest identical candidate',()=>{
  for(const kind of ['PART','CHUNK']) {
    const f=intentFixture(kind), producer=f.makeIntent();
    f.ledger.prepare(f.ctx,kind,0,producer.intent);
    const first=producer.save();producer.save();
    f.files.created.reverse();
    assert.deepEqual(plain(f.ledger.recover(f.ctx,kind,0)),first);
    assert.equal(f.files.deleted.length,0);assert.equal(f.rows.size,1);
  }
});

test('intent rotation fences an older writer and metadata substitution cannot publish',()=>{
  const f=intentFixture(), first=f.makeIntent('<pdf>first</pdf>');
  const old=f.ledger.prepare(f.ctx,'PART',0,first.intent), payload=first.save();
  const second=f.makeIntent('<pdf>second</pdf>'), next=f.ledger.prepare(f.ctx,'PART',0,second.intent);
  assert.notEqual(old.token,next.token);
  assert.throws(()=>f.ledger.commit(f.ctx,'PART',0,payload,old.token),/stale intent/);
  assert.throws(()=>f.ledger.commit(f.ctx,'PART',0,payload,next.token),/intent metadata/);
  assert.throws(()=>f.ledger.commit(f.ctx,'PART',0,payload),/stale intent/);
  assert.equal(f.ledger.get(f.ctx,'PART',0),null);
  const winner=second.save();assert.deepEqual(plain(f.ledger.recover(f.ctx,'PART',0)),winner);
});

test('WRITING edits, wrong actor, terminal parent, and malformed intent fail closed',()=>{
  for(const mode of ['native','actor','terminal','intent']) {
    const f=intentFixture(), producer=f.makeIntent();
    f.ledger.prepare(f.ctx,'PART',0,producer.intent);producer.save();
    if(mode==='native')f.rows.values().next().value.custrecord_pld_art_payload='{}';
    if(mode==='actor')f.user.role=4;
    if(mode==='terminal') {f.jobs.get('501').custrecord_pld_job_status='COMPLETE';signJob(f.stubs,'501',f.jobs.get('501'));}
    if(mode==='intent') {
      assert.throws(()=>f.ledger.prepare(f.ctx,'PART',0,{...producer.intent,extra:'untrusted'}),/intent schema/);
      assert.throws(()=>f.ledger.prepare(f.ctx,'PART',0,{...producer.intent,name:'pld_part_501_000000.txt'}),/intent name/);
    } else assert.throws(()=>f.ledger.recover(f.ctx,'PART',0),/integrity|unavailable|stage/);
    assert.equal(f.files.deleted.length,0);
  }
});

test('orphan candidates require exact type, size, hash and privacy, with bounded overflow',()=>{
  for(const mode of ['type','size','hash','privacy','overflow']) {
    const f=intentFixture(), producer=f.makeIntent();f.ledger.prepare(f.ctx,'PART',0,producer.intent);
    const payload=producer.save(), row=f.files.created[0];
    if(mode==='type')row.fileType='PDF';
    if(mode==='size')row.size++;
    if(mode==='hash')f.files.contents[payload.partId]='x'.repeat(row.size);
    if(mode==='privacy')row.isOnline=true;
    if(mode==='overflow')for(let i=0;i<3;i++)producer.save();
    assert.throws(()=>f.ledger.recover(f.ctx,'PART',0),/type|metadata|contents|private|candidate|online|unavailable|storage/);
    assert.equal(f.ledger.get(f.ctx,'PART',0),null);assert.equal(f.files.deleted.length,0);
  }
});

test('rotation racing a commit fences the stale loaded record and committed winner survives lost acknowledgment',()=>{
  const f=intentFixture(), first=f.makeIntent('first'), second=f.makeIntent('second');
  const initial=f.ledger.prepare(f.ctx,'PART',0,first.intent), payload=first.save();let raced=false;
  f.rows.beforeSave=({fields})=>{if(!raced && fields.custrecord_pld_art_state==='COMMITTED'){raced=true;f.ledger.prepare(f.ctx,'PART',0,second.intent);}};
  assert.throws(()=>f.ledger.commit(f.ctx,'PART',0,payload,initial.token),/stale intent/);
  f.rows.beforeSave=null;
  const reservation=f.ledger.prepare(f.ctx,'PART',0,second.intent), winner=second.save();
  const record=f.stubs['N/record'].load;
  f.stubs['N/record'].load=opts=>{const rec=record(opts);if(opts.type==='customrecord_pld_batch_artifact'){const save=rec.save;rec.save=()=>{save();throw new Error('acknowledgment lost');};}return rec;};
  assert.deepEqual(plain(f.ledger.commit(f.ctx,'PART',0,winner,reservation.token)),winner);
});


test('A to B to A reservations reject the original token and bind CHUNK intent to its signed plan',()=>{
  const f=intentFixture(), a=f.makeIntent('A'), b=f.makeIntent('B');
  const first=f.ledger.prepare(f.ctx,'PART',0,a.intent), payload=a.save();
  f.ledger.prepare(f.ctx,'PART',0,b.intent);
  const last=f.ledger.prepare(f.ctx,'PART',0,a.intent);
  assert.notEqual(first.token,last.token);
  assert.throws(()=>f.ledger.commit(f.ctx,'PART',0,payload,first.token),/stale intent/);
  assert.equal(JSON.parse(f.rows.values().next().value.custrecord_pld_art_payload).revision,3);
  assert.deepEqual(plain(f.ledger.commit(f.ctx,'PART',0,payload,last.token)),payload);
  const chunk=intentFixture('CHUNK'), producer=chunk.makeIntent();
  const reservation=chunk.ledger.prepare(chunk.ctx,'CHUNK',0,producer.intent), saved=producer.save();
  chunk.jobs.get('501').custrecord_pld_job_plan=chunk.integrity.seal('plan',{different:true});
  signJob(chunk.stubs,'501',chunk.jobs.get('501'));
  for(const action of [()=>chunk.ledger.prepare(chunk.ctx,'CHUNK',0,producer.intent),()=>chunk.ledger.recover(chunk.ctx,'CHUNK',0),()=>chunk.ledger.commit(chunk.ctx,'CHUNK',0,saved,reservation.token)]) assert.throws(action,/writing plan mismatch/);
});


test('recovery compares long numeric candidate identities without rounding',()=>{
  const f=intentFixture(), producer=f.makeIntent();f.ledger.prepare(f.ctx,'PART',0,producer.intent);
  for(const id of ['9007199254740993','9007199254740992']) {
    const payload=producer.save(), row=f.files.created.at(-1);
    f.files.contents[id]=f.files.contents[payload.partId];row.id=id;
  }
  assert.equal(f.ledger.recover(f.ctx,'PART',0).partId,'9007199254740992');
});

test('concurrent initial reservations preserve one row and reject unbounded revision rotation',()=>{
  const f=intentFixture(), producer=f.makeIntent();let raced=false;
  f.rows.beforeSave=()=>{if(!raced){raced=true;f.ledger.prepare(f.ctx,'PART',0,producer.intent);}};
  const reservation=f.ledger.prepare(f.ctx,'PART',0,producer.intent);
  assert.equal(f.rows.size,1);assert.equal(f.ledger.prepare(f.ctx,'PART',0,producer.intent).token,reservation.token);
  f.rows.beforeSave=null;
  const row=f.rows.values().next().value, state=f.integrity.open('artifact',row.custrecord_pld_art_auth);
  const wrapper=JSON.parse(state.payload);wrapper.revision=Number.MAX_SAFE_INTEGER;
  state.payload=JSON.stringify(wrapper);row.custrecord_pld_art_payload=state.payload;row.custrecord_pld_art_auth=f.integrity.seal('artifact',state);
  assert.throws(()=>f.ledger.prepare(f.ctx,'PART',0,f.makeIntent('changed').intent),/revision limit/);
  row.custrecord_pld_art_payload='{}';
  assert.throws(()=>f.ledger.list(f.ctx,'PART'),/integrity/);
});

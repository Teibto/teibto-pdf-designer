/** Crash-safe reserved child provisioning with authenticated native records.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadAmd}=require('./helpers/amd');
const {fileSystemStub,runtimeStub,logStub}=require('./helpers/ns-stubs');
const {batchStore,signJob}=require('./helpers/batch-store');
const KEY='pld-retry-'+'a'.repeat(64);
function fixture() {
  const user={id:9,role:3},files=fileSystemStub({files:{'/SuiteScripts/pdf-layout-designer/pld_version.txt':{folder:'55'}}});
  const log=logStub();
  const stubs={'N/runtime':runtimeStub({user}),'N/file':files.module,'N/log':log.module,
    'N/record':{load(){throw new Error('Missing record');}},'N/search':{Sort:{DESC:'DESC'},createColumn:opts=>opts,create(){throw new Error('Unexpected search');}}};
  const rows=batchStore(stubs,files),integrity=loadAmd('./pld_lib_batch_integrity',stubs),jobs=loadAmd('./pld_lib_batch_jobs',stubs);
  return {user,files,stubs,rows,integrity,jobs,log};
}
function initOnly(f) {
  f.rows.beforeSave=({fresh,type})=>{if(!fresh && type==='customrecord_pld_batch_job')throw new Error('promotion interrupted');};
  assert.throws(()=>f.jobs.createReserved(2,KEY),/promotion interrupted/);
  f.rows.beforeSave=null;return [...f.rows.keys()][0];
}

test('reserved first save is sealed, repeated requests reuse the same job and private folder',()=>{
  const f=fixture();let initial=0;
  f.rows.beforeSave=({fields,type,fresh})=>{if(fresh && type==='customrecord_pld_batch_job'){
    initial++;const value=f.integrity.open('job-init',fields.custrecord_pld_job_auth);
    assert.equal(value.externalid,KEY);assert.equal(value.phase,'PROVISIONING');assert.equal(value.owner,'9');assert.equal(Object.hasOwn(value,'id'),false);
  }};
  const first=f.jobs.createReserved(2,KEY), second=f.jobs.createReserved(2,KEY);
  assert.deepEqual(JSON.parse(JSON.stringify(second)),JSON.parse(JSON.stringify(first)));
  assert.equal(initial,1);assert.equal(f.rows.size,2);assert.equal(first.phase,'PROVISIONING');assert.ok(first.folder);
  assert.equal(f.rows.get(first.folder).isprivate,true);assert.equal(f.files.created.length,0);assert.equal(f.files.deleted.length,0);
  assert.throws(()=>f.jobs.createReserved(3,KEY),/count mismatch/);
  assert.throws(()=>f.jobs.update(first.id,{externalid:'changed'}),/Immutable/);
});

test('lost initial or promotion save acknowledgment recovers only an authenticated reserved winner',()=>{
  for(const stage of ['initial','promotion']) {
    const f=fixture();let saves=0,lost=false;
    f.rows.afterSave=({type})=>{if(type==='customrecord_pld_batch_job'){saves++;if(!lost && saves===(stage==='initial'?1:2)){lost=true;throw new Error('acknowledgment lost');}}};
    const job=f.jobs.createReserved(2,KEY);
    assert.ok(job.folder);assert.equal(f.rows.size,2);assert.equal(lost,true);
  }
});

test('ordinary loads reject init while exact reservation lookup safely promotes after interruption',()=>{
  const f=fixture(),id=initOnly(f);
  assert.throws(()=>f.jobs.load(id),/integrity/);
  const job=f.jobs.findReserved(KEY);assert.equal(job.id,id);assert.equal(job.folder,'');assert.equal(f.rows.size,1);
  assert.equal(f.jobs.createReserved(2,KEY).id,id);assert.equal(f.rows.size,2);
});

test('promotion retries only bounded optimistic conflicts and preserves concurrent normal promotion',()=>{
  const f=fixture(),id=initOnly(f);let raced=false;
  f.rows.beforeSave=({type})=>{if(type==='customrecord_pld_batch_job' && !raced){raced=true;f.jobs.findReserved(KEY);}};
  assert.equal(f.jobs.findReserved(KEY).id,id);
  const stalled=fixture();initOnly(stalled);let attempts=0;
  stalled.rows.beforeSave=()=>{attempts++;throw Object.assign(new Error('conflict'),{name:'RCRD_HAS_BEEN_CHANGED'});};
  assert.throws(()=>stalled.jobs.findReserved(KEY),/conflict/);assert.equal(attempts,3);
});

test('native key, actor, unsigned and coordinated init tampering cannot confer reservation authority',()=>{
  for(const mode of ['key','actor','role','unsigned','fields']) {
    const f=fixture(),id=initOnly(f),row=f.rows.get(id);
    if(mode==='key')row.externalid='pld-retry-'+'b'.repeat(64);
    if(mode==='actor')f.user.id=10;
    if(mode==='role')f.user.role=4;
    if(mode==='unsigned')row.custrecord_pld_job_auth='';
    if(mode==='fields'){row.owner='10';row.custrecord_pld_job_requester='10';f.user.id=10;}
    assert.throws(()=>f.jobs.findReserved(mode==='key'?row.externalid:KEY),/integrity|unavailable/);
    assert.equal(f.rows.size,1);
  }
});

test('duplicate native keys and unsigned collision winners fail closed',()=>{
  const f=fixture(),id=initOnly(f);f.rows.set('999',{...f.rows.get(id)});
  assert.throws(()=>f.jobs.findReserved(KEY),/Duplicate/);
  const unsigned=fixture();let raced=false;
  unsigned.rows.beforeSave=({type,fresh,fields})=>{if(type==='customrecord_pld_batch_job' && fresh && !raced){raced=true;unsigned.rows.set('999',{...fields,custrecord_pld_job_auth:''});}};
  assert.throws(()=>unsigned.jobs.createReserved(2,KEY),/integrity/);assert.equal(unsigned.rows.size,1);
});

test('folder creation lost acknowledgment and binding save loss resume the original private folder',()=>{
  for(const stage of ['folder','binding']) {
    const f=fixture();let lost=false;
    f.rows.afterSave=({type,fields})=>{if(!lost && (stage==='folder'?type==='folder':type==='customrecord_pld_batch_job' && fields.custrecord_pld_job_folder)){
      lost=true;throw new Error('acknowledgment lost');
    }};
    const job=f.jobs.createReserved(2,KEY);assert.ok(job.folder);assert.equal(f.rows.size,2);assert.equal(lost,true);
    assert.equal(f.jobs.createReserved(2,KEY).folder,job.folder);
  }
});

test('unbound duplicate, public or foreign folders are never adopted',()=>{
  for(const mode of ['duplicate','public','owner']) {
    const f=fixture(),id=initOnly(f);f.jobs.findReserved(KEY);
    const folder={name:'pld-job-'+id,parent:'55',owner:mode==='owner'?'10':'9',isprivate:mode!=='public'};
    f.rows.set('801',folder);if(mode==='duplicate')f.rows.set('802',{...folder});
    assert.throws(()=>f.jobs.createReserved(2,KEY),/Duplicate|privacy/);
    assert.equal(f.jobs.load(id).folder,'');assert.equal(f.files.deleted.length,0);
  }
});

test('legacy job seals are compatible only with an empty actual external ID',()=>{
  const f=fixture(),job=f.jobs.createReserved(2,KEY),row=f.rows.get(job.id);
  const legacy=f.integrity.open('job',row.custrecord_pld_job_auth);delete legacy.externalid;
  row.custrecord_pld_job_auth=f.integrity.seal('job',legacy);
  assert.throws(()=>f.jobs.load(job.id),/integrity/);
  row.externalid='';assert.equal(f.jobs.load(job.id).externalid,'');
  f.jobs.update(job.id,{phase:'READY'});
  assert.equal(f.integrity.open('job',row.custrecord_pld_job_auth).externalid,'');
});

test('advanced reserved jobs are returned without rebuilding folder or changing accepted state',()=>{
  const f=fixture(),job=f.jobs.createReserved(2,KEY);
  f.jobs.update(job.id,{snapshot:'900',snapshotdigest:'c'.repeat(64)});
  f.jobs.update(job.id,{status:'RUNNING',phase:'RENDERING',task:'ACCEPTED'});
  const replay=f.jobs.createReserved(2,KEY);
  assert.equal(replay.status,'RUNNING');assert.equal(replay.snapshot,'900');assert.equal(replay.task,'ACCEPTED');assert.equal(f.rows.size,2);
});


test('concurrent unique-key creation and same-folder binding reuse the authenticated winner',()=>{
  for(const stage of ['create','binding']) {
    const f=fixture();let raced=false,winner;
    f.rows.beforeSave=({id,type,fresh,fields})=>{
      if(raced || type!=='customrecord_pld_batch_job')return;
      if(stage==='create' && fresh){raced=true;winner=f.jobs.createReserved(2,KEY);}
      if(stage==='binding' && !fresh && fields.custrecord_pld_job_folder){raced=true;winner=f.jobs.update(id,{folder:fields.custrecord_pld_job_folder});}
    };
    const result=f.jobs.createReserved(2,KEY);
    assert.equal(result.id,winner.id);assert.equal(result.folder,winner.folder);assert.equal(f.rows.size,2);
  }
});

test('competing folder creations remain visible instead of silently selecting one',()=>{
  const f=fixture();let raced=false;
  f.rows.afterSave=({type,fields})=>{if(type==='folder' && !raced){raced=true;f.rows.set('999',{...fields});}};
  assert.throws(()=>f.jobs.createReserved(2,KEY),/Duplicate/);
  const reserved=f.jobs.findReserved(KEY);assert.equal(reserved.folder,'');assert.equal(reserved.phase,'PROVISIONING');
  assert.equal(f.files.created.length,0);assert.equal(f.files.deleted.length,0);
});


test('synthetic reserved allocation never overwrites existing source records',()=>{
  const f=fixture();f.rows.set('501',{owner:'9',custrecord_pld_job_requester:'9',custrecord_pld_job_role:'3',custrecord_pld_job_status:'PARTIAL'});
  signJob(f.stubs,'501',f.rows.get('501'));
  const source=JSON.stringify(f.rows.get('501')),child=f.jobs.createReserved(2,KEY);
  assert.notEqual(child.id,'501');assert.equal(JSON.stringify(f.rows.get('501')),source);
});


test('listing keeps valid jobs, counts authenticated init, and hides corrupt rows without aborting',()=>{
  const f=fixture(),id=initOnly(f),search=f.stubs['N/search'].create;
  const validId='700',corruptId='701';
  f.rows.set(validId,{owner:'9',externalid:'',custrecord_pld_job_requester:'9',custrecord_pld_job_role:'3',
    custrecord_pld_job_status:'QUEUED',custrecord_pld_job_requested:'2',custrecord_pld_job_printed:'0',custrecord_pld_job_failed:'0'});
  signJob(f.stubs,validId,f.rows.get(validId));
  f.rows.set(corruptId,{...f.rows.get(validId),custrecord_pld_job_auth:''});
  f.stubs['N/search'].create=opts=>opts.type==='customrecord_pld_batch_job' && opts.filters[0][0]==='custrecord_pld_job_requester'
    ? {run:()=>({getRange:()=>[{id:validId},{id},{id:corruptId}]})}:search(opts);
  let writes=0;f.rows.beforeSave=()=>{writes++;};
  const listed=f.jobs.list();assert.deepEqual(Array.from(listed,job=>job.id),[validId]);
  assert.equal(listed.provisioningCount,1);assert.equal(listed.unavailableCount,1);assert.equal(writes,0);
  assert.equal(f.log.entries.filter(entry=>entry.title==='PLD batch list row unavailable').length,1);
  assert.throws(()=>f.jobs.load(id),/integrity/);
  f.rows.get(id).custrecord_pld_job_requested='99';
  const afterTamper=f.jobs.list();assert.deepEqual(Array.from(afterTamper,job=>job.id),[validId]);
  assert.equal(afterTamper.provisioningCount,0);assert.equal(afterTamper.unavailableCount,2);assert.equal(writes,0);
});

test('listing does not mask systemic record load failures as corrupt rows',()=>{
  const f=fixture(),search=f.stubs['N/search'].create;
  f.stubs['N/search'].create=opts=>opts.type==='customrecord_pld_batch_job' && opts.filters[0][0]==='custrecord_pld_job_requester'
    ? {run:()=>({getRange:()=>[{id:'999'}]})}:search(opts);
  assert.throws(()=>f.jobs.list(),/Missing record/);
  assert.equal(f.log.entries.filter(entry=>entry.title==='PLD batch list row unavailable').length,0);
});

test('listing crypto readiness failure aborts globally before any row is hidden',()=>{
  const f=fixture();let loads=0;
  const load=f.stubs['N/record'].load;
  f.stubs['N/record'].load=opts=>{loads++;return load(opts);};
  f.stubs['N/crypto'].createHmac=()=>{throw new Error('native HMAC denied');};

  assert.throws(()=>f.jobs.list(),/Batch integrity verification failed.*crypto:hmac/);
  assert.equal(loads,0,'readiness probe must run before per-row handling');
  assert.equal(f.log.entries.filter(entry=>entry.title==='PLD batch list row unavailable').length,0,
    'global crypto outage must not be misreported as row corruption');
});

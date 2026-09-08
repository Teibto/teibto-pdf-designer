/** Signed source selection and failure partition boundaries.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadAmd} = require('./helpers/amd');
const {fileSystemStub, runtimeStub, logStub} = require('./helpers/ns-stubs');
const {batchStore, signJob} = require('./helpers/batch-store');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture({ids=['11','12','11','14'], failed=[0,2], allFailed=false}={}) {
  const user={id:9,role:3}, files=fileSystemStub();
  const stubs={'N/runtime':runtimeStub({user}),'N/file':files.module,'N/log':logStub().module,
    'N/record':{load(){throw new Error('unexpected record');}},'N/search':{},'N/render':{},'N/format':{},
    './pld_lib_company_config':{},'./pld_lib_invoice_data':{}};
  const rows=batchStore(stubs,files,{ids}), job=rows.get('501'), integrity=loadAmd('./pld_lib_batch_integrity',stubs);
  const snapshot={schemaVersion:5,jobId:'501',folder:'77',requester:{id:9,role:3},rectype:'invoice',tplid:'42',ids,
    templateSnapshot:{xml:'<pdf><body>${record.tranid!}</body></pdf>',copies:[{th:'Original',en:'Original'}]}};
  if(allFailed) failed=ids.map((_,seq)=>seq);
  const chunks=ids.map((_,seq)=>seq).filter(seq=>!failed.includes(seq)).map((seq,ordinal)=>({ordinal,sequences:[seq]}));
  let snapshotFile;
  const f={user,files,stubs,rows,job,integrity,snapshot};
  f.bindSnapshot=()=>{
    const text=integrity.seal('snapshot',snapshot);
    files.register('900',text);
    snapshotFile={name:'pld_job_501.json',folder:'77',isOnline:false,size:Buffer.byteLength(text),getContents:()=>text};
    job.custrecord_pld_job_snapshotdigest=integrity.digest(text);
    return snapshotFile;
  };
  f.bindSnapshot();
  const load=files.module.load;files.module.load=opts=>String(opts.id)==='900'?snapshotFile:load(opts);
  const plan={jobId:'501',snapshotDigest:job.custrecord_pld_job_snapshotdigest,requested:ids.length,chunks,
    failed:failed.map(seq=>({seq,recid:String(ids[seq]),code:seq%2?'NO_COMMITTED_PART':'RENDER_FAILED',message:'private raw exception must not be returned'}))};
  Object.assign(job,{custrecord_pld_job_status:allFailed?'FAILED':'PARTIAL',custrecord_pld_job_phase:'DONE',
    custrecord_pld_job_printed:ids.length-failed.length,custrecord_pld_job_failed:failed.length});
  const manifest={jobId:'501',snapshotDigest:job.custrecord_pld_job_snapshotdigest,folder:'77',requested:ids.length,printed:ids.length-failed.length,failed:failed.length,
    outputs:chunks.map(chunk=>({ordinal:chunk.ordinal,fileId:String(1000+chunk.ordinal),proof:integrity.seal('result',{
      jobId:'501',snapshotDigest:job.custrecord_pld_job_snapshotdigest,folder:'77',ordinal:chunk.ordinal,fileId:String(1000+chunk.ordinal),sequences:chunk.sequences,printed:chunk.sequences.length,failed:0})}))};
  f.sign=()=>{job.custrecord_pld_job_plan=integrity.seal('plan',plan);job.custrecord_pld_job_outputs=allFailed?'':integrity.seal('manifest',manifest);signJob(stubs,'501',job);};
  f.sign();
  Object.assign(f,{plan,manifest,selection:loadAmd('./pld_lib_batch_selection',stubs),snapshotFile:()=>snapshotFile});
  return f;
}

test('two published outputs select only failed occurrences and preserve exact immutable template',()=>{
  const f=fixture(), selection=f.selection.read('501');
  assert.deepEqual(plain(selection.sequences),[0,2]);assert.deepEqual(plain(selection.ids),['11','11']);
  assert.deepEqual(plain(selection.failures),[{seq:0,recid:'11',code:'RENDER_FAILED'},{seq:2,recid:'11',code:'RENDER_FAILED'}]);
  assert.deepEqual(plain(selection.templateSnapshot),f.snapshot.templateSnapshot);
  assert.equal(selection.sourceSnapshotDigest,f.job.custrecord_pld_job_snapshotdigest);
  assert.equal(selection.sourcePlanDigest,f.integrity.digest(f.job.custrecord_pld_job_plan));
  assert.equal(selection.sourceOutputsDigest,f.integrity.digest(f.job.custrecord_pld_job_outputs));
  assert.equal(selection.tplid,'42');assert.equal(selection.rectype,'invoice');assert.equal(f.files.created.length,0);
});

test('all-failed signed plan selects every occurrence up to 500 documents',()=>{
  const f=fixture({ids:Array(500).fill('11'),allFailed:true});
  const selection=f.selection.read('501');assert.equal(selection.ids.length,500);
  assert.deepEqual(plain(selection.sequences),Array.from({length:500},(_,i)=>i));
  assert.equal(selection.sourceOutputsDigest,f.integrity.digest(''));
  assert.throws(()=>fixture({ids:Array(501).fill('11'),allFailed:true}).selection.read('501'),/counts/);
});

test('nonterminal, completed, unknown and failed-with-output states cannot become retry selections',()=>{
  for(const change of [{custrecord_pld_job_phase:'RENDER_SUBMIT_UNKNOWN'},{custrecord_pld_job_status:'RUNNING'},{custrecord_pld_job_status:'COMPLETE'}]) {
    const f=fixture();Object.assign(f.job,change);f.sign();assert.throws(()=>f.selection.read('501'),/eligible/);
  }
  for(const key of ['result','resultseal','printed']) {
    const f=fixture({allFailed:true});f.job['custrecord_pld_job_'+key]='1';f.sign();assert.throws(()=>f.selection.read('501'),/state|counts/);
  }
});

test('owner, role, private folder and signed snapshot boundaries fail closed',()=>{
  for(const mode of ['owner','role','folder','parent','public','unsigned','bytes','name','size']) {
    const f=fixture();
    if(mode==='owner')f.user.id=10;
    if(mode==='role')f.user.role=4;
    if(mode==='folder')f.rows.get('77').isprivate=false;
    if(mode==='parent')f.rows.get('77').owner='10';
    if(mode==='public')f.snapshotFile().isOnline=true;
    if(mode==='unsigned')f.job.custrecord_pld_job_failed=99;
    if(mode==='bytes')f.snapshotFile().getContents=()=>'{tampered}';
    if(mode==='name')f.snapshotFile().name='other.json';
    if(mode==='size') {f.snapshotFile().size=8*1024*1024+1;f.snapshotFile().getContents=()=>{throw new Error('must not read oversized file');};}
    assert.throws(()=>f.selection.read('501'),/unavailable|privacy|private|storage|integrity|digest|snapshot file/);
  }
});

test('signed malformed snapshot identities, XML and copy bounds are rejected',()=>{
  for(const mutate of [s=>s.schemaVersion=4,s=>s.requester.role=4,s=>s.ids[0]='../11',s=>s.folder='88',
    s=>s.templateSnapshot.xml='',s=>s.templateSnapshot.xml='x'.repeat(1000001),s=>s.templateSnapshot.copies=Array(101).fill({en:'copy'}),s=>s.templateSnapshot.copies=[{en:42}]]) {
    const f=fixture();mutate(f.snapshot);f.bindSnapshot();f.plan.snapshotDigest=f.job.custrecord_pld_job_snapshotdigest;f.sign();
    assert.throws(()=>f.selection.read('501'),/snapshot|copies|execution limit/);
  }
});

test('signed plan must partition sequences completely in order with safe failure codes and matching IDs',()=>{
  for(const mutate of [p=>p.snapshotDigest='a'.repeat(64),p=>p.requested++,p=>p.chunks[1].ordinal=0,p=>p.chunks[0].sequences=[1,1],
    p=>p.chunks[0].sequences=[4],p=>p.chunks[0].sequences=Array(26).fill(1),p=>p.failed.reverse(),p=>p.failed[1].seq=0,
    p=>p.failed[0].recid='999',p=>p.failed[0].code='RAW_EXCEPTION',p=>p.chunks.pop()]) {
    const f=fixture();mutate(f.plan);f.sign();assert.throws(()=>f.selection.read('501'),/plan|partition/);
  }
});

test('published results must exactly match the plan and counts, including stale signed envelopes',()=>{
  for(const mutate of [f=>f.manifest.outputs.pop(),f=>f.manifest.snapshotDigest='f'.repeat(64),f=>f.manifest.printed++,
    f=>{const out=f.manifest.outputs[0],proof=f.integrity.open('result',out.proof);proof.sequences=[0];out.proof=f.integrity.seal('result',proof);},
    f=>{f.plan.chunks[0].sequences=[0];f.plan.failed[0].seq=1;f.plan.failed[0].recid='12';}]) {
    const f=fixture();mutate(f);f.sign();assert.throws(()=>f.selection.read('501'),/manifest|chunk|published plan/);
  }
});

test('job mutation during snapshot validation cannot return a mixed source generation',()=>{
  const f=fixture(), read=f.snapshotFile().getContents;let changed=false;
  f.snapshotFile().getContents=()=>{if(!changed){changed=true;f.job.custrecord_pld_job_task='different-task';f.sign();}return read();};
  assert.throws(()=>f.selection.read('501'),/source changed/);
});


test('missing snapshot, legacy source and all-failed output claims remain ineligible',()=>{
  for(const mode of ['missing','legacy','outputs','partial-plan']) {
    const f=fixture({allFailed:true});
    if(mode==='missing'){f.job.custrecord_pld_job_snapshot='';signJob(f.stubs,'501',f.job);}
    if(mode==='legacy'){f.snapshot.schemaVersion=4;f.bindSnapshot();f.sign();}
    if(mode==='outputs'){f.job.custrecord_pld_job_outputs=f.integrity.seal('manifest',{unpublished:true});signJob(f.stubs,'501',f.job);}
    if(mode==='partial-plan'){f.plan.failed.pop();f.plan.chunks=[{ordinal:0,sequences:[3]}];f.sign();}
    assert.throws(()=>f.selection.read('501'),/identity|state|plan/);
    assert.equal(f.files.created.length,0);assert.equal(f.files.deleted.length,0);
  }
});

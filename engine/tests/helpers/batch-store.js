/** Batch persistence fixture; security checks use the real job module.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
const { loadAmd } = require('./amd');
const JOB_FIELDS = ['requester','role','status','folder','parent','snapshot','result','resultseal','requested','printed','failed','task','snapshotdigest','phase','plan','mergetask','outputs'];
function signJob(stubs, id, row) {
  const value = { id: String(id), owner: String(row.owner ?? ''), externalid: String(row.externalid ?? '') };
  JOB_FIELDS.forEach(k => { value[k] = String(row['custrecord_pld_job_' + k] ?? ''); });
  row.custrecord_pld_job_auth = loadAmd('./pld_lib_batch_integrity', stubs).seal('job', value);
}
function batchStore(stubs, files, seed) {
  require('./batch-crypto').installBatchCrypto(stubs);
  const rows = new Map(); let seq = 500;
  const types = new Map(); rows.types = types;
  function rowType(id,row) { return types.get(String(id)) || (Object.hasOwn(row,'custrecord_pld_job_requester') ? 'customrecord_pld_batch_job' : 'folder'); }
  const original = stubs['N/record'];
  const pdfs = new Map();
  const render = stubs['N/render'];
  if (render) {
    const originalPdf = render.xmlToPdf;
    render.xmlToPdf = (opts) => {
      const pdf = originalPdf(opts); const save = pdf.save;
      pdf.save = function () { const id = save.call(this); files.register(id, Buffer.from('%PDF-1.4 synthetic QA').toString('base64')); pdfs.set(String(id), { name: this.name, folder: this.folder, isOnline: this.isOnline, size: 21, fileType: files.module.Type.PDF }); return id; };
      return pdf;
    };
  }
  const fileLoad = files.module.load;
  files.module.load = (opts) => {
    const result = fileLoad(opts);
    const created = files.created.find((f) => String(f.id) === String(opts.id)) || pdfs.get(String(opts.id));
    return Object.assign({}, result, created ? { name: created.name, folder: created.folder, isOnline: created.isOnline, fileType: created.fileType ?? result.fileType, size: created.size ?? Buffer.byteLength(result.getContents?.() || '') } : {});
  };
  const previousSearch = stubs['N/search'];
  if (previousSearch) stubs['N/search'] = Object.assign({}, previousSearch, {
    create(opts) {
      if ((opts.type === 'customrecord_pld_batch_job' && opts.filters?.[0]?.[0] === 'externalidstring') || opts.type === 'folder') {
        return {run:()=>({getRange:({start,end})=>[...rows].filter(([id,row])=>rowType(id,row)===opts.type && opts.filters.every(term=>{
          if(term==='AND')return true;
          const [field,operator,value]=term;
          if(!['is','anyof'].includes(operator))throw new Error('Unsupported provisioning fixture filter');
          return String(row[field==='externalidstring'?'externalid':field] ?? '')===String(value);
        })).slice(start,end).map(([id])=>({id}))})};
      }
      if (opts.type !== 'file' || opts.filters?.[0]?.[0] !== 'folder') return previousSearch.create(opts);
      return { run: () => ({ getRange: ({ start, end }) => {
        const candidates = [...files.created, ...[...pdfs].map(([id, metadata]) => ({ id, ...metadata }))];
        return candidates.filter(candidate => opts.filters.every(term => {
          if (term === 'AND') return true;
          const [field, operator, value] = term;
          if (!['is', 'anyof'].includes(operator)) throw new Error('Unsupported file fixture filter');
          return String(candidate[field]) === String(value);
        })).slice(start, end).map(candidate => ({ id: String(candidate.id) }));
      } }) };
    },
  });
  if (seed) {
    rows.set('501', { owner: '9', custrecord_pld_job_requester: '9', custrecord_pld_job_role: '3', custrecord_pld_job_status: 'QUEUED',
      custrecord_pld_job_snapshot: '900', custrecord_pld_job_folder: '77', custrecord_pld_job_parent: '55', custrecord_pld_job_requested: seed.ids?.length || 0 });
    rows.set('77', { owner: '9', parent: '55', isprivate: true });
    signJob(stubs, '501', rows.get('501'));
  }
  const asRecord = (id, fields, isNew = false, type = rowType(id,fields)) => {
    let baseline = isNew ? null : JSON.stringify(fields);
    const values = { ...fields }; let changes = {};
    return { id,
      getValue: ({ fieldId }) => values[fieldId] ?? '',
      setValue: ({ fieldId, value }) => { values[fieldId] = value; changes[fieldId] = value; },
      save() {
        if(rows.beforeSave)rows.beforeSave({id:String(id),fields:values,type,fresh:baseline===null});
        if(type==='customrecord_pld_batch_job' && values.externalid)for(const [otherId,row] of rows) {
          if(String(otherId)!==String(id) && rowType(otherId,row)===type && String(row.externalid).toLowerCase()===String(values.externalid).toLowerCase())throw new Error('Duplicate external ID');
        }
        if (baseline === null) { rows.set(String(id), { ...values }); }
        else stubs['N/record'].submitFields({ id: String(id), values: changes, expected: baseline });
        types.set(String(id),type);
        baseline = JSON.stringify(rows.get(String(id))); changes = {};
        if(rows.afterSave)rows.afterSave({id:String(id),fields:values,type});
        return String(id);
      },
    };
  };
  stubs['N/record'] = Object.assign({}, original, {
    load(opts) { return rows.has(String(opts.id)) && (opts.type === 'folder' || opts.type === 'customrecord_pld_batch_job') ? asRecord(String(opts.id), rows.get(String(opts.id))) : original.load(opts); },
    create(opts) {
      if (!['folder', 'customrecord_pld_batch_job'].includes(opts.type)) return original.create(opts);
      do { seq++; } while (rows.has(String(seq)));
      return asRecord(String(seq), {}, true, opts.type);
    },
    submitFields({ id, values, expected }) {
      if (expected !== undefined && JSON.stringify(rows.get(String(id))) !== expected) {
        const error = new Error('Record has been changed'); error.name = 'RCRD_HAS_BEEN_CHANGED'; throw error;
      }
      Object.assign(rows.get(String(id)), values);
    },
  });
  stubs['N/url'] = { HostType: { APPLICATION: 'APPLICATION' }, resolveDomain: () => 'acct.app.netsuite.com',
    resolveScript: ({ params }) => '/app/site/hosting/scriptlet.nl?script=123&deploy=1&action=' + params.action + '&job=' + params.job + (params.chunk === undefined ? '' : '&chunk=' + params.chunk) };
  return rows;
}
module.exports = { batchStore, signJob };

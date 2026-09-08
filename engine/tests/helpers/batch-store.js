/** Batch persistence fixture; security checks use the real job module.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
'use strict';
function batchStore(stubs, files, seed) {
  const rows = new Map(); let seq = 500;
  const original = stubs['N/record'];
  const pdfs = new Map();
  const render = stubs['N/render'];
  if (render) {
    const originalPdf = render.xmlToPdf;
    render.xmlToPdf = (opts) => {
      const pdf = originalPdf(opts); const save = pdf.save;
      pdf.save = function () { const id = save.call(this); pdfs.set(String(id), { name: this.name, folder: this.folder, isOnline: this.isOnline }); return id; };
      return pdf;
    };
  }
  const fileLoad = files.module.load;
  files.module.load = (opts) => {
    const result = fileLoad(opts);
    const created = files.created.find((f) => String(f.id) === String(opts.id)) || pdfs.get(String(opts.id));
    return Object.assign({}, result, created ? { name: created.name, folder: created.folder, isOnline: created.isOnline } : {});
  };
  if (seed) {
    rows.set('501', { owner: '9', custrecord_pld_job_requester: '9', custrecord_pld_job_role: '3', custrecord_pld_job_status: 'QUEUED',
      custrecord_pld_job_snapshot: '900', custrecord_pld_job_folder: '77', custrecord_pld_job_parent: '55', custrecord_pld_job_requested: seed.ids?.length || 0 });
    rows.set('77', { owner: '9', parent: '55', isprivate: true });
  }
  const asRecord = (id, fields) => ({ id, getValue: ({ fieldId }) => fields[fieldId] ?? '', setValue: ({ fieldId, value }) => { fields[fieldId] = value; }, save: () => { rows.set(String(id), fields); return String(id); } });
  stubs['N/record'] = Object.assign({}, original, {
    load(opts) { return rows.has(String(opts.id)) && (opts.type === 'folder' || opts.type === 'customrecord_pld_batch_job') ? asRecord(String(opts.id), rows.get(String(opts.id))) : original.load(opts); },
    create(opts) { return ['folder', 'customrecord_pld_batch_job'].includes(opts.type) ? asRecord(String(++seq), {}) : original.create(opts); },
    submitFields({ id, values }) { Object.assign(rows.get(String(id)), values); },
  });
  stubs['N/url'] = { HostType: { APPLICATION: 'APPLICATION' }, resolveDomain: () => 'acct.app.netsuite.com',
    resolveScript: ({ params }) => '/app/site/hosting/scriptlet.nl?script=123&deploy=1&action=' + params.action + '&job=' + params.job };
  return rows;
}
module.exports = { batchStore };

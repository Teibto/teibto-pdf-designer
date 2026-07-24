/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — PDF Render Engine
 * Loads BFO XML template from Custom Record, binds to transaction record,
 * renders PDF via N/render (FreeMarker), and returns PDF to browser.
 *
 * Usage:
 *   ?action=render&rectype=invoice&recid=123&tplid=456
 *   ?action=render&rectype=invoice&recid=123&tplid=456&download=T
 *   ?action=preview&tplid=456                    ← preview with sample data
 *   ?action=list&rectype=invoice                 ← list available templates
 *   ?action=delete&tplid=456 (POST)               ← delete a template record
 *
 * @author Wichit Wongta
 */
define([
  'N/render',
  'N/record',
  'N/search',
  'N/file',
  'N/runtime',
  'N/log',
  'N/xml',
  'N/format',
  './pld_lib_company_config',
  './pld_lib_invoice_data'
], function (render, record, search, file, runtime, log, xml, format, companyConfig, invoiceData) {

  // ─── Custom Record Config ───
  const TPL_RECORD_TYPE   = 'customrecord_pld_template';
  const TPL_FLD_NAME      = 'custrecord_pld_tpl_name';
  const TPL_FLD_DATA      = 'custrecord_pld_tpl_data';     // JSON string (designer state)
  const TPL_FLD_XML       = 'custrecord_pld_tpl_xml';      // BFO XML string
  const TPL_FLD_REC_TYPE  = 'custrecord_pld_tpl_rectype';  // Target record type
  const TPL_FLD_IS_DEFAULT = 'custrecord_pld_tpl_default'; // Checkbox: default for this rectype

  function onRequest(context) {
    var request  = context.request;
    var response = context.response;

    try {
      var action = request.parameters.action || 'render';

      switch (action) {
        case 'render':
          return renderPdf(context);
        case 'preview':
          return previewPdf(context);
        case 'list':
          return listTemplates(context);
        case 'save':
          return saveTemplate(context);
        case 'get':
          return getTemplate(context);
        case 'delete':
          return deleteTemplate(context);
        case 'preview-live':
          return previewLivePdf(context);
        case 'version':
          return getVersion(context);
        default:
          return renderPdf(context);
      }

    } catch (e) {
      log.error({ title: 'PLD Render Error', details: e });
      response.setHeader({ name: 'Content-Type', value: 'application/json' });
      response.write(JSON.stringify({
        error: true,
        message: e.message || String(e),
        stack: e.stack || ''
      }));
    }
  }

  // ═══════════════════════════════════════════════════
  // RENDER PDF — Main flow
  // ═══════════════════════════════════════════════════

  /**
   * Render PDF from template + record.
   * Params: rectype, recid, tplid (or uses default template)
   */
  function renderPdf(context) {
    var params   = context.request.parameters;
    var recType  = params.rectype;
    var recId    = params.recid;
    var tplId    = params.tplid;
    var download = params.download === 'T';

    if (!recType || !recId) {
      throw new Error('Missing required parameters: rectype and recid');
    }

    // ─── 1. Load Template (XML + copy set from the record data, #92) ───
    var tpl = tplId ? loadTemplateXml(tplId) : findDefaultTemplateXml(recType);
    var tplXml = tpl && tpl.xml;
    var tplCopies = tpl && tpl.copies;

    if (!tplXml) {
      throw new Error('No template found. Please specify tplid or set a default template for ' + recType);
    }

    // ─── 2. Render (record + company + context) ───
    // Invoices bind the curated schema (company/customer/document/totals/items)
    // built from SuiteQL — the SAME data source as live Preview (preview-live),
    // so Print == Preview. Without this, Print binds the raw record and the
    // designer templates (${record.customer.name} etc.) render empty (#67 GAP #1).
    // Invoices also print the statutory copy set (ต้นฉบับ + สำเนา, #15).
    // #91: every supported type binds curated data. #92: copy set comes from
    // the template record (data JSON), falling back to the invoice default.
    var out;
    if (invoiceData.isSupportedType(recType)) {
      var copies = resolveCopies(tplCopies, recType);
      out = copies.length > 1
        ? renderCopiesPdf(tplXml, recType, recId, copies)
        : renderXmlWithRecord(tplXml, recType, recId,
            invoiceData.buildTransactionData(recType, recId, copies[0].th, copies[0].en));
    } else {
      out = renderXmlWithRecord(tplXml, recType, recId, null);
    }

    // ─── 3. Set filename from tranid ───
    var tranId = recId;
    try {
      tranId = out.tranId
        || (out.rec && out.rec.getValue({ fieldId: 'tranid' }))
        || recId;
    } catch (e) { tranId = recId; }
    var fileName = recType + '_' + tranId + '.pdf';
    out.pdfFile.name = fileName;

    // ─── 4. Return PDF ───
    context.response.setHeader({
      name: 'Content-Type',
      value: 'application/pdf'
    });
    context.response.setHeader({
      name: 'Content-Disposition',
      value: (download ? 'attachment' : 'inline') + '; filename="' + fileName + '"'
    });
    context.response.writeFile({ file: out.pdfFile, isInline: !download });
  }

  /**
   * Build a configured N/render renderer for one template + one data binding —
   * the single binding path shared by Print (render) and live Preview
   * (preview-live), so a preview of unsaved designer XML is byte-for-byte the
   * same engine + data sources as Print (#12). When the caller supplies a
   * curated data object (designer schema built via SuiteQL — see
   * pld_lib_invoice_data), bind THAT as `record` so ${record.customer.name},
   * <#list record.items ...> resolve; otherwise bind the raw NetSuite record
   * (`rec`) so hand-written master templates (${record.tranid}) render unchanged.
   */
  function makeRenderer(tplXml, curatedData, rec) {
    var renderer = render.create();
    renderer.templateContent = tplXml;

    if (curatedData) {
      renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'record', data: curatedData });
    } else {
      renderer.addRecord({ templateName: 'record', record: rec });
    }

    // Company info (custom data source) — subsidiary-scoped (OneWorld, #144)
    renderer.addCustomDataSource({
      format: render.DataSource.OBJECT,
      alias: 'company',
      data: loadCompanyInfo(subsidiaryIdOf(curatedData, rec))
    });

    // Current date/user info
    var currentUser = runtime.getCurrentUser();
    renderer.addCustomDataSource({
      format: render.DataSource.OBJECT,
      alias: 'context',
      data: {
        today: format.format({ value: new Date(), type: format.Type.DATE }),
        now: format.format({ value: new Date(), type: format.Type.DATETIME }),
        userName: currentUser.name,
        userEmail: currentUser.email
      }
    });

    return renderer;
  }

  /**
   * Bind BFO XML to a real record and render a single-copy PDF (non-invoice
   * record types). Returns { pdfFile, rec } (caller names the file).
   */
  function renderXmlWithRecord(tplXml, recType, recId, curatedData) {
    var rec = record.load({ type: recType, id: recId });
    return { pdfFile: makeRenderer(tplXml, curatedData, rec).renderAsPdf(), rec: rec };
  }

  // Thai statutory copy set (#15) — default for invoices when the template
  // doesn't define its own copy set (#92).
  var INVOICE_COPIES = [
    { th: 'ต้นฉบับ', en: 'Original' },
    { th: 'สำเนา', en: 'Copy' }
  ];

  /** Validate a template-defined copy set (#92): array of {th|en} → sanitized
   *  array, or null when absent/invalid (caller falls back to defaults). */
  function parseCopies(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c || typeof c !== 'object') return null;
      var th = typeof c.th === 'string' ? c.th : '';
      var en = typeof c.en === 'string' ? c.en : '';
      if (!th && !en) return null;
      out.push({ th: th || en, en: en || th });
    }
    return out;
  }

  /** Copies for a render (#92): template-defined set, else invoice default,
   *  else single original. */
  function resolveCopies(tplCopies, recType) {
    return tplCopies || (recType === 'invoice' ? INVOICE_COPIES : [{ th: 'ต้นฉบับ', en: 'Original' }]);
  }

  /**
   * Render the invoice once per copy label and combine into ONE PDF via BFO
   * <pdfset> (#15). FreeMarker must resolve per copy (each copy binds its own
   * curated data → different title), so each pass uses renderAsString, then the
   * resolved <pdf> documents render together with render.xmlToPdf.
   * Returns { pdfFile, tranId }.
   */
  function renderCopiesPdf(tplXml, recType, recId, copies) {
    var tranId = '';
    var docs = copies.map(function (c) {
      var curated = invoiceData.buildTransactionData(recType, recId, c.th, c.en);
      tranId = tranId || (curated.document && curated.document.number) || '';
      var resolved = makeRenderer(tplXml, curated, null).renderAsString();
      var start = resolved.indexOf('<pdf>');
      var end = resolved.lastIndexOf('</pdf>');
      if (start < 0 || end < 0) {
        throw new Error('renderAsString produced no <pdf> document — cannot build the copy set');
      }
      return resolved.substring(start, end + '</pdf>'.length);
    });

    var pdfFile = render.xmlToPdf({
      xmlString: '<?xml version="1.0"?>\n' +
        '<!DOCTYPE pdfset PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n' +
        '<pdfset>\n' + docs.join('\n') + '\n</pdfset>'
    });
    return { pdfFile: pdfFile, tranId: tranId };
  }

  // ═══════════════════════════════════════════════════
  // LIVE PREVIEW — render unsaved designer XML against the real record (#12)
  // ═══════════════════════════════════════════════════

  /**
   * Preview the CURRENT (unsaved) designer XML with the same record + data
   * sources Print uses — guarantees "preview == print". POST body:
   *   { xml: "<full BFO XML>", rectype: "invoice", recid: "123" }
   * Optional `data`: a curated data object bound as `record` INSTEAD of
   * buildInvoiceData — synthetic-data preview for QA/stress tests (#75); the
   * render pipeline (FreeMarker + BFO + copy set) stays the real one.
   */
  function previewLivePdf(context) {
    if (context.request.method !== 'POST') {
      throw new Error('POST required for preview-live');
    }

    var body = JSON.parse(context.request.body || '{}');
    if (!body.xml)     throw new Error('preview-live requires xml (export BFO from the designer)');
    if (!body.rectype) throw new Error('preview-live requires rectype');
    if (!body.recid && !body.data) throw new Error('preview-live requires recid — open the designer from a record');

    // Designer templates bind the curated schema (company/customer/document/totals/
    // items). For invoices, build that from SuiteQL so preview shows REAL data —
    // including the statutory copy set (ต้นฉบับ + สำเนา), same as Print (#15).
    var out;
    if (body.data) {
      out = { pdfFile: makeRenderer(body.xml, body.data, null).renderAsPdf() };
    } else if (invoiceData.isSupportedType(body.rectype)) {
      // #92: unsaved designer state sends its copy set in the body
      var pvCopies = resolveCopies(parseCopies(body.copies), body.rectype);
      out = pvCopies.length > 1
        ? renderCopiesPdf(body.xml, body.rectype, body.recid, pvCopies)
        : renderXmlWithRecord(body.xml, body.rectype, body.recid,
            invoiceData.buildTransactionData(body.rectype, body.recid, pvCopies[0].th, pvCopies[0].en));
    } else {
      out = renderXmlWithRecord(body.xml, body.rectype, body.recid, null);
    }
    out.pdfFile.name = 'preview.pdf';

    context.response.setHeader({ name: 'Content-Type', value: 'application/pdf' });
    context.response.setHeader({ name: 'Content-Disposition', value: 'inline; filename="preview.pdf"' });
    context.response.writeFile({ file: out.pdfFile, isInline: true });
  }

  // ═══════════════════════════════════════════════════
  // PREVIEW — Render with sample data
  // ═══════════════════════════════════════════════════

  function previewPdf(context) {
    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid for preview');

    var tplXml = loadTemplateXml(tplId);

    // Replace FreeMarker expressions with placeholder text for preview.
    // The preview renderer has no data sources bound, so ANY ${...} left in
    // the template (record, line, company, context, ...) is a render error —
    // strip every interpolation and every <#...> directive, not just record.*.
    var previewXml = tplXml
      .replace(/\$\{[^}]*\}/g, '[Sample Data]')
      .replace(/<#[^>]*>/g, '')
      .replace(/<\/#[^>]*>/g, '');

    var renderer = render.create();
    renderer.templateContent = previewXml;

    var pdfFile = renderer.renderAsPdf();
    pdfFile.name = 'preview.pdf';

    context.response.setHeader({ name: 'Content-Type', value: 'application/pdf' });
    context.response.setHeader({ name: 'Content-Disposition', value: 'inline; filename="preview.pdf"' });
    context.response.writeFile({ file: pdfFile, isInline: true });
  }

  // ═══════════════════════════════════════════════════
  // VERSION — which package version is deployed on this account (#11)
  // ═══════════════════════════════════════════════════

  /**
   * Serve the deploy stamp so any account can report its deployed version.
   * deploy.sh writes pld_version.txt (version + git sha + UTC) into this same
   * File Cabinet folder before each deploy — the stamp travels with the package.
   */
  var VERSION_FILE_PATH = '/SuiteScripts/pdf-layout-designer/pld_version.txt';

  function getVersion(context) {
    var payload;
    try {
      payload = file.load({ id: VERSION_FILE_PATH }).getContents();
    } catch (e) {
      payload = JSON.stringify({ version: 'unknown', error: 'no deploy stamp: ' + (e.message || e) });
    }
    context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    context.response.write(payload);
  }

  // ═══════════════════════════════════════════════════
  // TEMPLATE CRUD
  // ═══════════════════════════════════════════════════

  /**
   * List templates (GET).
   * Params: rectype (optional filter)
   */
  function listTemplates(context) {
    var recType = context.request.parameters.rectype || '';
    var filters = [['isinactive', 'is', 'F']];

    if (recType) {
      filters.push('AND');
      filters.push([TPL_FLD_REC_TYPE, 'is', recType]);
    }

    var results = [];
    search.create({
      type: TPL_RECORD_TYPE,
      filters: filters,
      columns: [
        TPL_FLD_NAME,
        TPL_FLD_REC_TYPE,
        TPL_FLD_IS_DEFAULT,
        'created',
        'lastmodified'
      ]
    }).run().each(function (row) {
      results.push({
        id: row.id,
        name: row.getValue(TPL_FLD_NAME),
        rectype: row.getValue(TPL_FLD_REC_TYPE),
        isDefault: row.getValue(TPL_FLD_IS_DEFAULT),
        created: row.getValue('created'),
        modified: row.getValue('lastmodified')
      });
      return true;
    });

    sendJson(context, results);
  }

  /**
   * Get single template (GET).
   * Params: tplid
   */
  function getTemplate(context) {
    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid');

    var rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });

    sendJson(context, {
      id: tplId,
      name: rec.getValue({ fieldId: TPL_FLD_NAME }),
      data: rec.getValue({ fieldId: TPL_FLD_DATA }),
      xml: rec.getValue({ fieldId: TPL_FLD_XML }),
      rectype: rec.getValue({ fieldId: TPL_FLD_REC_TYPE }),
      isDefault: rec.getValue({ fieldId: TPL_FLD_IS_DEFAULT })
    });
  }

  /**
   * Save template (POST).
   * Body: { id?, name, data, xml, rectype, isDefault? }
   */
  function saveTemplate(context) {
    if (context.request.method !== 'POST') {
      throw new Error('POST required for save');
    }

    var body = JSON.parse(context.request.body);

    // XML is mandatory on every save — the engine has no generator of its own,
    // so a template without XML can never render (#6, R4: no silent fallback).
    if (!body.xml) {
      throw new Error('Template XML is required. Export BFO XML from the designer and include it in the save payload (#6).');
    }

    var tplId = body.id;
    var rec;

    if (tplId) {
      rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });
    } else {
      rec = record.create({ type: TPL_RECORD_TYPE });
    }

    // Built-in name is mandatory (custom record includeName=T) — set it too,
    // not only the custom label field, or save fails with "Please enter value(s) for: Name".
    rec.setValue({ fieldId: 'name', value: body.name || 'Untitled' });
    rec.setValue({ fieldId: TPL_FLD_NAME, value: body.name || 'Untitled' });

    if (body.data) {
      rec.setValue({ fieldId: TPL_FLD_DATA, value: body.data });
    }
    rec.setValue({ fieldId: TPL_FLD_XML, value: body.xml });
    if (body.rectype) {
      rec.setValue({ fieldId: TPL_FLD_REC_TYPE, value: body.rectype });
    }
    if (body.isDefault === true) {
      // Unset other defaults for this rectype first
      clearDefaultForRecType(body.rectype, tplId);
      rec.setValue({ fieldId: TPL_FLD_IS_DEFAULT, value: true });
    }

    var savedId = rec.save();

    sendJson(context, { id: savedId, success: true });
  }

  /**
   * Delete template (POST).
   * Params: tplid
   * #142: the SPA previously had no way to delete an NS template at all
   * (only Load + Duplicate) — a stale/wrong record could never be removed.
   * The record IS deleted even when it's the record type's default (a user
   * may deliberately be removing a broken default), but the response flags
   * wasDefault:true so the caller can warn that the record type is now left
   * without a default template (Print falls back to "no template found",
   * see renderPdf/findDefaultTemplateXml — no silent fallback, R4).
   */
  function deleteTemplate(context) {
    if (context.request.method !== 'POST') {
      throw new Error('POST required for delete');
    }

    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid');

    var wasDefault = false;
    try {
      wasDefault = record.lookupFields({
        type: TPL_RECORD_TYPE,
        id: tplId,
        columns: [TPL_FLD_IS_DEFAULT]
      })[TPL_FLD_IS_DEFAULT] === true;
    } catch (e) {
      // Record already gone / unreadable — let record.delete below surface
      // the real error (R4: no silent swallow).
      wasDefault = false;
    }

    record.delete({ type: TPL_RECORD_TYPE, id: tplId });

    sendJson(context, { success: true, wasDefault: wasDefault });
  }

  // ═══════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════

  /**
   * Load BFO XML from template custom record.
   * No fallback generation: the only BFO generator is the designer's
   * bfo-export.service.ts — a template without XML is a hard error (#6, R4).
   */
  function loadTemplateXml(tplId) {
    var rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });
    var xmlContent = rec.getValue({ fieldId: TPL_FLD_XML });

    if (!xmlContent) {
      throw new Error('Template ' + tplId + ' has no BFO XML. ' +
        'Re-save it from the designer — the engine no longer generates XML from designer data (#6).');
    }

    return { xml: xmlContent, copies: copiesFromDataJson(rec.getValue({ fieldId: TPL_FLD_DATA })) };
  }

  /** Copy set stored in the designer JSON of a template record (#92) */
  function copiesFromDataJson(dataJson) {
    if (!dataJson) return null;
    try { return parseCopies(JSON.parse(dataJson).copies); } catch (e) { return null; }
  }

  /**
   * Find default template for a record type.
   * Same no-fallback rule as loadTemplateXml (#6, R4).
   */
  function findDefaultTemplateXml(recType) {
    var results = search.create({
      type: TPL_RECORD_TYPE,
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        [TPL_FLD_REC_TYPE, 'is', recType],
        'AND',
        [TPL_FLD_IS_DEFAULT, 'is', 'T']
      ],
      columns: [TPL_FLD_XML, TPL_FLD_DATA]
    }).run().getRange({ start: 0, end: 1 });

    if (results.length === 0) return null;

    var xmlContent = results[0].getValue(TPL_FLD_XML);
    if (!xmlContent) {
      throw new Error('Default template for ' + recType + ' (id ' + results[0].id + ') has no BFO XML. ' +
        'Re-save it from the designer — the engine no longer generates XML from designer data (#6).');
    }

    return { xml: xmlContent, copies: copiesFromDataJson(results[0].getValue(TPL_FLD_DATA)) };
  }

  /**
   * Clear the "default" flag for other templates of the same record type.
   */
  function clearDefaultForRecType(recType, excludeId) {
    if (!recType) return;

    var filters = [
      ['isinactive', 'is', 'F'],
      'AND',
      [TPL_FLD_REC_TYPE, 'is', recType],
      'AND',
      [TPL_FLD_IS_DEFAULT, 'is', 'T']
    ];

    search.create({
      type: TPL_RECORD_TYPE,
      filters: filters,
      columns: []
    }).run().each(function (row) {
      if (String(row.id) !== String(excludeId)) {
        record.submitFields({
          type: TPL_RECORD_TYPE,
          id: row.id,
          values: { custrecord_pld_tpl_default: false }
        });
      }
      return true;
    });
  }

  /**
   * Load company info from the PLD config custom record (#9).
   * Single source of ${company.*}: shared loader pld_lib_company_config.js —
   * per-account setup is one config record, no template edits, no script params.
   *
   * @param {string|number} [subsidiaryId] - transaction's subsidiary (OneWorld,
   *   #144); undefined when there's no record context (synthetic preview data).
   */
  function loadCompanyInfo(subsidiaryId) {
    return companyConfig.load(subsidiaryId);
  }

  /**
   * Resolve the subsidiary id to scope ${company.*} by (#144), preferring the
   * curated data's own subsidiaryId (set by pld_lib_invoice_data from the
   * transaction it already loaded) and falling back to the raw record `rec`
   * when curatedData wasn't built by that library (non-invoice record types).
   * Returns undefined when neither is available (no record context) — load()
   * then falls back to the global/first-active config, unchanged behavior.
   */
  function subsidiaryIdOf(curatedData, rec) {
    if (curatedData && curatedData.subsidiaryId) return curatedData.subsidiaryId;
    if (!rec) return undefined;
    try { return rec.getValue({ fieldId: 'subsidiary' }); } catch (e) { return undefined; }
  }

  function sendJson(context, data) {
    context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    context.response.write(JSON.stringify(data));
  }

  return { onRequest: onRequest };
});

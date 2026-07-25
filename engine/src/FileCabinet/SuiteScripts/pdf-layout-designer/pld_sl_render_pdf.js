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
    var response = context.response;
    var tel = newTelemetry(context.request); // observability (#149) — request-scoped

    try {
      switch (tel.action) {
        case 'render':
          return renderPdf(context, tel);
        case 'preview':
          return previewPdf(context, tel);
        case 'list':
          return listTemplates(context);
        case 'save':
          return saveTemplate(context);
        case 'get':
          return getTemplate(context);
        case 'delete':
          return deleteTemplate(context);
        case 'preview-live':
          return previewLivePdf(context, tel);
        case 'version':
          return getVersion(context);
        default:
          return renderPdf(context, tel);
      }

    } catch (e) {
      // Structured, correlated failure log (#149): one entry carrying full
      // context — which action/template/record/subsidiary/account/stage failed —
      // so a customer-reported "print ไม่ออก" is diagnosable straight from the
      // Script Execution Log. errorId ties the user's on-screen ref to this line.
      logRenderError(tel, e);
      // Who is reading this response decides its shape (#157): the Print/Download
      // buttons open this Suitelet in a browser tab, so a failure there must be a
      // readable page — not raw JSON with a stack trace. The designer calls the
      // other actions over fetch and keeps the JSON contract.
      if (isBrowserAction(tel.action)) {
        writeErrorPage(response, tel, e);
      } else {
        writeErrorJson(response, tel, e);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // USER-FACING ERRORS (#157)
  // ═══════════════════════════════════════════════════

  /** Actions a browser opens directly (transaction buttons + preview links). */
  var BROWSER_ACTIONS = { render: true, preview: true };

  function isBrowserAction(action) {
    // newTelemetry defaults a missing action to 'render' — same as the switch's
    // default branch — so an unknown/empty action lands on the page, not on JSON.
    return BROWSER_ACTIONS[String(action)] === true;
  }

  /**
   * Error page for the Print/Download/Preview buttons. Carries the errorId the
   * user reports to us and the short message, never the stack — the stack is
   * already in the Script Execution Log with full context (#149), and it is not
   * something an accounting user should be reading off the screen.
   */
  function writeErrorPage(response, tel, e) {
    var safeMessage = escapeHtml(e && e.message ? e.message : String(e));
    response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    response.write(
      '<!DOCTYPE html>\n<html lang="th">\n<head>\n' +
      '<meta charset="utf-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<title>สร้าง PDF ไม่สำเร็จ</title>\n' +
      '<style>\n' +
      'body{margin:0;padding:32px 16px;background:#f4f5f7;color:#1f2330;' +
      "font-family:'Segoe UI',Tahoma,'Sarabun',sans-serif;font-size:15px;line-height:1.7}\n" +
      '.card{max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe1e6;' +
      'border-radius:10px;padding:24px 28px}\n' +
      'h1{margin:0 0 4px;font-size:20px}\n' +
      '.sub{margin:0 0 18px;color:#5e6c84}\n' +
      '.ref{background:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;padding:12px 14px;margin:0 0 18px}\n' +
      'code{font-family:Consolas,monospace;font-size:14px;font-weight:600}\n' +
      'details{margin:0 0 20px;color:#42526e}\n' +
      'summary{cursor:pointer;color:#5e6c84}\n' +
      '.msg{margin:8px 0 0;padding:10px 12px;background:#f4f5f7;border-radius:6px;' +
      'font-family:Consolas,monospace;font-size:13px;word-break:break-word}\n' +
      'button{font:inherit;padding:8px 18px;margin-right:8px;border-radius:6px;cursor:pointer;' +
      'border:1px solid #dfe1e6;background:#fff}\n' +
      'button.primary{background:#0052cc;border-color:#0052cc;color:#fff}\n' +
      '</style>\n</head>\n<body>\n<div class="card">\n' +
      '<h1>สร้าง PDF ไม่สำเร็จ</h1>\n' +
      '<p class="sub">ระบบสร้างไฟล์ PDF ของเอกสารนี้ไม่ได้ — ข้อมูลบนเอกสารไม่ถูกแก้ไขใด ๆ</p>\n' +
      '<p class="ref">แจ้งทีม Teibto พร้อมรหัสอ้างอิง <code>' + escapeHtml(tel.errorId) + '</code><br />' +
      'ทีมใช้รหัสนี้เปิดดู log ของการพิมพ์ครั้งนี้ได้ตรง ๆ</p>\n' +
      '<details><summary>รายละเอียดทางเทคนิค (สำหรับผู้ดูแลระบบ)</summary>' +
      '<p class="msg">' + safeMessage + '</p></details>\n' +
      '<p><button class="primary" onclick="location.reload()">ลองพิมพ์อีกครั้ง</button>' +
      '<button onclick="window.close()">ปิดหน้านี้</button></p>\n' +
      '</div>\n</body>\n</html>'
    );
  }

  /**
   * Error body for the designer's fetch calls. `stack` is deliberately NOT sent
   * (#157) — it lives in the log; the SPA only ever reads `message`.
   */
  function writeErrorJson(response, tel, e) {
    response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    response.write(JSON.stringify({
      error: true,
      errorId: tel.errorId,
      message: e && e.message ? e.message : String(e),
      ref: 'เกิดข้อผิดพลาดในการสร้าง PDF — แจ้งทีม Teibto พร้อมรหัสอ้างอิง ' + tel.errorId
    }));
  }

  /** Escape for HTML text content — an error message can carry XML/< from BFO. */
  function escapeHtml(text) {
    return xml.escape({ xmlText: String(text == null ? '' : text) });
  }

  // ═══════════════════════════════════════════════════
  // OBSERVABILITY (#149) — structured, correlated render telemetry via N/log
  // (native sink only: no custom record / no render data stored on the customer
  // account — data-classification-safe, zero write governance).
  // ═══════════════════════════════════════════════════

  /** Short, greppable correlation id shared between the on-screen error and the
   *  server log line (e.g. "PLD-l8x2k-3f9"). */
  function newErrorId() {
    return 'PLD-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 0x100000).toString(36);
  }

  /** Build the request-scoped telemetry context from what's known up front;
   *  render paths fill in stage/subsidiaryId as they proceed. */
  function newTelemetry(request) {
    var p = (request && request.parameters) || {};
    var user = {};
    try { user = runtime.getCurrentUser() || {}; } catch (e) { user = {}; }
    return {
      errorId: newErrorId(),
      action: p.action || 'render',
      rectype: p.rectype || '',
      recid: p.recid || '',
      tplid: p.tplid || '',
      subsidiaryId: '',
      userId: user.id || '',
      stage: 'init',
      start: Date.now()
    };
  }

  function telElapsedMs(tel) { return Date.now() - tel.start; }

  /** Base structured payload common to the ok/error log lines. */
  function telBase(tel) {
    return {
      errorId: tel.errorId,
      action: tel.action,
      rectype: tel.rectype,
      recid: tel.recid,
      tplid: tel.tplid,
      subsidiaryId: tel.subsidiaryId,
      userId: tel.userId,
      elapsedMs: telElapsedMs(tel)
    };
  }

  /** One audit line per successful render — lightweight latency/throughput
   *  telemetry readable from the native Script Execution Log. */
  function logRenderOk(tel, extra) {
    var d = telBase(tel);
    d.ok = true;
    if (extra) {
      for (var k in extra) { if (extra.hasOwnProperty(k)) d[k] = extra[k]; }
    }
    log.audit({ title: 'PLD render ok', details: d });
  }

  /** One error line per failure, correlated by errorId and tagged with the stage
   *  it died in (template-load / load-record / render / copyset / write). */
  function logRenderError(tel, e) {
    var d = telBase(tel);
    d.stage = tel.stage;
    d.message = (e && e.message) || String(e);
    d.stack = (e && e.stack) || '';
    log.error({ title: 'PLD render failed [' + tel.errorId + ']', details: d });
  }

  // ═══════════════════════════════════════════════════
  // RENDER PDF — Main flow
  // ═══════════════════════════════════════════════════

  /**
   * Render PDF from template + record.
   * Params: rectype, recid, tplid (or uses default template)
   */
  function renderPdf(context, tel) {
    var params   = context.request.parameters;
    var recType  = params.rectype;
    var recId    = params.recid;
    var tplId    = params.tplid;
    var download = params.download === 'T';

    if (!recType || !recId) {
      throw new Error('Missing required parameters: rectype and recid');
    }

    // ─── 1. Load Template (XML + copy set from the record data, #92) ───
    tel.stage = 'load-template';
    var tpl = tplId ? loadTemplateXml(tplId) : findDefaultTemplateXml(recType);
    var tplXml = tpl && tpl.xml;
    var tplCopies = tpl && tpl.copies;

    if (!tplXml) {
      throw new Error('No template found. Please specify tplid or set a default template for ' + recType);
    }

    // ─── 2. Render (record + company + context) ───
    tel.stage = 'render';
    // Invoices bind the curated schema (company/customer/document/totals/items)
    // built from SuiteQL — the SAME data source as live Preview (preview-live),
    // so Print == Preview. Without this, Print binds the raw record and the
    // designer templates (${record.customer.name} etc.) render empty (#67 GAP #1).
    // Invoices also print the statutory copy set (ต้นฉบับ + สำเนา, #15).
    // #91: every supported type binds curated data. #92: copy set comes from
    // the template record (data JSON), falling back to the invoice default.
    var out, copiesCount = 1;
    if (invoiceData.isSupportedType(recType)) {
      var copies = resolveCopies(tplCopies, recType);
      copiesCount = copies.length;
      out = copies.length > 1
        ? renderCopiesPdf(tplXml, recType, recId, copies, tel)
        : renderXmlWithRecord(tplXml, recType, recId,
            invoiceData.buildTransactionData(recType, recId, copies[0].th, copies[0].en), tel);
    } else {
      out = renderXmlWithRecord(tplXml, recType, recId, null, tel);
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

    // PDF built — record the success telemetry before we hand off the bytes (#149).
    logRenderOk(tel, { copies: copiesCount });

    // ─── 4. Return PDF ───
    tel.stage = 'write';
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
  function makeRenderer(tplXml, curatedData, rec, tel) {
    var renderer = render.create();
    renderer.templateContent = tplXml;

    if (curatedData) {
      renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'record', data: curatedData });
    } else {
      renderer.addRecord({ templateName: 'record', record: rec });
    }

    // Company info (custom data source) — subsidiary-scoped (OneWorld, #144).
    // Capture the resolved subsidiary into telemetry (#149) so a failed render is
    // traceable to the config record that fed ${company.*}.
    var subsidiaryId = subsidiaryIdOf(curatedData, rec);
    if (tel && subsidiaryId != null && subsidiaryId !== '') tel.subsidiaryId = String(subsidiaryId);
    renderer.addCustomDataSource({
      format: render.DataSource.OBJECT,
      alias: 'company',
      data: loadCompanyInfo(subsidiaryId)
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
  function renderXmlWithRecord(tplXml, recType, recId, curatedData, tel) {
    if (tel) tel.stage = 'load-record';
    var rec = record.load({ type: recType, id: recId });
    if (tel) tel.stage = 'render';
    return { pdfFile: makeRenderer(tplXml, curatedData, rec, tel).renderAsPdf(), rec: rec };
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
  function renderCopiesPdf(tplXml, recType, recId, copies, tel) {
    if (tel) tel.stage = 'render';
    var tranId = '';
    var docs = copies.map(function (c) {
      var curated = invoiceData.buildTransactionData(recType, recId, c.th, c.en);
      tranId = tranId || (curated.document && curated.document.number) || '';
      var resolved = makeRenderer(tplXml, curated, null, tel).renderAsString();
      var start = resolved.indexOf('<pdf>');
      var end = resolved.lastIndexOf('</pdf>');
      if (start < 0 || end < 0) {
        throw new Error('renderAsString produced no <pdf> document — cannot build the copy set');
      }
      return resolved.substring(start, end + '</pdf>'.length);
    });

    if (tel) tel.stage = 'copyset';
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
  function previewLivePdf(context, tel) {
    if (context.request.method !== 'POST') {
      throw new Error('POST required for preview-live');
    }

    tel.stage = 'parse-body';
    var body = JSON.parse(context.request.body || '{}');
    if (!body.xml)     throw new Error('preview-live requires xml (export BFO from the designer)');
    if (!body.rectype) throw new Error('preview-live requires rectype');
    if (!body.recid && !body.data) throw new Error('preview-live requires recid — open the designer from a record');

    // Body carries the render context for a preview — reflect it into telemetry
    // (#149) so a failed preview is as traceable as a failed print.
    tel.rectype = body.rectype;
    tel.recid = body.recid || '';

    // Designer templates bind the curated schema (company/customer/document/totals/
    // items). For invoices, build that from SuiteQL so preview shows REAL data —
    // including the statutory copy set (ต้นฉบับ + สำเนา), same as Print (#15).
    tel.stage = 'render';
    var out, copiesCount = 1;
    if (body.data) {
      out = { pdfFile: makeRenderer(body.xml, body.data, null, tel).renderAsPdf() };
    } else if (invoiceData.isSupportedType(body.rectype)) {
      // #92: unsaved designer state sends its copy set in the body
      var pvCopies = resolveCopies(parseCopies(body.copies), body.rectype);
      copiesCount = pvCopies.length;
      out = pvCopies.length > 1
        ? renderCopiesPdf(body.xml, body.rectype, body.recid, pvCopies, tel)
        : renderXmlWithRecord(body.xml, body.rectype, body.recid,
            invoiceData.buildTransactionData(body.rectype, body.recid, pvCopies[0].th, pvCopies[0].en), tel);
    } else {
      out = renderXmlWithRecord(body.xml, body.rectype, body.recid, null, tel);
    }
    out.pdfFile.name = 'preview.pdf';

    logRenderOk(tel, { copies: copiesCount });
    tel.stage = 'write';
    context.response.setHeader({ name: 'Content-Type', value: 'application/pdf' });
    context.response.setHeader({ name: 'Content-Disposition', value: 'inline; filename="preview.pdf"' });
    context.response.writeFile({ file: out.pdfFile, isInline: true });
  }

  // ═══════════════════════════════════════════════════
  // PREVIEW — Render with sample data
  // ═══════════════════════════════════════════════════

  function previewPdf(context, tel) {
    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid for preview');

    tel.stage = 'load-template';
    var tplXml = loadTemplateXml(tplId);

    // Replace FreeMarker expressions with placeholder text for preview.
    // The preview renderer has no data sources bound, so ANY ${...} left in
    // the template (record, line, company, context, ...) is a render error —
    // strip every interpolation and every <#...> directive, not just record.*.
    var previewXml = tplXml
      .replace(/\$\{[^}]*\}/g, '[Sample Data]')
      .replace(/<#[^>]*>/g, '')
      .replace(/<\/#[^>]*>/g, '');

    tel.stage = 'render';
    var renderer = render.create();
    renderer.templateContent = previewXml;

    var pdfFile = renderer.renderAsPdf();
    pdfFile.name = 'preview.pdf';

    logRenderOk(tel, { copies: 1 });
    tel.stage = 'write';
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

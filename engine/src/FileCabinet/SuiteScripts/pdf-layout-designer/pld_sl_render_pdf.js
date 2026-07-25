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
 *   ?action=history&tplid=456                    ← version history (#189)
 *   ?action=rollback&tplid=456&version=3 (POST)   ← restore a version (#189)
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
  './pld_lib_render',
  './pld_lib_auth',
  './pld_lib_tpl_audit'
], function (render, record, search, file, runtime, log, xml, pldRender, auth, tplAudit) {

  // ─── Custom Record Config (owned by the render core, #181) ───
  const TPL_RECORD_TYPE   = pldRender.TPL.TYPE;
  const TPL_FLD_NAME      = pldRender.TPL.NAME;
  const TPL_FLD_DATA      = pldRender.TPL.DATA;     // JSON string (designer state)
  const TPL_FLD_XML       = pldRender.TPL.XML;      // BFO XML string
  const TPL_FLD_REC_TYPE  = pldRender.TPL.RECTYPE;  // Target record type
  const TPL_FLD_IS_DEFAULT = pldRender.TPL.IS_DEFAULT; // Checkbox: default for this rectype

  function onRequest(context) {
    var response = context.response;
    var tel = newTelemetry(context.request); // observability (#149) — request-scoped

    try {
      // ทุก action ที่เปลี่ยนเทมเพลตผ่านด่านสิทธิ์ก่อนเสมอ (#189) — จุดเดียว ไม่ใช่
      // กระจายเช็คในแต่ละฟังก์ชัน เพราะ action ที่เพิ่มทีหลังแล้วลืมเช็คคือช่องโหว่เงียบ
      if (WRITE_ACTIONS[tel.action] === true) {
        auth.assertCanEditTemplates(tel.action, { tplid: tel.tplid, rectype: tel.rectype });
      }

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
        case 'history':
          return templateHistory(context);
        case 'rollback':
          return rollbackTemplate(context);
        case 'preview-live':
          return previewLivePdf(context, tel);
        case 'version':
          return getVersion(context);
        default:
          return renderPdf(context, tel);
      }

    } catch (e) {
      // สิทธิ์ไม่พอไม่ใช่ "render ล้มเหลว" — ตอบเป็นคำปฏิเสธที่อ่านรู้เรื่อง และ
      // ไม่ต้อง log ซ้ำ (pld_lib_auth เขียน audit line ไปแล้วพร้อม roleId)
      if (e && e.pldDenied === true) {
        return writeDeniedJson(response, e);
      }
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

  /**
   * Actions ที่เปลี่ยนสถานะเทมเพลต — ต้องผ่าน pld_lib_auth ก่อน (#189).
   * อ่านอย่างเดียว (render / preview / list / get / history / version) เปิดให้ทุก role
   * ตามเดิม เพราะการพิมพ์เอกสารเป็นงานประจำวันของทุกคน
   */
  var WRITE_ACTIONS = { save: true, 'delete': true, rollback: true };

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

  /**
   * คำปฏิเสธเมื่อ role ไม่มีสิทธิ์แก้เทมเพลต (#189). ทุก write action ถูกเรียกผ่าน
   * fetch จาก SPA จึงเป็น JSON เสมอ · `denied:true` แยกจาก error ทั่วไปเพื่อให้ SPA
   * ขึ้นข้อความ "ดูได้แต่แก้ไม่ได้" แทนที่จะชวนให้ผู้ใช้กดลองใหม่
   */
  function writeDeniedJson(response, e) {
    response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    response.write(JSON.stringify({
      error: true,
      denied: true,
      message: e.message
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
    var tpl = pldRender.resolveTemplate(tplId, recType);

    // ─── 2. Render (record + company + context) ───
    tel.stage = 'render';
    // Invoices bind the curated schema (company/customer/document/totals/items)
    // built from SuiteQL — the SAME data source as live Preview (preview-live),
    // so Print == Preview. Without this, Print binds the raw record and the
    // designer templates (${record.customer.name} etc.) render empty (#67 GAP #1).
    // Invoices also print the statutory copy set (ต้นฉบับ + สำเนา, #15).
    // #91: every supported type binds curated data. #92: copy set comes from
    // the template record (data JSON), falling back to the invoice default.
    // #159: copy set ใช้กับ **ทุก** record type แล้ว — เดิมสาขา else (rectype ที่ยังไม่ curated)
    // เรียก render ตรงโดยไม่แตะ resolveCopies เลย ทำให้ชุดสำเนาที่ผู้ใช้ตั้งไว้ถูกทิ้งเงียบ ๆ
    var copies = pldRender.resolveCopies(tpl.copies, recType);
    var copiesCount = copies.length;
    var out = pldRender.renderDocument(tpl.xml, recType, recId, copies, tel);

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
    // #92: unsaved designer state sends its copy set in the body · #159: honored for
    // every record type, same path as Print, so preview == print on copies too.
    var pvCopies = pldRender.resolveCopies(pldRender.parseCopies(body.copies), body.rectype);
    var copiesCount = pvCopies.length;
    var out;
    if (body.data) {
      // synthetic-data preview (#75): caller supplies the bound object itself
      out = { pdfFile: pldRender.makeRenderer(body.xml, body.data, null, tel, pvCopies[0]).renderAsPdf() };
      copiesCount = 1;
    } else {
      out = pldRender.renderDocument(body.xml, body.rectype, body.recid, pvCopies, tel);
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
    // .xml — loadTemplate returns { xml, copies } (#92). Reading the object itself
    // used to land here and blow up on .replace() below, so ?action=preview has
    // been dead since the copy set was added; the split made it visible (#181).
    var tplXml = pldRender.loadTemplate(tplId).xml;

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
   * Body: { id?, name, data, xml, rectype, isDefault?, note? }
   *
   * เขียนทับเนื้อเทมเพลตได้เหมือนเดิม แต่ไม่ทำให้ของเดิมหาย (#189): เวอร์ชันก่อนหน้า
   * ถูก snapshot ไว้ก่อนเสมอ ถ้าเทมเพลตนั้นยังไม่เคยมีประวัติ (มีอยู่ก่อนฟีเจอร์นี้)
   * จะเก็บสถานะปัจจุบันเป็นเวอร์ชัน baseline ให้ก่อน — ไม่งั้นการ save ครั้งแรก
   * หลัง deploy จะกลืน XML ที่ใช้งานจริงอยู่ไปโดยไม่มีทางถอย
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
      seedBaselineVersion(tplId, rec);
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

    var snap = tplAudit.snapshot({
      tplId: savedId,
      action: tplId ? 'update' : 'create',
      name: body.name || 'Untitled',
      rectype: body.rectype || '',
      xml: body.xml,
      data: body.data || '',
      note: body.note || ''
    });

    tplAudit.auditWrite(tplId ? 'update' : 'create', {
      tplid: String(savedId),
      rectype: body.rectype || '',
      name: body.name || 'Untitled',
      isDefault: body.isDefault === true,
      version: snap.versionNo
    });

    sendJson(context, { id: savedId, success: true, version: snap.versionNo });
  }

  /**
   * เทมเพลตที่มีอยู่ก่อนฟีเจอร์ประวัติ (#189) ยังไม่มีเวอร์ชันสักตัว — เก็บสถานะ
   * ปัจจุบันเป็น baseline **ก่อน** จะเขียนทับ เพื่อให้ save ครั้งแรกหลัง deploy
   * ยังย้อนกลับได้ · เทมเพลตที่มีประวัติแล้วไม่ต้องทำอะไร (เวอร์ชันล่าสุด = ของที่อยู่บน record)
   */
  function seedBaselineVersion(tplId, rec) {
    if (tplAudit.latestVersionNo(tplId) > 0) return;

    var currentXml = rec.getValue({ fieldId: TPL_FLD_XML });
    if (!currentXml) return; // ไม่มีอะไรให้กู้คืน

    tplAudit.snapshot({
      tplId: tplId,
      action: 'baseline',
      name: rec.getValue({ fieldId: TPL_FLD_NAME }) || '',
      rectype: rec.getValue({ fieldId: TPL_FLD_REC_TYPE }) || '',
      xml: currentXml,
      data: rec.getValue({ fieldId: TPL_FLD_DATA }) || '',
      note: 'สถานะก่อนเริ่มเก็บประวัติเวอร์ชัน'
    });
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
   * see renderPdf / pld_lib_render.findDefaultTemplate — no silent fallback, R4).
   */
  function deleteTemplate(context) {
    if (context.request.method !== 'POST') {
      throw new Error('POST required for delete');
    }

    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid');

    // #189: อ่านของจริงออกมาเก็บเป็นเวอร์ชันสุดท้าย **ก่อน** ลบ — การลบเทมเพลตที่ใช้
    // ออกใบกำกับภาษีเป็น action ที่ย้อนไม่ได้ที่สุดใน product นี้ ประวัติจึงต้องมีเนื้อไฟล์
    // ติดไปด้วย ไม่ใช่แค่บรรทัดว่า "ถูกลบแล้ว" (rollback สร้าง record ใหม่จากแถวนี้ได้)
    var rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });
    var wasDefault = rec.getValue({ fieldId: TPL_FLD_IS_DEFAULT }) === true;
    var recType = rec.getValue({ fieldId: TPL_FLD_REC_TYPE }) || '';

    var snap = tplAudit.snapshot({
      tplId: tplId,
      action: 'delete',
      name: rec.getValue({ fieldId: TPL_FLD_NAME }) || '',
      rectype: recType,
      xml: rec.getValue({ fieldId: TPL_FLD_XML }) || '',
      data: rec.getValue({ fieldId: TPL_FLD_DATA }) || '',
      note: wasDefault ? 'เป็น default ของ ' + recType + ' ตอนที่ถูกลบ' : ''
    });

    record.delete({ type: TPL_RECORD_TYPE, id: tplId });

    tplAudit.auditWrite('delete', {
      tplid: String(tplId),
      rectype: recType,
      wasDefault: wasDefault,
      version: snap.versionNo
    });

    sendJson(context, { success: true, wasDefault: wasDefault, version: snap.versionNo });
  }

  // ═══════════════════════════════════════════════════
  // VERSION HISTORY + ROLLBACK (#189)
  // ═══════════════════════════════════════════════════

  /**
   * ประวัติการแก้ของเทมเพลตหนึ่งตัว (GET) — ใคร role ไหน ทำอะไร เมื่อไหร่
   * เปิดให้ทุก role อ่านได้เหมือน list/get: การรู้ว่าใครแก้เอกสารเป็นข้อมูลที่ควรโปร่งใส
   * ในทีม ส่วนการ **เปลี่ยน** ยังคงต้องมีสิทธิ์
   */
  function templateHistory(context) {
    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid');

    var limit = parseInt(context.request.parameters.limit, 10) || 100;

    sendJson(context, {
      tplid: String(tplId),
      canEdit: auth.canEditTemplates(),
      keepPayload: tplAudit.PAYLOAD_KEEP,
      versions: tplAudit.history(tplId, limit)
    });
  }

  /**
   * ย้อนเทมเพลตกลับไปเวอร์ชันหนึ่ง (POST) — params: tplid, version
   *
   * ไม่เคยลบประวัติ: การย้อนกลับเขียนเป็น **เวอร์ชันใหม่** ที่มีเนื้อของเวอร์ชันเก่า
   * ดังนั้นย้อนของย้อนได้ และประวัติยังเล่าเรื่องตามลำดับเวลาจริง
   *
   * เทมเพลตที่ถูกลบไปแล้วก็ย้อนได้ — สร้าง record ใหม่จาก snapshot (ธง default
   * ไม่ตามมาด้วย เพราะการกู้คืนต้องไม่แย่ง Print ของ record type นั้นกลับไปเงียบ ๆ)
   */
  function rollbackTemplate(context) {
    if (context.request.method !== 'POST') {
      throw new Error('POST required for rollback');
    }

    var params = context.request.parameters;
    var tplId = params.tplid;
    var wanted = params.version;

    if (!tplId) throw new Error('Missing tplid');
    if (!wanted) throw new Error('Missing version — ระบุเวอร์ชันที่ต้องการย้อนกลับไป');

    var src = tplAudit.readVersion(tplId, wanted);

    var rec;
    var recreated = false;
    try {
      rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });
    } catch (e) {
      // เทมเพลตถูกลบไปแล้ว — กู้กลับมาเป็น record ใหม่ (เกณฑ์ข้อ 7 ของ #189)
      rec = record.create({ type: TPL_RECORD_TYPE });
      recreated = true;
    }

    rec.setValue({ fieldId: 'name', value: src.name || 'Untitled' });
    rec.setValue({ fieldId: TPL_FLD_NAME, value: src.name || 'Untitled' });
    rec.setValue({ fieldId: TPL_FLD_XML, value: src.xml });
    rec.setValue({ fieldId: TPL_FLD_DATA, value: src.data });
    if (src.rectype) {
      rec.setValue({ fieldId: TPL_FLD_REC_TYPE, value: src.rectype });
    }

    var savedId = rec.save();

    var snap = tplAudit.snapshot({
      tplId: savedId,
      action: 'rollback',
      name: src.name,
      rectype: src.rectype,
      xml: src.xml,
      data: src.data,
      note: 'ย้อนกลับไปเวอร์ชัน ' + src.version + (recreated ? ' (กู้เทมเพลตที่ถูกลบไปแล้ว)' : '')
    });

    tplAudit.auditWrite('rollback', {
      tplid: String(savedId),
      sourceTplid: String(tplId),
      rectype: src.rectype,
      restoredFrom: src.version,
      recreated: recreated,
      version: snap.versionNo
    });

    sendJson(context, {
      success: true,
      id: savedId,
      version: snap.versionNo,
      restoredFrom: src.version,
      recreated: recreated
    });
  }

  // ═══════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════

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

  function sendJson(context, data) {
    context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    context.response.write(JSON.stringify(data));
  }

  return { onRequest: onRequest };
});

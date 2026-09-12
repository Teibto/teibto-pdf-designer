/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — render core (#181)
 *
 * ทุกอย่างที่ "เอา template + record → PDF" อยู่ที่ไฟล์นี้ไฟล์เดียว: โหลด template
 * record, ตีความชุดสำเนา, ประกอบ renderer พร้อม data source ครบชุด (record/copy/
 * company/context) แล้วรวมหลาย pass เป็น PDF ก้อนเดียวผ่าน <pdfset>.
 *
 * เหตุผลที่แยกออกมา: การพิมพ์เป็นชุด (#181) ต้อง render หลายใบแล้วรวมเป็นไฟล์เดียว
 * ถ้าคัดลอกโค้ด render ไปไว้ที่ Suitelet ตัวใหม่ product จะมี render path ที่สองทันที
 * ซึ่งเป็นบทเรียนที่ repo นี้จ่ายมาแล้ว (CLAUDE.md — BFO เป็น render engine เดียว).
 * pld_sl_render_pdf (พิมพ์ทีละใบ + preview) และ batch print เรียกฟังก์ชันชุดเดียวกันนี้.
 *
 * `tel` ที่รับเข้ามาคือ telemetry object ของผู้เรียก (#149) — lib เขียนเฉพาะ
 * `stage` กับ `subsidiaryId` ลงไป ไม่ได้เป็นเจ้าของ log เอง เพราะรูปแบบ log/error
 * ขึ้นกับคนอ่านฝั่งผู้เรียก (#157).
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
define([
  'N/render',
  'N/record',
  'N/search',
  'N/runtime',
  'N/format',
  './pld_lib_company_config',
  './pld_lib_invoice_data',
  './pld_lib_invoice_reference'
], function (render, record, search, runtime, format, companyConfig, invoiceData, invoiceReference) {

  // ─── Template custom record ───
  var TPL = {
    TYPE:     'customrecord_pld_template',
    NAME:     'custrecord_pld_tpl_name',
    DATA:     'custrecord_pld_tpl_data',     // JSON string (designer state)
    XML:      'custrecord_pld_tpl_xml',      // BFO XML string
    RECTYPE:  'custrecord_pld_tpl_rectype',  // target record type
    IS_DEFAULT: 'custrecord_pld_tpl_default'
  };

  // ═══════════════════════════════════════════════════
  // TEMPLATE + COPY SET
  // ═══════════════════════════════════════════════════

  /**
   * Load BFO XML from a template custom record.
   * No fallback generation: the only BFO generator is the designer's
   * bfo-export.service.ts — a template without XML is a hard error (#6, R4).
   */
  function loadTemplate(tplId) {
    var rec = record.load({ type: TPL.TYPE, id: tplId });
    var xmlContent = rec.getValue({ fieldId: TPL.XML });

    if (!xmlContent) {
      throw new Error('Template ' + tplId + ' has no BFO XML. ' +
        'Re-save it from the designer — the engine no longer generates XML from designer data (#6).');
    }

    return { xml: xmlContent, copies: copiesFromDataJson(rec.getValue({ fieldId: TPL.DATA })) };
  }

  /** Copy set stored in the designer JSON of a template record (#92) */
  function copiesFromDataJson(dataJson) {
    if (!dataJson) return null;
    try { return parseCopies(JSON.parse(dataJson).copies); } catch (e) { return null; }
  }

  /**
   * Find the default template for a record type.
   * Same no-fallback rule as loadTemplate (#6, R4).
   */
  function findDefaultTemplate(recType) {
    var results = search.create({
      type: TPL.TYPE,
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        [TPL.RECTYPE, 'is', recType],
        'AND',
        [TPL.IS_DEFAULT, 'is', 'T']
      ],
      columns: [TPL.XML, TPL.DATA]
    }).run().getRange({ start: 0, end: 1 });

    if (results.length === 0) return null;

    var xmlContent = results[0].getValue(TPL.XML);
    if (!xmlContent) {
      throw new Error('Default template for ' + recType + ' (id ' + results[0].id + ') has no BFO XML. ' +
        'Re-save it from the designer — the engine no longer generates XML from designer data (#6).');
    }

    return { xml: xmlContent, copies: copiesFromDataJson(results[0].getValue(TPL.DATA)) };
  }

  /**
   * Template for one print: the one asked for, else the record type's default.
   * Throws the user-visible "No template found" when neither exists (R4 — never
   * an empty PDF).
   */
  function resolveTemplate(tplId, recType) {
    var tpl = tplId ? loadTemplate(tplId) : findDefaultTemplate(recType);
    if (!tpl || !tpl.xml) {
      throw new Error('No template found. Please specify tplid or set a default template for ' + recType);
    }
    return tpl;
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

  /** Copy data source shape (#159) — keys a template may bind under ${copy.*}. */
  function copyBinding(copy) {
    var th = (copy && copy.th) || 'ต้นฉบับ';
    var en = (copy && copy.en) || 'Original';
    return { th: th, en: en, label: th + ' (' + en + ')' };
  }

  // ═══════════════════════════════════════════════════
  // RENDERER
  // ═══════════════════════════════════════════════════

  /**
   * Build a configured N/render renderer for one template + one data binding —
   * the single binding path shared by Print (render), live Preview
   * (preview-live) and batch print (#181), so every surface renders byte-for-byte
   * the same engine + data sources (#12). When the caller supplies a curated data
   * object (designer schema built via SuiteQL — see pld_lib_invoice_data), bind
   * THAT as `record` so ${record.customer.name}, <#list record.items ...> resolve;
   * otherwise bind the raw NetSuite record (`rec`) so hand-written master
   * templates (${record.tranid}) render unchanged.
   */
  function makeRenderer(tplXml, curatedData, rec, tel, copy) {
    var renderer = render.create();
    renderer.templateContent = tplXml;

    if (curatedData) {
      renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'record', data: curatedData });
    } else {
      renderer.addRecord({ templateName: 'record', record: rec });
    }

    // Copy label of the pass being rendered (#159) — its own data source so it works
    // on BOTH binding paths: curated types get it from the copy set, and a raw-record
    // type (no curated data at all) finally gets a real label instead of every copy
    // printing "ต้นฉบับ". Templates bind ${copy.label} / ${copy.th} / ${copy.en}.
    renderer.addCustomDataSource({
      format: render.DataSource.OBJECT,
      alias: 'copy',
      data: copyBinding(copy)
    });

    // Company info (custom data source) — subsidiary-scoped (OneWorld, #144).
    // Capture the resolved subsidiary into telemetry (#149) so a failed render is
    // traceable to the config record that fed ${company.*}.
    var subsidiaryId = subsidiaryIdOf(curatedData, rec);
    if (tel && subsidiaryId != null && subsidiaryId !== '') tel.subsidiaryId = String(subsidiaryId);
    renderer.addCustomDataSource({
      format: render.DataSource.OBJECT,
      alias: 'company',
      data: companyConfig.load(subsidiaryId)
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

  /**
   * Bind BFO XML to a real record and render a single-copy PDF.
   * Returns { pdfFile, rec } (caller names the file).
   */
  function renderXmlWithRecord(tplXml, recType, recId, curatedData, tel, copy) {
    if (tel) tel.stage = 'load-record';
    var rec = record.load({ type: recType, id: recId });
    if (tel) tel.stage = 'render';
    return { pdfFile: makeRenderer(tplXml, curatedData, rec, tel, copy).renderAsPdf(), rec: rec };
  }

  // ═══════════════════════════════════════════════════
  // ONE DOCUMENT → PDF (copy set aware)
  // ═══════════════════════════════════════════════════

  /**
   * Render one document as resolved <pdf> document strings — one per copy (#159).
   * This is the shape batch print needs: several documents' strings concatenate
   * into ONE <pdfset>, so a 40-page batch is a single file with every copy in
   * order (#181).
   *
   * Curated types build their schema per copy (the doc title carries the copy
   * label); a raw-record type loads the record ONCE and reuses it for every pass —
   * only the ${copy.*} data source differs.
   *
   * @returns {{docs: string[], tranId: string, rec: Object|null}}
   */
  function renderDocumentXml(tplXml, recType, recId, copies, tel) {
    var curatedType = invoiceData.isSupportedType(recType);

    var rec = null;
    if (!curatedType) {
      if (tel) tel.stage = 'load-record';
      rec = record.load({ type: recType, id: recId });
    }
    if (tel) tel.stage = 'render';

    var tranId = '';
    var docs = copies.map(function (c) {
      var curated = curatedType
        ? invoiceData.buildTransactionData(recType, recId, c.th, c.en)
        : null;
      curated = referenceData(tplXml, curated, recType, recId);
      if (curated) tranId = tranId || (curated.document && curated.document.number) || '';
      return extractPdfDoc(makeRenderer(tplXml, curated, rec, tel, c).renderAsString());
    });

    if (!tranId && rec) {
      try { tranId = rec.getValue({ fieldId: 'tranid' }) || ''; } catch (e) { tranId = ''; }
    }

    return { docs: docs, tranId: tranId, rec: rec };
  }

  /**
   * The <pdf> document inside a FreeMarker-resolved template string. Anything
   * outside it (XML declaration, DOCTYPE, stray whitespace) cannot go inside a
   * <pdfset>, and a template that resolved to something else must fail loudly
   * rather than produce a set that silently drops a copy (R4).
   */
  function extractPdfDoc(resolved) {
    var root = /<pdf(?:\s[^<>]*?)?>/.exec(resolved);
    var start = root ? root.index : -1;
    var end = resolved.lastIndexOf('</pdf>');
    if (start < 0 || end < 0) {
      throw new Error('renderAsString produced no <pdf> document — cannot build the copy set');
    }
    return resolved.substring(start, end + '</pdf>'.length);
  }

  /** Combine resolved <pdf> documents into one PDF file via BFO <pdfset> (#15). */
  function combinePdfDocs(docs) {
    return render.xmlToPdf({
      xmlString: '<?xml version="1.0"?>\n' +
        '<!DOCTYPE pdfset PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n' +
        '<pdfset>\n' + docs.join('\n') + '\n</pdfset>'
    });
  }

  /**
   * Render one document for its copy set, whatever the record type (#159).
   * Single copy → straight renderAsPdf (one render pass, no re-parse); more than
   * one → one pass per copy label combined into ONE PDF.
   *
   * @returns {{pdfFile: Object, tranId: string, rec: Object|null}}
   */
  function renderDocument(tplXml, recType, recId, copies, tel) {
    if (copies.length === 1) {
      var only = copies[0];
      var singleData = invoiceData.isSupportedType(recType)
        ? invoiceData.buildTransactionData(recType, recId, only.th, only.en)
        : null;
      singleData = referenceData(tplXml, singleData, recType, recId);
      var out = renderXmlWithRecord(tplXml, recType, recId, singleData, tel, only);
      return { pdfFile: out.pdfFile, rec: out.rec, tranId: '' };
    }

    var multi = renderDocumentXml(tplXml, recType, recId, copies, tel);
    if (tel) tel.stage = 'copyset';
    return { pdfFile: combinePdfDocs(multi.docs), tranId: multi.tranId, rec: multi.rec };
  }

  /**
   * Render a template against **synthetic** data — no transaction needed (#191).
   *
   * Lives here, not in the Suitelet, because it must go through the same
   * `makeRenderer` as Print: the whole value of a sample preview is that it fails
   * and succeeds for the same reasons the real print does (Thai font from config,
   * `<macrolist>` header on every page, a binding that is not `?xml`-escaped
   * blowing up the whole document). A second binding path would be a preview that
   * lies — the exact class of bug the single-render-core rule exists to prevent.
   *
   * The copy set is honored like Print's: one pass per label, combined via
   * `<pdfset>`, so ต้นฉบับ/สำเนา is visible before the template ever reaches a
   * customer's account.
   *
   * @returns {{pdfFile: Object}}
   */
  function referenceData(tplXml, data, recType, recId) {
    if (tplXml.indexOf('pld:reference-layout') === -1) return data;
    if (recType !== 'invoice' || !data) throw new Error('Reference invoice layout requires a curated invoice');
    return invoiceReference.enrich(data, recId);
  }

  function renderSampleDocument(tplXml, recType, copies, tel, suppliedData) {
    if (tel) tel.stage = 'render';

    function dataForCopy(c) {
      if (!suppliedData) return invoiceData.buildSampleData(recType, c.th, c.en);
      var data = JSON.parse(JSON.stringify(suppliedData));
      if (data.document) {
        data.document.copyTH = c.th;
        data.document.copyEN = c.en;
      }
      data.custbody_doc_copy_label = c.th + ' (' + c.en + ')';
      return data;
    }

    if (copies.length === 1) {
      var only = copies[0];
      var data = dataForCopy(only);
      return { pdfFile: makeRenderer(tplXml, data, null, tel, only).renderAsPdf() };
    }

    var docs = copies.map(function (c) {
      var perCopy = dataForCopy(c);
      return extractPdfDoc(makeRenderer(tplXml, perCopy, null, tel, c).renderAsString());
    });
    if (tel) tel.stage = 'copyset';
    return { pdfFile: combinePdfDocs(docs) };
  }

  return {
    TPL: TPL,
    INVOICE_COPIES: INVOICE_COPIES,
    loadTemplate: loadTemplate,
    findDefaultTemplate: findDefaultTemplate,
    resolveTemplate: resolveTemplate,
    parseCopies: parseCopies,
    resolveCopies: resolveCopies,
    copyBinding: copyBinding,
    makeRenderer: makeRenderer,
    renderDocument: renderDocument,
    renderDocumentXml: renderDocumentXml,
    renderSampleDocument: renderSampleDocument,
    combinePdfDocs: combinePdfDocs
  };
});

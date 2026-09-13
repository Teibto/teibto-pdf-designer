/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * PDF Layout Flow Designer — NetSuite Suitelet Host
 * Serves the built SPA from File Cabinet and injects NetSuite context.
 *
 * Suitelet ตัวนี้ **อ่านอย่างเดียว** (#189): เสิร์ฟ SPA, ส่ง context, โหลดข้อมูล record
 * และ list เทมเพลต · การเขียนเทมเพลตทุกชนิดอยู่ที่ pld_sl_render_pdf ที่เดียวซึ่งมีด่าน
 * สิทธิ์ + ประวัติเวอร์ชันครบ — ห้ามเพิ่ม path เขียนกลับมาที่นี่
 *
 * @author Wichit Wongta
 */
define([
  'N/file',
  'N/runtime',
  'N/url',
  'N/search',
  'N/record',
  'N/log',
  './pld_lib_company_config',
  './pld_lib_invoice_data',
  './pld_lib_auth'
], function (file, runtime, url, search, record, log, companyConfig, invoiceData, auth) {

  /**
   * File Cabinet path of the built SPA bundle. deploy.sh (#39) stages
   * designer/dist-netsuite here, so the Suitelet serves it by PATH — no
   * per-account internal IDs to hardcode (paths are identical on every account).
   */
  const DIST_PATH = '/SuiteScripts/pdf-layout-designer/dist';

  /**
   * @param {Object} context
   * @param {ServerRequest} context.request
   * @param {ServerResponse} context.response
   */
  function onRequest(context) {
    const request = context.request;
    const response = context.response;

    if (request.method === 'GET') {
      const action = request.parameters.action || 'app';

      switch (action) {
        case 'app':
          return serveApp(context);
        case 'load-record':
          return loadRecordData(context);
        case 'list-templates':
          return listSavedTemplates(context);
        default:
          return serveApp(context);
      }
    }

    if (request.method === 'POST') {
      // #189: เดิมที่นี่รับ `save-template` (สำเนาที่สองของ CRUD ที่ pld_sl_render_pdf
      // เป็นเจ้าของ) และ `generate-bfo` ที่เขียนไฟล์ XML ลง File Cabinet **โฟลเดอร์ไหน
      // ก็ได้ตามที่ผู้เรียกส่งมา** โดยไม่ตรวจสิทธิ์อะไรเลย ทั้งคู่ไม่มี client เรียกจริง
      // (SPA ยิง action=save/list ไปที่ render Suitelet) จึงถอดออกทั้งคู่ — ทางเขียน
      // เทมเพลตเหลือเส้นเดียวที่มีด่านสิทธิ์และประวัติเวอร์ชัน
      response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
      response.write(JSON.stringify({
        error: true,
        message: 'Suitelet นี้อ่านอย่างเดียว — บันทึกเทมเพลตผ่าน PLD Renderer (?action=save) เท่านั้น (#189)'
      }));
    }
  }

  // ═══════════════════════════════════════
  // SERVE APP
  // ═══════════════════════════════════════

  /**
   * Serve the built SPA — load its index.html from File Cabinet by path, rewrite
   * asset refs to File Cabinet URLs, and inject NetSuite globals (#39).
   */
  function serveApp(context) {
    try {
      // Serve the built SPA from File Cabinet BY PATH (#39) — no per-account IDs.
      var indexHtml = file.load({ id: DIST_PATH + '/index.html' }).getContents();

      // Resolve File Cabinet URLs of the two direct assets by path. .url is cheap
      // (metadata) — do NOT getContents() the ~2MB bundle. Module scripts are
      // MIME-strict: NetSuite serves a JS content-type only when the URL carries
      // _xt=.js, else the <script type="module"> is rejected and the app never
      // upgrades (#39).
      var jsUrl  = withJsExt(file.load({ id: DIST_PATH + '/assets/pld-app.js' }).url);
      var cssUrl = file.load({ id: DIST_PATH + '/assets/pld-app.css' }).url;

      // Rewrite the build's relative refs (base './') to absolute File Cabinet URLs
      indexHtml = indexHtml
        .replace('./assets/pld-app.js', jsUrl)
        .replace('./assets/pld-app.css', cssUrl);

      // Inject globals the app reads: __NS_CONTEXT__ (record + fonts), this
      // designer Suitelet's own URL (load-record / save-template callbacks), and
      // the render Suitelet URL (server preview + Print, #12).
      var nsContext = buildNsContext(context);
      var suiteletUrl = url.resolveScript({
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        returnExternalUrl: false,
      });
      var injection = '<script>'
        + 'window.__NS_CONTEXT__ = ' + JSON.stringify(nsContext) + ';'
        + 'window.__NS_SUITELET_URL__ = ' + JSON.stringify(suiteletUrl) + ';'
        + 'window.__NS_RENDER_URL__ = ' + JSON.stringify(getRenderUrl()) + ';'
        + '</script>';
      indexHtml = indexHtml.replace('</head>', injection + '\n</head>');

      context.response.write(indexHtml);
    } catch (e) {
      log.error({ title: 'serveApp', details: e });
      context.response.write('<h2>Error loading PDF Layout Designer</h2><p>' + (e.message || e) + '</p>');
    }
  }

  /** Ensure a File Cabinet media URL is served with a JS content-type (#39). */
  function withJsExt(u) {
    if (u.indexOf('_xt=') !== -1) return u;
    return u + (u.indexOf('?') === -1 ? '?' : '&') + '_xt=.js';
  }

  // ═══════════════════════════════════════
  // NETSUITE CONTEXT
  // ═══════════════════════════════════════

  /**
   * Resolve the internal URL of the PDF render Suitelet so the designer can
   * call it for server-side preview (?action=preview-live) and Print (#12).
   * Degrades to '' if the render script isn't deployed — designer still loads.
   */
  function getRenderUrl() {
    try {
      return url.resolveScript({
        scriptId: 'customscript_pld_render',
        deploymentId: 'customdeploy_pld_render',
        returnExternalUrl: false,
      });
    } catch (e) {
      log.error({ title: 'getRenderUrl', details: e });
      return '';
    }
  }

  function buildNsContext(context) {
    const user = runtime.getCurrentUser();
    const script = runtime.getCurrentScript();
    // Use the exact company-config path actual rendering requires. Legacy script
    // parameters must not mask a missing/broken config and suppress the SPA's Thai
    // font warning. No transaction is open here, so scope by the current user's
    // subsidiary (OneWorld, #144) — the best available bootstrap context.
    var cfg = {};
    try { cfg = companyConfig.load(user.subsidiary, { forRender: true }); } catch (e) { cfg = {}; }

    const ctx = {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      role: user.role,
      subsidiary: user.subsidiary,
      accountId: runtime.accountId,
      scriptId: script.id,
      deploymentId: script.deploymentId,
      environment: runtime.envType,
      // Record context if opened from a record
      recordType: context.request.parameters.rectype || null,
      recordId: context.request.parameters.recid || null,
      // File Cabinet URLs of THSarabunNew TTFs — designer embeds them as
      // <link type="font"> in exported BFO XML (server BFO has no Thai fonts)
      fontRegularUrl: cfg.fontRegular || null,
      fontBoldUrl: cfg.fontBold || null,
      // #189: บอก SPA ตั้งแต่ตอนเปิดว่า role นี้บันทึกได้ไหม — ผู้ใช้ที่แก้ไม่ได้ควรเห็น
      // โหมดอ่านอย่างเดียวตั้งแต่แรก ไม่ใช่ออกแบบไปครึ่งชั่วโมงแล้วโดนปฏิเสธตอนกดบันทึก
      // (server ยังเป็นคนตัดสินจริงทุกครั้ง — ค่านี้ใช้แค่ทำให้ UI ซื่อสัตย์)
      canEditTemplates: auth.canEditTemplates(),
    };

    return ctx;
  }

  // ═══════════════════════════════════════
  // RECORD DATA LOADING
  // ═══════════════════════════════════════

  /**
   * Load record data as JSON for binding.
   * Called via AJAX: ?action=load-record&rectype=invoice&recid=123
   */
  function loadRecordData(context) {
    const started = Date.now();
    const usageBefore = remainingUsage();
    try {
      const recType = context.request.parameters.rectype;
      const recId = context.request.parameters.recid;

      if (!recType || !recId) {
        context.response.write(JSON.stringify({ error: 'Missing rectype or recid' }));
        return;
      }

      // Invoices load the curated schema (SuiteQL) so the mapping UI's keys match
      // exactly what the render binds (design = data = print). Other record types
      // keep the raw extract for now.
      const data = invoiceData.isSupportedType(recType)
        ? invoiceData.buildTransactionData(recType, recId)
        : extractRecordData(record.load({ type: recType, id: recId }), recType);

      const loaded = Date.now();
      const payload = JSON.stringify(data);
      const usageAfter = remainingUsage();
      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.setHeader({ name: 'Server-Timing', value:
        'data;dur=' + Math.max(0, loaded - started) + ', serialize;dur=' + Math.max(0, Date.now() - loaded) });
      if (usageBefore !== null && usageAfter !== null) {
        context.response.setHeader({ name: 'X-PLD-Usage', value: String(Math.max(0, usageBefore - usageAfter)) });
      }
      context.response.write(payload);

    } catch (e) {
      log.error({ title: 'loadRecordData', details: e });
      context.response.write(JSON.stringify({ error: e.message }));
    }
  }

  function remainingUsage() {
    try {
      const value = runtime.getCurrentScript().getRemainingUsage();
      return typeof value === 'number' && isFinite(value) ? value : null;
    } catch (e) { return null; }
  }

  /**
   * Extract record fields and sublists into JSON format.
   */
  function extractRecordData(rec, recType) {
    const data = {
      _recordType: recType,
      _internalId: rec.id,
    };

    // ─── Body Fields ───
    const bodyFields = getBodyFields(recType);
    for (const field of bodyFields) {
      try {
        const value = rec.getValue({ fieldId: field });
        const text = rec.getText({ fieldId: field });
        data[field] = text || value;
      } catch (e) {
        // Field not available
      }
    }

    // ─── Company Info (customrecord_pld_config — single source, #9) ───
    // Subsidiary-scoped (OneWorld, #144) from the record already loaded above.
    try {
      var recSubsidiary;
      try { recSubsidiary = rec.getValue({ fieldId: 'subsidiary' }); } catch (e2) { recSubsidiary = undefined; }
      data.company = companyConfig.load(recSubsidiary);
    } catch (e) {
      data.company = {};
    }

    // ─── Item Sublist ───
    const itemSublist = getItemSublistId(recType);
    if (itemSublist) {
      const lineCount = rec.getLineCount({ sublistId: itemSublist });
      const items = [];

      for (let i = 0; i < lineCount; i++) {
        const line = { _line: i + 1 };
        const lineFields = getLineFields(recType);

        for (const field of lineFields) {
          try {
            const value = rec.getSublistValue({ sublistId: itemSublist, fieldId: field, line: i });
            const text = rec.getSublistText({ sublistId: itemSublist, fieldId: field, line: i });
            line[field] = text || value;
          } catch (e) {
            // Field not available
          }
        }

        items.push(line);
      }

      data.items = items;
    }

    return data;
  }

  // ═══════════════════════════════════════
  // TEMPLATE CRUD (Custom Record)
  // ═══════════════════════════════════════

  /**
   * List saved templates from a custom record.
   * Custom Record: customrecord_pld_template
   *   - custrecord_pld_tpl_name (Text)
   *   - custrecord_pld_tpl_data (Long Text / File)
   *   - custrecord_pld_tpl_rectype (Text) — record type filter
   */
  function listSavedTemplates(context) {
    try {
      const recType = context.request.parameters.rectype || '';

      const filters = [
        ['isinactive', 'is', 'F'],
      ];
      if (recType) {
        filters.push('AND');
        filters.push(['custrecord_pld_tpl_rectype', 'is', recType]);
      }

      const results = [];
      search.create({
        type: 'customrecord_pld_template',
        filters: filters,
        columns: [
          'custrecord_pld_tpl_name',
          'custrecord_pld_tpl_rectype',
          'created',
          'lastmodified',
        ],
      }).run().each(function (result) {
        results.push({
          id: result.id,
          name: result.getValue('custrecord_pld_tpl_name'),
          type: result.getValue('custrecord_pld_tpl_rectype'),
          created: result.getValue('created'),
          modified: result.getValue('lastmodified'),
        });
        return true;
      });

      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.write(JSON.stringify(results));

    } catch (e) {
      log.error({ title: 'listSavedTemplates', details: e });
      context.response.write(JSON.stringify({ error: e.message }));
    }
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  function getBodyFields(recType) {
    const common = [
      'tranid', 'trandate', 'status', 'subsidiary', 'department',
      'memo', 'currency', 'exchangerate',
    ];

    const typeFields = {
      invoice: [...common, 'entity', 'duedate', 'subtotal', 'taxtotal', 'total', 'amountpaid', 'amountremaining', 'terms', 'otherrefnum'],
      salesorder: [...common, 'entity', 'shipdate', 'subtotal', 'taxtotal', 'total', 'terms', 'shipmethod'],
      purchaseorder: [...common, 'entity', 'shipdate', 'subtotal', 'taxtotal', 'total', 'terms', 'approvalstatus'],
      estimate: [...common, 'entity', 'duedate', 'subtotal', 'taxtotal', 'total', 'probability', 'expectedclosedate'],
      vendorbill: [...common, 'entity', 'duedate', 'subtotal', 'taxtotal', 'total', 'terms'],
      itemfulfillment: [...common, 'entity', 'shipdate', 'shipmethod', 'shipstatus'],
      cashsale: [...common, 'entity', 'subtotal', 'taxtotal', 'total', 'paymentmethod', 'account'],
    };

    return typeFields[recType] || common;
  }

  function getItemSublistId(recType) {
    const sublistMap = {
      invoice: 'item',
      salesorder: 'item',
      purchaseorder: 'item',
      estimate: 'item',
      vendorbill: 'item',
      itemfulfillment: 'item',
      cashsale: 'item',
      journalentry: 'line',
    };
    return sublistMap[recType] || 'item';
  }

  function getLineFields(recType) {
    const common = ['item', 'description', 'quantity', 'rate', 'amount', 'taxcode', 'tax1amt'];

    const typeFields = {
      invoice: [...common, 'units', 'grossamt', 'location'],
      salesorder: [...common, 'units', 'location', 'commitmentfirm'],
      purchaseorder: [...common, 'units', 'quantityreceived', 'quantitybilled', 'expectedreceiptdate'],
      itemfulfillment: ['item', 'description', 'quantity', 'units', 'location', 'serialnumbers', 'inventorydetail'],
    };

    return typeFields[recType] || common;
  }

  return { onRequest: onRequest };
});

/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * PDF Layout Flow Designer — NetSuite Suitelet Host
 * Serves the built SPA from File Cabinet and injects NetSuite context.
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
  './pld_lib_company_config'
], function (file, runtime, url, search, record, log, companyConfig) {

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
        case 'save-template':
          return; // POST only
        default:
          return serveApp(context);
      }
    }

    if (request.method === 'POST') {
      const action = request.parameters.action;

      switch (action) {
        case 'save-template':
          return saveTemplateToRecord(context);
        case 'generate-bfo':
          return generateBfoRecord(context);
        default:
          response.write(JSON.stringify({ error: 'Unknown action' }));
      }
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
      fontRegularUrl: script.getParameter({ name: 'custscript_pld_font_regular' }) || null,
      fontBoldUrl: script.getParameter({ name: 'custscript_pld_font_bold' }) || null,
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
    try {
      const recType = context.request.parameters.rectype;
      const recId = context.request.parameters.recid;

      if (!recType || !recId) {
        context.response.write(JSON.stringify({ error: 'Missing rectype or recid' }));
        return;
      }

      const rec = record.load({ type: recType, id: recId });
      const data = extractRecordData(rec, recType);

      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.write(JSON.stringify(data));

    } catch (e) {
      log.error({ title: 'loadRecordData', details: e });
      context.response.write(JSON.stringify({ error: e.message }));
    }
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
    try {
      data.company = companyConfig.load();
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
   *   - custrecord_pld_tpl_type (Text) — record type filter
   */
  function listSavedTemplates(context) {
    try {
      const recType = context.request.parameters.rectype || '';

      const filters = [
        ['isinactive', 'is', 'F'],
      ];
      if (recType) {
        filters.push('AND');
        filters.push(['custrecord_pld_tpl_type', 'is', recType]);
      }

      const results = [];
      search.create({
        type: 'customrecord_pld_template',
        filters: filters,
        columns: [
          'custrecord_pld_tpl_name',
          'custrecord_pld_tpl_type',
          'created',
          'lastmodified',
        ],
      }).run().each(function (result) {
        results.push({
          id: result.id,
          name: result.getValue('custrecord_pld_tpl_name'),
          type: result.getValue('custrecord_pld_tpl_type'),
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

  /**
   * Save template to custom record (POST).
   */
  function saveTemplateToRecord(context) {
    try {
      const body = JSON.parse(context.request.body);
      const templateId = body.id;
      const name = body.name;
      const data = body.data; // JSON string of template
      const recType = body.rectype || '';

      // XML is mandatory — the engine has no generator of its own, so a template
      // saved without XML can never render (#6, R4: no silent fallback).
      if (!body.xml) {
        throw new Error('Template XML is required. Export BFO XML from the designer and include it in the save payload (#6).');
      }

      let rec;
      if (templateId) {
        rec = record.load({ type: 'customrecord_pld_template', id: templateId });
      } else {
        rec = record.create({ type: 'customrecord_pld_template' });
      }

      // Built-in name is mandatory (custom record includeName=T) — set it too.
      rec.setValue({ fieldId: 'name', value: name || 'Untitled' });
      rec.setValue({ fieldId: 'custrecord_pld_tpl_name', value: name });
      rec.setValue({ fieldId: 'custrecord_pld_tpl_data', value: data });
      rec.setValue({ fieldId: 'custrecord_pld_tpl_xml', value: body.xml });
      if (recType) {
        rec.setValue({ fieldId: 'custrecord_pld_tpl_rectype', value: recType });
      }

      const savedId = rec.save();

      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.write(JSON.stringify({ id: savedId, success: true }));

    } catch (e) {
      log.error({ title: 'saveTemplateToRecord', details: e });
      context.response.write(JSON.stringify({ error: e.message }));
    }
  }

  // ═══════════════════════════════════════
  // BFO RECORD GENERATION
  // ═══════════════════════════════════════

  /**
   * Generate and save BFO XML as a File Cabinet file (POST).
   */
  function generateBfoRecord(context) {
    try {
      const body = JSON.parse(context.request.body);
      const xmlContent = body.xml;
      const fileName = body.filename || 'pld-template.xml';
      const folderId = body.folderId || APP_FOLDER_ID;

      const xmlFile = file.create({
        name: fileName,
        fileType: file.Type.XMLDOC,
        contents: xmlContent,
        folder: folderId,
      });

      const fileId = xmlFile.save();

      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.write(JSON.stringify({ fileId: fileId, success: true }));

    } catch (e) {
      log.error({ title: 'generateBfoRecord', details: e });
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

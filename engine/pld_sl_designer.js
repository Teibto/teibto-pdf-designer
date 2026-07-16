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
  'N/ui/serverWidget',
  'N/file',
  'N/runtime',
  'N/url',
  'N/search',
  'N/record',
  'N/log'
], function (serverWidget, file, runtime, url, search, record, log) {

  /**
   * File Cabinet folder ID where the built app files live.
   * Update this after uploading the dist/ folder.
   */
  const APP_FOLDER_ID = 0; // ← TODO: ใส่ Folder ID หลัง upload

  /**
   * Alternative: direct file IDs if known
   */
  const INDEX_FILE_ID = 0; // ← TODO: ใส่ File ID ของ index.html

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
   * Serve the SPA as an inline HTML page.
   * Approach A: Load index.html from File Cabinet
   * Approach B: Build the HTML with serverWidget
   */
  function serveApp(context) {
    try {
      // ─── Approach A: Serve index.html from File Cabinet ───
      if (INDEX_FILE_ID > 0) {
        const indexFile = file.load({ id: INDEX_FILE_ID });
        let htmlContent = indexFile.getContents();

        // Inject NetSuite context as global variable
        const nsContext = buildNsContext(context);
        const injection = '<script>window.__NS_CONTEXT__ = ' + JSON.stringify(nsContext) + ';</script>';
        htmlContent = htmlContent.replace('</head>', injection + '\n</head>');

        context.response.write(htmlContent);
        return;
      }

      // ─── Approach B: Use serverWidget inline HTML ───
      const form = serverWidget.createForm({
        title: 'PDF Layout Designer',
        hideNavBar: true,
      });

      const htmlField = form.addField({
        id: 'custpage_app',
        type: serverWidget.FieldType.INLINEHTML,
        label: 'App',
      });

      const nsContext = buildNsContext(context);
      const suiteletUrl = url.resolveScript({
        scriptId: runtime.getCurrentScript().id,
        deploymentId: runtime.getCurrentScript().deploymentId,
        returnExternalUrl: false,
      });

      // If APP_FOLDER_ID is set, build asset URLs from File Cabinet
      let appBaseUrl = '';
      if (APP_FOLDER_ID > 0) {
        appBaseUrl = getFileCabinetUrl(APP_FOLDER_ID);
      }

      htmlField.defaultValue = buildInlineHtml(nsContext, suiteletUrl, appBaseUrl);
      context.response.writePage(form);

    } catch (e) {
      log.error({ title: 'serveApp', details: e });
      context.response.write('<h2>Error loading PDF Layout Designer</h2><p>' + e.message + '</p>');
    }
  }

  // ═══════════════════════════════════════
  // NETSUITE CONTEXT
  // ═══════════════════════════════════════

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

    // ─── Company Info ───
    try {
      data.company = {
        name: runtime.getCurrentScript().getParameter({ name: 'custscript_pld_company_name' }) || '',
        address: runtime.getCurrentScript().getParameter({ name: 'custscript_pld_company_addr' }) || '',
        phone: runtime.getCurrentScript().getParameter({ name: 'custscript_pld_company_phone' }) || '',
        taxId: runtime.getCurrentScript().getParameter({ name: 'custscript_pld_company_taxid' }) || '',
      };
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

      let rec;
      if (templateId) {
        rec = record.load({ type: 'customrecord_pld_template', id: templateId });
      } else {
        rec = record.create({ type: 'customrecord_pld_template' });
      }

      rec.setValue({ fieldId: 'custrecord_pld_tpl_name', value: name });
      rec.setValue({ fieldId: 'custrecord_pld_tpl_data', value: data });
      if (recType) {
        rec.setValue({ fieldId: 'custrecord_pld_tpl_type', value: recType });
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

  function getFileCabinetUrl(folderId) {
    // Build URL to File Cabinet folder for static assets
    // This depends on your account's File Cabinet structure
    return '/site/hosting/scriptlet.nl?folder=' + folderId;
  }

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

  /**
   * Build inline HTML when not using File Cabinet index.html
   */
  function buildInlineHtml(nsContext, suiteletUrl, appBaseUrl) {
    return [
      '<!DOCTYPE html>',
      '<html lang="th">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>PDF Layout Designer</title>',
      '  <script>',
      '    window.__NS_CONTEXT__ = ' + JSON.stringify(nsContext) + ';',
      '    window.__NS_SUITELET_URL__ = "' + suiteletUrl + '";',
      '  </script>',
      '  <style>',
      '    body { margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
      '    .ns-loading { display: flex; align-items: center; justify-content: center; height: 100vh; background: #13141f; color: #8a8ca0; font-size: 14px; flex-direction: column; gap: 16px; }',
      '    .ns-loading .spinner { width: 40px; height: 40px; border: 3px solid #2d2e3f; border-top-color: #4f6ef7; border-radius: 50%; animation: spin 0.8s linear infinite; }',
      '    @keyframes spin { to { transform: rotate(360deg); } }',
      '  </style>',
      appBaseUrl ? '  <script type="module" src="' + appBaseUrl + '/assets/index.js"></script>' : '',
      appBaseUrl ? '  <link rel="stylesheet" href="' + appBaseUrl + '/assets/index.css">' : '',
      '</head>',
      '<body>',
      '  <div id="app">',
      '    <div class="ns-loading">',
      '      <div class="spinner"></div>',
      '      <span>Loading PDF Layout Designer...</span>',
      '    </div>',
      '  </div>',
      '  <pld-app-shell></pld-app-shell>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  return { onRequest: onRequest };
});

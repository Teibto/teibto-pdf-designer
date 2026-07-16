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
  'N/format'
], function (render, record, search, file, runtime, log, xml, format) {

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

    // ─── 1. Load Template ───
    var tplXml;
    if (tplId) {
      tplXml = loadTemplateXml(tplId);
    } else {
      // Find default template for this record type
      tplXml = findDefaultTemplateXml(recType);
    }

    if (!tplXml) {
      throw new Error('No template found. Please specify tplid or set a default template for ' + recType);
    }

    // ─── 2. Load Record ───
    var rec = record.load({
      type: recType,
      id: recId
    });

    // ─── 3. Build Renderer ───
    var renderer = render.create();
    renderer.templateContent = tplXml;

    // Add the main record (accessible as "record" in FreeMarker)
    renderer.addRecord({
      templateName: 'record',
      record: rec
    });

    // ─── 4. Add company info as custom data source ───
    var companyInfo = loadCompanyInfo();
    renderer.addCustomDataSource({
      format: render.DataSource.OBJECT,
      alias: 'company',
      data: companyInfo
    });

    // ─── 5. Add current date/user info ───
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

    // ─── 6. Render PDF ───
    var pdfFile = renderer.renderAsPdf();

    // ─── 7. Set filename ───
    var tranId = '';
    try { tranId = rec.getValue({ fieldId: 'tranid' }) || recId; } catch (e) { tranId = recId; }
    var fileName = recType + '_' + tranId + '.pdf';
    pdfFile.name = fileName;

    // ─── 8. Return PDF ───
    context.response.setHeader({
      name: 'Content-Type',
      value: 'application/pdf'
    });
    context.response.setHeader({
      name: 'Content-Disposition',
      value: (download ? 'attachment' : 'inline') + '; filename="' + fileName + '"'
    });
    context.response.writeFile({ file: pdfFile, isInline: !download });
  }

  // ═══════════════════════════════════════════════════
  // PREVIEW — Render with sample data
  // ═══════════════════════════════════════════════════

  function previewPdf(context) {
    var tplId = context.request.parameters.tplid;
    if (!tplId) throw new Error('Missing tplid for preview');

    var tplXml = loadTemplateXml(tplId);
    if (!tplXml) throw new Error('Template not found: ' + tplId);

    // Replace FreeMarker expressions with placeholder text for preview
    var previewXml = tplXml
      .replace(/\$\{record\.\w+(\.\w+)*\}/g, '[Sample Data]')
      .replace(/<#list[^>]*>/g, '')
      .replace(/<\/#list>/g, '');

    var renderer = render.create();
    renderer.templateContent = previewXml;

    var pdfFile = renderer.renderAsPdf();
    pdfFile.name = 'preview.pdf';

    context.response.setHeader({ name: 'Content-Type', value: 'application/pdf' });
    context.response.setHeader({ name: 'Content-Disposition', value: 'inline; filename="preview.pdf"' });
    context.response.writeFile({ file: pdfFile, isInline: true });
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
    var tplId = body.id;
    var rec;

    if (tplId) {
      rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });
    } else {
      rec = record.create({ type: TPL_RECORD_TYPE });
    }

    rec.setValue({ fieldId: TPL_FLD_NAME, value: body.name || 'Untitled' });

    if (body.data) {
      rec.setValue({ fieldId: TPL_FLD_DATA, value: body.data });
    }
    if (body.xml) {
      rec.setValue({ fieldId: TPL_FLD_XML, value: body.xml });
    }
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

  // ═══════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════

  /**
   * Load BFO XML from template custom record.
   */
  function loadTemplateXml(tplId) {
    try {
      var rec = record.load({ type: TPL_RECORD_TYPE, id: tplId });
      var xmlContent = rec.getValue({ fieldId: TPL_FLD_XML });

      if (xmlContent) return xmlContent;

      // Fallback: generate XML from designer JSON data
      var jsonData = rec.getValue({ fieldId: TPL_FLD_DATA });
      if (jsonData) {
        return generateXmlFromDesignerData(JSON.parse(jsonData));
      }

      return null;
    } catch (e) {
      log.error({ title: 'loadTemplateXml', details: e });
      return null;
    }
  }

  /**
   * Find default template for a record type.
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
    if (xmlContent) return xmlContent;

    var jsonData = results[0].getValue(TPL_FLD_DATA);
    if (jsonData) {
      return generateXmlFromDesignerData(JSON.parse(jsonData));
    }

    return null;
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
   * Generate BFO XML from designer JSON data (fallback).
   * Converts the canvas state into a proper BFO XML document
   * with FreeMarker syntax for N/render.
   */
  function generateXmlFromDesignerData(designerData) {
    var elements = designerData.elements || [];
    var page = designerData.page || { width: 595, height: 842, orientation: 'portrait' };

    // Group elements by role
    var grouped = {
      header: [],
      content: [],
      table: [],
      summary: [],
      footer: [],
      watermark: []
    };

    elements.forEach(function (el) {
      var role = el.role || 'content';
      if (grouped[role]) {
        grouped[role].push(el);
      } else {
        grouped.content.push(el);
      }
    });

    // Sort each group by Y position
    Object.keys(grouped).forEach(function (key) {
      grouped[key].sort(function (a, b) { return a.y - b.y; });
    });

    // Build XML
    var xmlParts = [];

    xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlParts.push('<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">');
    xmlParts.push('<pdf>');

    // ─── CSS ───
    xmlParts.push('<head>');
    xmlParts.push('<style type="text/css">');
    xmlParts.push('body { font-family: Tahoma, sans-serif; font-size: 10pt; color: #333; }');
    xmlParts.push('table { width: 100%; border-collapse: collapse; }');
    xmlParts.push('th { background-color: #e8eaf0; font-weight: bold; padding: 6px 8px; text-align: left; border-bottom: 1.5px solid #ccc; }');
    xmlParts.push('td { padding: 5px 8px; border-bottom: 0.5px solid #eee; }');
    xmlParts.push('tr.alt { background-color: #f9fafb; }');
    xmlParts.push('.header { font-size: 16pt; font-weight: bold; color: #111; margin-bottom: 8px; }');
    xmlParts.push('.label { font-size: 8pt; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }');
    xmlParts.push('.total-row td { font-weight: bold; border-top: 1.5px solid #333; }');
    xmlParts.push('.text-right { text-align: right; }');
    xmlParts.push('.text-center { text-align: center; }');
    xmlParts.push('.footer { font-size: 8pt; color: #888; text-align: center; margin-top: 12px; padding-top: 8px; border-top: 0.5px solid #ddd; }');
    xmlParts.push('</style>');
    xmlParts.push('</head>');

    // ─── BODY ───
    xmlParts.push('<body size="' + (page.size || 'A4') + '"' +
      (page.orientation === 'landscape' ? ' orientation="landscape"' : '') + '>');

    // Header elements
    grouped.header.forEach(function (el) {
      xmlParts.push(renderElementToXml(el, 'record'));
    });

    // Content elements
    grouped.content.forEach(function (el) {
      xmlParts.push(renderElementToXml(el, 'record'));
    });

    // Table elements
    grouped.table.forEach(function (el) {
      xmlParts.push(renderTableToXml(el, 'record'));
    });

    // Summary elements
    grouped.summary.forEach(function (el) {
      xmlParts.push(renderElementToXml(el, 'record'));
    });

    // Footer elements
    if (grouped.footer.length > 0) {
      xmlParts.push('<div class="footer">');
      grouped.footer.forEach(function (el) {
        xmlParts.push(renderElementToXml(el, 'record'));
      });
      xmlParts.push('</div>');
    }

    xmlParts.push('</body>');
    xmlParts.push('</pdf>');

    return xmlParts.join('\n');
  }

  /**
   * Render a single element to BFO XML with FreeMarker variables.
   */
  function renderElementToXml(el, recordAlias) {
    var binding = el.binding || '';
    var content = el.content || '';

    // Resolve binding → FreeMarker syntax
    if (binding) {
      content = '${' + recordAlias + '.' + binding + '}';
    } else if (content) {
      // Replace {{path}} → ${record.path}
      content = content.replace(/\{\{(.+?)\}\}/g, function (_, path) {
        return '${' + recordAlias + '.' + path.trim() + '}';
      });
    }

    switch (el.type) {
      case 'header':
        var styles = [];
        if (el.fontSize) styles.push('font-size: ' + el.fontSize + 'pt');
        if (el.fontWeight === 'bold') styles.push('font-weight: bold');
        if (el.color && el.color !== '#111111') styles.push('color: ' + el.color);
        if (el.textAlign) styles.push('text-align: ' + el.textAlign);
        return '<h2 style="' + styles.join('; ') + '">' + escapeXml(content) + '</h2>';

      case 'text':
        var styles = [];
        if (el.fontSize) styles.push('font-size: ' + el.fontSize + 'pt');
        if (el.fontWeight === 'bold') styles.push('font-weight: bold');
        if (el.color && el.color !== '#333333') styles.push('color: ' + el.color);
        if (el.textAlign) styles.push('text-align: ' + el.textAlign);
        return '<p style="' + styles.join('; ') + '">' + escapeXml(content) + '</p>';

      case 'image':
        var src = el.src || el.imageData || '';
        if (binding) src = '${' + recordAlias + '.' + binding + '}';
        return '<img src="' + escapeXml(src) + '" style="width: ' + el.w + 'px; height: ' + el.h + 'px;" />';

      case 'shape':
        var bg = el.bgColor || '#4f6ef7';
        var radius = el.borderRadius || 0;
        return '<div style="background: ' + bg + '; width: ' + el.w + 'px; height: ' + el.h + 'px;' +
          (radius > 0 ? ' border-radius: ' + radius + 'px;' : '') +
          (el.opacity < 1 ? ' opacity: ' + el.opacity + ';' : '') +
          '"> </div>';

      case 'line':
        var lineColor = el.lineColor || '#ccc';
        var lineWidth = el.lineWidth || 1;
        var lineStyle = el.lineStyle || 'solid';
        return '<hr style="border: none; border-top: ' + lineWidth + 'px ' + lineStyle + ' ' + lineColor + ';" />';

      case 'list':
        var items = el.items || [];
        var listTag = el.listStyle === 'number' ? 'ol' : 'ul';
        var listHtml = '<' + listTag + ' style="font-size: ' + (el.fontSize || 10) + 'pt;">';
        items.forEach(function (item) {
          listHtml += '<li>' + escapeXml(item) + '</li>';
        });
        listHtml += '</' + listTag + '>';
        return listHtml;

      default:
        return '<!-- unsupported: ' + el.type + ' -->';
    }
  }

  /**
   * Render a table element to BFO XML with FreeMarker <#list> loop.
   */
  function renderTableToXml(el, recordAlias) {
    var columns = el.columns || [];
    var binding = el.binding || 'item';

    if (columns.length === 0) return '<!-- table: no columns configured -->';

    var parts = [];
    parts.push('<table>');

    // ─── Header Row ───
    parts.push('<thead><tr>');
    columns.forEach(function (col) {
      if (col.hidden) return;
      var style = 'text-align: ' + (col.align || 'left') + ';';
      if (col.width) style += ' width: ' + col.width + 'px;';
      parts.push('<th style="' + style + '">' + escapeXml(col.label || col.key) + '</th>');
    });
    parts.push('</tr></thead>');

    // ─── Body with FreeMarker Loop ───
    parts.push('<tbody>');
    parts.push('<#list ' + recordAlias + '.' + binding + ' as line>');
    // FreeMarker has no C-style ternary — use ?then(whenTrue, whenFalse)
    parts.push('<tr class="${(line_index % 2 == 0)?then(\'\', \'alt\')}">');

    columns.forEach(function (col) {
      if (col.hidden) return;

      var style = 'text-align: ' + (col.align || 'left') + ';';
      if (col.bold) style += ' font-weight: bold;';

      var value;
      if (col.isIndex) {
        value = '${line_index + 1}';
      } else {
        value = '${line.' + col.key + '}';

        // Format based on column type
        if (col.format === 'number') {
          value = '${line.' + col.key + '?string["#,##0"]}';
        } else if (col.format === 'currency') {
          value = '${line.' + col.key + '?string["#,##0.00"]}';
        } else if (col.format === 'percent') {
          value = '${line.' + col.key + '?string["0.00"]}%';
        }
      }

      parts.push('<td style="' + style + '">' + value + '</td>');
    });

    parts.push('</tr>');
    parts.push('</#list>');
    parts.push('</tbody>');
    parts.push('</table>');

    return parts.join('\n');
  }

  /**
   * Load company info from script parameters or company record.
   */
  function loadCompanyInfo() {
    var script = runtime.getCurrentScript();

    return {
      name:    getScriptParam(script, 'custscript_pld_company_name') || '',
      address: getScriptParam(script, 'custscript_pld_company_addr') || '',
      phone:   getScriptParam(script, 'custscript_pld_company_phone') || '',
      taxId:   getScriptParam(script, 'custscript_pld_company_taxid') || '',
      email:   getScriptParam(script, 'custscript_pld_company_email') || '',
      logo:    getScriptParam(script, 'custscript_pld_company_logo') || ''
    };
  }

  function getScriptParam(script, paramId) {
    try {
      return script.getParameter({ name: paramId }) || '';
    } catch (e) {
      return '';
    }
  }

  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sendJson(context, data) {
    context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    context.response.write(JSON.stringify(data));
  }

  return { onRequest: onRequest };
});

/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — Transaction Buttons
 * Adds "Design PDF" and "Print PDF" buttons on supported transaction forms.
 * Print PDF opens the render Suitelet in a new tab.
 * Design PDF opens the designer Suitelet.
 *
 * @author Wichit Wongta
 */
define([
  'N/url',
  'N/runtime',
  'N/search',
  'N/log'
], function (url, runtime, search, log) {

  // ─── Script IDs (update after deployment) ───
  var DESIGNER_SCRIPT_ID = 'customscript_pld_designer';
  var DESIGNER_DEPLOY_ID = 'customdeploy_pld_designer';
  var RENDERER_SCRIPT_ID = 'customscript_pld_render';
  var RENDERER_DEPLOY_ID = 'customdeploy_pld_render';

  /**
   * Supported record types.
   */
  var SUPPORTED_TYPES = [
    'invoice',
    'salesorder',
    'purchaseorder',
    'estimate',
    'vendorbill',
    'cashsale',
    'itemfulfillment',
    'creditmemo',
    'returnauthorization',
    'customerpayment',
    'purchaserequisition'
  ];

  function beforeLoad(context) {
    // Only on View mode
    if (context.type !== context.UserEventType.VIEW) return;

    var recType = context.newRecord.type;
    if (SUPPORTED_TYPES.indexOf(recType) === -1) return;

    var recId = context.newRecord.id;

    try {
      // ─── Print PDF Button ───
      var renderUrl = url.resolveScript({
        scriptId: RENDERER_SCRIPT_ID,
        deploymentId: RENDERER_DEPLOY_ID,
        params: {
          action: 'render',
          rectype: recType,
          recid: recId
        }
      });

      context.form.addButton({
        id: 'custpage_pld_print',
        label: 'Print PDF',
        functionName: 'window.open("' + renderUrl + '", "_blank")'
      });

      // ─── Print PDF (Download) ───
      var downloadUrl = renderUrl + '&download=T';
      context.form.addButton({
        id: 'custpage_pld_download',
        label: 'Download PDF',
        functionName: 'window.open("' + downloadUrl + '")'
      });

      // ─── Design PDF Button ───
      var designerUrl = url.resolveScript({
        scriptId: DESIGNER_SCRIPT_ID,
        deploymentId: DESIGNER_DEPLOY_ID,
        params: {
          rectype: recType,
          recid: recId
        }
      });

      context.form.addButton({
        id: 'custpage_pld_design',
        label: 'Design PDF',
        functionName: 'window.open("' + designerUrl + '", "pld_designer", "width=1440,height=900,menubar=no,toolbar=no")'
      });

      // ─── Template Selector (if multiple templates) ───
      var templates = findTemplatesForType(recType);
      if (templates.length > 1) {
        addTemplateSelector(context, templates, recType, recId);
      }

    } catch (e) {
      log.debug({ title: 'PLD UE beforeLoad', details: e.message });
    }
  }

  /**
   * Find all templates for a given record type.
   */
  function findTemplatesForType(recType) {
    var results = [];

    try {
      search.create({
        type: 'customrecord_pld_template',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['custrecord_pld_tpl_rectype', 'is', recType]
        ],
        columns: [
          'custrecord_pld_tpl_name',
          'custrecord_pld_tpl_default'
        ]
      }).run().each(function (row) {
        results.push({
          id: row.id,
          name: row.getValue('custrecord_pld_tpl_name'),
          isDefault: row.getValue('custrecord_pld_tpl_default')
        });
        return true;
      });
    } catch (e) {
      log.debug({ title: 'findTemplatesForType', details: e.message });
    }

    return results;
  }

  /**
   * Add a template selector field when multiple templates exist.
   */
  function addTemplateSelector(context, templates, recType, recId) {
    var form = context.form;

    var selectField = form.addField({
      id: 'custpage_pld_tpl_select',
      type: 'select',
      label: 'PDF Template',
      container: 'main'
    });
    selectField.updateLayoutType({ layoutType: 'outsidebelow' });

    selectField.addSelectOption({ value: '', text: '— Default —' });
    templates.forEach(function (tpl) {
      selectField.addSelectOption({
        value: tpl.id,
        text: tpl.name + (tpl.isDefault ? ' ★' : '')
      });
    });

    var rendererBase = url.resolveScript({
      scriptId: RENDERER_SCRIPT_ID,
      deploymentId: RENDERER_DEPLOY_ID,
      params: {
        action: 'render',
        rectype: recType,
        recid: recId
      }
    });

    var clientJs = [
      'function pldPrintSelected() {',
      '  var sel = document.getElementById("custpage_pld_tpl_select");',
      '  var tplId = sel ? sel.value : "";',
      '  var baseUrl = "' + rendererBase + '";',
      '  if (tplId) baseUrl += "&tplid=" + tplId;',
      '  window.open(baseUrl, "_blank");',
      '}',
    ].join('\n');

    var scriptField = form.addField({
      id: 'custpage_pld_script',
      type: 'inlinehtml',
      label: ' '
    });
    scriptField.defaultValue = '<script>' + clientJs + '</script>';

    form.addButton({
      id: 'custpage_pld_print_selected',
      label: 'Print Selected Template',
      functionName: 'pldPrintSelected()'
    });
  }

  return { beforeLoad: beforeLoad };
});

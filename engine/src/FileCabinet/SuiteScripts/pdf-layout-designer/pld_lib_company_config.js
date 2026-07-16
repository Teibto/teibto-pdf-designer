/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — Company Config loader
 * แหล่งเดียวของค่า ${company.*}: custom record customrecord_pld_config (#9)
 * ใช้ร่วมกันทั้ง render และ designer Suitelet — ห้ามมี loader ชุดที่สอง
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
define(['N/search', 'N/log'], function (search, log) {

  var CFG_RECORD_TYPE = 'customrecord_pld_config';

  // alias ใน template (company.*) → field บน config record
  var CFG_FIELD_MAP = {
    name:        'custrecord_pld_cfg_name',
    nameEn:      'custrecord_pld_cfg_name_en',
    address:     'custrecord_pld_cfg_address',
    addressEn:   'custrecord_pld_cfg_address_en',
    phone:       'custrecord_pld_cfg_phone',
    email:       'custrecord_pld_cfg_email',
    taxId:       'custrecord_pld_cfg_taxid',
    branch:      'custrecord_pld_cfg_branch',
    logo:        'custrecord_pld_cfg_logo_url',
    themeColor:  'custrecord_pld_cfg_theme_color',
    fontRegular: 'custrecord_pld_cfg_font_regular',
    fontBold:    'custrecord_pld_cfg_font_bold',
    flags:       'custrecord_pld_cfg_flags'
  };

  /**
   * Load company config from the first active customrecord_pld_config.
   * ไม่มี config → คืนค่าว่างทุก key (binding null-safe ทำให้ render ต่อได้)
   * พร้อม audit log บอกสาเหตุ — ไม่ silent
   */
  function load() {
    var info = {};
    Object.keys(CFG_FIELD_MAP).forEach(function (alias) { info[alias] = ''; });

    var results = search.create({
      type: CFG_RECORD_TYPE,
      filters: [['isinactive', 'is', 'F']],
      columns: Object.keys(CFG_FIELD_MAP).map(function (alias) { return CFG_FIELD_MAP[alias]; })
    }).run().getRange({ start: 0, end: 1 });

    if (results.length === 0) {
      log.audit({
        title: 'PLD company config missing',
        details: 'No active ' + CFG_RECORD_TYPE + ' record — all ${company.*} values render empty. Create one per DEPLOYMENT.md §Company Config.'
      });
      return info;
    }

    Object.keys(CFG_FIELD_MAP).forEach(function (alias) {
      info[alias] = results[0].getValue(CFG_FIELD_MAP[alias]) || '';
    });

    return info;
  }

  return { load: load };
});

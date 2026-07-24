/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — Company Config loader
 * แหล่งเดียวของค่า ${company.*}: custom record customrecord_pld_config (#9)
 * ใช้ร่วมกันทั้ง render และ designer Suitelet — ห้ามมี loader ชุดที่สอง
 *
 * Subsidiary scoping (OneWorld, issue #144): load(subsidiaryId) เลือก config
 * ตามลำดับ (1) active record ที่ custrecord_pld_cfg_subsidiary == subsidiaryId
 * (2) active record ที่ subsidiary ว่าง (global fallback) (3) active record
 * แรกสุด (legacy/single-subsidiary — คงพฤติกรรมเดิมไว้)
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
define(['N/search', 'N/log'], function (search, log) {

  var CFG_RECORD_TYPE = 'customrecord_pld_config';
  var SUBSIDIARY_FIELD = 'custrecord_pld_cfg_subsidiary';

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

  var CFG_COLUMNS = Object.keys(CFG_FIELD_MAP).map(function (alias) { return CFG_FIELD_MAP[alias]; })
    .concat([SUBSIDIARY_FIELD]);

  /**
   * Load active customrecord_pld_config rows (columns + subsidiary), no subsidiary filter.
   * แยกออกมาเพื่อให้ทั้ง 3 ลำดับ fallback ใช้ผลค้นหาเดียวกัน (governance-friendly)
   */
  function loadAllActive() {
    return search.create({
      type: CFG_RECORD_TYPE,
      filters: [['isinactive', 'is', 'F']],
      columns: CFG_COLUMNS
    }).run().getRange({ start: 0, end: 1000 });
  }

  function toInfo(resultRow) {
    var info = {};
    Object.keys(CFG_FIELD_MAP).forEach(function (alias) {
      info[alias] = resultRow.getValue(CFG_FIELD_MAP[alias]) || '';
    });
    return info;
  }

  /**
   * Load company config, scoped by subsidiary (OneWorld, issue #144).
   *
   * @param {string|number} [subsidiaryId] - subsidiary internal id ของ transaction
   *   ที่กำลัง render; ไม่ระบุ (undefined) = ไม่มี record context (เช่น sample/preview)
   *   → ใช้ global fallback แล้วตกไปที่ record แรกสุด
   * ไม่มี config ที่ match เลย → คืนค่าว่างทุก key (binding null-safe ทำให้ render ต่อได้)
   * พร้อม audit log บอกสาเหตุ — ไม่ silent
   */
  function load(subsidiaryId) {
    var info = {};
    Object.keys(CFG_FIELD_MAP).forEach(function (alias) { info[alias] = ''; });

    var results = loadAllActive();

    if (results.length === 0) {
      log.audit({
        title: 'PLD company config missing',
        details: 'No active ' + CFG_RECORD_TYPE + ' record — all ${company.*} values render empty. Create one per DEPLOYMENT.md §Company Config.'
      });
      return info;
    }

    var matched = null;

    if (subsidiaryId !== undefined && subsidiaryId !== null && subsidiaryId !== '') {
      for (var i = 0; i < results.length; i++) {
        var rowSubsidiary = results[i].getValue(SUBSIDIARY_FIELD);
        if (rowSubsidiary && String(rowSubsidiary) === String(subsidiaryId)) {
          matched = results[i];
          break;
        }
      }
    }

    if (!matched) {
      for (var j = 0; j < results.length; j++) {
        var globalSubsidiary = results[j].getValue(SUBSIDIARY_FIELD);
        if (!globalSubsidiary) {
          matched = results[j];
          break;
        }
      }
    }

    if (!matched) {
      matched = results[0];
    }

    return toInfo(matched);
  }

  return { load: load };
});

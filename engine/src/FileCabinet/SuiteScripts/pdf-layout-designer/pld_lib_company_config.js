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
 * แรกสุด เฉพาะเมื่อไม่มี subsidiary context (legacy/single-subsidiary)
 *
 * @author Wichit Wongta
 * @since 2026-07-17
 */
define(['N/search', 'N/file', 'N/log'], function (search, file, log) {

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

  // ── File Cabinet URL ที่ไม่หมดอายุ (#167) ───────────────────────────────────
  // URL ของ File Cabinet มี token `h=` ที่เปลี่ยนทุกครั้งที่ไฟล์ถูก re-save — และ
  // "re-save" รวมถึงการ deploy engine ทับด้วย ดังนั้น config ที่เก็บ URL ดิบจะกลายเป็น
  // ของเก่าเงียบ ๆ แล้ว BFO โหลดฟอนต์/โลโก้ไม่ได้ (ไม่ error, glyph ไทยหายทั้งใบ).
  //
  // ทางแก้: เก็บ **file id** ใน config แล้ว resolve URL สดตอน render — และถ้า config
  // ยังเก็บ URL แบบเดิม ก็ดึง id ออกจาก URL นั้นมา resolve ใหม่ให้ ผู้ดูแลไม่ต้องแก้อะไร
  // ค่าที่ไม่ใช่ทั้ง id และ File Cabinet URL (เช่น CDN ภายนอก) ใช้ตามที่ตั้งไว้
  var FILE_URL_ALIASES = { fontRegular: true, fontBold: true, logo: true };
  var URL_FILE_ID = /[?&]id=(\d+)/;
  // per-execution cache: หนึ่ง render อ่าน config ซ้ำหลายรอบ (copy set ยิง load() ต่อชุด)
  var urlCache = {};

  function fileUrlById(fileId) {
    if (Object.prototype.hasOwnProperty.call(urlCache, fileId)) return urlCache[fileId];
    var url = file.load({ id: fileId }).url;
    if (typeof url !== 'string' || !url.trim()) throw new Error('File has no usable URL');
    urlCache[fileId] = url;
    return url;
  }

  function configError(code, message) {
    var error = new Error(code + ': ' + message);
    error.name = code;
    return error;
  }

  function resolveFileUrl(raw, alias, forRender) {
    var value = String(raw == null ? '' : raw).trim();
    var required = forRender && (alias === 'fontRegular' || alias === 'fontBold');
    if (!value) {
      if (required) throw configError('PLD_FONT_MISSING', 'ตั้งค่าฟอนต์ไทย ' + alias + ' ใน Company Config ก่อนพิมพ์ / Configure the required Thai font in Company Config.');
      return '';
    }

    var isCabinetUrl = /^(?:https:\/\/[^/]+)?\/core\/media\/media\.nl\?/i.test(value);
    var fileId = /^\d+$/.test(value) ? value : (isCabinetUrl ? (value.match(URL_FILE_ID) || [])[1] : null);
    if (!fileId) {
      if (required) throw configError('PLD_FONT_UNRESOLVED', 'ฟอนต์ไทย ' + alias + ' ต้องใช้ File Cabinet file ID หรือ URL / Configure a File Cabinet font ID or URL.');
      return value;
    }

    try {
      return fileUrlById(fileId);
    } catch (e) {
      if (required) throw configError('PLD_FONT_UNRESOLVED', 'โหลดฟอนต์ไทย ' + alias + ' ไม่ได้ (file ID ' + fileId + ') / Check the font file and its permissions in Company Config.');
      log.audit({
        title: 'PLD config file url unresolved',
        details: alias + ': file id ' + fileId + ' โหลดไม่ได้ (' + ((e && e.message) || e) +
          ') — ตรวจสอบไฟล์ใน Company Config'
      });
      // Setup can inspect the original value; an optional broken logo is omitted on render.
      return forRender ? '' : value;
    }
  }

  function toInfo(resultRow, forRender) {
    var info = {};
    Object.keys(CFG_FIELD_MAP).forEach(function (alias) {
      var raw = resultRow.getValue(CFG_FIELD_MAP[alias]) || '';
      info[alias] = FILE_URL_ALIASES[alias] ? resolveFileUrl(raw, alias, forRender) : raw;
    });
    return info;
  }

  /**
   * Load company config, scoped by subsidiary (OneWorld, issue #144).
   *
   * @param {string|number} [subsidiaryId] - subsidiary internal id ของ transaction
   *   ที่กำลัง render; ไม่ระบุ (undefined) = ไม่มี record context (เช่น sample/preview)
   *   → ใช้ global fallback แล้วตกไปที่ record แรกสุด
   * @param {Object} [options] - { forRender: true } enforces config and Thai fonts
   *   even in single-subsidiary accounts without a subsidiary field. A supplied
   *   subsidiary always enforces these requirements. load(undefined) is setup inspection.
   */
  function load(subsidiaryId, options) {
    var hasSubsidiary = subsidiaryId !== undefined && subsidiaryId !== null && subsidiaryId !== '';
    var forRender = hasSubsidiary || !!(options && options.forRender);
    var info = {};
    Object.keys(CFG_FIELD_MAP).forEach(function (alias) { info[alias] = ''; });

    var results = loadAllActive();

    if (results.length === 0) {
      if (forRender) throw configError('PLD_COMPANY_CONFIG_MISSING', 'ไม่พบ Company Config ที่ใช้งานอยู่ / Create an active Company Config before printing.');
      log.audit({
        title: 'PLD company config missing',
        details: 'No active ' + CFG_RECORD_TYPE + ' record — all ${company.*} values render empty. Create one per DEPLOYMENT.md §Company Config.'
      });
      return info;
    }

    var matched = null;

    if (hasSubsidiary) {
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
      if (hasSubsidiary) throw configError('PLD_COMPANY_CONFIG_MISSING', 'ไม่พบ Company Config สำหรับ subsidiary ' + subsidiaryId + ' / Configure this subsidiary or an explicit global default before printing.');
      matched = results[0];
    }

    return toInfo(matched, forRender);
  }

  return { load: load };
});

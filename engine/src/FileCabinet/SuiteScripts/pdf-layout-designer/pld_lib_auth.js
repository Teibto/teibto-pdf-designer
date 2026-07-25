/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — สิทธิ์แก้ไข template (#189)
 *
 * ทั้ง 3 Suitelet ของ product นี้ deploy ด้วย `allroles=T` + `runasrole=ADMINISTRATOR`
 * เพราะการ **พิมพ์** ต้องอ่าน transaction/ฟอนต์/config ข้าม subsidiary ได้ — ผลข้างเคียงคือ
 * สิทธิ์ระดับ record ของ NetSuite ไม่ได้กันอะไรไว้เลย ใครที่ login ได้ก็ยิง `?action=save`
 * ทับ template ที่ทั้ง account ใช้ออกใบกำกับภาษีได้ ไฟล์นี้จึงเป็น**ด่านเดียว**ที่แยก
 * "คนพิมพ์เอกสาร" (ทุกคน) ออกจาก "คนแก้ template" (เฉพาะ role ที่ระบุไว้).
 *
 * กติกา:
 * - allowlist มาจาก field `custrecord_pld_cfg_editor_roles` บน config record —
 *   union ของทุก record ที่ active เพราะ template เป็นของ **ทั้ง account** ไม่ได้ผูก
 *   subsidiary (customrecord_pld_template ไม่มี field subsidiary) การอ่านแบบ 3-tier
 *   เหมือน company config จึงให้คำตอบที่ไม่ตรงกับสิ่งที่ถูกคุ้มครอง
 * - Administrator (role id 3 ทุก account) อนุญาตเสมอ — กัน account ล็อกตัวเองออก
 * - **fail closed**: config ว่าง อ่านไม่ได้ หรือ field ยังไม่ถูก deploy = อนุญาตเฉพาะ
 *   Administrator พร้อม log บอกสาเหตุ ไม่มีทางที่ config ผิดแล้วเปิดให้ทุก role (R4 —
 *   ผิดพลาดแล้วต้องเห็น ไม่ใช่เงียบแล้วปล่อยผ่าน)
 *
 * ข้อจำกัดที่ unit test พิสูจน์ไม่ได้ (บทเรียนเดียวกับ #174): ค่าที่ใช้ตัดสินคือ
 * `runtime.getCurrentUser().role` ซึ่ง **ต้องยืนยันสดบน account** ว่าเป็น role ของผู้ใช้จริง
 * ไม่ใช่ role ที่ deployment ตั้ง run-as ไว้ — ทุกการตัดสินจึงเขียน roleId ลง log.audit
 * ให้ตรวจได้จาก Script Execution Log ตรง ๆ (ดู docs/RUNBOOK.md)
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
define(['N/runtime', 'N/search', 'N/log'], function (runtime, search, log) {

  /** Administrator — internal id คงที่ทุก account ของ NetSuite */
  var ADMIN_ROLE_ID = '3';

  var CFG_RECORD_TYPE = 'customrecord_pld_config';
  var CFG_EDITOR_ROLES = 'custrecord_pld_cfg_editor_roles';

  /**
   * Cache ต่อ execution เดียว — หนึ่ง request ถาม allowlist ได้หลายรอบ
   * (gate + context ของ SPA) ไม่ควรจ่าย search ซ้ำ
   */
  var roleCache = null;

  /**
   * ผู้ใช้ที่กำลังยิง request — id/name ใช้ได้ตรง ๆ (path เดียวกับ telemetry #149)
   * ส่วน role คือค่าที่ต้องยืนยันสดตามหมายเหตุหัวไฟล์
   */
  function currentActor() {
    var user = {};
    try { user = runtime.getCurrentUser() || {}; } catch (e) { user = {}; }
    return {
      userId: user.id == null ? '' : String(user.id),
      userName: user.name || '',
      roleId: user.role == null ? '' : String(user.role)
    };
  }

  /**
   * role ids ที่แก้ template ได้ — Administrator + ค่าที่ตั้งไว้ใน config
   * รับได้ทั้ง "1017,1042" และ "1017 1042" (คนกรอกใส่ตัวคั่นอะไรก็ได้)
   */
  function editorRoleIds() {
    if (roleCache) return roleCache;

    var ids = {};
    ids[ADMIN_ROLE_ID] = true;

    var rows;
    try {
      rows = search.create({
        type: CFG_RECORD_TYPE,
        filters: [['isinactive', 'is', 'F']],
        columns: [CFG_EDITOR_ROLES]
      }).run().getRange({ start: 0, end: 1000 });
    } catch (e) {
      // field ยังไม่ถูก deploy หรือ config record หาย → เหลือ Administrator อย่างเดียว
      // (fail closed) แต่ห้ามเงียบ: ผู้ดูแลต้องเห็นว่าทำไม role ที่เคยแก้ได้ถึงแก้ไม่ได้
      log.error({
        title: 'PLD editor roles unreadable',
        details: 'อ่าน ' + CFG_EDITOR_ROLES + ' จาก ' + CFG_RECORD_TYPE + ' ไม่ได้ (' +
          ((e && e.message) || e) + ') — อนุญาตเฉพาะ Administrator จนกว่าจะแก้ config ' +
          '(deploy object ชุดล่าสุดแล้วตั้งค่าตาม engine/DEPLOYMENT.md §Template Governance)'
      });
      roleCache = ids;
      return ids;
    }

    var configured = 0;
    for (var i = 0; i < rows.length; i++) {
      String(rows[i].getValue(CFG_EDITOR_ROLES) || '')
        .split(/[^0-9]+/)
        .forEach(function (token) {
          if (token) { ids[token] = true; configured += 1; }
        });
    }

    if (configured === 0) {
      log.audit({
        title: 'PLD editor roles not configured',
        details: 'ไม่มี role ใดถูกตั้งใน ' + CFG_EDITOR_ROLES + ' — แก้ template ได้เฉพาะ ' +
          'Administrator (role ' + ADMIN_ROLE_ID + ') ตามค่าตั้งต้นแบบ fail-closed'
      });
    }

    roleCache = ids;
    return ids;
  }

  /** ผู้ใช้ปัจจุบันแก้ template ได้ไหม */
  function canEditTemplates() {
    var actor = currentActor();
    if (!actor.roleId) return false; // ไม่รู้ว่าเป็น role ไหน = ไม่ให้เขียน
    return editorRoleIds()[actor.roleId] === true;
  }

  /**
   * ด่านของทุก write action — ผ่านแล้วเงียบ ไม่ผ่านโยน error ที่ติดธง `pldDenied`
   * ให้ Suitelet ตอบเป็นคำปฏิเสธ (ไม่ใช่หน้า "สร้าง PDF ไม่สำเร็จ") · ทั้งผ่านและไม่ผ่าน
   * เขียน log.audit หนึ่งบรรทัดพร้อม roleId — เป็นทั้ง audit trail และเครื่องมือยืนยัน
   * ว่า role ที่ engine เห็นคือ role จริงของผู้ใช้
   *
   * @param {string} action - ชื่อ action ที่กำลังจะทำ (save / delete / rollback)
   * @param {Object} [detail] - context เพิ่ม เช่น { tplid: '19' }
   * @returns {Object} actor ที่ผ่านด่าน
   */
  function assertCanEditTemplates(action, detail) {
    var actor = currentActor();
    var allowed = actor.roleId ? editorRoleIds()[actor.roleId] === true : false;

    var entry = {
      action: action,
      allowed: allowed,
      userId: actor.userId,
      userName: actor.userName,
      roleId: actor.roleId
    };
    if (detail) {
      for (var k in detail) { if (detail.hasOwnProperty(k)) entry[k] = detail[k]; }
    }

    if (allowed) {
      log.audit({ title: 'PLD template write allowed', details: entry });
      return actor;
    }

    log.audit({ title: 'PLD template write denied', details: entry });

    var err = new Error(
      'บทบาทของคุณไม่มีสิทธิ์แก้ไขเทมเพลตเอกสาร (role ' + (actor.roleId || 'ไม่ทราบ') + ') — ' +
      'ดูเอกสารได้แต่บันทึกไม่ได้ · ให้ผู้ดูแลระบบเพิ่ม role นี้ในช่อง "Template Editor Roles" ' +
      'ของ PLD Company Config ถ้าต้องการให้แก้ไขได้'
    );
    err.name = 'PLD_PERMISSION_DENIED';
    err.pldDenied = true;
    err.pldActor = actor;
    throw err;
  }

  /** ใช้ในเทสเท่านั้น — ล้าง cache ระหว่างเคส (ของจริงตายไปพร้อม execution) */
  function resetCache() { roleCache = null; }

  return {
    ADMIN_ROLE_ID: ADMIN_ROLE_ID,
    CFG_EDITOR_ROLES: CFG_EDITOR_ROLES,
    currentActor: currentActor,
    canEditTemplates: canEditTemplates,
    assertCanEditTemplates: assertCanEditTemplates,
    resetCache: resetCache
  };
});

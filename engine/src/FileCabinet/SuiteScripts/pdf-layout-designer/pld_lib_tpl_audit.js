/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — ประวัติเวอร์ชัน + audit trail ของ template (#189)
 *
 * เดิม `save` เขียนทับ `custrecord_pld_tpl_xml` ตรง ๆ ของเดิมหายถาวร (system notes
 * ไม่เก็บค่าของ field ชนิด CLOBTEXT) และไม่มี log ของการเขียนเลย — template ที่ออก
 * ใบกำกับภาษีของทั้ง account จึงถูกแก้หรือลบได้โดยไม่มีทั้งร่องรอยและทางถอยกลับ.
 *
 * ไฟล์นี้ทำสองอย่างพร้อมกันบนข้อมูลชุดเดียว:
 * - **กู้คืนได้** — ทุก write ทิ้ง snapshot ของ XML + designer JSON ไว้ใน
 *   `customrecord_pld_tpl_version` (immutable, เลขเวอร์ชันเดินหน้าทีละ 1 ต่อ template)
 * - **ตรวจสอบได้** — แถวเดียวกันนั้นบันทึกว่าใคร role ไหน ทำอะไร เมื่อไหร่ คู่กับ
 *   `log.audit` หนึ่งบรรทัดต่อการเขียนหนึ่งครั้ง
 *
 * ที่เก็บกับที่ตรวจสอบมีอายุไม่เท่ากันโดยตั้งใจ: payload (XML/JSON) เก็บแค่
 * `PAYLOAD_KEEP` เวอร์ชันล่าสุดต่อ template เพราะ CLOBTEXT ก้อนละหลายสิบ KB × การกด
 * save ทุกครั้งของนักออกแบบ = ข้อมูลบน account ลูกค้าโตไม่มีเพดาน · **แถว audit ไม่เคยถูกลบ**
 * เวอร์ชันเก่าจึงยังตอบได้ว่าใครแก้เมื่อไหร่ เพียงแต่กู้เนื้อกลับไม่ได้ และการ rollback
 * ไปเวอร์ชันที่ถูกตัด payload แล้วต้อง error ให้เห็น ไม่ใช่คืน XML ว่าง (R4)
 *
 * template id เก็บเป็น **ตัวเลขธรรมดา** ไม่ใช่ List/Record — ประวัติต้องรอดจากการลบ
 * template ทิ้ง (เกณฑ์ข้อ 7 ของ #189) ซึ่ง field แบบ List/Record ทำไม่ได้
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
define(['N/record', 'N/search', 'N/log', './pld_lib_auth'], function (record, search, log, auth) {

  var VER = {
    TYPE:     'customrecord_pld_tpl_version',
    TPLID:    'custrecord_pld_ver_tplid',
    NO:       'custrecord_pld_ver_no',
    ACTION:   'custrecord_pld_ver_action',
    NAME:     'custrecord_pld_ver_name',
    RECTYPE:  'custrecord_pld_ver_rectype',
    USERID:   'custrecord_pld_ver_userid',
    USERNAME: 'custrecord_pld_ver_username',
    ROLEID:   'custrecord_pld_ver_roleid',
    XML:      'custrecord_pld_ver_xml',
    DATA:     'custrecord_pld_ver_data',
    NOTE:     'custrecord_pld_ver_note',
    PRUNED:   'custrecord_pld_ver_pruned'
  };

  /** จำนวนเวอร์ชันล่าสุดต่อ template ที่ยังเก็บเนื้อ XML/JSON ไว้ให้กู้คืนได้ */
  var PAYLOAD_KEEP = 20;

  /**
   * action ที่ยอมรับ — สะกดผิดแล้วประวัติจะกรองไม่เจอ จึงบังคับที่ชั้นนี้
   * `baseline` = สถานะที่อยู่บน record อยู่ก่อนแล้วตอนเริ่มเก็บประวัติ (ไม่มีใครเพิ่งแก้)
   */
  var ACTIONS = { create: true, update: true, rollback: true, 'delete': true, baseline: true };

  // ═══════════════════════════════════════════════════
  // อ่านประวัติ
  // ═══════════════════════════════════════════════════

  /**
   * แถวเวอร์ชันของ template หนึ่งตัว เรียงจากใหม่ไปเก่า
   * @param {string|number} tplId
   * @param {Array<string>} columns - field ที่ต้องการ (payload ไม่ควรติดมาถ้าไม่ใช้)
   * @param {number} [limit]
   */
  function versionRows(tplId, columns, limit) {
    // เลขเวอร์ชันเป็นคอลัมน์แรกเสมอและเป็นตัวเรียง — ผู้เรียกไม่ต้องรู้ลำดับคอลัมน์
    var cols = [search.createColumn({ name: VER.NO, sort: search.Sort.DESC })];
    columns.forEach(function (name) {
      if (name !== VER.NO) cols.push(search.createColumn({ name: name }));
    });

    return search.create({
      type: VER.TYPE,
      filters: [[VER.TPLID, 'equalto', tplId]],
      columns: cols
    }).run().getRange({ start: 0, end: limit || 1000 });
  }

  /** เลขเวอร์ชันล่าสุดของ template (0 = ยังไม่เคยมีประวัติ) */
  function latestVersionNo(tplId) {
    var rows = versionRows(tplId, [VER.NO], 1);
    if (rows.length === 0) return 0;
    return parseInt(rows[0].getValue(VER.NO), 10) || 0;
  }

  /**
   * ประวัติสำหรับแสดงผล — metadata ล้วน ไม่ดึง CLOBTEXT ติดมาด้วย
   * (`hasPayload` บอกว่าเวอร์ชันนั้นยังกู้คืนได้ไหม)
   */
  function history(tplId, limit) {
    var rows = versionRows(tplId, [
      VER.NO, VER.ACTION, VER.NAME, VER.RECTYPE,
      VER.USERID, VER.USERNAME, VER.ROLEID, VER.NOTE, VER.PRUNED, 'created'
    ], limit || 100);

    return rows.map(function (row) {
      return {
        id: row.id,
        version: parseInt(row.getValue(VER.NO), 10) || 0,
        action: row.getValue(VER.ACTION) || '',
        name: row.getValue(VER.NAME) || '',
        rectype: row.getValue(VER.RECTYPE) || '',
        userId: row.getValue(VER.USERID) || '',
        userName: row.getValue(VER.USERNAME) || '',
        roleId: row.getValue(VER.ROLEID) || '',
        note: row.getValue(VER.NOTE) || '',
        hasPayload: row.getValue(VER.PRUNED) !== true && row.getValue(VER.PRUNED) !== 'T',
        created: row.getValue('created') || ''
      };
    });
  }

  /**
   * เนื้อของเวอร์ชันหนึ่ง สำหรับ rollback
   * ไม่มีเวอร์ชันนั้น หรือ payload ถูกตัดไปแล้ว = error ที่ผู้ใช้อ่านรู้เรื่อง (R4)
   *
   * ค้นหาแถวด้วย search แต่ **อ่านเนื้อด้วย `record.load`** — ผลลัพธ์ของ saved search
   * ตัดค่าของ field ยาวได้ ส่วน `record.load().getValue()` คืนค่าเต็มเสมอ; XML ที่ขาดครึ่ง
   * จะ render ไม่ออกหรือ (แย่กว่า) ออกมาไม่ครบหน้า ซึ่งไม่ควรเกิดจากปุ่มกู้คืน
   */
  function readVersion(tplId, versionNo) {
    var want = parseInt(versionNo, 10);
    if (!want || want < 1) throw new Error('เลขเวอร์ชันไม่ถูกต้อง: ' + versionNo);

    var rows = versionRows(tplId, [VER.NO, VER.PRUNED]);
    var hit = null;
    for (var i = 0; i < rows.length; i++) {
      if ((parseInt(rows[i].getValue(VER.NO), 10) || 0) === want) { hit = rows[i]; break; }
    }

    if (!hit) {
      throw new Error('ไม่พบเวอร์ชัน ' + want + ' ของเทมเพลต ' + tplId + ' ในประวัติ');
    }

    var pruned = hit.getValue(VER.PRUNED);
    var rec = pruned === true || pruned === 'T' ? null : record.load({ type: VER.TYPE, id: hit.id });
    var xmlContent = rec ? (rec.getValue({ fieldId: VER.XML }) || '') : '';

    if (!xmlContent) {
      throw new Error(
        'เวอร์ชัน ' + want + ' ของเทมเพลต ' + tplId + ' ไม่มีเนื้อไฟล์ให้กู้คืนแล้ว — ' +
        'ระบบเก็บเนื้อไฟล์ไว้ ' + PAYLOAD_KEEP + ' เวอร์ชันล่าสุดต่อเทมเพลต ' +
        'ประวัติการแก้ไขยังอยู่ครบแต่ย้อนกลับไปเวอร์ชันนี้ไม่ได้ (#189)'
      );
    }

    return {
      version: want,
      name: rec.getValue({ fieldId: VER.NAME }) || '',
      rectype: rec.getValue({ fieldId: VER.RECTYPE }) || '',
      xml: xmlContent,
      data: rec.getValue({ fieldId: VER.DATA }) || ''
    };
  }

  // ═══════════════════════════════════════════════════
  // เขียนประวัติ
  // ═══════════════════════════════════════════════════

  /**
   * บันทึก snapshot หนึ่งเวอร์ชัน แล้วตัด payload ของเวอร์ชันที่เกินโควตา
   *
   * @param {Object} opts
   * @param {string|number} opts.tplId
   * @param {string} opts.action - create | update | rollback | delete
   * @param {string} opts.name
   * @param {string} [opts.rectype]
   * @param {string} opts.xml   - BFO XML ณ เวอร์ชันนี้
   * @param {string} [opts.data] - designer JSON ณ เวอร์ชันนี้
   * @param {string} [opts.note]
   * @returns {{versionNo: number, id: string}}
   */
  function snapshot(opts) {
    if (!opts || !opts.tplId) throw new Error('snapshot ต้องมี tplId');
    if (!ACTIONS[opts.action]) throw new Error('snapshot action ไม่ถูกต้อง: ' + opts.action);

    var actor = auth.currentActor();
    var versionNo = latestVersionNo(opts.tplId) + 1;

    var rec = record.create({ type: VER.TYPE });
    rec.setValue({ fieldId: 'name', value: 'TPL ' + opts.tplId + ' v' + versionNo });
    rec.setValue({ fieldId: VER.TPLID, value: parseInt(opts.tplId, 10) });
    rec.setValue({ fieldId: VER.NO, value: versionNo });
    rec.setValue({ fieldId: VER.ACTION, value: opts.action });
    rec.setValue({ fieldId: VER.NAME, value: opts.name || '' });
    rec.setValue({ fieldId: VER.RECTYPE, value: opts.rectype || '' });
    rec.setValue({ fieldId: VER.USERID, value: actor.userId });
    rec.setValue({ fieldId: VER.USERNAME, value: actor.userName });
    rec.setValue({ fieldId: VER.ROLEID, value: actor.roleId });
    rec.setValue({ fieldId: VER.XML, value: opts.xml || '' });
    rec.setValue({ fieldId: VER.DATA, value: opts.data || '' });
    rec.setValue({ fieldId: VER.NOTE, value: opts.note || '' });
    rec.setValue({ fieldId: VER.PRUNED, value: false });

    var id = rec.save();

    prunePayloads(opts.tplId);

    return { versionNo: versionNo, id: id };
  }

  /**
   * ตัดเนื้อ XML/JSON ของเวอร์ชันที่เก่ากว่า PAYLOAD_KEEP ตัวล่าสุด — แถวยังอยู่
   * (ยังตอบได้ว่าใครแก้เมื่อไหร่) แต่ `hasPayload` เป็น false และ rollback จะ error
   *
   * ไม่ใช่ best-effort เงียบ ๆ: ตัดไม่สำเร็จก็ยังต้องเห็นใน log แต่ห้ามทำให้ save
   * ที่สำเร็จไปแล้วกลายเป็น error — ผู้ใช้บันทึกงานได้แล้ว การบ้านของเราคือพื้นที่เก็บ
   */
  function prunePayloads(tplId) {
    try {
      var rows = versionRows(tplId, [VER.NO, VER.PRUNED]);
      for (var i = PAYLOAD_KEEP; i < rows.length; i++) {
        var pruned = rows[i].getValue(VER.PRUNED);
        if (pruned === true || pruned === 'T') continue; // ตัดไปแล้ว ไม่ต้องเขียนซ้ำ

        var values = {};
        values[VER.XML] = '';
        values[VER.DATA] = '';
        values[VER.PRUNED] = true;
        record.submitFields({ type: VER.TYPE, id: rows[i].id, values: values });

        log.audit({
          title: 'PLD template version payload pruned',
          details: {
            tplid: String(tplId),
            version: parseInt(rows[i].getValue(VER.NO), 10) || 0,
            keep: PAYLOAD_KEEP,
            note: 'แถว audit ยังอยู่ — กู้คืนเวอร์ชันนี้ไม่ได้แล้ว'
          }
        });
      }
    } catch (e) {
      log.error({
        title: 'PLD template version prune failed',
        details: 'tplid ' + tplId + ': ' + ((e && e.message) || e) +
          ' — snapshot ถูกบันทึกแล้ว แต่เวอร์ชันเก่ายังกินพื้นที่อยู่'
      });
    }
  }

  // ═══════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════

  /**
   * หนึ่งบรรทัดต่อการเขียนหนึ่งครั้งใน Script Execution Log — คู่กับแถวเวอร์ชัน
   * ที่อยู่บน account (log หมดอายุ, แถวเวอร์ชันไม่หมด)
   */
  function auditWrite(action, detail) {
    var actor = auth.currentActor();
    var entry = {
      action: action,
      userId: actor.userId,
      userName: actor.userName,
      roleId: actor.roleId
    };
    if (detail) {
      for (var k in detail) { if (detail.hasOwnProperty(k)) entry[k] = detail[k]; }
    }
    log.audit({ title: 'PLD template ' + action, details: entry });
  }

  return {
    VER: VER,
    PAYLOAD_KEEP: PAYLOAD_KEEP,
    latestVersionNo: latestVersionNo,
    history: history,
    readVersion: readVersion,
    snapshot: snapshot,
    auditWrite: auditWrite
  };
});

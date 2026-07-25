/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — พิมพ์เป็นชุด (batch print, #181)
 *
 * หน้าจอเดียวที่เลือกเอกสารหลายใบแล้วได้ PDF ก้อนเดียว: กรองด้วยประเภทเอกสาร +
 * ช่วงวันที่ → ติ๊กรายการ → พิมพ์. ทุกใบวิ่งผ่าน `pld_lib_render` ตัวเดียวกับปุ่ม
 * Print บน record จึงได้ข้อมูล/ชุดสำเนา/ฟอนต์เหมือนกันทุกประการ (CLAUDE.md — BFO
 * เป็น render engine เดียว) ต่างแค่เอา <pdf> ของทุกใบมาต่อกันใน <pdfset> เดียว.
 *
 * Usage:
 *   (ไม่มี parameter)                        ← ฟอร์มกรอง
 *   ?rectype=invoice&from=2026-07-01&to=…    ← ฟอร์ม + รายการที่ตรงเงื่อนไข
 *   POST action=print (docid=1,2,3)          ← พิมพ์ชุด → PDF ก้อนเดียว
 *
 * โควตา: Suitelet มี 1,000 usage units ต่อครั้ง ซึ่งพอสำหรับสิบกว่าใบเท่านั้น
 * สคริปต์ **วัดต้นทุนจริงต่อใบตอนรัน** (`getRemainingUsage()`) แล้วหยุดก่อนโควตาหมด
 * พร้อมรายงานว่าพิมพ์ไปกี่ใบ เหลือกี่ใบ — ไม่มีการตัดทิ้งเงียบ (R4).
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
define([
  'N/search',
  'N/runtime',
  'N/log',
  'N/xml',
  'N/format',
  './pld_lib_render',
  './pld_lib_invoice_data'
], function (search, runtime, log, xml, format, pldRender, invoiceData) {

  /** หน่วย governance ที่กันไว้ให้ขั้นตอนรวมไฟล์ + ส่ง response ตอนท้าย */
  var RESERVE_UNITS = 100;

  /** เพดานเวลาต่อหนึ่งคำสั่งพิมพ์ — หยุดเองก่อนโดน execution timeout ของ Suitelet */
  var TIME_BUDGET_MS = 3 * 60 * 1000;

  /** จำนวนรายการสูงสุดที่ดึงมาแสดงในหน้าจอ (ไม่ใช่จำนวนที่พิมพ์ได้) */
  var LIST_LIMIT = 300;

  /**
   * ประเภทเอกสารที่ยอดรวมมีความหมาย — คอลัมน์ `total` ของ transaction search
   * ใส่เฉพาะประเภทเหล่านี้ ประเภทที่ไม่มียอดเงินตามกฎหมาย (ใบส่งสินค้า) ไม่ขอ
   * คอลัมน์นั้นเลย เพื่อไม่ให้ search พังทั้งหน้าจอเพราะคอลัมน์ที่ record type
   * นั้นไม่มี (#170 — เอกสารกลุ่ม NO_TOTALS)
   */
  var MONEY_TYPES = {
    invoice: true, creditmemo: true, estimate: true, salesorder: true,
    purchaseorder: true, cashsale: true, vendorbill: true,
    returnauthorization: true, customerpayment: true
  };

  function onRequest(context) {
    var request = context.request;
    var tel = newTelemetry(request);

    try {
      if (request.method === 'POST' && request.parameters.action === 'print') {
        return batchPrint(context, tel);
      }
      return writeFormPage(context, tel);
    } catch (e) {
      logBatchError(tel, e);
      writeErrorPage(context.response, tel, e);
    }
  }

  // ═══════════════════════════════════════════════════
  // พิมพ์เป็นชุด
  // ═══════════════════════════════════════════════════

  /**
   * Render ทุกใบที่เลือกแล้วรวมเป็น PDF ก้อนเดียว
   *
   * ผลลัพธ์มีสองแบบเท่านั้น เพื่อไม่ให้ผู้ใช้ได้ไฟล์ที่ขาดใบไปโดยไม่รู้ตัว (R4):
   *  - ครบทุกใบ → PDF
   *  - ไม่ครบ (ใบใดใบหนึ่งพัง หรือโควตา/เวลาไม่พอ) → หน้าสรุปที่บอกว่าใบไหนได้
   *    ใบไหนไม่ได้ พร้อมปุ่มสั่งพิมพ์เฉพาะใบที่เหลือ
   */
  function batchPrint(context, tel) {
    var params = context.request.parameters;
    var recType = params.rectype;
    var tplId = params.tplid || '';
    var ids = parseIds(params.docid);

    if (!recType) throw new Error('ไม่ได้ระบุประเภทเอกสาร');
    if (ids.length === 0) throw new Error('ยังไม่ได้เลือกเอกสารที่จะพิมพ์');

    tel.rectype = recType;
    tel.tplid = tplId;
    tel.count = ids.length;

    tel.stage = 'load-template';
    var tpl = pldRender.resolveTemplate(tplId, recType);
    var copies = pldRender.resolveCopies(tpl.copies, recType);

    tel.stage = 'render';
    var result = renderBatch(tpl.xml, recType, ids, copies, tel);

    if (result.failed.length > 0 || result.pending.length > 0) {
      logBatchOk(tel, {
        printed: result.printed.length, failed: result.failed.length,
        pending: result.pending.length, partial: true
      });
      return writeSummaryPage(context, tel, recType, tplId, result);
    }

    tel.stage = 'combine';
    var pdfFile = pldRender.combinePdfDocs(result.docs);
    pdfFile.name = 'batch_' + recType + '_' + result.printed.length + '.pdf';

    logBatchOk(tel, {
      printed: result.printed.length, failed: 0, pending: 0,
      copies: copies.length, unitsPerDoc: result.worstCost
    });

    tel.stage = 'write';
    context.response.setHeader({ name: 'Content-Type', value: 'application/pdf' });
    context.response.setHeader({
      name: 'Content-Disposition', value: 'inline; filename="' + pdfFile.name + '"'
    });
    context.response.writeFile({ file: pdfFile, isInline: true });
  }

  /**
   * Render ทีละใบพร้อมเฝ้าโควตา
   *
   * ต้นทุน governance ต่อใบขึ้นกับ record type / จำนวนบรรทัด / จำนวนสำเนา จึง
   * **วัดจากของจริง** (`getRemainingUsage()` คร่อมการ render แต่ละใบ) แล้วใช้ค่าที่
   * แพงที่สุดที่เจอมาเป็นเกณฑ์ตัดสินใจว่าจะขึ้นใบถัดไปไหว — ไม่ใช้ค่าคงที่ที่เดาไว้
   * เพราะเดาสูงไปคือพิมพ์ได้น้อยกว่าที่ควร เดาต่ำไปคือโดน governance kill กลางคัน
   * แล้วผู้ใช้ไม่ได้อะไรกลับไปเลย
   */
  function renderBatch(tplXml, recType, ids, copies, tel) {
    var script = runtime.getCurrentScript();
    var startedAt = Date.now();

    var docs = [];
    var printed = [];
    var failed = [];
    var worstCost = 0;

    for (var i = 0; i < ids.length; i++) {
      var remaining = script.getRemainingUsage();
      var outOfUnits = printed.length + failed.length > 0 && remaining < worstCost + RESERVE_UNITS;
      var outOfTime = Date.now() - startedAt > TIME_BUDGET_MS;

      if (outOfUnits || outOfTime) {
        return {
          docs: docs, printed: printed, failed: failed,
          pending: ids.slice(i), worstCost: worstCost,
          stopReason: outOfUnits ? 'units' : 'time'
        };
      }

      try {
        var out = pldRender.renderDocumentXml(tplXml, recType, ids[i], copies, tel);
        for (var d = 0; d < out.docs.length; d++) docs.push(out.docs[d]);
        printed.push({ id: ids[i], tranId: out.tranId || ids[i] });
      } catch (e) {
        // ใบเดียวพังต้องไม่ทำให้ทั้งชุดล่ม — เก็บไว้รายงาน พร้อม errorId ของใบนั้นเอง
        // ที่ตรงกับบรรทัดใน Script Execution Log (#149)
        var docError = { id: ids[i], errorId: newErrorId(), message: (e && e.message) || String(e) };
        failed.push(docError);
        log.error({
          title: 'PLD batch document failed [' + docError.errorId + ']',
          details: {
            batchId: tel.errorId, errorId: docError.errorId, rectype: recType,
            recid: ids[i], message: docError.message, stack: (e && e.stack) || ''
          }
        });
      }

      var cost = remaining - script.getRemainingUsage();
      if (cost > worstCost) worstCost = cost;
    }

    return {
      docs: docs, printed: printed, failed: failed,
      pending: [], worstCost: worstCost, stopReason: ''
    };
  }

  /** `docid` มาเป็นค่าซ้ำชื่อจาก checkbox — NetSuite รวมให้เป็นสตริงคั่นจุลภาค */
  function parseIds(raw) {
    return String(raw == null ? '' : raw)
      .split(',')
      .map(function (s) { return s.replace(/\s+/g, ''); })
      .filter(function (s) { return s !== ''; });
  }

  // ═══════════════════════════════════════════════════
  // หน้าจอ
  // ═══════════════════════════════════════════════════

  function writeFormPage(context, tel) {
    var params = context.request.parameters;
    var recType = params.rectype || '';
    var from = params.from || '';
    var to = params.to || '';
    var tplId = params.tplid || '';

    var rows = [];
    if (recType) {
      tel.stage = 'search';
      tel.rectype = recType;
      rows = findDocuments(recType, from, to);
    }

    var html = pageShell('พิมพ์เอกสารเป็นชุด', [
      '<h1>พิมพ์เอกสารเป็นชุด</h1>',
      '<p class="sub">เลือกประเภทเอกสารและช่วงวันที่ แล้วติ๊กใบที่ต้องการ — ระบบรวมทุกใบเป็น PDF ไฟล์เดียว</p>',
      filterForm(recType, from, to, tplId),
      recType ? documentList(recType, tplId, rows) : ''
    ].join('\n'));

    context.response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    context.response.write(html);
  }

  function filterForm(recType, from, to, tplId) {
    var options = ['<option value="">— เลือกประเภทเอกสาร —</option>'];
    var titles = invoiceData.docTitles;
    Object.keys(titles).forEach(function (type) {
      options.push('<option value="' + esc(type) + '"' + (type === recType ? ' selected' : '') + '>' +
        esc(titles[type].th) + ' (' + esc(titles[type].en) + ')</option>');
    });

    return [
      '<form method="GET" class="filters">',
      '<label>ประเภทเอกสาร<select name="rectype" required>' + options.join('') + '</select></label>',
      '<label>วันที่ตั้งแต่<input type="date" name="from" value="' + esc(from) + '" /></label>',
      '<label>ถึงวันที่<input type="date" name="to" value="' + esc(to) + '" /></label>',
      tplId ? '<input type="hidden" name="tplid" value="' + esc(tplId) + '" />' : '',
      '<button class="primary" type="submit">ค้นหาเอกสาร</button>',
      '</form>'
    ].join('\n');
  }

  function documentList(recType, tplId, rows) {
    if (rows.length === 0) {
      return '<p class="warn">ไม่พบเอกสารที่ตรงเงื่อนไข — ลองขยายช่วงวันที่</p>';
    }

    var money = MONEY_TYPES[recType] === true;
    var head = '<tr><th class="pick"><input type="checkbox" id="pld-all" checked /></th>' +
      '<th>เลขที่</th><th>วันที่</th><th>คู่ค้า</th>' + (money ? '<th class="num">ยอดรวม</th>' : '') + '</tr>';

    var body = rows.map(function (r) {
      return '<tr class="doc" data-search="' + esc((r.tranid + ' ' + r.entity).toLowerCase()) + '">' +
        '<td class="pick"><input type="checkbox" name="docid" value="' + esc(r.id) + '" checked /></td>' +
        '<td>' + esc(r.tranid) + '</td>' +
        '<td>' + esc(r.trandate) + '</td>' +
        '<td>' + esc(r.entity) + '</td>' +
        (money ? '<td class="num">' + esc(r.total) + '</td>' : '') +
        '</tr>';
    }).join('\n');

    return [
      '<form method="POST" class="picker">',
      '<input type="hidden" name="action" value="print" />',
      '<input type="hidden" name="rectype" value="' + esc(recType) + '" />',
      templateSelect(recType, tplId),
      '<div class="toolbar">',
      '<input type="search" id="pld-filter" placeholder="กรองในรายการ (เลขที่ / คู่ค้า)" />',
      '<span class="count">พบ ' + rows.length + ' รายการ' +
        (rows.length >= LIST_LIMIT ? ' (แสดงสูงสุด ' + LIST_LIMIT + ' — ลองแคบช่วงวันที่)' : '') + '</span>',
      '</div>',
      '<table class="docs"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>',
      '<p class="actions"><button class="primary" type="submit">พิมพ์เป็นชุด</button>',
      '<span class="hint">พิมพ์ได้ประมาณสิบกว่าใบต่อครั้งตามโควตาสคริปต์ของ NetSuite — ' +
      'ถ้าเลือกเกิน ระบบจะบอกว่าพิมพ์ได้กี่ใบและเหลือกี่ใบ ไม่ตัดทิ้งเงียบ</span></p>',
      '</form>',
      listScript()
    ].join('\n');
  }

  /** กรองรายการฝั่งเบราว์เซอร์ + ติ๊ก/เอาออกทั้งหมด (ไม่ยิง server ซ้ำ) */
  function listScript() {
    return '<script>\n' +
      '(function(){\n' +
      '  var all=document.getElementById("pld-all");\n' +
      '  var q=document.getElementById("pld-filter");\n' +
      '  var rows=[].slice.call(document.querySelectorAll("tr.doc"));\n' +
      '  if(all){all.addEventListener("change",function(){\n' +
      '    rows.forEach(function(r){ if(r.style.display!=="none"){ r.querySelector("input").checked=all.checked; } });\n' +
      '  });}\n' +
      '  if(q){q.addEventListener("input",function(){\n' +
      '    var v=q.value.toLowerCase();\n' +
      '    rows.forEach(function(r){\n' +
      '      var hit=r.getAttribute("data-search").indexOf(v)!==-1;\n' +
      '      r.style.display=hit?"":"none";\n' +
      '      if(!hit){ r.querySelector("input").checked=false; }\n' +
      '    });\n' +
      '  });}\n' +
      '})();\n' +
      '</script>';
  }

  function templateSelect(recType, tplId) {
    var templates = findTemplates(recType);
    if (templates.length === 0) {
      return '<p class="warn">ประเภทนี้ยังไม่มี template ใน NetSuite — กดพิมพ์แล้วจะขึ้นว่าไม่พบ template</p>';
    }
    var options = ['<option value="">— ใช้ template เริ่มต้นของประเภทนี้ —</option>'];
    templates.forEach(function (t) {
      options.push('<option value="' + esc(t.id) + '"' + (String(t.id) === String(tplId) ? ' selected' : '') + '>' +
        esc(t.name) + (t.isDefault ? ' ★' : '') + '</option>');
    });
    return '<label class="tpl">Template<select name="tplid">' + options.join('') + '</select></label>';
  }

  /**
   * หน้าสรุปเมื่อพิมพ์ไม่ครบ — ผู้ใช้ต้องเห็นเสมอว่าใบไหนไม่ได้ออกมาและเพราะอะไร
   * (AC #4/#6 ของ #181) ปุ่มบนหน้านี้สั่งพิมพ์ใหม่เฉพาะกลุ่มที่เลือก
   */
  function writeSummaryPage(context, tel, recType, tplId, result) {
    var parts = ['<h1>พิมพ์เป็นชุดไม่ครบ</h1>'];

    parts.push('<p class="sub">เอกสารที่เลือกไว้ ' + (result.printed.length + result.failed.length + result.pending.length) +
      ' ใบ · สร้างสำเร็จ ' + result.printed.length + ' ใบ · ล้มเหลว ' + result.failed.length +
      ' ใบ · ยังไม่ได้พิมพ์ ' + result.pending.length + ' ใบ</p>');

    if (result.pending.length > 0) {
      parts.push('<p class="ref">' + (result.stopReason === 'time'
        ? 'หยุดเพราะใช้เวลานานเกินกำหนดของหนึ่งคำสั่งพิมพ์'
        : 'หยุดเพราะโควตาสคริปต์ของ NetSuite (usage units) กำลังจะหมด — วัดได้ว่าเอกสารชุดนี้ใช้ประมาณ ' +
          result.worstCost + ' units ต่อใบ') +
        '<br />กดปุ่มด้านล่างเพื่อพิมพ์ส่วนที่เหลือเป็นชุดถัดไป</p>');
    }

    if (result.failed.length > 0) {
      parts.push('<h2>ใบที่สร้างไม่สำเร็จ</h2><table class="docs"><thead><tr><th>internal id</th>' +
        '<th>รหัสอ้างอิง</th><th>สาเหตุ</th></tr></thead><tbody>' +
        result.failed.map(function (f) {
          return '<tr><td>' + esc(f.id) + '</td><td><code>' + esc(f.errorId) + '</code></td><td>' +
            esc(f.message) + '</td></tr>';
        }).join('') + '</tbody></table>');
    }

    if (result.printed.length > 0) {
      parts.push(reprintForm(recType, tplId, result.printed.map(function (p) { return p.id; }),
        'พิมพ์ ' + result.printed.length + ' ใบที่สร้างสำเร็จ'));
    }
    if (result.pending.length > 0) {
      parts.push(reprintForm(recType, tplId, result.pending,
        'พิมพ์ ' + result.pending.length + ' ใบที่เหลือ'));
    }
    parts.push('<p class="hint">การกดปุ่มคือการสั่ง render ใหม่สำหรับใบในกลุ่มนั้น ' +
      'ระบบไม่ได้เก็บไฟล์ที่สร้างค้างไว้</p>');
    parts.push('<p class="ref">รหัสอ้างอิงของคำสั่งพิมพ์นี้ <code>' + esc(tel.errorId) + '</code></p>');

    context.response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    context.response.write(pageShell('พิมพ์เป็นชุดไม่ครบ', parts.join('\n')));
  }

  function reprintForm(recType, tplId, ids, label) {
    return '<form method="POST" class="again">' +
      '<input type="hidden" name="action" value="print" />' +
      '<input type="hidden" name="rectype" value="' + esc(recType) + '" />' +
      (tplId ? '<input type="hidden" name="tplid" value="' + esc(tplId) + '" />' : '') +
      ids.map(function (id) {
        return '<input type="hidden" name="docid" value="' + esc(id) + '" />';
      }).join('') +
      '<button class="primary" type="submit">' + esc(label) + '</button></form>';
  }

  /**
   * หน้าล้มเหลวของทั้งคำสั่ง (เช่น ไม่พบ template) — รูปแบบเดียวกับหน้าพิมพ์ทีละใบ
   * (#157): ข้อความไทย + errorId ที่ตรงกับ log · ไม่มี stack บนหน้าจอ
   */
  function writeErrorPage(response, tel, e) {
    var html = pageShell('พิมพ์เป็นชุดไม่สำเร็จ', [
      '<h1>พิมพ์เป็นชุดไม่สำเร็จ</h1>',
      '<p class="sub">ระบบสร้างไฟล์ PDF ของชุดนี้ไม่ได้ — ข้อมูลบนเอกสารไม่ถูกแก้ไขใด ๆ</p>',
      '<p class="ref">แจ้งทีม Teibto พร้อมรหัสอ้างอิง <code>' + esc(tel.errorId) + '</code></p>',
      '<details><summary>รายละเอียดทางเทคนิค (สำหรับผู้ดูแลระบบ)</summary>' +
      '<p class="msg">' + esc((e && e.message) || String(e)) + '</p></details>',
      '<p><button class="primary" onclick="history.back()">กลับไปเลือกใหม่</button></p>'
    ].join('\n'));

    response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    response.write(html);
  }

  function pageShell(title, bodyHtml) {
    return '<!DOCTYPE html>\n<html lang="th">\n<head>\n<meta charset="utf-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<title>' + esc(title) + '</title>\n<style>\n' +
      'body{margin:0;padding:28px 16px;background:#f4f5f7;color:#1f2330;' +
      "font-family:'Segoe UI',Tahoma,'Sarabun',sans-serif;font-size:15px;line-height:1.6}\n" +
      '.wrap{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #dfe1e6;' +
      'border-radius:10px;padding:24px 28px}\n' +
      'h1{margin:0 0 4px;font-size:21px}h2{font-size:17px;margin:22px 0 8px}\n' +
      '.sub{margin:0 0 18px;color:#5e6c84}\n' +
      '.filters{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;padding:16px;' +
      'background:#f4f5f7;border-radius:8px;margin:0 0 18px}\n' +
      'label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#42526e}\n' +
      'select,input[type=date],input[type=search]{font:inherit;padding:6px 8px;border:1px solid #c1c7d0;' +
      'border-radius:6px;background:#fff;color:inherit}\n' +
      '.toolbar{display:flex;gap:12px;align-items:center;margin:14px 0 8px}\n' +
      '.toolbar .count{color:#5e6c84;font-size:13px}\n' +
      '.tpl{margin:0 0 6px}\n' +
      'table.docs{width:100%;border-collapse:collapse;font-size:14px}\n' +
      'table.docs th,table.docs td{border-bottom:1px solid #ebecf0;padding:7px 8px;text-align:left}\n' +
      'table.docs th{background:#f4f5f7;color:#42526e;font-weight:600}\n' +
      'table.docs td.num,table.docs th.num{text-align:right}\n' +
      'td.pick,th.pick{width:34px}\n' +
      '.actions{margin:18px 0 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap}\n' +
      '.hint{color:#5e6c84;font-size:13px}\n' +
      '.warn{background:#fffae6;border:1px solid #ffe380;border-radius:6px;padding:10px 12px}\n' +
      '.ref{background:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;padding:12px 14px}\n' +
      '.msg{margin:8px 0 0;padding:10px 12px;background:#f4f5f7;border-radius:6px;' +
      'font-family:Consolas,monospace;font-size:13px;word-break:break-word}\n' +
      'code{font-family:Consolas,monospace;font-weight:600}\n' +
      'form.again{display:inline-block;margin:0 10px 10px 0}\n' +
      'button{font:inherit;padding:8px 18px;border-radius:6px;cursor:pointer;' +
      'border:1px solid #dfe1e6;background:#fff}\n' +
      'button.primary{background:#0052cc;border-color:#0052cc;color:#fff}\n' +
      '</style>\n</head>\n<body>\n<div class="wrap">\n' + bodyHtml + '\n</div>\n</body>\n</html>';
  }

  // ═══════════════════════════════════════════════════
  // ข้อมูลสำหรับหน้าจอ
  // ═══════════════════════════════════════════════════

  /**
   * เอกสารที่เลือกพิมพ์ได้ — saved-search API รู้จัก record type ตรง ๆ จึงไม่ต้อง
   * แปลงเป็น type code เองเหมือน SuiteQL (บทเรียน #174: SQL ที่ unit test พิสูจน์
   * ไม่ได้ ต้องไปล้มบน account จริง) · `mainline is T` = หนึ่งแถวต่อหนึ่งเอกสาร
   */
  function findDocuments(recType, from, to) {
    var filters = [['mainline', 'is', 'T']];
    var fromDate = parseIsoDate(from);
    var toDate = parseIsoDate(to);
    if (fromDate) filters.push('AND', ['trandate', 'onorafter', asNsDate(fromDate)]);
    if (toDate) filters.push('AND', ['trandate', 'onorbefore', asNsDate(toDate)]);

    var columns = [
      search.createColumn({ name: 'tranid' }),
      search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
      search.createColumn({ name: 'entity' })
    ];
    if (MONEY_TYPES[recType] === true) columns.push(search.createColumn({ name: 'total' }));

    var rows = [];
    search.create({ type: recType, filters: filters, columns: columns })
      .run().getRange({ start: 0, end: LIST_LIMIT })
      .forEach(function (r) {
        rows.push({
          id: r.id,
          tranid: r.getValue('tranid') || ('#' + r.id),
          trandate: r.getValue('trandate') || '',
          entity: r.getText('entity') || r.getValue('entity') || '',
          total: MONEY_TYPES[recType] === true ? (r.getValue('total') || '') : ''
        });
      });
    return rows;
  }

  /** Template ทั้งหมดของ record type นี้ (ชื่อ + ตัวที่เป็นค่าเริ่มต้น) */
  function findTemplates(recType) {
    var out = [];
    search.create({
      type: pldRender.TPL.TYPE,
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        [pldRender.TPL.RECTYPE, 'is', recType]
      ],
      columns: [pldRender.TPL.NAME, pldRender.TPL.IS_DEFAULT]
    }).run().each(function (row) {
      out.push({
        id: row.id,
        name: row.getValue(pldRender.TPL.NAME) || ('template ' + row.id),
        isDefault: row.getValue(pldRender.TPL.IS_DEFAULT) === true || row.getValue(pldRender.TPL.IS_DEFAULT) === 'T'
      });
      return true;
    });
    return out;
  }

  /** `YYYY-MM-DD` จาก <input type="date"> → Date (null ถ้าว่าง/รูปแบบไม่ตรง) */
  function parseIsoDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value).trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /** ค่าที่ search filter รับ = รูปแบบวันที่ของ account (ห้าม hardcode dd/mm/yyyy) */
  function asNsDate(date) {
    return format.format({ value: date, type: format.Type.DATE });
  }

  // ═══════════════════════════════════════════════════
  // OBSERVABILITY (#149)
  // ═══════════════════════════════════════════════════

  function newErrorId() {
    return 'PLD-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 0x100000).toString(36);
  }

  function newTelemetry(request) {
    var p = (request && request.parameters) || {};
    var user = {};
    try { user = runtime.getCurrentUser() || {}; } catch (e) { user = {}; }
    return {
      errorId: newErrorId(),
      action: p.action || 'form',
      rectype: p.rectype || '',
      tplid: p.tplid || '',
      recid: '',
      subsidiaryId: '',
      userId: user.id || '',
      count: 0,
      stage: 'init',
      start: Date.now()
    };
  }

  function telBase(tel) {
    return {
      errorId: tel.errorId, action: tel.action, rectype: tel.rectype,
      tplid: tel.tplid, recid: tel.recid, subsidiaryId: tel.subsidiaryId,
      userId: tel.userId, selected: tel.count, elapsedMs: Date.now() - tel.start
    };
  }

  function logBatchOk(tel, extra) {
    var d = telBase(tel);
    d.ok = true;
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) d[k] = extra[k]; } }
    log.audit({ title: 'PLD batch print ok', details: d });
  }

  function logBatchError(tel, e) {
    var d = telBase(tel);
    d.stage = tel.stage;
    d.message = (e && e.message) || String(e);
    d.stack = (e && e.stack) || '';
    log.error({ title: 'PLD batch print failed [' + tel.errorId + ']', details: d });
  }

  function esc(text) {
    return xml.escape({ xmlText: String(text == null ? '' : text) });
  }

  return { onRequest: onRequest };
});

/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * PDF Layout Designer — พิมพ์เป็นชุดขนาดใหญ่ (#181)
 *
 * หน้าจอ `pld_sl_batch_print` พิมพ์สดได้ราวสิบใบต่อครั้ง (วัดจริงบน SB2: ใบแจ้งหนี้
 * 2 สำเนา ≈ 160 usage units/ใบ จาก 1,000 units ของ Suitelet) เกินกว่านั้นมันจะส่ง
 * งานมาที่สคริปต์ตัวนี้ ซึ่งได้ **1,000 units ต่อหนึ่ง map invocation** — หนึ่ง
 * เอกสารต่อหนึ่ง key จึงไม่มีวันเต็มโควตา ไม่ว่าชุดจะใหญ่แค่ไหน
 *
 * ทุกใบ render ผ่าน `pld_lib_render` ตัวเดียวกับปุ่ม Print และหน้าจอพิมพ์เป็นชุด
 * (CLAUDE.md — BFO เป็น render engine เดียว) ผลลัพธ์คือไฟล์ PDF ก้อนเดียวใน File
 * Cabinet แล้วอีเมลลิงก์ให้คนสั่งพิมพ์
 *
 * ทำไมต้องพักเป็นไฟล์ระหว่างทาง: การรวมเอกสารเป็น `<pdfset>` ต้องใช้ **XML ที่
 * FreeMarker resolve แล้ว** ของทุกใบพร้อมกัน ซึ่งใหญ่เกินกว่าจะส่งผ่าน key/value
 * ของ Map/Reduce · map จึงเขียน XML ของใบตัวเองเป็นไฟล์ชั่วคราวแล้วส่งต่อแค่
 * file id · summarize โหลดกลับมาต่อกันครั้งเดียว แล้วลบไฟล์ชั่วคราวทิ้ง
 *
 * job spec (ไฟล์ JSON ที่ Suitelet เขียนไว้) ส่งมาทาง script parameter
 * `custscript_pld_mr_job` = file id — parameter เก็บ id ตัวเดียว ไม่ใช่รายการ
 * เอกสารทั้งชุด (ชุด 300 ใบยาวเกินกว่าจะยัดลง parameter)
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
define([
  'N/file',
  'N/render',
  'N/runtime',
  'N/log',
  'N/email',
  'N/url',
  './pld_lib_render'
], function (file, render, runtime, log, email, url, pldRender) {

  var JOB_PARAM = 'custscript_pld_mr_job';
  var MAX_DOCS = 500;
  // Product memory budget for resolved input, excluding pdfset framing.
  var MAX_XML_BYTES = 8 * 1024 * 1024;

  // ═══════════════════════════════════════════════════
  // getInputData — หนึ่งเอกสาร = หนึ่ง key
  // ═══════════════════════════════════════════════════

  function getInputData() {
    var job = loadJob();
    log.audit({
      title: 'PLD batch job started',
      details: { jobId: job.jobId, rectype: job.rectype, tplid: job.tplid, count: job.ids.length }
    });

    return job.ids.map(function (id, i) {
      return {
        seq: i,
        recid: String(id),
        jobId: job.jobId,
        rectype: job.rectype,
        tplid: job.tplid || '',
        folder: job.folder
      };
    });
  }

  /**
   * job spec จาก File Cabinet — พังต้องดังตั้งแต่ getInputData (R4)
   * ไม่ใช่ปล่อยให้ map วิ่งเปล่าแล้วผู้ใช้ได้อีเมลว่า "สำเร็จ 0 ใบ"
   */
  function loadJob(skipValidation) {
    var fileId = runtime.getCurrentScript().getParameter({ name: JOB_PARAM });
    if (!fileId) {
      throw new Error('ไม่ได้ระบุ job file (script parameter ' + JOB_PARAM + ') — ' +
        'สั่งงานนี้จากหน้าจอพิมพ์เป็นชุดเท่านั้น');
    }
    var job = JSON.parse(file.load({ id: fileId }).getContents());
    if (!job || typeof job !== 'object') throw new Error('Invalid batch job');
    if (!skipValidation && (!job.rectype || !Array.isArray(job.ids) || job.ids.length === 0)) {
      throw new Error('job file ' + fileId + ' ไม่มี rectype หรือรายการเอกสาร');
    }
    if (!skipValidation && job.ids.length > MAX_DOCS) {
      throw new Error('พิมพ์เป็นชุดได้ไม่เกิน ' + MAX_DOCS + ' ใบ');
    }
    job.jobFileId = fileId;
    return job;
  }

  // ═══════════════════════════════════════════════════
  // map — render หนึ่งใบ แล้วพักไว้เป็นไฟล์
  // ═══════════════════════════════════════════════════

  function map(context) {
    var entry = JSON.parse(context.value);

    var tpl = pldRender.resolveTemplate(entry.tplid, entry.rectype);
    var copies = pldRender.resolveCopies(tpl.copies, entry.rectype);
    var out = pldRender.renderDocumentXml(tpl.xml, entry.rectype, entry.recid, copies, null);

    // ตรวจว่า XML ที่ resolve แล้วอ่านได้จริงตั้งแต่ตอนนี้ ไม่ใช่ไปพังตอนรวมไฟล์
    // ซึ่งจะทำให้ทั้งชุดล่มโดยไม่รู้ว่าใบไหนเป็นต้นเหตุ (อาการเดียวกับ #184)
    var contents = out.docs.join('\n');
    if (contents.indexOf('<pdf>') === -1) {
      throw new Error('เอกสาร ' + entry.recid + ' ไม่ได้ resolve เป็น <pdf>');
    }

    assertXmlBudget(utf8Bytes(contents));
    var partId = file.create({
      name: partName(entry.jobId, entry.seq),
      fileType: file.Type.PLAINTEXT,
      contents: contents,
      encoding: file.Encoding.UTF8,   // ข้อความไทยใน XML ต้องไม่เพี้ยนตอนอ่านกลับ
      folder: entry.folder,
      isOnline: false
    }).save();

    try {
      context.write({
        key: sortKey(entry.seq),
        value: JSON.stringify({ partId: partId, recid: entry.recid, tranId: out.tranId || entry.recid })
      });
    } catch (e) {
      cleanUp([{ partId: partId }], {});
      throw e;
    }
  }

  /** key ต้องเรียงแบบสตริงได้ — เอกสารในไฟล์รวมต้องอยู่ตามลำดับที่ผู้ใช้เลือก */
  function sortKey(seq) {
    var s = '00000' + seq;
    return s.slice(-6);
  }

  function partName(jobId, seq) {
    return 'pld_part_' + jobId + '_' + sortKey(seq) + '.txt';
  }

  // ═══════════════════════════════════════════════════
  // summarize — รวมเป็นไฟล์เดียว เก็บกวาด แล้วแจ้งผล
  // ═══════════════════════════════════════════════════

  function summarize(summary) {
    var parts = [];
    var job;
    var failures = collectErrors(summary);
    var result = { pdfId: '', pdfUrl: '', printed: 0, failed: 0 };
    var fatal;
    try {
      var outputError;
      summary.output.iterator().each(function (key, value) {
        try {
          var v = JSON.parse(value);
          if (!v || !v.partId) throw new Error('Missing part file ID');
          v.key = key;
          parts.push(v);
        } catch (e) {
          outputError = new Error('Invalid batch output: ' + key);
          failures.push({ key: key, message: outputError.message });
        }
        return true;
      });
      job = loadJob(true);
      if (outputError) throw outputError;
      parts.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
      if (summary.inputSummary && summary.inputSummary.error) {
        throw new Error('Input: ' + summary.inputSummary.error);
      }
      if (parts.length > MAX_DOCS) throw new Error('Batch exceeds ' + MAX_DOCS + ' documents');
      if (parts.length > 0) result = mergeParts(job, parts, failures.length);
    } catch (e) {
      fatal = e;
      failures.push({ key: 'batch', message: e.message });
      log.error({ title: 'PLD batch job failed', details: { message: e.message } });
    } finally {
      if (!job) job = { jobFileId: runtime.getCurrentScript().getParameter({ name: JOB_PARAM }), ids: [] };
      result.failed = fatal ? (Array.isArray(job.ids) ? job.ids.length : 0) : failures.length;
      cleanUp(parts, job);
      notify(job, result, failures);
      log.audit({
        title: 'PLD batch job finished',
        details: {
          jobId: job.jobId, rectype: job.rectype, requested: Array.isArray(job.ids) ? job.ids.length : 0,
          printed: result.printed, failed: result.failed, pdfId: result.pdfId,
          seconds: summary.seconds, usage: summary.usage
        }
      });
    }
    if (fatal) throw fatal;
  }

  /** ใบที่ map พังต้องถูกรายงานทีละใบ ไม่ใช่หายไปเงียบ ๆ จากชุด (R4) */
  function collectErrors(summary) {
    var failures = [];
    summary.mapSummary.errors.iterator().each(function (key, error) {
      var message = error;
      try { message = JSON.parse(error).message || error; } catch (e) { /* ข้อความดิบ */ }
      failures.push({ key: key, message: String(message) });
      return true;
    });
    return failures;
  }

  /** ต่อ XML ของทุกใบเป็น <pdfset> เดียว แล้วเก็บ PDF ลง File Cabinet */
  function mergeParts(job, parts, failedCount) {
    var docs = [];
    var bytes = 0;
    parts.forEach(function (p) {
      var part = file.load({ id: p.partId });
      if (typeof part.size === 'number') assertXmlBudget(bytes + part.size);
      var contents = part.getContents();
      bytes += utf8Bytes(contents);
      assertXmlBudget(bytes);
      docs.push(contents);
    });

    var pdfFile = pldRender.combinePdfDocs(docs);
    pdfFile.name = 'batch_' + job.rectype + '_' + parts.length + '_' + job.jobId + '.pdf';
    pdfFile.folder = job.folder;
    pdfFile.isOnline = false;
    var pdfId = pdfFile.save();
    var pdfUrl = '';
    try {
      var savedUrl = file.load({ id: pdfId }).url;
      if (!savedUrl) throw new Error('Saved PDF has no download URL');
      pdfUrl = absoluteUrl(savedUrl);
    } catch (e) {
      // The PDF is already durable: preserve its ID for recovery, never report
      // a successful save as zero printed just because link lookup failed.
      log.error({ title: 'PLD batch PDF link unavailable', details: { pdfId: pdfId, message: e.message } });
    }

    return {
      pdfId: pdfId,
      pdfUrl: pdfUrl,
      printed: parts.length,
      failed: failedCount
    };
  }

  function assertXmlBudget(bytes) {
    if (bytes > MAX_XML_BYTES) {
      throw new Error('XML ของชุดเกิน 8 MiB — ลดจำนวนเอกสารหรือสำเนาแล้วส่งใหม่');
    }
  }

  function utf8Bytes(text) {
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  /** ไฟล์ชั่วคราวต้องไม่ค้างใน File Cabinet ของลูกค้า */
  function cleanUp(parts, job) {
    parts.forEach(function (p) {
      try { file.delete({ id: p.partId }); } catch (e) {
        log.error({ title: 'PLD batch cleanup', details: { partId: p.partId, message: e.message } });
      }
    });
    try { if (job.jobFileId) file.delete({ id: job.jobFileId }); } catch (e) {
      log.error({ title: 'PLD batch cleanup (job spec)', details: { id: job.jobFileId, message: e.message } });
    }
  }

  /** URL ของ File Cabinet เป็น path — เติม domain ให้กดจากอีเมลได้ */
  function absoluteUrl(fileUrl) {
    try {
      return 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION }) + fileUrl;
    } catch (e) {
      return fileUrl;
    }
  }

  /**
   * แจ้งผลกลับไปหาคนที่กดสั่งพิมพ์ — เป็นการแจ้งภายในถึงตัวผู้ใช้เอง
   * (ไม่ใช่การส่งเอกสารออกไปหาลูกค้า ซึ่งเป็นงานคนละใบของ #181)
   */
  function notify(job, result, failures) {
    var requester = job.requester && job.requester.id;
    if (!requester) {
      log.audit({ title: 'PLD batch: no requester to notify', details: { jobId: job.jobId } });
      return;
    }

    var requested = Array.isArray(job.ids) ? job.ids.length : 0;
    var lines = [
      'พิมพ์เอกสารเป็นชุดเสร็จแล้ว',
      '',
      'ประเภทเอกสาร: ' + job.rectype,
      'เลือกไว้: ' + requested + ' ใบ',
      'สร้างสำเร็จ: ' + result.printed + ' ใบ',
      'ล้มเหลว: ' + result.failed + ' ใบ'
    ];
    if (result.pdfUrl) {
      lines.push('', 'ไฟล์รวม: ' + result.pdfUrl);
    } else if (result.pdfId) {
      lines.push('', 'สร้างไฟล์แล้ว แต่ดึงลิงก์ไม่สำเร็จ — เปิด File Cabinet ด้วย file ID: ' + result.pdfId);
    }
    if (failures.length > 0) {
      lines.push('', 'ใบที่สร้างไม่สำเร็จ (ลำดับในชุด — สาเหตุ):');
      failures.slice(0, 20).forEach(function (f) {
        lines.push('  ' + f.key + ' — ' + f.message);
      });
      if (failures.length > 20) lines.push('  … อีก ' + (failures.length - 20) + ' ใบ (ดูใน Script Execution Log)');
    }

    try {
      email.send({
        author: requester,
        recipients: requester,
        subject: 'พิมพ์เอกสารเป็นชุด — ' + result.printed + '/' + requested + ' ใบ',
        body: lines.join('\n')
      });
    } catch (e) {
      // อีเมลส่งไม่ออกต้องไม่ทำให้ผลลัพธ์หาย — ไฟล์อยู่ใน File Cabinet แล้ว
      log.error({
        title: 'PLD batch: ส่งอีเมลแจ้งผลไม่สำเร็จ',
        details: { jobId: job.jobId, requester: requester, pdfId: result.pdfId, message: e.message }
      });
    }
  }

  return {
    getInputData: getInputData,
    map: map,
    summarize: summarize
  };
});

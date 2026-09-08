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
 * เอกสารต่อหนึ่ง key; oversized documents can still exhaust governance.
 * Merge remains bounded to 8 MiB XML / 500 documents; chunking/recovery/pooling are not implemented.
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
 * `custscript_pld_mr_job` = durable job record ID — parameter เก็บ id ตัวเดียว ไม่ใช่รายการ
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
  './pld_lib_render', './pld_lib_batch_jobs', './pld_lib_batch_integrity'
], function (file, render, runtime, log, email, url, pldRender, jobs, integrity) {

  var JOB_PARAM = 'custscript_pld_mr_job';
  var MAX_DOCS = 500;
  // Product memory budget for resolved input, excluding pdfset framing.
  var MAX_XML_BYTES = 8 * 1024 * 1024;

  // ═══════════════════════════════════════════════════
  // getInputData — หนึ่งเอกสาร = หนึ่ง key
  // ═══════════════════════════════════════════════════

  function getInputData() {
    var job = loadJob();
    jobs.update(job.jobId, { status: 'RUNNING' });
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
  function loadJob() {
    var fileId = runtime.getCurrentScript().getParameter({ name: JOB_PARAM });
    if (!fileId) {
      throw new Error('ไม่ได้ระบุ job file/job record (script parameter ' + JOB_PARAM + ') — ' +
        'สั่งงานนี้จากหน้าจอพิมพ์เป็นชุดเท่านั้น');
    }
    var durable = jobs.load(fileId);
    if (['QUEUED', 'RUNNING'].indexOf(durable.status) < 0) throw new Error('Batch job is not runnable');
    var jobFile = jobs.loadFile(durable, durable.snapshot);
    fileId = durable.snapshot;
    if (jobFile.size > 8 * 1024 * 1024) throw new Error('Batch job file exceeds 8 MiB');
    var contents = jobFile.getContents();
    if (utf8Bytes(contents) > 8 * 1024 * 1024) throw new Error('Batch job file exceeds 8 MiB');
    var job = integrity.open('snapshot', contents);
    if (!job || typeof job !== 'object') throw new Error('Invalid batch job');
    if ((!job.rectype || !Array.isArray(job.ids) || job.ids.length === 0)) {
      throw new Error('job file ' + fileId + ' ไม่มี rectype หรือรายการเอกสาร');
    }
    if (job.ids.length > MAX_DOCS) {
      throw new Error('พิมพ์เป็นชุดได้ไม่เกิน ' + MAX_DOCS + ' ใบ');
    }
    {
      var snapshot = job.templateSnapshot;
      if (job.schemaVersion !== 4 || !snapshot) {
        throw new Error('งานคิวรุ่นเก่าไม่มี template snapshot — ส่งงานใหม่จากหน้าพิมพ์เป็นชุด');
      }
      if (typeof snapshot.xml !== 'string' || !snapshot.xml.trim() || snapshot.xml.length > 1000000 ||
        !Array.isArray(snapshot.copies) || !snapshot.copies.length ||
        snapshot.copies.some(function (c) {
          return !c || (c.th !== undefined && typeof c.th !== 'string') || (c.en !== undefined && typeof c.en !== 'string') ||
            (!c.th && !c.en);
        })) throw new Error('Invalid template snapshot (XML/copy bounds)');
      pldRender.resolveCopies(snapshot.copies, job.rectype);
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(job.rectype) ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(job.jobId) || !/^[1-9][0-9]*$/.test(String(job.folder)) ||
        job.ids.some(function (id) { return !/^[1-9][0-9]*$/.test(String(id)); })) {
        throw new Error('Invalid batch job metadata');
      }
    }
    if (String(job.jobId) !== durable.id || String(job.folder) !== String(durable.folder) ||
      !job.requester || String(job.requester.id) !== String(durable.requester) || String(job.requester.role) !== String(durable.role) ||
      !Array.isArray(job.ids) || job.ids.length !== Number(durable.requested)) throw new Error('Batch snapshot identity mismatch');
    job.durable = durable;
    job.jobFileId = fileId;
    job.snapshotDigest = integrity.digest(contents);
    return job;
  }

  // ═══════════════════════════════════════════════════
  // map — render หนึ่งใบ แล้วพักไว้เป็นไฟล์
  // ═══════════════════════════════════════════════════

  function map(context) {
    var entry = JSON.parse(context.value);

    // Read the persisted enqueue-time snapshot, never the mutable template record.
    var job = loadJob();
    if (!Number.isInteger(entry.seq) || entry.seq < 0 || entry.seq >= job.ids.length ||
      String(entry.recid) !== String(job.ids[entry.seq])) throw new Error('Invalid batch map entry');
    entry.jobId = job.jobId;
    entry.rectype = job.rectype;
    entry.folder = job.folder;
    var out = pldRender.renderDocumentXml(job.templateSnapshot.xml, job.rectype, entry.recid, job.templateSnapshot.copies, null);

    // ตรวจว่า XML ที่ resolve แล้วอ่านได้จริงตั้งแต่ตอนนี้ ไม่ใช่ไปพังตอนรวมไฟล์
    // ซึ่งจะทำให้ทั้งชุดล่มโดยไม่รู้ว่าใบไหนเป็นต้นเหตุ (อาการเดียวกับ #184)
    var contents = out.docs.join('\n');
    if (contents.indexOf('<pdf>') === -1) {
      throw new Error('เอกสาร ' + entry.recid + ' ไม่ได้ resolve เป็น <pdf>');
    }

    assertXmlBudget(utf8Bytes(contents));
    jobs.assertFolder(job.durable);
    var partId = file.create({
      name: partName(entry.jobId, entry.seq),
      fileType: file.Type.PLAINTEXT,
      contents: contents,
      encoding: file.Encoding.UTF8,   // ข้อความไทยใน XML ต้องไม่เพี้ยนตอนอ่านกลับ
      folder: entry.folder,
      isOnline: false
    }).save();

    var part = { partId: String(partId), recid: String(entry.recid), tranId: String(out.tranId || entry.recid) };
    part.proof = integrity.seal('part', { jobId: job.jobId, snapshotDigest: job.snapshotDigest,
      seq: entry.seq, recid: part.recid, partId: part.partId, folder: String(job.folder),
      name: partName(job.jobId, entry.seq), bytes: utf8Bytes(contents), contentsHash: integrity.digest(contents) });
    try {
      context.write({
        key: sortKey(entry.seq),
        value: JSON.stringify(part)
      });
    } catch (e) {
      part.key = sortKey(entry.seq);
      cleanUp([part], job, false);
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
    var committed = false;
    var terminalReplay = false;
    try {
      // Resolve authority independently: a corrupt/missing snapshot must still
      // leave a durable FAILED state, without trusting snapshot requester fields.
      var durable = jobs.load(runtime.getCurrentScript().getParameter({ name: JOB_PARAM }));
      if (['COMPLETE', 'PARTIAL', 'FAILED'].indexOf(durable.status) >= 0) {
        terminalReplay = true;
        log.audit({ title: 'PLD batch terminal replay ignored', details: { jobId: durable.id, status: durable.status } });
        return;
      }
      job = { durable: durable, jobId: durable.id, ids: [], requester: { id: durable.requester } };
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
      job = loadJob();
      if (outputError) throw outputError;
      parts.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
      if (summary.inputSummary && summary.inputSummary.error) {
        throw new Error('Input: ' + summary.inputSummary.error);
      }
      if (parts.length > MAX_DOCS) throw new Error('Batch exceeds ' + MAX_DOCS + ' documents');
      var seen = {};
      parts.forEach(function (part) {
        var seq = Number(part.key);
        if (!/^\d{6}$/.test(part.key) || seq >= job.ids.length || seen[part.key] || String(part.recid) !== String(job.ids[seq])) throw new Error('Invalid batch output identity');
        seen[part.key] = true;
      });
      job.ids.forEach(function (recid, seq) {
        if (!seen[sortKey(seq)] && !failures.some(function (f) { return Number(f.key) === seq; })) {
          failures.push({ key: sortKey(seq), message: 'ไม่มีผลลัพธ์สำหรับเอกสาร ' + recid + ' — ส่งเอกสารนี้ใหม่' });
        }
      });
      if (parts.length > 0) result = mergeParts(job, parts, job.ids.length - parts.length);
      result.failed = job.ids.length - result.printed;
      jobs.update(job.jobId, { status: result.printed ? (result.failed ? 'PARTIAL' : 'COMPLETE') : 'FAILED',
        result: result.pdfId, resultseal: result.resultseal || '', printed: result.printed, failed: result.failed });
      committed = true;
    } catch (e) {
      fatal = e;
      failures.push({ key: 'batch', message: e.message });
      log.error({ title: 'PLD batch job failed', details: { message: e.message } });
    } finally {
      if (!terminalReplay) {
        if (!job) job = { ids: [] };
        result.failed = fatal ? (job.durable ? Number(job.durable.requested) : 0) : result.failed;
        if (fatal) { result.printed = 0; result.pdfUrl = ''; }
        if (fatal && job.durable) {
          try { jobs.update(job.jobId, { status: 'FAILED', printed: 0, failed: Number(job.durable.requested) }); }
          catch (persistError) { log.error({ title: 'PLD durable failure update failed', details: persistError.message }); }
        }
        // Preserve snapshot/parts on commit failure for operator recovery.
        if (committed) cleanUp(parts, job, true);
        if (committed || (fatal && job.durable)) notify(job, result, failures);
        log.audit({
          title: 'PLD batch job finished',
          details: {
            jobId: job.jobId, rectype: job.rectype, requested: Array.isArray(job.ids) ? job.ids.length : 0,
            printed: result.printed, failed: result.failed, pdfId: result.pdfId,
            seconds: summary.seconds, usage: summary.usage
          }
        });
      }
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
      var part = verifyPart(job, p);
      if (typeof part.size === 'number') assertXmlBudget(bytes + part.size);
      var contents = part.contents;
      bytes += utf8Bytes(contents);
      assertXmlBudget(bytes);
      docs.push(contents);
    });

    var pdfFile = pldRender.combinePdfDocs(docs);
    pdfFile.name = 'batch_' + job.rectype + '_' + parts.length + '_' + job.jobId + '.pdf';
    pdfFile.folder = job.folder;
    pdfFile.isOnline = false;
    if (!Number.isFinite(pdfFile.size) || pdfFile.size > 10 * 1024 * 1024) throw new Error('PDF exceeds authenticated download size limit');
    var originalHash = integrity.digestPdf(pdfFile.getContents());
    var originalSize = pdfFile.size;
    var originalName = pdfFile.name;
    jobs.assertFolder(job.durable);
    var pdfId = pdfFile.save();
    var saved = jobs.loadFile(job.durable, pdfId);
    if (!Number.isFinite(saved.size) || saved.size > 10 * 1024 * 1024) throw new Error('PDF exceeds authenticated download size limit');
    if (saved.size !== originalSize || saved.name !== originalName || integrity.digestPdf(saved.getContents()) !== originalHash) {
      throw new Error('PDF integrity mismatch after save');
    }
    var resultseal = integrity.seal('result', { jobId: job.jobId, folder: String(job.folder),
      fileId: String(pdfId), name: originalName, contentsHash: originalHash,
      size: originalSize, printed: parts.length, failed: failedCount,
      sequences: parts.map(function (p) { return Number(p.key); }) });
    var pdfUrl = '';
    try { pdfUrl = absoluteUrl(jobs.route(job.jobId)); } catch (linkError) {
      log.error({ title: 'PLD batch status link unavailable', details: { jobId: job.jobId, message: linkError.message } });
    }

    return {
      pdfId: pdfId,
      resultseal: resultseal,
      pdfUrl: pdfUrl,
      printed: parts.length,
      failed: failedCount
    };
  }

  function verifyPart(job, part) {
    var proof = integrity.open('part', part.proof);
    var seq = Number(part.key);
    if (proof.jobId !== job.jobId || proof.snapshotDigest !== job.snapshotDigest || proof.seq !== seq ||
      proof.recid !== String(job.ids[seq]) || proof.recid !== String(part.recid) || proof.partId !== String(part.partId) ||
      proof.folder !== String(job.folder) || proof.name !== partName(job.jobId, seq)) throw new Error('Invalid authenticated batch part identity');
    var stored = jobs.loadFile(job.durable, part.partId);
    if (stored.name !== proof.name) throw new Error('Invalid batch part file');
    if (typeof stored.size === 'number') assertXmlBudget(stored.size);
    var contents = stored.getContents();
    if (utf8Bytes(contents) !== proof.bytes || integrity.digest(contents) !== proof.contentsHash) throw new Error('Batch part integrity mismatch');
    return { size: proof.bytes, contents: contents };
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
  function cleanUp(parts, job, removeSnapshot) {
    parts.forEach(function (p) {
      try { verifyPart(job, p); file.delete({ id: p.partId }); } catch (e) {
        log.error({ title: 'PLD batch cleanup', details: { partId: p.partId, message: e.message } });
      }
    });
    try { if (removeSnapshot && job.jobFileId) {
      var snapshot = jobs.loadFile(job.durable, job.jobFileId);
      var contents = snapshot.getContents();
      integrity.open('snapshot', contents);
      if (integrity.digest(contents) !== job.snapshotDigest) throw new Error('Batch snapshot changed before cleanup');
      file.delete({ id: job.jobFileId });
    } } catch (e) {
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

    var requested = job.durable ? Number(job.durable.requested) : (Array.isArray(job.ids) ? job.ids.length : 0);
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
    } else if (result.pdfId && result.printed > 0) {
      lines.push('', 'ดูสถานะงานและดาวน์โหลดจากหน้าพิมพ์เป็นชุด');
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

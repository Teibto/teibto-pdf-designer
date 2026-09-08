/** Shared authenticated batch pipeline operations.
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define([
  "N/runtime",
  "N/file",
  "N/log",
  "N/email",
  "N/url",
  "./pld_lib_render",
  "./pld_lib_batch_jobs",
  "./pld_lib_batch_integrity",
], function (runtime, file, log, email, url, pldRender, jobs, integrity) {
  var MAX_DOCS = 500;
  var MAX_XML_BYTES = 8 * 1024 * 1024;
  // Exact framing used by the single canonical combinePdfDocs implementation.
  var FRAMING_BYTES =
    '<?xml version="1.0"?>\n<!DOCTYPE pdfset PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n<pdfset>\n\n</pdfset>'
      .length;
  function sortKey(seq) {
    return ("00000" + seq).slice(-6);
  }
  function partName(jobId, seq) {
    return "pld_part_" + jobId + "_" + sortKey(seq) + ".txt";
  }
  function artifactContext(job) {
    return {
      jobId: job.jobId,
      snapshotDigest: job.snapshotDigest,
      folder: job.folder,
      ids: job.ids,
    };
  }
  function loadJob(parameter) {
    var fileId = runtime.getCurrentScript().getParameter({ name: parameter });
    if (!fileId) {
      throw new Error(
        "ไม่ได้ระบุ job file/job record (script parameter " +
          parameter +
          ") — " +
          "สั่งงานนี้จากหน้าจอพิมพ์เป็นชุดเท่านั้น",
      );
    }
    var durable = jobs.load(fileId);
    if (["QUEUED", "RUNNING"].indexOf(durable.status) < 0)
      throw new Error("Batch job is not runnable");
    var jobFile = jobs.loadFile(durable, durable.snapshot);
    fileId = durable.snapshot;
    if (jobFile.size > 8 * 1024 * 1024)
      throw new Error("Batch job file exceeds 8 MiB");
    var contents = jobFile.getContents();
    if (utf8Bytes(contents) > 8 * 1024 * 1024)
      throw new Error("Batch job file exceeds 8 MiB");
    var job = integrity.open("snapshot", contents);
    if (!job || typeof job !== "object") throw new Error("Invalid batch job");
    if (!job.rectype || !Array.isArray(job.ids) || job.ids.length === 0) {
      throw new Error("job file " + fileId + " ไม่มี rectype หรือรายการเอกสาร");
    }
    if (job.ids.length > MAX_DOCS) {
      throw new Error("พิมพ์เป็นชุดได้ไม่เกิน " + MAX_DOCS + " ใบ");
    }
    {
      var snapshot = job.templateSnapshot;
      if (job.schemaVersion !== 5 || !snapshot) {
        throw new Error(
          "งานคิวรุ่นเก่าไม่มี template snapshot — ส่งงานใหม่จากหน้าพิมพ์เป็นชุด",
        );
      }
      if (
        typeof snapshot.xml !== "string" ||
        !snapshot.xml.trim() ||
        snapshot.xml.length > 1000000 ||
        !Array.isArray(snapshot.copies) ||
        !snapshot.copies.length ||
        snapshot.copies.some(function (c) {
          return (
            !c ||
            (c.th !== undefined && typeof c.th !== "string") ||
            (c.en !== undefined && typeof c.en !== "string") ||
            (!c.th && !c.en)
          );
        })
      )
        throw new Error("Invalid template snapshot (XML/copy bounds)");
      pldRender.resolveCopies(snapshot.copies, job.rectype);
      if (
        !/^[a-z][a-z0-9_]{0,79}$/.test(job.rectype) ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(job.jobId) ||
        !/^[1-9][0-9]*$/.test(String(job.folder)) ||
        job.ids.some(function (id) {
          return !/^[1-9][0-9]*$/.test(String(id));
        })
      ) {
        throw new Error("Invalid batch job metadata");
      }
    }
    if (
      String(job.jobId) !== durable.id ||
      String(job.folder) !== String(durable.folder) ||
      !job.requester ||
      String(job.requester.id) !== String(durable.requester) ||
      String(job.requester.role) !== String(durable.role) ||
      !Array.isArray(job.ids) ||
      job.ids.length !== Number(durable.requested)
    )
      throw new Error("Batch snapshot identity mismatch");
    job.durable = durable;
    job.jobFileId = fileId;
    job.snapshotDigest = integrity.digest(contents);
    if (durable.snapshotdigest !== job.snapshotDigest)
      throw new Error("Batch snapshot digest mismatch");
    return job;
  }

  function verifyPart(job, part) {
    var proof = integrity.open("part", part.proof);
    var seq = Number(part.key);
    if (
      proof.jobId !== job.jobId ||
      proof.snapshotDigest !== job.snapshotDigest ||
      proof.seq !== seq ||
      proof.recid !== String(job.ids[seq]) ||
      proof.recid !== String(part.recid) ||
      proof.partId !== String(part.partId) ||
      proof.folder !== String(job.folder) ||
      proof.name !== partName(job.jobId, seq)
    )
      throw new Error("Invalid authenticated batch part identity");
    var stored = jobs.loadFile(job.durable, part.partId);
    if (stored.name !== proof.name) throw new Error("Invalid batch part file");
    if (typeof stored.size === "number") assertXmlBudget(stored.size);
    var contents = stored.getContents();
    if (
      utf8Bytes(contents) !== proof.bytes ||
      integrity.digest(contents) !== proof.contentsHash
    )
      throw new Error("Batch part integrity mismatch");
    return { size: proof.bytes, contents: contents };
  }

  function assertXmlBudget(bytes) {
    if (bytes > MAX_XML_BYTES) {
      throw new Error(
        "XML ของชุดเกิน 8 MiB — ลดจำนวนเอกสารหรือสำเนาแล้วส่งใหม่",
      );
    }
  }

  function utf8Bytes(text) {
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (
        c >= 0xd800 &&
        c <= 0xdbff &&
        i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        bytes += 4;
        i++;
      } else bytes += 3;
    }
    return bytes;
  }

  /** URL ของ File Cabinet เป็น path — เติม domain ให้กดจากอีเมลได้ */
  function absoluteUrl(fileUrl) {
    try {
      return (
        "https://" +
        url.resolveDomain({ hostType: url.HostType.APPLICATION }) +
        fileUrl
      );
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
      log.audit({
        title: "PLD batch: no requester to notify",
        details: { jobId: job.jobId },
      });
      return;
    }

    var requested = job.durable
      ? Number(job.durable.requested)
      : Array.isArray(job.ids)
        ? job.ids.length
        : 0;
    var lines = [
      "พิมพ์เอกสารเป็นชุดเสร็จแล้ว",
      "",
      "หมายเลขงาน: " + job.jobId,
      "ประเภทเอกสาร: " + (job.rectype || "—"),
      "เลือกไว้: " + requested + " ใบ",
      "สร้างสำเร็จ: " + result.printed + " ใบ",
      "ล้มเหลว: " + result.failed + " ใบ",
    ];
    if (result.pdfUrl) {
      lines.push("", "ไฟล์รวม: " + result.pdfUrl);
    } else if (result.pdfId && result.printed > 0) {
      lines.push("", "ดูสถานะงานและดาวน์โหลดจากหน้าพิมพ์เป็นชุด");
    }
    if (failures.length > 0) {
      lines.push("", "ใบที่สร้างไม่สำเร็จ (ลำดับในชุด — สาเหตุ):");
      failures.slice(0, 20).forEach(function (f) {
        lines.push("  " + f.key + " — " + f.message);
      });
      if (failures.length > 20)
        lines.push(
          "  … อีก " +
            (failures.length - 20) +
            " ใบ (ดูใน Script Execution Log)",
        );
    }

    try {
      email.send({
        author: requester,
        recipients: requester,
        subject:
          "พิมพ์เอกสารเป็นชุด — " + result.printed + "/" + requested + " ใบ",
        body: lines.join("\n"),
      });
    } catch (e) {
      // อีเมลส่งไม่ออกต้องไม่ทำให้ผลลัพธ์หาย — ไฟล์อยู่ใน File Cabinet แล้ว
      log.error({
        title: "PLD batch: ส่งอีเมลแจ้งผลไม่สำเร็จ",
        details: {
          jobId: job.jobId,
          requester: requester,
          pdfId: result.pdfId,
          message: e.message,
        },
      });
    }
  }

  function readPlan(job) {
    var plan = integrity.open("plan", job.durable.plan);
    if (
      !plan ||
      plan.jobId !== job.jobId ||
      plan.snapshotDigest !== job.snapshotDigest ||
      plan.requested !== job.ids.length ||
      !Array.isArray(plan.chunks) ||
      !Array.isArray(plan.failed)
    )
      throw new Error("Invalid batch plan");
    var seen = {};
    var prior = -1;
    plan.chunks.forEach(function (chunk, index) {
      if (
        !chunk ||
        chunk.ordinal !== index ||
        !Array.isArray(chunk.sequences) ||
        !chunk.sequences.length ||
        chunk.sequences.length > 25
      )
        throw new Error("Invalid batch chunk plan");
      chunk.sequences.forEach(function (seq) {
        if (
          !Number.isInteger(seq) ||
          seq < 0 ||
          seq >= job.ids.length ||
          seen[seq] ||
          seq <= prior
        )
          throw new Error("Invalid batch sequence plan");
        seen[seq] = true;
        prior = seq;
      });
    });
    plan.failed.forEach(function (failure) {
      var seq = failure.seq;
      if (
        !Number.isInteger(seq) ||
        seq < 0 ||
        seq >= job.ids.length ||
        seen[seq] ||
        failure.recid !== String(job.ids[seq]) ||
        ["RENDER_FAILED", "NO_COMMITTED_PART"].indexOf(failure.code) < 0
      )
        throw new Error("Invalid batch failure plan");
      seen[seq] = true;
    });
    if (Object.keys(seen).length !== job.ids.length)
      throw new Error("Incomplete batch plan");
    return plan;
  }
  function verifyChunk(job, chunk, payload, verifyFile) {
    var result = integrity.open("result", payload.proof);
    if (
      result.jobId !== job.jobId ||
      result.snapshotDigest !== job.snapshotDigest ||
      result.ordinal !== chunk.ordinal ||
      result.folder !== String(job.folder) ||
      result.fileId !== String(payload.fileId) ||
      JSON.stringify(result.sequences) !== JSON.stringify(chunk.sequences) ||
      result.printed !== chunk.sequences.length ||
      !Array.isArray(result.partRefs) ||
      result.partRefs.length !== chunk.sequences.length
    )
      throw new Error("Invalid authenticated batch chunk identity");
    if (verifyFile === false) return result;
    var stored = jobs.loadFile(job.durable, payload.fileId);
    if (
      !Number.isFinite(stored.size) ||
      stored.size > 10 * 1024 * 1024 ||
      stored.size !== result.size ||
      stored.name !== result.name ||
      integrity.digestPdf(stored.getContents()) !== result.contentsHash
    )
      throw new Error("Batch chunk integrity mismatch");
    return result;
  }
  return {
    loadJob: loadJob,
    sortKey: sortKey,
    partName: partName,
    verifyPart: verifyPart,
    utf8Bytes: utf8Bytes,
    assertXmlBudget: assertXmlBudget,
    framingBytes: FRAMING_BYTES,
    artifactContext: artifactContext,
    readPlan: readPlan,
    verifyChunk: verifyChunk,
    notify: notify,
    absoluteUrl: absoluteUrl,
  };
});

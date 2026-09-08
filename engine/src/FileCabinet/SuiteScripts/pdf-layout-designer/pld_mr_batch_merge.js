/** Bounded PDF merge stage: one deterministic chunk per reduce invocation.
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define([
  "N/file",
  "N/runtime",
  "N/log",
  "./pld_lib_render",
  "./pld_lib_batch_jobs",
  "./pld_lib_batch_integrity",
  "./pld_lib_batch_artifacts",
  "./pld_lib_batch_pipeline",
], function (
  file,
  runtime,
  log,
  pldRender,
  jobs,
  integrity,
  artifacts,
  pipeline,
) {
  var PARAM = "custscript_pld_merge_job";
  function terminal(job) {
    return ["COMPLETE", "PARTIAL", "FAILED"].indexOf(job.status) >= 0;
  }
  function getInputData() {
    var durable = jobs.load(
      runtime.getCurrentScript().getParameter({ name: PARAM }),
    );
    if (terminal(durable)) return [];
    var job = pipeline.loadJob(PARAM);
    var plan = pipeline.readPlan(job);
    if (!plan.chunks.length) throw new Error("Merge plan has no chunks");
    jobs.update(
      job.jobId,
      { phase: "MERGING" },
      { status: job.durable.status, outputs: "" },
    );
    return plan.chunks;
  }
  function map(context) {
    var chunk = JSON.parse(context.value);
    if (!chunk || !Number.isInteger(chunk.ordinal))
      throw new Error("Invalid merge input");
    context.write({ key: String(chunk.ordinal), value: JSON.stringify(chunk) });
  }
  function partRefs(job, chunk, ctx, includeContents) {
    var refs = [];
    var docs = [];
    var bytes = pipeline.framingBytes;
    chunk.sequences.forEach(function (seq) {
      var part = artifacts.get(ctx, "PART", seq);
      if (!part) throw new Error("Missing committed batch part");
      var verified = pipeline.verifyPart(job, part);
      bytes += verified.size + (docs.length ? 1 : 0);
      pipeline.assertXmlBudget(bytes);
      var proof = integrity.open("part", part.proof);
      refs.push({
        seq: seq,
        partId: String(part.partId),
        contentsHash: proof.contentsHash,
      });
      docs.push(includeContents ? verified.contents : "");
    });
    return { refs: refs, docs: docs };
  }
  function verifyCommitted(job, chunk, payload, refs, verifyFile) {
    var proof = pipeline.verifyChunk(job, chunk, payload, verifyFile);
    if (
      proof.partRefs.length !== refs.length ||
      proof.partRefs.some(function (ref, i) {
        return (
          ref.seq !== refs[i].seq ||
          ref.partId !== refs[i].partId ||
          ref.contentsHash !== refs[i].contentsHash
        );
      })
    )
      throw new Error("Batch chunk part references mismatch");
    return proof;
  }
  function reduce(context) {
    var job = pipeline.loadJob(PARAM);
    var plan = pipeline.readPlan(job);
    var ordinal = Number(context.key);
    var chunk = plan.chunks[ordinal];
    if (
      !Number.isInteger(ordinal) ||
      String(ordinal) !== String(context.key) ||
      !chunk ||
      !Array.isArray(context.values) ||
      !context.values.length ||
      context.values.some(function (v) {
        return JSON.stringify(JSON.parse(v)) !== JSON.stringify(chunk);
      })
    )
      throw new Error("Invalid merge chunk input");
    var ctx = pipeline.artifactContext(job);
    var existing = artifacts.get(ctx, "CHUNK", ordinal);
    var source = partRefs(job, chunk, ctx, !existing);
    if (existing) {
      verifyCommitted(job, chunk, existing, source.refs);
      context.write({ key: String(ordinal), value: JSON.stringify(existing) });
      return;
    }
    var pdf = pldRender.combinePdfDocs(source.docs);
    pdf.name =
      "batch_" +
      job.rectype +
      "_" +
      job.jobId +
      "_chunk_" +
      pipeline.sortKey(ordinal) +
      ".pdf";
    pdf.folder = job.folder;
    pdf.isOnline = false;
    if (
      !Number.isFinite(pdf.size) ||
      pdf.size <= 0 ||
      pdf.size > 10 * 1024 * 1024
    )
      throw new Error("PDF exceeds authenticated download size limit");
    var hash = integrity.digestPdf(pdf.getContents());
    var size = pdf.size;
    var name = pdf.name;
    jobs.assertFolder(job.durable);
    var fileId = String(pdf.save());
    var saved = jobs.loadFile(job.durable, fileId);
    if (
      saved.size !== size ||
      saved.name !== name ||
      integrity.digestPdf(saved.getContents()) !== hash
    )
      throw new Error("PDF integrity mismatch after save");
    var payload = {
      fileId: fileId,
      proof: integrity.seal("result", {
        jobId: job.jobId,
        snapshotDigest: job.snapshotDigest,
        ordinal: ordinal,
        sequences: chunk.sequences,
        partRefs: source.refs,
        folder: String(job.folder),
        fileId: fileId,
        name: name,
        contentsHash: hash,
        size: size,
        printed: chunk.sequences.length,
        failed: 0,
      }),
    };
    payload = artifacts.commit(ctx, "CHUNK", ordinal, payload);
    verifyCommitted(job, chunk, payload, source.refs);
    // Lost output after this point is recoverable from the durable CHUNK row.
    context.write({ key: String(ordinal), value: JSON.stringify(payload) });
  }
  function summarize(summary) {
    var durable = jobs.load(
      runtime.getCurrentScript().getParameter({ name: PARAM }),
    );
    if (terminal(durable)) return;
    var job;
    var parts = [];
    var outputs = [];
    var printed = 0;
    var plan;
    try {
      job = pipeline.loadJob(PARAM);
      plan = pipeline.readPlan(job);
      if (summary.inputSummary && summary.inputSummary.error)
        throw new Error("Batch merge input failed");
      var ctx = pipeline.artifactContext(job);
      var chunks = artifacts.list(ctx, "CHUNK");
      var byOrdinal = {};
      chunks.forEach(function (payload) {
        var proof = integrity.open("result", payload.proof);
        if (byOrdinal[proof.ordinal]) throw new Error("Duplicate batch chunk");
        byOrdinal[proof.ordinal] = payload;
      });
      parts = artifacts.list(ctx, "PART");
      var partProofs = {};
      parts.forEach(function (part) {
        var proof = integrity.open("part", part.proof);
        partProofs[proof.seq] = proof;
      });
      if (chunks.length !== plan.chunks.length)
        throw new Error(
          "Batch merge incomplete; committed chunks retained for recovery",
        );
      plan.chunks.forEach(function (chunk) {
        var payload = byOrdinal[chunk.ordinal];
        if (!payload) throw new Error("Missing committed batch chunk");
        var refs = chunk.sequences.map(function (seq) {
          var part = partProofs[seq];
          if (!part) throw new Error("Missing committed batch part");
          return {
            seq: seq,
            partId: part.partId,
            contentsHash: part.contentsHash,
          };
        });
        var proof = verifyCommitted(job, chunk, payload, refs, false);
        if (proof.failed !== 0)
          throw new Error("Batch chunk failure count mismatch");
        printed += chunk.sequences.length;
        outputs.push({
          ordinal: chunk.ordinal,
          fileId: payload.fileId,
          proof: payload.proof,
        });
      });
      if (!printed || printed + plan.failed.length !== job.ids.length)
        throw new Error("Incomplete batch output accounting");
      var manifest = {
        jobId: job.jobId,
        snapshotDigest: job.snapshotDigest,
        folder: String(job.folder),
        requested: job.ids.length,
        printed: printed,
        failed: plan.failed.length,
        outputs: outputs,
      };
      jobs.update(
        job.jobId,
        {
          status: plan.failed.length ? "PARTIAL" : "COMPLETE",
          phase: "DONE",
          outputs: integrity.seal("manifest", manifest),
          result: outputs[0].fileId,
          resultseal: outputs[0].proof,
          printed: printed,
          failed: plan.failed.length,
        },
        {
          status: "RUNNING",
          phase: "MERGING",
          outputs: "",
          plan: job.durable.plan,
        },
      );
    } catch (error) {
      // No output is published unless every planned chunk is committed and checked.
      var current = jobs.load(durable.id);
      if (current.status === "COMPLETE" || current.status === "PARTIAL") return;
      try {
        jobs.update(durable.id, {
          status: "FAILED", phase: "MERGE_FAILED", printed: 0, failed: Number(durable.requested),
        }, { status: current.status, phase: current.phase, outputs: current.outputs });
      } catch (persistError) {
        var latest = jobs.load(durable.id);
        if (latest.status === "COMPLETE" || latest.status === "PARTIAL") return;
        log.error({ title: "PLD merge failure persistence failed", details: { jobId: durable.id, message: persistError.message } });
        throw error;
      }
      pipeline.notify(job || { jobId: durable.id, durable: durable, requester: { id: durable.requester } },
        { printed: 0, failed: Number(durable.requested) }, [{ key: "merge", message: "รวมไฟล์ไม่สำเร็จ กรุณาดูสถานะงานเพื่อทำขั้นรวมไฟล์ต่อ" }]);
      throw error;
    }
    // Inputs remain available for bounded retention cleanup; never delete 500 files in summarize.
    var route = "";
    try {
      route = pipeline.absoluteUrl(jobs.route(job.jobId));
    } catch (error) {
      log.error({
        title: "PLD batch route unavailable",
        details: { jobId: job.jobId, message: error.message },
      });
    }
    pipeline.notify(
      job,
      {
        printed: printed,
        failed: plan.failed.length,
        pdfId: outputs[0].fileId,
        pdfUrl: route,
      },
      plan.failed.map(function (f) {
        return { key: pipeline.sortKey(f.seq), message: f.code };
      }),
    );
  }
  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});

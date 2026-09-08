/** Render stage: immutable per-document artifacts, followed by a durable chunk plan.
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define([
  "N/file",
  "N/runtime",
  "N/task",
  "N/log",
  "./pld_lib_render",
  "./pld_lib_batch_jobs",
  "./pld_lib_batch_integrity",
  "./pld_lib_batch_artifacts",
  "./pld_lib_batch_pipeline",
], function (
  file,
  runtime,
  task,
  log,
  pldRender,
  jobs,
  integrity,
  artifacts,
  pipeline,
) {
  var PARAM = "custscript_pld_mr_job";
  function getInputData() {
    var job = pipeline.loadJob(PARAM);
    if (job.durable.plan) return [];
    jobs.update(job.jobId, { status: "RUNNING", phase: "RENDERING" });
    return job.ids.map(function (id, seq) {
      return {
        seq: seq,
        recid: String(id),
        jobId: job.jobId,
        rectype: job.rectype,
        folder: job.folder,
      };
    });
  }
  function map(context) {
    var entry = JSON.parse(context.value);
    var job = pipeline.loadJob(PARAM);
    if (job.durable.plan) throw new Error("Batch render plan already sealed");
    if (
      !Number.isInteger(entry.seq) ||
      entry.seq < 0 ||
      entry.seq >= job.ids.length ||
      String(entry.recid) !== String(job.ids[entry.seq])
    )
      throw new Error("Invalid batch map entry");
    var ctx = pipeline.artifactContext(job);
    var part = artifacts.get(ctx, "PART", entry.seq);
    if (part) {
      pipeline.verifyPart(job, part);
      context.write({
        key: pipeline.sortKey(entry.seq),
        value: JSON.stringify(part),
      });
      return;
    }
    var rendered = pldRender.renderDocumentXml(
      job.templateSnapshot.xml,
      job.rectype,
      String(entry.recid),
      job.templateSnapshot.copies,
      null,
    );
    var contents = rendered.docs.join("\n");
    if (contents.indexOf("<pdf>") < 0)
      throw new Error("Document did not resolve to <pdf>");
    var bytes = pipeline.utf8Bytes(contents);
    pipeline.assertXmlBudget(bytes + pipeline.framingBytes);
    jobs.assertFolder(job.durable);
    var partId = String(
      file
        .create({
          name: pipeline.partName(job.jobId, entry.seq),
          fileType: file.Type.PLAINTEXT,
          contents: contents,
          encoding: file.Encoding.UTF8,
          folder: job.folder,
          isOnline: false,
        })
        .save(),
    );
    part = {
      partId: partId,
      recid: String(entry.recid),
      tranId: String(rendered.tranId || entry.recid),
      key: pipeline.sortKey(entry.seq),
    };
    part.proof = integrity.seal("part", {
      jobId: job.jobId,
      snapshotDigest: job.snapshotDigest,
      seq: entry.seq,
      recid: part.recid,
      tranId: part.tranId,
      partId: partId,
      folder: String(job.folder),
      name: pipeline.partName(job.jobId, entry.seq),
      bytes: bytes,
      contentsHash: integrity.digest(contents),
    });
    pipeline.verifyPart(job, part);
    // The unique durable ledger is authoritative even if context.write is lost.
    part = artifacts.commit(ctx, "PART", entry.seq, part);
    pipeline.verifyPart(job, part);
    context.write({
      key: pipeline.sortKey(entry.seq),
      value: JSON.stringify(part),
    });
  }
  function summarize(summary) {
    var durable = jobs.load(
      runtime.getCurrentScript().getParameter({ name: PARAM }),
    );
    if (["COMPLETE", "PARTIAL", "FAILED"].indexOf(durable.status) >= 0) return;
    var job;
    try {
      job = pipeline.loadJob(PARAM);
      // Never resubmit an already planned job: prior submission may have been accepted.
      if (job.durable.plan) {
        pipeline.readPlan(job);
        if (job.durable.phase !== "MERGE_PENDING") return;
      } else {
        if (summary.inputSummary && summary.inputSummary.error)
          throw new Error("Batch render input failed");
        var ctx = pipeline.artifactContext(job);
        var parts = artifacts.list(ctx, "PART");
        var bySeq = {};
        parts.forEach(function (part) {
          var proof = integrity.open("part", part.proof);
          var seq = proof.seq;
          if (
            !Number.isInteger(seq) ||
            seq < 0 ||
            seq >= job.ids.length ||
            bySeq[seq] ||
            part.key !== pipeline.sortKey(seq)
          )
            throw new Error("Invalid batch artifact sequence");
          bySeq[seq] = { part: part, bytes: proof.bytes };
        });
        var errors = {};
        if (summary.mapSummary && summary.mapSummary.errors)
          summary.mapSummary.errors.iterator().each(function (key) {
            var seq = Number(key);
            if (Number.isInteger(seq) && seq >= 0 && seq < job.ids.length)
              errors[seq] = true;
            return true;
          });
        var plan = {
          jobId: job.jobId,
          snapshotDigest: job.snapshotDigest,
          chunks: [],
          requested: job.ids.length,
          failed: [],
        };
        var chunk = null;
        var bytes = 0;
        job.ids.forEach(function (id, seq) {
          var item = bySeq[seq];
          if (!item) {
            plan.failed.push({
              seq: seq,
              recid: String(id),
              code: errors[seq] ? "RENDER_FAILED" : "NO_COMMITTED_PART",
            });
            return;
          }
          pipeline.assertXmlBudget(item.bytes + pipeline.framingBytes);
          if (
            !chunk ||
            chunk.sequences.length >= 25 ||
            bytes + 1 + item.bytes > 8 * 1024 * 1024
          ) {
            chunk = { ordinal: plan.chunks.length, sequences: [] };
            plan.chunks.push(chunk);
            bytes = pipeline.framingBytes;
          }
          bytes += item.bytes + (chunk.sequences.length ? 1 : 0);
          chunk.sequences.push(seq);
        });
        jobs.update(
          job.jobId,
          {
            plan: integrity.seal("plan", plan),
            phase: "MERGE_PENDING",
            status: "RUNNING",
          },
          { plan: "", status: job.durable.status },
        );
        if (!plan.chunks.length) {
          jobs.update(job.jobId, {
            status: "FAILED",
            phase: "DONE",
            printed: 0,
            failed: job.ids.length,
          });
          pipeline.notify(
            job,
            { printed: 0, failed: job.ids.length },
            plan.failed.map(function (f) {
              return { key: pipeline.sortKey(f.seq), message: f.code };
            }),
          );
          return;
        }
      }
    } catch (error) {
      // A competing summarizer may already have sealed and submitted this plan.
      if (jobs.load(durable.id).plan) throw error;
      jobs.update(durable.id, {
        status: "FAILED",
        phase: "DONE",
        printed: 0,
        failed: Number(durable.requested),
      }, { plan: "", outputs: "" });
      pipeline.notify(job || { jobId: durable.id, durable: durable, requester: { id: durable.requester } },
        { printed: 0, failed: Number(durable.requested) }, [{ key: "render", message: "สร้างเอกสารไม่สำเร็จ กรุณาแจ้งผู้ดูแลพร้อมหมายเลขงาน" }]);
      throw error;
    }
    // Persist the intent before calling an external scheduler; ambiguity is operator-visible.
    try {
      jobs.update(
        job.jobId,
        { phase: "MERGE_SUBMITTING", mergetask: "" },
        { phase: "MERGE_PENDING", status: "RUNNING" },
      );
    } catch (claimError) {
      if (jobs.load(job.jobId).phase !== "MERGE_PENDING") return;
      throw claimError;
    }
    var taskId;
    try {
      var pending = task.create({ taskType: task.TaskType.MAP_REDUCE });
      pending.scriptId = "customscript_pld_batch_merge";
      pending.deploymentId = "customdeploy_pld_batch_merge";
      pending.params = { custscript_pld_merge_job: job.jobId };
      taskId = pending.submit();
      if (!taskId) throw new Error("Merge task submission returned no task ID");
    } catch (error) {
      try {
        jobs.update(job.jobId, { phase: "MERGE_SUBMIT_UNKNOWN" });
      } catch (persistError) {
        log.error({
          title: "PLD merge submission state unavailable",
          details: { jobId: job.jobId, message: persistError.message },
        });
      }
      throw error;
    }
    try {
      jobs.update(job.jobId, { mergetask: String(taskId) });
    } catch (error) {
      log.error({
        title: "PLD merge task accepted; task metadata not persisted",
        details: {
          jobId: job.jobId,
          taskId: String(taskId),
          message: error.message,
        },
      });
    }
  }
  return { getInputData: getInputData, map: map, summarize: summarize };
});

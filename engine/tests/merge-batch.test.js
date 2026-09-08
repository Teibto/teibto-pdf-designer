/**
 * Durable two-stage batch pipeline and replay integration (#199)
 *
 * สัญญาที่ test ชุดนี้ตรึงไว้:
 *  - หนึ่งเอกสาร = หนึ่ง key (map ได้ 1,000 units ต่อ key ชุดใหญ่จึงไม่ชนโควตา)
 *  - ลำดับเอกสารในไฟล์รวมต้องตรงกับที่ผู้ใช้เลือก
 *  - ใบที่พังต้องถูกรายงานรายใบ ไม่ใช่หายไปจากชุดเงียบ ๆ (R4)
 *  - Inputs remain private and retained for separately bounded cleanup
 *  - อีเมลแจ้งผลส่งไม่ออก ต้องไม่ทำให้ไฟล์ที่สร้างแล้วสูญไปด้วย
 *
 * @author Wichit Wongta
 * @since 2026-09-09
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadAmd } = require("./helpers/amd");
const {
  logStub,
  companyConfigStub,
  runtimeStub,
  renderStub,
  formatStub,
  fileSystemStub,
} = require("./helpers/ns-stubs");

const TPL_XML = "<pdf><body>ok</body></pdf>";
const TWO_COPIES = JSON.stringify({
  copies: [
    { th: "ต้นฉบับ", en: "Original" },
    { th: "สำเนา", en: "Copy" },
  ],
});

const JOB = {
  schemaVersion: 5,
  templateSnapshot: { xml: TPL_XML, copies: JSON.parse(TWO_COPIES).copies },
  jobId: "501",
  rectype: "itemfulfillment",
  tplid: "7",
  ids: ["11", "12", "13"],
  folder: "77",
  requester: {
    id: "9",
    role: "3",
    name: "QA Tester",
    email: "qa@example.test",
  },
};

/**
 * @param {Object} opts
 * @param {Object} opts.job        job spec (null → ไม่มี parameter)
 * @param {Array}  opts.failIds    record ids ที่ record.load พัง
 * @param {boolean} opts.emailFails  ให้ email.send โยน error
 */
function buildMr({ job = JOB, failIds = [], emailFails = false } = {}) {
  const log = logStub();
  let signedSnapshot;
  const files = fileSystemStub({
    files: job
      ? {
          '/SuiteScripts/pdf-layout-designer/pld_version.txt': { folder: '55' },
          900: {
            name: "pld_job_501.json",
            get size() { return Buffer.byteLength(signedSnapshot || ""); },
            folder: "77",
            isOnline: false,
            getContents: () => signedSnapshot,
          },
        }
      : {},
  });
  const render = renderStub({ fileSystem: files });
  const emails = [];
  const tasks = [];
  const taskModule = {
    TaskType: { MAP_REDUCE: "MAP_REDUCE" },
    create(options = {}) {
      return {
        scriptId: options.scriptId, deploymentId: options.deploymentId, params: options.params,
        submit() {
          tasks.push({
            scriptId: this.scriptId,
            deploymentId: this.deploymentId,
            params: this.params,
          });
          return "merge-task-1";
        },
      };
    },
  };
  const stubs = {
    "N/file": files.module,
    "N/task": taskModule,
    "N/render": render.module,
    "N/runtime": runtimeStub({
      script: { getParameter: () => (job ? "501" : "") },
    }),
    "N/log": log.module,
    "N/email": {
      send(opts) {
        emails.push(opts);
        if (emailFails) throw new Error("SSS_MISSING_REQD_ARGUMENT: author");
      },
    },
    "N/url": {
      HostType: { APPLICATION: "APPLICATION" },
      resolveDomain: () => "acct.app.netsuite.com",
    },
    "N/format": formatStub,
    "N/search": {
      create: () => ({ run: () => ({ getRange: () => [], each: () => {} }) }),
    },
    "N/record": {
      Type: {},
      load: ({ id }) => {
        if (failIds.indexOf(String(id)) !== -1)
          throw new Error("This record does not exist: " + id);
        return {
          id,
          getValue: ({ fieldId }) => {
            if (fieldId === "tranid") return "IF-" + id;
            if (fieldId === "custrecord_pld_tpl_xml") return TPL_XML;
            if (fieldId === "custrecord_pld_tpl_data") return TWO_COPIES;
            return "";
          },
          getText: () => "",
        };
      },
    },
    "./pld_lib_company_config": companyConfigStub,
    "./pld_lib_invoice_data": {
      isSupportedType: () => false,
      buildTransactionData: () => ({}),
      docTitles: {},
    },
  };
  const rows = require("./helpers/batch-store").batchStore(stubs, files, job);
  const artifactRows =
    require("./helpers/batch-artifact-store").installArtifactStore(stubs);
  files.integrity = loadAmd("./pld_lib_batch_integrity", stubs);
  if (job) {
    signedSnapshot = files.integrity.seal("snapshot", job);
    files.snapshotDigest = files.integrity.digest(signedSnapshot);
    rows.get("501").custrecord_pld_job_snapshotdigest = files.snapshotDigest;
    require("./helpers/batch-store").signJob(stubs, "501", rows.get("501"));
  }
  return {
    stubs,
    rows,
    tasks,
    artifactRows,
    artifacts: loadAmd("./pld_lib_batch_artifacts", stubs),
    jobs: loadAmd("./pld_lib_batch_jobs", stubs),
    merge: loadAmd("./pld_mr_batch_merge", stubs),
    mr: loadAmd("./pld_mr_batch_print", stubs),
    log,
    render,
    files,
    emails,
  };
}

/** map context ที่จดสิ่งที่ถูก write ออกไป */
function mapContext(entry) {
  const written = [];
  return {
    written,
    context: { value: JSON.stringify(entry), write: (kv) => written.push(kv) },
  };
}

/** summary object ของ Map/Reduce (output + error iterator) */
function summaryStub({ output = [], errors = [] } = {}) {
  return {
    seconds: 42,
    usage: 1234,
    output: {
      iterator: () => ({
        each: (fn) => {
          output.every(([k, v]) => fn(k, v) !== false);
        },
      }),
    },
    mapSummary: {
      errors: {
        iterator: () => ({
          each: (fn) => {
            errors.every(([k, e]) => fn(k, e) !== false);
          },
        }),
      },
    },
  };
}

function runRender(f) {
  const errors = [];
  for (const entry of f.mr.getInputData()) {
    try {
      f.mr.map(mapContext(entry).context);
    } catch (error) {
      errors.push([
        String(entry.seq),
        JSON.stringify({ message: error.message }),
      ]);
    }
  }
  f.mr.summarize(summaryStub({ errors }));
}
function chunkContext(chunk, write = () => {}) {
  return { key: String(chunk.ordinal), values: [JSON.stringify(chunk)], write };
}
function runMerge(f) {
  for (const chunk of f.merge.getInputData())
    f.merge.reduce(chunkContext(chunk));
  f.merge.summarize(summaryStub());
}
function ctx(f, ids = JOB.ids) {
  return {
    jobId: "501",
    snapshotDigest: f.files.snapshotDigest,
    folder: "77",
    ids,
  };
}
function seedPart(f, seq, text, ids = JOB.ids) {
  const partId = String(
    f.files.module
      .create({
        name: "pld_part_501_" + String(seq).padStart(6, "0") + ".txt",
        fileType: "PLAINTEXT",
        encoding: "UTF-8",
        contents: text,
        folder: "77",
        isOnline: false,
      })
      .save(),
  );
  const part = {
    partId,
    recid: String(ids[seq]),
    tranId: "QA-" + ids[seq],
    key: String(seq).padStart(6, "0"),
  };
  part.proof = f.files.integrity.seal("part", {
    jobId: "501",
    snapshotDigest: f.files.snapshotDigest,
    seq,
    recid: part.recid,
    tranId: part.tranId,
    partId,
    folder: "77",
    name: "pld_part_501_" + part.key + ".txt",
    bytes: Buffer.byteLength(text),
    contentsHash: f.files.integrity.digest(text),
  });
  return f.artifacts.commit(ctx(f, ids), "PART", seq, part);
}

test("real render, artifact ledger, merge and authenticated download complete the pipeline", () => {
  const f = buildMr();
  runRender(f);
  assert.equal(
    f.render.calls.xmlToPdf.length,
    0,
    "render summarize does not run BFO merge",
  );
  assert.equal(f.tasks.length, 1);
  assert.equal(f.tasks[0].scriptId, "customscript_pld_batch_merge");
  assert.equal(f.tasks[0].deploymentId, undefined, "native selection must not pin merge handoff to one deployment");
  assert.equal(f.tasks[0].params.custscript_pld_merge_job, "501");
  assert.equal(f.jobs.load("501").status, "RUNNING");
  assert.throws(() => f.jobs.download("501"), /not committed/);
  runMerge(f);
  const job = f.jobs.load("501");
  assert.equal(job.status, "COMPLETE");
  assert.equal(Number(job.printed), 3);
  const manifest = f.files.integrity.open("manifest", job.outputs);
  assert.equal(manifest.outputs.length, 1);
  assert.equal(manifest.requested, 3);
  assert.equal(manifest.failed, 0);
  assert.ok(f.jobs.download("501", 0).name.endsWith(".pdf"));
  assert.equal(f.emails.length, 1);
  assert.match(f.emails[0].body, /action=status&job=501/);
  assert.doesNotMatch(f.emails[0].body, /media.nl/);
  assert.equal(
    f.files.deleted.length,
    0,
    "inputs retained for separately bounded cleanup",
  );
});

test("51 documents form 25/25/1 chunks with globally ordered download membership", () => {
  const ids = Array.from({ length: 51 }, (_, i) => String(i + 11));
  const f = buildMr({ job: { ...JOB, ids } });
  runRender(f);
  const plan = f.files.integrity.open("plan", f.jobs.load("501").plan);
  assert.deepEqual(
    Array.from(plan.chunks, (c) => c.sequences.length),
    [25, 25, 1],
  );
  runMerge(f);
  const manifest = f.files.integrity.open(
    "manifest",
    f.jobs.load("501").outputs,
  );
  assert.equal(manifest.outputs.length, 3);
  assert.equal(manifest.printed, 51);
  for (let i = 0; i < 3; i++)
    assert.ok(f.jobs.download("501", i).name.includes("_chunk_"));
  assert.throws(() => f.jobs.download("501", 3), /หมายเลขไฟล์/);
});

test("lost render context.write preserves committed PART and replay does not rerender", () => {
  const f = buildMr();
  const entry = f.mr.getInputData()[0];
  assert.throws(
    () =>
      f.mr.map({
        ...mapContext(entry).context,
        write() {
          throw new Error("lost output");
        },
      }),
    /lost output/,
  );
  const rendered = f.render.calls.renderedAsString;
  const files = f.files.created.length;
  f.mr.map(mapContext(entry).context);
  assert.equal(f.render.calls.renderedAsString, rendered);
  assert.equal(f.files.created.length, files);
  f.mr.summarize(summaryStub({ errors: [["0", "lost output"]] }));
  runMerge(f);
  assert.equal(f.jobs.load("501").status, "PARTIAL");
  assert.equal(Number(f.jobs.load("501").printed), 1);
});

for (const kind of ["PART", "CHUNK"]) {
  for (const interruption of ["save acknowledgement", "ledger commit"]) {
    test(kind + " retry adopts a saved file after lost " + interruption + " without rendering again", () => {
      const f = buildMr();
      let invoke;
      if (kind === "PART") {
        const entry = f.mr.getInputData()[0];
        invoke = () => f.mr.map(mapContext(entry).context);
      } else {
        runRender(f);
        const chunk = f.merge.getInputData()[0];
        invoke = () => f.merge.reduce(chunkContext(chunk));
      }
      if (interruption === "ledger commit") {
        f.artifactRows.beforeSave = ({ fields }) => {
          if (fields.custrecord_pld_art_kind === kind && fields.custrecord_pld_art_state === "COMMITTED") {
            f.artifactRows.beforeSave = null;
            throw new Error("synthetic interruption after file save");
          }
        };
      } else {
        const module = kind === "PART" ? f.files.module : f.stubs["N/render"];
        const method = kind === "PART" ? "create" : "xmlToPdf";
        const original = module[method];
        module[method] = opts => {
          const file = original(opts), save = file.save;
          file.save = function () {
            save.call(this);
            module[method] = original;
            throw new Error("synthetic interruption after file save");
          };
          return file;
        };
      }
      assert.throws(invoke, /synthetic interruption/);
      assert.equal(f.artifacts.get(ctx(f), kind, 0), null);
      assert.equal(f.artifacts.list(ctx(f), kind).length, 0);
      const renders = f.render.calls.renderedAsString, merges = f.render.calls.xmlToPdf.length;
      const files = f.files.created.length, savedPdfs = f.render.calls.savedFiles.length;
      invoke();
      assert.ok(f.artifacts.get(ctx(f), kind, 0));
      assert.equal(f.render.calls.renderedAsString, renders);
      assert.equal(f.render.calls.xmlToPdf.length, merges);
      assert.equal(f.files.created.length, files);
      assert.equal(f.render.calls.savedFiles.length, savedPdfs);
      if (kind === "PART") runRender(f);
      runMerge(f);
      assert.equal(f.jobs.load("501").status, "COMPLETE");
      assert.ok(f.jobs.download("501", 0).getContents());
      assert.equal(f.files.deleted.length, 0);
    });
  }
  test(kind + " retry rejects changed orphan bytes before rendering or publication", () => {
    const f = buildMr();
    let invoke;
    if (kind === "PART") {
      const entry = f.mr.getInputData()[0]; invoke = () => f.mr.map(mapContext(entry).context);
    } else {
      runRender(f); const chunk = f.merge.getInputData()[0]; invoke = () => f.merge.reduce(chunkContext(chunk));
    }
    f.artifactRows.beforeSave = ({ fields }) => {
      if (fields.custrecord_pld_art_kind === kind && fields.custrecord_pld_art_state === "COMMITTED") {
        f.artifactRows.beforeSave = null;
        const payload = JSON.parse(fields.custrecord_pld_art_payload);
        const id = payload.partId || payload.fileId;
        const body = f.files.contents[id];
        f.files.contents[id] = (body[0] === "A" ? "B" : "A") + body.slice(1);
        throw new Error("synthetic interrupted commit");
      }
    };
    assert.throws(invoke, /interrupted commit/);
    const renders = f.render.calls.renderedAsString, merges = f.render.calls.xmlToPdf.length;
    assert.throws(invoke, /contents mismatch/);
    assert.equal(f.artifacts.get(ctx(f), kind, 0), null);
    assert.equal(f.render.calls.renderedAsString, renders);
    assert.equal(f.render.calls.xmlToPdf.length, merges);
    assert.equal(f.jobs.load("501").outputs, "");
    assert.equal(f.files.deleted.length, 0);
  });
}

test("failure details use the original ordered selection for partial and all-failed jobs without rendering", () => {
  for (const allFailed of [false, true]) {
    const f = buildMr({ job: { ...JOB, ids: ["11", "12", "12"] }, failIds: allFailed ? ["11", "12"] : ["12"] });
    runRender(f);
    if (!allFailed) runMerge(f);
    const helpers = require("./helpers/ns-stubs"); f.stubs["N/xml"] = helpers.xmlStub;
    const sl = loadAmd("./pld_sl_batch_print", f.stubs);
    const status = helpers.contextStub({ parameters: { action: "status", job: "501" } }); sl.onRequest(status.context);
    assert.match(status.response.state.body, /action=failures/);
    const before = JSON.stringify([...f.rows]), renders = f.render.calls.renderedAsString, tasks = f.tasks.length;
    const details = helpers.contextStub({ parameters: { action: "failures", job: "501", ids: "99", file: "999" } });
    sl.onRequest(details.context);
    const html = details.response.state.body;
    assert.match(html, /รายการที่ไม่สำเร็จ/);
    assert.match(html, /<td>2<\/td><td>12<\/td><td>สร้างเอกสารไม่สำเร็จ/);
    assert.match(html, /<td>3<\/td><td>12<\/td><td>สร้างเอกสารไม่สำเร็จ/);
    assert.equal(html.includes('<td>1</td><td>11</td>'), allFailed);
    assert.match(html, /action=status/);
    assert.equal(html.includes('กลับไปดูสถานะงานและไฟล์ PDF ที่สร้างสำเร็จ'), !allFailed);
    assert.doesNotMatch(html, /media\.nl|<td>99<\/td>/);
    assert.match(html, /action=retry_failed/);
    assert.equal(JSON.stringify([...f.rows]), before);
    assert.equal(f.render.calls.renderedAsString, renders); assert.equal(f.tasks.length, tasks);
  }
});

test("failure details reject changed snapshot identity without leaking source selections", () => {
  const f = buildMr({ failIds: ["12"] }); runRender(f); runMerge(f);
  f.stubs["N/xml"] = require("./helpers/ns-stubs").xmlStub;
  const load = f.files.module.load;
  f.files.module.load = opts => String(opts.id) === "900" ? { ...load(opts), isOnline: true } : load(opts);
  const sl = loadAmd("./pld_sl_batch_print", f.stubs);
  const details = require("./helpers/ns-stubs").contextStub({ parameters: { action: "failures", job: "501" } });
  sl.onRequest(details.context);
  assert.doesNotMatch(details.response.state.body, /<td>12<\/td>|<caption>/);
  assert.match(details.response.state.body, /ไม่สำเร็จ|ข้อผิดพลาด/);
});

function linkedFixture(allFailed = false) {
  const failIds = allFailed ? ["11", "12"] : ["12"];
  const f = buildMr({ job: { ...JOB, ids: ["11", "12", "12"] }, failIds });
  runRender(f); if (!allFailed) runMerge(f);
  f.stubs["N/xml"] = require("./helpers/ns-stubs").xmlStub;
  return { ...f, failIds, retry: loadAmd("./pld_lib_batch_retry", f.stubs) };
}
test("linked retry submits one child, preserves original results and renders original failed occurrences", () => {
  for (const allFailed of [false, true]) {
    const f = linkedFixture(allFailed), before = JSON.stringify(f.rows.get("501")), tasks = f.tasks.length;
    const token = f.retry.token("501"), result = f.retry.run("501", token), child = result.job;
    assert.notEqual(child.id, "501"); assert.notEqual(child.folder, "77");
    assert.equal(f.retry.run("501", token).job.id, child.id); assert.equal(f.tasks.length, tasks + 1);
    const snapshot = f.files.integrity.open("snapshot", f.files.module.load({ id: child.snapshot }).getContents());
    assert.deepEqual(Array.from(snapshot.ids), allFailed ? ["11", "12", "12"] : ["12", "12"]);
    assert.equal(snapshot.templateSnapshot.xml, TPL_XML);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.templateSnapshot.copies)), JOB.templateSnapshot.copies);
    assert.deepEqual(Array.from(snapshot.lineage.sequences), allFailed ? [0, 1, 2] : [1, 2]);
    assert.equal(snapshot.lineage.sourceJobId, "501");
    f.failIds.splice(0);
    Object.assign(f.stubs["N/runtime"], runtimeStub({ script: { getParameter: () => child.id } }));
    runRender(f); runMerge(f);
    assert.equal(f.jobs.load(child.id).status, "COMPLETE");
    assert.equal(f.jobs.load(child.id).printed, allFailed ? "3" : "2");
    assert.ok(f.jobs.download(child.id, 0).getContents());
    assert.equal(JSON.stringify(f.rows.get("501")), before);
    assert.equal(f.files.deleted.length, 0);
    assert.equal(f.retry.run("501", token).job.id, child.id);
    const origin = f.retry.origin(child.id);
    assert.equal(origin.jobId, "501"); assert.deepEqual(Array.from(origin.sequences), allFailed ? [0, 1, 2] : [1, 2]);
    const helpers = require("./helpers/ns-stubs"), status = helpers.contextStub({ parameters: { action: "status", job: child.id } });
    loadAmd("./pld_sl_batch_print", f.stubs).onRequest(status.context);
    assert.match(status.response.state.body, /งานต้นฉบับ/);
    assert.match(status.response.state.body, allFailed ? /ลำดับในงานต้นฉบับ: 1, 2, 3/ : /ลำดับในงานต้นฉบับ: 2, 3/);
  }
});

test("lost linked submission-claim acknowledgement stays pending and never resubmits blindly", () => {
  const f = linkedFixture(), token = f.retry.token("501"), tasks = f.tasks.length;
  f.rows.afterSave = ({ fields }) => {
    if (fields.externalid && fields.custrecord_pld_job_phase === "RENDER_SUBMITTING") {
      f.rows.afterSave = null; throw new Error("lost submission claim acknowledgement");
    }
  };
  const result = f.retry.run("501", token);
  assert.equal(result.job.phase, "RENDER_SUBMITTING"); assert.equal(result.job.task, "");
  assert.equal(f.tasks.length, tasks);
  assert.equal(f.retry.run("501", token).job.id, result.job.id); assert.equal(f.tasks.length, tasks);
  const helpers = require("./helpers/ns-stubs"), status = helpers.contextStub({ parameters: { action: "status", job: result.job.id } });
  loadAmd("./pld_sl_batch_print", f.stubs).onRequest(status.context);
  assert.match(status.response.state.body, /ยังไม่ยืนยันว่าเริ่มประมวลผลแล้ว/);
});

test("linked retry cannot replace an altered retained snapshot or downgrade a worker that started", () => {
  const f = linkedFixture(), token = f.retry.token("501"), create = f.stubs["N/task"].create;
  f.stubs["N/task"].create = () => { throw new Error("prepare interrupted"); };
  assert.throws(() => f.retry.run("501", token), /prepare interrupted/);
  const childId = [...f.rows].find(([, row]) => row.externalid)?.[0], child = f.jobs.load(childId);
  const contents = f.files.contents[child.snapshot]; f.files.contents[child.snapshot] = "X" + contents.slice(1);
  f.stubs["N/task"].create = create;
  assert.throws(() => f.retry.run("501", token), /snapshot integrity/);
  f.files.contents[child.snapshot] = contents;
  f.stubs["N/task"].create = () => ({ submit() {
    f.jobs.update(childId, { status: "RUNNING", phase: "RENDERING" });
    const error = new Error("rejected after synthetic worker progress"); error.name = "FAILED_TO_SUBMIT_JOB_REQUEST_1"; throw error;
  } });
  const result = f.retry.run("501", token);
  assert.equal(result.job.status, "RUNNING"); assert.equal(result.job.phase, "RENDERING");
});

test("a failed child can create its own linked retry without another child from the original source", () => {
  const f = linkedFixture(), token = f.retry.token("501"), child = f.retry.run("501", token).job;
  Object.assign(f.stubs["N/runtime"], runtimeStub({ script: { getParameter: () => child.id } }));
  runRender(f);
  assert.equal(f.jobs.load(child.id).status, "FAILED");
  const next = f.retry.run(child.id, f.retry.token(child.id)).job;
  assert.notEqual(next.id, child.id); assert.equal(f.retry.origin(next.id).jobId, child.id);
  assert.equal(f.retry.run("501", token).job.id, child.id);
});

test("invalid or inaccessible source lineage shows a notice while valid child PDFs remain downloadable", () => {
  for (const mutation of ["parent plan", "parent role", "child snapshot"]) {
    const f = linkedFixture(), child = f.retry.run("501", f.retry.token("501")).job;
    f.failIds.splice(0); Object.assign(f.stubs["N/runtime"], runtimeStub({ script: { getParameter: () => child.id } }));
    runRender(f); runMerge(f);
    if (mutation === "parent plan") f.jobs.update("501", { plan: f.files.integrity.seal("plan", {}) });
    if (mutation === "parent role") {
      f.rows.get("501").custrecord_pld_job_role = "4";
      require("./helpers/batch-store").signJob(f.stubs, "501", f.rows.get("501"));
    }
    if (mutation === "child snapshot") f.files.contents[child.snapshot] = "changed";
    assert.throws(() => f.retry.origin(child.id));
    const helpers = require("./helpers/ns-stubs"), status = helpers.contextStub({ parameters: { action: "status", job: child.id } });
    loadAmd("./pld_sl_batch_print", f.stubs).onRequest(status.context);
    assert.match(status.response.state.body, /ยังแสดงข้อมูลเชื่อมโยงงานต้นฉบับไม่ได้/);
    assert.doesNotMatch(status.response.state.body, /งานต้นฉบับ <a/);
    assert.match(status.response.state.body, /action=download/);
    assert.ok(f.jobs.download(child.id, 0).getContents());
  }
});

test("linked retry rejects missing, stale, cross-action and wrong-actor tokens before child creation", () => {
  const f = linkedFixture(), token = f.retry.token("501"), count = f.rows.size;
  for (const value of [undefined, "", token + " ", f.files.integrity.seal("recovery", {})]) assert.throws(() => f.retry.run("501", value));
  f.jobs.update("501", { task: "changed-authoritative-task" });
  assert.throws(() => f.retry.run("501", token), /token identity/);
  Object.assign(f.stubs["N/runtime"], runtimeStub({ user: { id: 10, role: 3 } }));
  assert.throws(() => f.retry.run("501", token), /unavailable/);
  assert.equal(f.rows.size, count);
});

test("linked retry resumes snapshot and task preparation interruptions using one child", () => {
  for (const interruption of ["snapshot", "task preparation"]) {
    const f = linkedFixture(), token = f.retry.token("501"), create = f.stubs["N/task"].create;
    if (interruption === "snapshot") {
      const original = f.files.module.create;
      f.files.module.create = opts => {
        const out = original(opts), save = out.save;
        out.save = function () { save.call(this); f.files.module.create = original; throw new Error("lost snapshot acknowledgement"); };
        return out;
      };
    } else f.stubs["N/task"].create = () => { throw new Error("task preparation interrupted"); };
    if (interruption === "task preparation") assert.throws(() => f.retry.run("501", token), /preparation interrupted/);
    else f.retry.run("501", token);
    const childIds = [...f.rows].filter(([, row]) => row.externalid?.startsWith("pld-retry-")).map(([id]) => id);
    assert.equal(childIds.length, 1);
    const files = f.files.created.length;
    f.stubs["N/task"].create = create;
    const result = f.retry.run("501", token);
    assert.equal(result.job.id, childIds[0]); assert.equal(f.files.created.length, files);
    assert.equal(result.job.status, "QUEUED");
  }
});

test("linked retry fences duplicate posts during submission and preserves ambiguous or deferred outcomes", () => {
  for (const outcome of ["unknown", "rejected", "empty", "accepted"]) {
    const f = linkedFixture(), token = f.retry.token("501"); let submits = 0;
    f.stubs["N/task"].create = () => ({ submit() {
      submits++;
      const competing = f.retry.run("501", token);
      assert.equal(competing.job.phase, "RENDER_SUBMITTING");
      if (outcome === "accepted") return "CHILD_TASK";
      if (outcome === "empty") return " ";
      const error = new Error("synthetic submit response");
      if (outcome === "rejected") error.name = "FAILED_TO_SUBMIT_JOB_REQUEST_1";
      throw error;
    } });
    const result = f.retry.run("501", token);
    assert.equal(submits, 1);
    assert.equal(f.retry.run("501", token).job.id, result.job.id); assert.equal(submits, 1);
    assert.equal(result.job.phase, outcome === "accepted" ? "RENDER_SUBMITTING" : outcome === "rejected" ? "RENDER_WAITING" : "RENDER_SUBMIT_UNKNOWN");
    assert.ok(f.files.module.load({ id: result.job.snapshot }).getContents());
  }
});

test("linked retry Suitelet requires POST and connects the source details form to the child status", () => {
  const f = linkedFixture(), helpers = require("./helpers/ns-stubs"), sl = loadAmd("./pld_sl_batch_print", f.stubs);
  const get = helpers.contextStub({ parameters: { action: "retry_failed", job: "501" } }); sl.onRequest(get.context);
  assert.match(get.response.state.body, /requires POST/);
  const details = helpers.contextStub({ parameters: { action: "failures", job: "501" } }); sl.onRequest(details.context);
  const encoded = /name="token" value="([^"]+)"/.exec(details.response.state.body)[1];
  const token = encoded.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const post = helpers.contextStub({ method: "POST", parameters: { action: "retry_failed", job: "501", token } }); sl.onRequest(post.context);
  assert.match(post.response.state.body, /ติดตามงานลูกนี้/);
  assert.match(post.response.state.body, /กลับไปดูงานต้นฉบับ/);
});

test("render recovery reuses committed parts and the immutable snapshot after an input-stage failure", () => {
  const f = buildMr();
  const entries = f.mr.getInputData();
  f.mr.map(mapContext(entries[0]).context);
  const prior = f.artifacts.get(ctx(f), "PART", 0);
  const inputFailure = summaryStub(); inputFailure.inputSummary = { error: "synthetic input interruption" };
  assert.throws(() => f.mr.summarize(inputFailure), /input failed/);
  const failed = f.jobs.load("501");
  assert.equal(failed.status, "FAILED"); assert.equal(failed.plan, "");
  // The Suitelet separately verifies owner, signed token, snapshot and terminal task.
  // Exercise worker behavior after that authenticated atomic recovery claim.
  f.jobs.update("501", { status: "RUNNING", phase: "RENDER_SUBMITTING", task: "" },
    { status: "FAILED", phase: "DONE", plan: "", outputs: "" });
  const calls = f.render.calls.renderedAsString;
  runRender(f); runMerge(f);
  assert.equal(f.render.calls.renderedAsString - calls, 4); // Two remaining documents, two copies each.
  assert.equal(f.artifacts.get(ctx(f), "PART", 0).partId, prior.partId);
  const completed = f.jobs.load("501");
  assert.equal(completed.status, "COMPLETE"); assert.equal(completed.printed, "3");
  assert.equal(completed.snapshot, failed.snapshot); assert.equal(completed.snapshotdigest, failed.snapshotdigest);
  assert.equal(f.files.deleted.length, 0);
});

test("status-page render recovery token drives the existing workers to a downloadable completed job", () => {
  const f = buildMr(), helpers = require("./helpers/ns-stubs");
  f.stubs["N/xml"] = helpers.xmlStub;
  f.jobs.update("501", { task: "original-render-task" });
  const entries = f.mr.getInputData(); f.mr.map(mapContext(entries[0]).context);
  const failedInput = summaryStub(); failedInput.inputSummary = { error: "synthetic input failure" };
  assert.throws(() => f.mr.summarize(failedInput), /input failed/);
  const load = f.files.module.load;
  f.files.module.load = opts => {
    const out = load(opts);
    return String(opts.id) === "900" ? { ...out, name: "pld_job_501.json", size: Buffer.byteLength(out.getContents()) } : out;
  };
  f.stubs["N/task"].TaskStatus = { COMPLETE: "COMPLETE", FAILED: "FAILED" };
  f.stubs["N/task"].checkStatus = ({ taskId }) => {
    assert.equal(taskId, "original-render-task"); return { status: "FAILED" };
  };
  const create = f.stubs["N/task"].create;
  let recovered = 0;
  f.stubs["N/task"].create = opts => {
    assert.equal(opts.scriptId, "customscript_pld_batch_mr");
    assert.equal(opts.params.custscript_pld_mr_job, "501");
    return { submit() { recovered++; return "recovered-render-task"; } };
  };
  const sl = loadAmd("./pld_sl_batch_print", f.stubs);
  const page = helpers.contextStub({ parameters: { action: "status", job: "501" } }); sl.onRequest(page.context);
  const encoded = /name="token" value="([^"]+)"/.exec(page.response.state.body);
  assert.ok(encoded, "recoverable job status includes the first POST token");
  const token = encoded[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const post = helpers.contextStub({ method: "POST", parameters: { action: "recover", job: "501", token } });
  sl.onRequest(post.context);
  assert.equal(recovered, 1); assert.equal(f.jobs.load("501").task, "recovered-render-task");
  assert.match(post.response.state.body, /ระบบกำลังสร้างเอกสาร/);
  f.stubs["N/task"].create = create;
  runRender(f); runMerge(f);
  assert.equal(f.jobs.load("501").status, "COMPLETE");
  assert.ok(f.jobs.download("501", 0).getContents());
});

test("overlapping render input claims preserve a competing plan or published result", () => {
  for (const finish of [false, true]) {
    const f = buildMr(); const submit = f.stubs["N/record"].submitFields;
    let raced = false;
    f.stubs["N/record"].submitFields = opts => {
      if (!raced && opts.values.custrecord_pld_job_phase === "RENDERING") {
        raced = true; runRender(f); if (finish) runMerge(f);
      }
      return submit(opts);
    };
    assert.equal(f.mr.getInputData().length, 0);
    const current = f.jobs.load("501");
    assert.ok(current.plan);
    assert.equal(current.status, finish ? "COMPLETE" : "RUNNING");
    assert.notEqual(current.phase, "RENDERING");
    if (finish) assert.equal(f.jobs.download("501", 0).name.endsWith(".pdf"), true);
  }
});

test("overlapping input claims for the same render task reuse immutable keys without a false failure", () => {
  const f = buildMr(), submit = f.stubs["N/record"].submitFields;
  let raced = false;
  f.stubs["N/record"].submitFields = opts => {
    if (!raced && opts.values.custrecord_pld_job_phase === "RENDERING") {
      raced = true; assert.equal(f.mr.getInputData().length, 3);
    }
    return submit(opts);
  };
  assert.equal(f.mr.getInputData().length, 3);
  assert.equal(f.jobs.load("501").phase, "RENDERING");
});

test("render input accepts the concurrent task-ID acknowledgement without downgrading a newer task", () => {
  for (const prior of ["", "already-known-task"]) {
    const f = buildMr();
    f.jobs.update("501", { status: "RUNNING", phase: "RENDER_SUBMITTING", task: prior });
    const submit = f.stubs["N/record"].submitFields; let raced = false;
    f.stubs["N/record"].submitFields = opts => {
      if (!raced && opts.values.custrecord_pld_job_phase === "RENDERING") {
        raced = true; f.jobs.update("501", { task: "accepted-task" });
      }
      return submit(opts);
    };
    if (prior) assert.throws(() => f.mr.getInputData(), /changed/);
    else assert.equal(f.mr.getInputData().length, 3);
    const job = f.jobs.load("501");
    assert.equal(job.task, "accepted-task");
    assert.equal(job.phase, prior ? "RENDER_SUBMITTING" : "RENDERING");
  }
  const f = buildMr(), submit = f.stubs["N/record"].submitFields; let raced = false;
  f.stubs["N/record"].submitFields = opts => {
    if (!raced && opts.values.custrecord_pld_job_phase === "RENDERING") {
      raced = true; f.mr.getInputData(); f.jobs.update("501", { task: "accepted-task" });
    }
    return submit(opts);
  };
  assert.equal(f.mr.getInputData().length, 3);
  assert.equal(f.jobs.load("501").phase, "RENDERING");
});

test("lost reduce context.write and terminal summarize replay reuse committed CHUNK", () => {
  const f = buildMr();
  runRender(f);
  const chunk = f.merge.getInputData()[0];
  assert.throws(
    () =>
      f.merge.reduce(
        chunkContext(chunk, () => {
          throw new Error("lost reduce output");
        }),
      ),
    /lost reduce output/,
  );
  const merges = f.render.calls.xmlToPdf.length;
  f.merge.reduce(chunkContext(chunk));
  assert.equal(f.render.calls.xmlToPdf.length, merges);
  f.merge.summarize(summaryStub({ errors: [["0", "lost output"]] }));
  const prior = f.jobs.load("501");
  f.merge.summarize(summaryStub());
  assert.equal(f.jobs.load("501").outputs, prior.outputs);
  assert.equal(f.emails.length, 1);
});

test("partial rendering accounts every selected sequence without trusting context.output", () => {
  const f = buildMr({ failIds: ["12"] });
  runRender(f);
  runMerge(f);
  const job = f.jobs.load("501");
  const manifest = f.files.integrity.open("manifest", job.outputs);
  assert.equal(job.status, "PARTIAL");
  assert.equal(Number(job.failed), 1);
  assert.doesNotThrow(() => f.jobs.download("501", 0));
  assert.equal(manifest.printed, 2);
  assert.equal(manifest.failed, 1);
  const proof = f.files.integrity.open("result", manifest.outputs[0].proof);
  assert.deepEqual(Array.from(proof.sequences), [0, 2]);
  assert.equal(proof.failed, 0);
  assert.equal(
    f.files.integrity.open("plan", job.plan).failed[0].code,
    "RENDER_FAILED",
  );
});

test("Thai XML byte budget splits chunks including exact framing instead of rejecting aggregate", () => {
  const f = buildMr();
  seedPart(f, 0, "<pdf>" + "ก".repeat(1500000) + "</pdf>");
  seedPart(f, 1, "<pdf>" + "ก".repeat(1500000) + "</pdf>");
  f.mr.summarize(summaryStub());
  const plan = f.files.integrity.open("plan", f.jobs.load("501").plan);
  assert.equal(plan.chunks.length, 2);
  runMerge(f);
  assert.equal(f.render.calls.xmlToPdf.length, 2);
  assert.equal(Number(f.jobs.load("501").printed), 2);
  for (const call of f.render.calls.xmlToPdf)
    assert.ok(Buffer.byteLength(call.xmlString) <= 8 * 1024 * 1024);
});

test("single part that cannot fit with framing fails loudly before task submission", () => {
  const f = buildMr();
  seedPart(f, 0, "<pdf>" + "a".repeat(8 * 1024 * 1024 - 11) + "</pdf>");
  assert.throws(() => f.mr.summarize(summaryStub()), /8 MiB/);
  assert.equal(f.tasks.length, 0);
  assert.equal(f.jobs.load("501").status, "FAILED");
  assert.equal(f.files.deleted.length, 0);
});

test("missing CHUNK fails publication, then authorized recovery reuses earlier chunks", () => {
  const ids = Array.from({ length: 26 }, (_, i) => String(i + 11));
  const f = buildMr({ job: { ...JOB, ids } });
  runRender(f);
  const chunks = f.merge.getInputData();
  f.merge.reduce(chunkContext(chunks[0]));
  assert.throws(() => f.merge.summarize(summaryStub()), /incomplete/);
  assert.equal(f.jobs.load("501").phase, "MERGE_FAILED");
  assert.throws(() => f.jobs.download("501"), /not committed/);
  f.jobs.update("501", { status: "RUNNING", phase: "MERGE_SUBMITTING" });
  runMerge(f);
  assert.equal(f.render.calls.xmlToPdf.length, 2);
  assert.equal(f.jobs.load("501").status, "COMPLETE");
});

test("tampered physical PART is never fed to BFO during merge or replay", () => {
  const f = buildMr();
  runRender(f);
  const part = f.artifacts.get(ctx(f), "PART", 0);
  f.files.contents[part.partId] = "<pdf>tampered</pdf>";
  assert.throws(
    () => f.merge.reduce(chunkContext(f.merge.getInputData()[0])),
    /integrity/,
  );
  assert.equal(f.render.calls.xmlToPdf.length, 0);
  assert.equal(f.files.deleted.length, 0);
});

test("PDF changed between save and readback is never committed or published", () => {
  const f = buildMr();
  runRender(f);
  const original = f.files.module.load;
  f.files.module.load = (options) => {
    const result = original(options);
    return result.name?.endsWith(".pdf")
      ? {
          ...result,
          getContents: () => Buffer.from("attacker").toString("base64"),
        }
      : result;
  };
  assert.throws(
    () => f.merge.reduce(chunkContext(f.merge.getInputData()[0])),
    /integrity mismatch after save/,
  );
  assert.equal(f.artifacts.list(ctx(f), "CHUNK").length, 0);
  assert.throws(() => f.jobs.download("501"), /not committed/);
});

test("folder privacy changed while BFO runs prevents PDF save", () => {
  const f = buildMr();
  runRender(f);
  const combine = f.render.module.xmlToPdf;
  let saves = 0;
  f.render.module.xmlToPdf = (options) => {
    const pdf = combine(options);
    f.rows.get("77").isprivate = false;
    pdf.save = () => {
      saves++;
      throw new Error("must not save");
    };
    return pdf;
  };
  assert.throws(
    () => f.merge.reduce(chunkContext(f.merge.getInputData()[0])),
    /privacy/,
  );
  assert.equal(saves, 0);
});

test("merge submit ambiguity and accepted metadata write failure never cause duplicate submission", () => {
  for (const accepted of [false, true]) {
    const f = buildMr();
    for (const entry of f.mr.getInputData())
      f.mr.map(mapContext(entry).context);
    if (!accepted)
      f.stubs["N/task"].create = () => ({
        submit() {
          f.tasks.push({});
          throw new Error("connection lost");
        },
      });
    else {
      const save = f.stubs["N/record"].submitFields;
      f.stubs["N/record"].submitFields = (options) => {
        if (options.values.custrecord_pld_job_mergetask)
          throw new Error("metadata lost");
        return save(options);
      };
    }
    if (accepted) assert.doesNotThrow(() => f.mr.summarize(summaryStub()));
    else assert.throws(() => f.mr.summarize(summaryStub()), /connection lost/);
    f.mr.summarize(summaryStub());
    assert.equal(f.tasks.length, 1);
    assert.equal(
      f.jobs.load("501").phase,
      accepted ? "MERGE_SUBMITTING" : "MERGE_SUBMIT_UNKNOWN",
    );
  }
});

test("final job commit failure retains committed chunks and all inputs for recovery", () => {
  const f = buildMr();
  runRender(f);
  for (const chunk of f.merge.getInputData())
    f.merge.reduce(chunkContext(chunk));
  const save = f.stubs["N/record"].submitFields;
  f.stubs["N/record"].submitFields = (options) => {
    if (options.values.custrecord_pld_job_outputs)
      throw new Error("publish lost");
    return save(options);
  };
  assert.throws(() => f.merge.summarize(summaryStub()), /publish lost/);
  assert.equal(f.artifacts.list(ctx(f), "CHUNK").length, 1);
  assert.equal(f.jobs.load("501").phase, "MERGE_FAILED");
  assert.equal(f.files.deleted.length, 0);
  assert.throws(() => f.jobs.download("501"), /not committed/);
});

test("plan persisted before a crash is submitted once on summarize restart", () => {
  const f = buildMr();
  for (const entry of f.mr.getInputData()) f.mr.map(mapContext(entry).context);
  const save = f.stubs["N/record"].submitFields;
  f.stubs["N/record"].submitFields = (options) => {
    if (options.values.custrecord_pld_job_phase === "MERGE_SUBMITTING")
      throw new Error("crash before claim");
    return save(options);
  };
  assert.throws(() => f.mr.summarize(summaryStub()), /crash before claim/);
  assert.equal(f.jobs.load("501").phase, "MERGE_PENDING");
  assert.equal(f.tasks.length, 0);
  f.stubs["N/record"].submitFields = save;
  f.mr.summarize(summaryStub());
  f.mr.summarize(summaryStub());
  assert.equal(f.tasks.length, 1);
});

test("competing summarize submission claims cannot submit the merge twice", () => {
  const f = buildMr();
  for (const entry of f.mr.getInputData()) f.mr.map(mapContext(entry).context);
  const save = f.stubs["N/record"].submitFields;
  let interleaved = false;
  f.stubs["N/record"].submitFields = (options) => {
    if (
      !interleaved &&
      options.values.custrecord_pld_job_phase === "MERGE_SUBMITTING"
    ) {
      interleaved = true;
      f.mr.summarize(summaryStub());
    }
    return save(options);
  };
  f.mr.summarize(summaryStub());
  assert.equal(f.tasks.length, 1);
  assert.equal(f.jobs.load("501").mergetask, "merge-task-1");
});

test("500-document summarize reads metadata instead of all XML payloads", () => {
  const ids = Array.from({ length: 500 }, (_, i) => String(i + 11));
  const f = buildMr({ job: { ...JOB, ids } });
  for (let i = 0; i < ids.length; i++) seedPart(f, i, "<pdf>QA</pdf>", ids);
  const original = f.files.module.load;
  let partLoads = 0;
  f.files.module.load = (options) => {
    const result = original(options);
    if (result.name?.startsWith("pld_part_")) partLoads++;
    return result;
  };
  f.mr.summarize(summaryStub());
  assert.equal(partLoads, 0);
  assert.equal(
    f.files.integrity.open("plan", f.jobs.load("501").plan).chunks.length,
    20,
  );
});

test("all failed documents reach explicit FAILED state without scheduling empty merges", () => {
  const f = buildMr({ failIds: JOB.ids });
  runRender(f);
  assert.equal(f.jobs.load("501").status, "FAILED");
  assert.equal(Number(f.jobs.load("501").failed), 3);
  assert.equal(f.tasks.length, 0);
});

test("corrupt input leaves durable failure and private inputs retained", () => {
  const f = buildMr();
  const original = f.files.module.load;
  f.files.module.load = (options) =>
    options.id === "900"
      ? { folder: "77", isOnline: false, getContents: () => "{broken" }
      : original(options);
  assert.throws(() => f.mr.summarize(summaryStub()), /integrity/);
  assert.equal(f.jobs.load("501").status, "FAILED");
  assert.equal(f.files.deleted.length, 0);
});

test("signed chunk bytes modified after ledger commit are rejected on authorized download", () => {
  const f = buildMr();
  runRender(f);
  for (const chunk of f.merge.getInputData())
    f.merge.reduce(chunkContext(chunk));
  const pdf = f.artifacts.get(ctx(f), "CHUNK", 0);
  f.files.contents[pdf.fileId] = Buffer.from("tampered PDF").toString("base64");
  f.merge.summarize(summaryStub());
  assert.equal(f.jobs.load("501").status, "COMPLETE");
  assert.throws(() => f.jobs.download("501", 0), /integrity/);
});

test("summary output cannot inject an uncommitted part or override the ledger", () => {
  const f = buildMr();
  f.mr.getInputData();
  f.mr.summarize(
    summaryStub({
      output: [["000000", JSON.stringify({ partId: "999", recid: "11" })]],
    }),
  );
  assert.equal(f.tasks.length, 0);
  assert.equal(f.jobs.load("501").status, "FAILED");
  assert.equal(Number(f.jobs.load("501").printed), 0);
});

test("final summarize reads ledger metadata without reloading every PDF", () => {
  const f = buildMr();
  runRender(f);
  for (const chunk of f.merge.getInputData())
    f.merge.reduce(chunkContext(chunk));
  const load = f.files.module.load;
  let pdfLoads = 0;
  f.files.module.load = (options) => {
    const value = load(options);
    if (value.name?.endsWith(".pdf")) pdfLoads++;
    return value;
  };
  f.merge.summarize(summaryStub());
  assert.equal(pdfLoads, 0);
  assert.equal(f.jobs.load("501").status, "COMPLETE");
});

test("competing final summarize cannot downgrade or republish a terminal result", () => {
  const f = buildMr();
  runRender(f);
  for (const chunk of f.merge.getInputData())
    f.merge.reduce(chunkContext(chunk));
  const save = f.stubs["N/record"].submitFields;
  let interleaved = false;
  f.stubs["N/record"].submitFields = (options) => {
    if (!interleaved && options.values.custrecord_pld_job_outputs) {
      interleaved = true;
      f.merge.summarize(summaryStub());
    }
    return save(options);
  };
  f.merge.summarize(summaryStub());
  assert.equal(f.jobs.load("501").status, "COMPLETE");
  assert.equal(f.emails.length, 1);
  assert.doesNotThrow(() => f.jobs.download("501", 0));
});

test("failure publication racing a successful finalizer cannot overwrite completed output", () => {
  const f = buildMr();
  runRender(f);
  for (const chunk of f.merge.getInputData()) f.merge.reduce(chunkContext(chunk));
  const save = f.stubs["N/record"].submitFields;
  let interleaved = false;
  f.stubs["N/record"].submitFields = options => {
    if (!interleaved && options.values.custrecord_pld_job_phase === "MERGE_FAILED") {
      interleaved = true;
      f.merge.summarize(summaryStub());
    }
    return save(options);
  };
  const failed = summaryStub();
  failed.inputSummary = { error: "late competing input failure" };
  assert.doesNotThrow(() => f.merge.summarize(failed));
  assert.equal(f.jobs.load("501").status, "COMPLETE");
  assert.equal(f.emails.length, 1);
  assert.doesNotThrow(() => f.jobs.download("501", 0));
});

test("oversized PDF is rejected before reading its base64 either before save or at readback", () => {
  for (const stage of ["before", "readback"]) {
    const f = buildMr();
    runRender(f);
    let reads = 0;
    if (stage === "before") {
      const combine = f.render.module.xmlToPdf;
      f.render.module.xmlToPdf = (options) => ({
        ...combine(options),
        size: 10 * 1024 * 1024 + 1,
        getContents() {
          reads++;
          throw new Error("must not read");
        },
      });
    } else {
      const load = f.files.module.load;
      f.files.module.load = (options) => {
        const value = load(options);
        return value.name?.endsWith(".pdf")
          ? {
              ...value,
              size: 10 * 1024 * 1024 + 1,
              getContents() {
                reads++;
                throw new Error("must not read");
              },
            }
          : value;
      };
    }
    assert.throws(
      () => f.merge.reduce(chunkContext(f.merge.getInputData()[0])),
      /size limit|integrity mismatch after save/,
    );
    assert.equal(reads, 0);
    assert.equal(f.artifacts.list(ctx(f), "CHUNK").length, 0);
  }
});

test("email failure preserves committed outputs and authorized downloads", () => {
  const f = buildMr({ emailFails: true });
  runRender(f);
  runMerge(f);
  assert.equal(f.jobs.load("501").status, "COMPLETE");
  assert.doesNotThrow(() => f.jobs.download("501", 0));
  assert.ok(
    f.log.entries.some(
      (entry) => entry.level === "error" && /ส่งอีเมล/.test(entry.title),
    ),
  );
});

test("signed malformed plans reject duplicate, missing, out-of-range or oversized chunks", () => {
  for (const mode of ["duplicate", "missing", "range", "oversized"]) {
    const f = buildMr();
    runRender(f);
    const plan = JSON.parse(
      JSON.stringify(f.files.integrity.open("plan", f.jobs.load("501").plan)),
    );
    if (mode === "duplicate") plan.chunks[0].sequences = [0, 0, 2];
    if (mode === "missing") plan.chunks[0].sequences = [0, 1];
    if (mode === "range") plan.chunks[0].sequences = [0, 1, 3];
    if (mode === "oversized") plan.chunks[0].sequences = Array(26).fill(0);
    f.jobs.update("501", { plan: f.files.integrity.seal("plan", plan) });
    assert.throws(() => f.merge.getInputData(), /plan/);
    assert.equal(f.render.calls.xmlToPdf.length, 0);
  }
});

test("merge input-stage failure retains inputs and makes no output available", () => {
  const f = buildMr();
  runRender(f);
  const summary = summaryStub();
  summary.inputSummary = { error: "synthetic input failure" };
  assert.throws(() => f.merge.summarize(summary), /input failed/);
  assert.equal(f.jobs.load("501").phase, "MERGE_FAILED");
  assert.equal(f.files.deleted.length, 0);
  assert.throws(() => f.jobs.download("501"), /not committed/);
  assert.match(f.emails[0].body, /หมายเลขงาน: 501/);
  assert.match(f.emails[0].body, /สร้างสำเร็จ: 0 ใบ/);
  assert.doesNotMatch(f.emails[0].body, /ไฟล์รวม:/);
});

test("merge input cannot select chunks or sequences outside the authenticated plan", () => {
  const f = buildMr();
  runRender(f);
  const chunk = f.merge.getInputData()[0];
  assert.throws(
    () =>
      f.merge.reduce({
        key: "0",
        values: [JSON.stringify({ ...chunk, sequences: [2, 1, 0] })],
        write() {},
      }),
    /Invalid merge chunk/,
  );
  assert.throws(
    () =>
      f.merge.reduce({
        key: "99",
        values: [JSON.stringify(chunk)],
        write() {},
      }),
    /Invalid merge chunk/,
  );
  assert.equal(f.render.calls.xmlToPdf.length, 0);
});


test("native merge rejection persists waiting and informs the owner without automatic retry", () => {
  for (const emailFails of [false, true]) {
    const f = buildMr({emailFails}); let attempts = 0;
    f.stubs["N/task"].create = () => ({submit() {
      attempts++;
      throw Object.assign(new Error("rejected"), {name: "FAILED_TO_SUBMIT_JOB_REQUEST_1"});
    }});
    runRender(f);
    const job = f.jobs.load("501");
    assert.equal(job.phase, "MERGE_WAITING"); assert.equal(job.mergetask, "");
    assert.ok(job.plan); assert.equal(job.outputs, "");
    assert.equal(f.files.deleted.length, 0);
    if (!emailFails) {
      assert.equal(f.emails.length, 1);
      assert.match(f.emails[0].body, /501/);
      assert.doesNotMatch(f.emails[0].body, /สร้างสำเร็จ:/);
    }
    f.mr.summarize(summaryStub()); assert.equal(attempts, 1);
  }
});

test("merge handoff malformed task identities and message-only rejection remain unknown", () => {
  for (const value of ["   ", 42, {}, true, null, ""]) {
    const f = buildMr(); let attempts = 0;
    f.stubs["N/task"].create = () => ({submit() {attempts++; return value;}});
    assert.throws(() => runRender(f), /no task ID/);
    assert.equal(f.jobs.load("501").phase, "MERGE_SUBMIT_UNKNOWN");
    assert.equal(f.jobs.load("501").mergetask, "");
    f.mr.summarize(summaryStub()); assert.equal(attempts, 1);
  }
  const f = buildMr();
  f.stubs["N/task"].create = () => ({submit() {throw new Error("FAILED_TO_SUBMIT_JOB_REQUEST_1");}});
  assert.throws(() => runRender(f), /FAILED_TO_SUBMIT/);
  assert.equal(f.jobs.load("501").phase, "MERGE_SUBMIT_UNKNOWN");
});

test("rejected merge handoff cannot downgrade an advanced worker or announce unpersisted waiting", () => {
  for (const mode of ["advanced", "write-failure"]) {
    const f = buildMr(), save = f.stubs["N/record"].submitFields;
    f.stubs["N/task"].create = () => ({submit() {
      if (mode === "advanced") f.jobs.update("501", {phase: "MERGING", mergetask: "ACTIVE_WORKER"});
      throw Object.assign(new Error("rejected"), {code: "FAILED_TO_SUBMIT_JOB_REQUEST_1"});
    }});
    if (mode === "write-failure") f.stubs["N/record"].submitFields = opts => {
      if (opts.values.custrecord_pld_job_phase === "MERGE_WAITING") throw new Error("state write failed");
      return save(opts);
    };
    runRender(f);
    assert.equal(f.jobs.load("501").phase, mode === "advanced" ? "MERGING" : "MERGE_SUBMITTING");
    assert.equal(f.emails.length, 0);
  }
});

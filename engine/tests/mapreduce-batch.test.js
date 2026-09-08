/**
 * pld_mr_batch_print — พิมพ์เป็นชุดขนาดใหญ่ผ่าน Map/Reduce (#181)
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
          900: {
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
    create() {
      return {
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

test("หนึ่งเอกสาร = หนึ่ง key — map จึงได้โควตาเต็มต่อใบ", () => {
  const { mr } = buildMr();

  const entries = Array.from(mr.getInputData()).map((e) => ({ ...e }));

  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.recid),
    ["11", "12", "13"],
  );
  assert.deepEqual(
    entries.map((e) => e.seq),
    [0, 1, 2],
  );
  assert.equal(entries[0].rectype, "itemfulfillment");
  assert.equal(entries[0].folder, "77");
});

test('ไม่มี job parameter = ล้มตั้งแต่ต้น ไม่ใช่จบด้วย "สำเร็จ 0 ใบ"', () => {
  const { mr } = buildMr({ job: null });

  assert.throws(() => mr.getInputData(), /job file/);
});

test("map เขียน XML ของใบตัวเองเป็นไฟล์ชั่วคราว แล้วส่งต่อแค่ file id", () => {
  const { mr, files } = buildMr();
  mr.getInputData();
  const { written, context } = mapContext({
    seq: 2,
    recid: "13",
    jobId: "501",
    rectype: "itemfulfillment",
    tplid: "7",
    folder: "77",
  });

  mr.map(context);

  const part = files.created[0];
  assert.match(part.name, /^pld_part_501_000002_[a-f0-9]{64}\.txt$/);
  assert.equal(part.folder, "77");
  assert.equal(
    part.encoding,
    "UTF-8",
    "ข้อความไทยใน XML ต้องไม่เพี้ยนตอนอ่านกลับ",
  );
  assert.equal(
    (part.contents.match(/<pdf>/g) || []).length,
    2,
    "สองสำเนาอยู่ในไฟล์เดียวของใบนี้",
  );

  assert.equal(written.length, 1);
  assert.equal(written[0].key, "000002", "key ต้องเรียงแบบสตริงได้");
  assert.equal(JSON.parse(written[0].value).partId, part.id);
});

test("ใบที่ render ไม่ได้ ต้องโยน error ให้ Map/Reduce จดเป็นความล้มเหลวของ key นั้น", () => {
  const { mr } = buildMr({ failIds: ["12"] });
  const { context } = mapContext({
    seq: 1,
    recid: "12",
    jobId: "501",
    rectype: "itemfulfillment",
    tplid: "7",
    folder: "77",
  });

  assert.throws(() => mr.map(context), /does not exist: 12/);
});

test("oversize job fails before any map inputs are returned", () => {
  const { mr } = buildMr({ job: { ...JOB, ids: Array(501).fill("11") } });
  assert.throws(() => mr.getInputData(), /500/);
});

test("workers use frozen enqueue XML and copy labels even when template is unavailable", () => {
  const frozen = {
    xml: "<pdf><body>Frozen</body></pdf>",
    copies: [{ th: "สำเนาคงที่", en: "Frozen copy" }],
  };
  const { mr, render, files } = buildMr({
    job: { ...JOB, templateSnapshot: frozen },
    failIds: ["7"],
  });
  const originalCreate = render.module.create;
  const boundXml = [];
  render.module.create = () => {
    const renderer = originalCreate();
    renderer.renderAsString = function () {
      boundXml.push(this.templateContent);
      return this.templateContent;
    };
    return renderer;
  };
  const entries = mr.getInputData();
  mr.map(mapContext(entries[0]).context);
  mr.map(mapContext(entries[1]).context);
  assert.deepEqual(boundXml, [frozen.xml, frozen.xml]);
  assert.deepEqual(
    render.calls.dataSources
      .filter((s) => s.alias === "copy")
      .map((s) => s.data.th),
    ["สำเนาคงที่", "สำเนาคงที่"],
  );
  assert.equal(files.created.length, 2);
});

test("snapshot and job metadata bounds are validated before scheduling maps", () => {
  const invalid = [
    { templateSnapshot: { ...JOB.templateSnapshot, xml: "x".repeat(1000001) } },
    { templateSnapshot: { ...JOB.templateSnapshot, copies: [] } },
    {
      templateSnapshot: {
        ...JOB.templateSnapshot,
        copies: [{ th: "", en: "" }],
      },
    },
    {
      templateSnapshot: {
        ...JOB.templateSnapshot,
        copies: [{ th: 123, en: "A" }],
      },
    },
    { ids: ["invalid"] },
    { folder: "-1" },
    { jobId: "../other" },
  ];
  for (const change of invalid) {
    const { mr } = buildMr({ job: { ...JOB, ...change } });
    assert.throws(() => mr.getInputData(), /Invalid/);
  }
});

test("snapshot accepts established XML size and one-language copy labels", () => {
  const xml = "<pdf><body>" + "ก".repeat(989900) + "</body></pdf>";
  for (const copy of [
    { th: "สำเนา", en: "" },
    { th: "", en: "Copy" },
    { en: "Copy" },
  ]) {
    const { mr, render } = buildMr({
      job: { ...JOB, templateSnapshot: { xml, copies: [copy] } },
    });
    const entries = mr.getInputData();
    mr.map(mapContext(entries[0]).context);
    assert.equal(render.calls.renderedAsString, 1);
  }
});

test("serialized job UTF-8 budget accepts escaped XML and rejects oversize copy payload", () => {
  const xml = "<pdf>" + "\t".repeat(989900) + "</pdf>";
  const accepted = buildMr({
    job: { ...JOB, templateSnapshot: { xml, copies: [{ th: "A" }] } },
  });
  assert.equal(accepted.mr.getInputData().length, 3);
  const oversized = buildMr({
    job: {
      ...JOB,
      templateSnapshot: { xml: TPL_XML, copies: [{ th: "ก".repeat(2800000) }] },
    },
  });
  assert.throws(() => oversized.mr.getInputData(), /8 MiB/);
});

test("persisted excessive copies are rejected before scheduling or rendering", () => {
  const { mr, render } = buildMr({
    job: {
      ...JOB,
      templateSnapshot: {
        xml: TPL_XML,
        copies: Array(21).fill({ en: "Copy" }),
      },
    },
  });
  assert.throws(() => mr.getInputData(), /20.*render execution limit/);
  assert.throws(
    () => mr.map(mapContext({ seq: 0, recid: "11" }).context),
    /20.*render execution limit/,
  );
  assert.equal(render.calls.created, 0);
});

test("forged Map/Reduce actor fails before transaction render and file cleanup", () => {
  const { mr, render, files, stubs } = buildMr();
  stubs["N/runtime"].getCurrentUser = () => ({ id: 10, role: 3 });
  assert.throws(() => mr.getInputData(), /unavailable/);
  assert.throws(
    () => mr.map(mapContext({ seq: 0, recid: "11" }).context),
    /unavailable/,
  );
  assert.throws(() => mr.summarize(summaryStub()), /unavailable/);
  assert.equal(render.calls.created, 0);
  assert.equal(files.deleted.length, 0);
});

test("unsigned snapshot and unavailable secret fail before transaction work", () => {
  for (const mode of ["unsigned", "secret"]) {
    const { mr, files, stubs, render } = buildMr();
    if (mode === "unsigned") {
      const load = files.module.load;
      files.module.load = (opts) =>
        opts.id === "900"
          ? {
              folder: "77",
              isOnline: false,
              getContents: () => JSON.stringify(JOB),
            }
          : load(opts);
    } else
      stubs["N/crypto"].createSecretKey = () => {
        throw new Error("denied");
      };
    assert.throws(() => mr.getInputData(), /integrity/);
    assert.equal(render.calls.created, 0);
    assert.equal(files.created.length, 0);
  }
});

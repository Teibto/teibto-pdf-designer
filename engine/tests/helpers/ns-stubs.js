/**
 * Fake NetSuite modules for the engine unit tests (#155).
 * Small on purpose: each stub covers only the calls the libraries actually make,
 * and throws on anything unexpected so a test can never pass on a silent
 * undefined (the exact failure mode #155 was about).
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

/**
 * N/query stub. `fixtures` is an ordered list of { match, rows }: the first
 * entry whose `match` substring appears in the SQL wins.
 */
function queryStub(fixtures) {
  const seen = [];
  return {
    seen,
    runSuiteQL({ query, params }) {
      seen.push({ query, params });
      const hit = fixtures.find((f) => query.indexOf(f.match) !== -1);
      if (!hit) throw new Error('unexpected SuiteQL in test: ' + query.slice(0, 120));
      return { asMappedResults: () => hit.rows.map((r) => ({ ...r })) };
    },
  };
}

/**
 * N/record stub exposing one record's body fields, and optionally its sublists —
 * `sublists` is { [sublistId]: [ {fieldId: value}, … ] }, used by the customer
 * payment `apply` list (#170). Reading a sublist that was not provided throws, the
 * same way the real record does, so a test can never pass on an empty table.
 */
function recordStub({ id = 1, values = {}, texts = {}, sublists = {} } = {}) {
  const rows = (sublistId) => {
    if (!Object.prototype.hasOwnProperty.call(sublists, sublistId)) {
      throw new Error(`record has no sublist "${sublistId}"`);
    }
    return sublists[sublistId];
  };
  const rec = {
    id,
    getValue({ fieldId }) {
      if (!Object.prototype.hasOwnProperty.call(values, fieldId)) return '';
      return values[fieldId];
    },
    getText({ fieldId }) {
      if (!Object.prototype.hasOwnProperty.call(texts, fieldId)) return '';
      return texts[fieldId];
    },
    getFields() {
      return Object.keys(values);
    },
    getLineCount({ sublistId }) {
      return rows(sublistId).length;
    },
    /** Union of the field ids present on the sublist's rows. */
    getSublistFields({ sublistId }) {
      const seen = [];
      rows(sublistId).forEach((row) => {
        Object.keys(row).forEach((k) => { if (seen.indexOf(k) === -1) seen.push(k); });
      });
      return seen;
    },
    getSublistValue({ sublistId, fieldId, line }) {
      const row = rows(sublistId)[line];
      if (!row) throw new Error(`line ${line} out of range on "${sublistId}"`);
      return Object.prototype.hasOwnProperty.call(row, fieldId) ? row[fieldId] : '';
    },
  };
  return {
    rec,
    module: {
      load: () => rec,
      create: () => rec,
      Type: {},
    },
  };
}

/** N/format stub — fixed output so assertions stay deterministic. */
const formatStub = {
  Type: { DATE: 'date', DATETIME: 'datetime' },
  format({ value, type }) {
    // cross-realm: a Date built inside the AMD sandbox is not `instanceof Date` here
    if (Object.prototype.toString.call(value) !== '[object Date]') {
      return String(value == null ? '' : value);
    }
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const yyyy = value.getFullYear();
    return type === 'datetime' ? `${dd}/${mm}/${yyyy} 10:30` : `${dd}/${mm}/${yyyy}`;
  },
};

/** N/log stub that records what was logged, so tests can assert on it. */
function logStub() {
  const entries = [];
  const push = (level) => (opts) => entries.push({ level, ...opts });
  return {
    entries,
    module: {
      debug: push('debug'),
      audit: push('audit'),
      error: push('error'),
      emergency: push('emergency'),
    },
  };
}

/** Company-config stub — the real loader needs N/search + a live config record. */
const companyConfigStub = {
  load: () => ({
    name: 'บริษัท ตัวอย่าง จำกัด',
    nameEn: 'Example Co., Ltd.',
    address: '99/9 ถนนทดสอบ กรุงเทพฯ 10110',
    addressEn: '99/9 Test Rd, Bangkok 10110',
    phone: '02-000-0000',
    email: 'ar@example.co.th',
    taxId: '0105500000000',
    branch: '00000',
    logo: '',
    fontRegular: 'https://example.test/THSarabunPSK.ttf',
    fontBold: 'https://example.test/THSarabunPSK-Bold.ttf',
  }),
};

/**
 * N/xml stub — escape() plus a crude Parser.fromString: it rejects a bare `&`
 * the way BFO's parser does, which is exactly the failure batch print has to
 * survive per document (#184).
 */
const xmlStub = {
  Parser: {
    fromString({ text }) {
      const bare = /&(?![a-zA-Z]+;|#\d+;)/.test(String(text));
      if (bare) throw new Error("The entity name must immediately follow the '&' in the entity reference.");
      return { text: String(text) };
    },
  },
  escape({ xmlText }) {
    return String(xmlText)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },
};

/**
 * N/runtime stub.
 *
 * `usage` models the governance budget the batch print screen steers by (#181):
 * pass a function to return a falling sequence, or a number for a fixed budget.
 */
function runtimeStub({
  // role 3 = Administrator: the default keeps every pre-#189 test on the allowed
  // side of the template-permission gate, exactly as those flows behaved before it.
  user = { id: 9, name: 'QA Tester', email: 'qa@example.test', role: 3 },
  script = { id: 'customscript_pld_render', deploymentId: 'customdeploy_pld_render' },
  usage,
  parameters = {},
} = {}) {
  const currentScript = Object.assign({
    getRemainingUsage: () => (typeof usage === 'function' ? usage() : (usage == null ? 1000 : usage)),
    getParameter: ({ name }) => (Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : ''),
  }, script);
  return {
    accountId: 'TSTDRV000',
    getCurrentUser: () => user,
    getCurrentScript: () => currentScript,
    EnvType: { SANDBOX: 'SANDBOX', PRODUCTION: 'PRODUCTION' },
    envType: 'SANDBOX',
  };
}

/**
 * N/search stub. `rows` is the result set; each row is { id, values } and gets a
 * positional getValue(fieldId) like the real search.Result.
 */
function searchStub(rows = []) {
  const pick = (bag, field) => {
    const key = typeof field === 'object' && field ? field.name : field;
    return Object.prototype.hasOwnProperty.call(bag || {}, key) ? bag[key] : '';
  };
  const results = rows.map((r) => ({
    id: r.id,
    getValue: (field) => pick(r.values, field),
    getText: (field) => pick(r.texts, field),
  }));
  const created = [];
  const columns = [];
  return {
    created,
    columns,
    module: {
      Sort: { ASC: 'ASC', DESC: 'DESC', NONE: 'NONE' },
      createColumn(opts) { columns.push(opts); return opts; },
      create(opts) {
        created.push(opts);
        return {
          run: () => ({
            getRange: () => results.slice(),
            each: (fn) => { results.every((row) => fn(row) !== false); },
          }),
        };
      },
    },
  };
}

/** N/render stub — records what was rendered so tests can assert on it. */
function renderStub({ pdfName = 'out.pdf', asString = '<pdf><body>ok</body></pdf>', fileSystem = null } = {}) {
  const calls = {
    created: 0, dataSources: [], records: [], renderedAsPdf: 0, renderedAsString: 0,
    xmlToPdf: [], savedFiles: [],
  };
  // The file N/render hands back is a real file object: batch print names it and
  // saves it into the File Cabinet (#181), single Print only streams it.
  let fileSeq = 500;
  const pdfFile = () => ({
    name: pdfName,
    save() {
      const id = String(fileSeq++);
      calls.savedFiles.push({ id, name: this.name, folder: this.folder });
      // the saved PDF must be loadable afterwards (batch print reads its url)
      if (fileSystem) fileSystem.register(id, '%PDF-1.4');
      return id;
    },
  });
  return {
    calls,
    module: {
      DataSource: { OBJECT: 'OBJECT', JSON: 'JSON', XML_STRING: 'XML_STRING' },
      create() {
        calls.created += 1;
        return {
          templateContent: '',
          addCustomDataSource(ds) { calls.dataSources.push(ds); },
          addRecord(r) { calls.records.push(r); },
          renderAsPdf() { calls.renderedAsPdf += 1; return pdfFile(); },
          // asString may be a function of the pass index, so a test can make ONE
          // document in a batch resolve to broken XML (#181/#184)
          renderAsString() {
            const i = calls.renderedAsString;
            calls.renderedAsString += 1;
            return typeof asString === 'function' ? asString(i) : asString;
          },
        };
      },
      xmlToPdf(opts) { calls.xmlToPdf.push(opts); return pdfFile(); },
    },
  };
}

/** N/file stub — only load() is used (version stamp). */
function fileStub({ contents = '{"version":"test"}' } = {}) {
  return { load: () => ({ getContents: () => contents }) };
}

/**
 * N/file stub with create/load/delete, for the batch print job spec and the
 * temporary per-document XML parts (#181). `files` seeds fixed entries by id or
 * path (the version stamp the output folder is resolved from).
 */
function fileSystemStub({ files = {}, folder = 90 } = {}) {
  const created = [];
  const deleted = [];
  const contents = {};
  let seq = 1000;
  return {
    created,
    deleted,
    contents,
    register(id, body) { contents[id] = body; },
    module: {
      Type: { PLAINTEXT: 'PLAINTEXT', JSON: 'JSON' },
      Encoding: { UTF8: 'UTF-8' },
      create(opts) {
        return Object.assign({}, opts, {
          save() {
            const id = String(seq++);
            created.push(Object.assign({ id }, opts));
            contents[id] = opts.contents;
            return id;
          },
        });
      },
      load({ id }) {
        if (Object.prototype.hasOwnProperty.call(files, id)) return files[id];
        if (Object.prototype.hasOwnProperty.call(contents, id)) {
          return {
            getContents: () => contents[id],
            url: '/core/media/media.nl?id=' + id,
            folder,
          };
        }
        throw new Error('That file does not exist: ' + id);
      },
      delete({ id }) { deleted.push(String(id)); },
    },
  };
}

/** N/task stub — records the Map/Reduce submissions the Suitelet makes (#181). */
function taskStub({ taskId = 'MAPREDUCETASK_1' } = {}) {
  const submitted = [];
  return {
    submitted,
    module: {
      TaskType: { MAP_REDUCE: 'MAP_REDUCE', SCHEDULED_SCRIPT: 'SCHEDULED_SCRIPT' },
      create(opts) {
        return { submit() { submitted.push(opts); return taskId; } };
      },
    },
  };
}

/** Suitelet response recorder. */
function responseStub() {
  const state = { headers: {}, body: '', files: [] };
  return {
    state,
    headers: state.headers,
    setHeader({ name, value }) { state.headers[name] = value; },
    write(arg) {
      state.body += typeof arg === 'string' ? arg : String((arg && arg.output) || '');
    },
    writeFile({ file, isInline }) { state.files.push({ file, isInline }); },
  };
}

/** Suitelet request/response context. */
function contextStub({ parameters = {}, method = 'GET', body = '' } = {}) {
  const response = responseStub();
  return { context: { request: { parameters, method, body }, response }, response };
}

// ═══════════════════════════════════════════════════
// A LIVE RECORD STORE (#189)
// ═══════════════════════════════════════════════════
//
// Template governance is about what SURVIVES a write: a version row must exist
// after a save, the row must still be there after the template is deleted, and the
// version number must keep climbing. Hand-fed search fixtures cannot show any of
// that — so these two stubs share one in-memory store: N/record writes into it and
// N/search reads back out of it.

/**
 * N/record stub backed by a mutable store.
 *
 * @param {Object} [seed] - { 'customrecord_x:12': { field: value, … } }
 */
function recordStoreStub(seed = {}) {
  const records = {};
  Object.keys(seed).forEach((key) => { records[key] = { ...seed[key] }; });

  const saved = [];
  const deleted = [];
  const submitted = [];
  let seq = 500;
  let clock = 0;

  const makeRec = (type, id, values) => {
    const bag = { ...values };
    return {
      id,
      getValue({ fieldId }) {
        return Object.prototype.hasOwnProperty.call(bag, fieldId) ? bag[fieldId] : '';
      },
      setValue({ fieldId, value }) { bag[fieldId] = value; },
      save() {
        const rid = id == null ? String(seq++) : String(id);
        // the platform stamps `created`; monotonic + deterministic so history
        // assertions can read it
        clock += 1;
        const created = bag.created || `25/7/2026 10:${String(clock).padStart(2, '0')}`;
        records[`${type}:${rid}`] = { ...bag, created };
        saved.push({ type, id: rid, values: { ...bag } });
        return rid;
      },
    };
  };

  return {
    records,
    saved,
    deleted,
    submitted,
    /** rows of one type currently in the store, as plain objects */
    rowsOf(type) {
      return Object.keys(records)
        .filter((k) => k.indexOf(`${type}:`) === 0)
        .map((k) => ({ id: k.slice(type.length + 1), values: records[k] }));
    },
    module: {
      Type: {},
      load({ type, id }) {
        const key = `${type}:${id}`;
        if (!Object.prototype.hasOwnProperty.call(records, key)) {
          throw new Error(`That record does not exist: ${key}`);
        }
        return makeRec(type, String(id), records[key]);
      },
      create({ type }) { return makeRec(type, null, {}); },
      delete({ type, id }) {
        const key = `${type}:${id}`;
        if (!Object.prototype.hasOwnProperty.call(records, key)) {
          throw new Error(`That record does not exist: ${key}`);
        }
        delete records[key];
        deleted.push({ type, id: String(id) });
      },
      submitFields({ type, id, values }) {
        const key = `${type}:${id}`;
        submitted.push({ type, id: String(id), values: { ...values } });
        if (records[key]) Object.assign(records[key], values);
        return String(id);
      },
      lookupFields({ type, id, columns }) {
        const key = `${type}:${id}`;
        if (!Object.prototype.hasOwnProperty.call(records, key)) {
          throw new Error(`That record does not exist: ${key}`);
        }
        const out = {};
        columns.forEach((c) => { out[c] = records[key][c]; });
        return out;
      },
    },
  };
}

/** field name out of either a plain string or a search.Column object */
const columnName = (field) => (typeof field === 'object' && field ? field.name : field);

/** One `[field, operator, value]` filter against a stored row. */
function matchesFilter(values, [field, op, want]) {
  const raw = Object.prototype.hasOwnProperty.call(values, field) ? values[field] : '';

  if (op === 'is' && field === 'isinactive') {
    return (raw === true || raw === 'T' ? 'T' : 'F') === want;
  }
  if (op === 'is' && (want === 'T' || want === 'F')) {
    return (raw === true || raw === 'T' ? 'T' : 'F') === want;
  }
  if (op === 'equalto') return Number(raw) === Number(want);
  return String(raw) === String(want);
}

/** N/search stub reading the same store recordStoreStub writes into. */
function storeSearchStub(store) {
  const created = [];
  return {
    created,
    module: {
      Sort: { ASC: 'ASC', DESC: 'DESC', NONE: 'NONE' },
      createColumn(opts) { return opts; },
      create(opts) {
        created.push(opts);
        const rows = store.rowsOf(opts.type)
          .filter((row) => (opts.filters || [])
            .filter((f) => Array.isArray(f))
            .every((f) => matchesFilter(row.values, f)));

        const sortCol = (opts.columns || []).find((c) => c && c.sort);
        if (sortCol) {
          const dir = sortCol.sort === 'DESC' ? -1 : 1;
          rows.sort((a, b) => dir * ((Number(a.values[sortCol.name]) || 0) - (Number(b.values[sortCol.name]) || 0)));
        }

        const results = rows.map((row) => ({
          id: row.id,
          getValue: (field) => {
            const key = columnName(field);
            return Object.prototype.hasOwnProperty.call(row.values, key) ? row.values[key] : '';
          },
          getText: () => '',
        }));

        return {
          run: () => ({
            getRange: ({ start = 0, end = 1000 } = {}) => results.slice(start, end),
            each: (fn) => { results.every((row) => fn(row) !== false); },
          }),
        };
      },
    },
  };
}

module.exports = {
  queryStub, recordStub, formatStub, logStub, companyConfigStub,
  xmlStub, runtimeStub, searchStub, renderStub, fileStub, fileSystemStub, taskStub,
  responseStub, contextStub, recordStoreStub, storeSearchStub,
};

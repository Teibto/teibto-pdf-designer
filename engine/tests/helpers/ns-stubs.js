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

/** N/record stub exposing one record's body fields. */
function recordStub({ id = 1, values = {}, texts = {} } = {}) {
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
    if (!(value instanceof Date)) return String(value == null ? '' : value);
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

module.exports = { queryStub, recordStub, formatStub, logStub, companyConfigStub };

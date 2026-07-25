/**
 * pld_lib_company_config — File Cabinet URL resolution (#167) + subsidiary scoping (#144).
 *
 * Why this matters: a File Cabinet URL carries an `h=` token that changes whenever the
 * file is re-saved — and deploying the engine re-saves the bundled fonts. A config that
 * stores the raw URL therefore goes stale silently and BFO drops every Thai glyph with
 * no error. The loader now resolves the URL from the file id at render time.
 *
 * @author Wichit Wongta
 * @since 2026-07-25
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAmd } = require('./helpers/amd');
const { searchStub, logStub } = require('./helpers/ns-stubs');

const FIELD = {
  name: 'custrecord_pld_cfg_name',
  logo: 'custrecord_pld_cfg_logo_url',
  fontRegular: 'custrecord_pld_cfg_font_regular',
  fontBold: 'custrecord_pld_cfg_font_bold',
  subsidiary: 'custrecord_pld_cfg_subsidiary',
};

/** N/file stub: returns a URL that carries a FRESH token per load, and counts loads. */
function fileStub({ fail = [] } = {}) {
  const loads = [];
  return {
    loads,
    module: {
      load({ id }) {
        loads.push(String(id));
        if (fail.indexOf(String(id)) !== -1) throw new Error('That record does not exist. id=' + id);
        return { url: `/core/media/media.nl?id=${id}&c=4089685_SB2&h=FRESH${id}&_xt=.ttf` };
      },
    },
  };
}

function buildLoader({ rows, fail } = {}) {
  const search = searchStub(rows || []);
  const file = fileStub({ fail });
  const log = logStub();
  const lib = loadAmd('./pld_lib_company_config', {
    'N/search': search.module,
    'N/file': file.module,
    'N/log': log.module,
  }, new Map()); // fresh module instance per test → the per-execution url cache is not shared
  return { lib, file, log };
}

const rowWith = (values) => [{ id: '1', values: { [FIELD.name]: 'บริษัท ตัวอย่าง จำกัด', ...values } }];

test('a file id in the config resolves to a fresh URL at render time', () => {
  const { lib, file } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022', [FIELD.logo]: '4023' }),
  });

  const cfg = lib.load();

  assert.match(cfg.fontRegular, /id=4021&.*h=FRESH4021/);
  assert.match(cfg.fontBold, /id=4022&.*h=FRESH4022/);
  assert.match(cfg.logo, /id=4023&.*h=FRESH4023/);
  assert.deepEqual(file.loads.slice().sort(), ['4021', '4022', '4023'], 'one load per configured file');
});

test('a legacy URL with a stale token is re-resolved from its id — no admin action needed', () => {
  const { lib } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: 'https://4089685-sb2.app.netsuite.com/core/media/media.nl?id=4021&c=4089685_SB2&h=STALE&_xt=.ttf' }),
  });

  const cfg = lib.load();

  assert.match(cfg.fontRegular, /h=FRESH4021/);
  assert.ok(cfg.fontRegular.indexOf('STALE') === -1, 'the expired token must not survive');
});

test('a non-File-Cabinet URL is used exactly as configured', () => {
  const { lib, file } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: 'https://fonts.example.test/THSarabunPSK.ttf' }),
  });

  assert.equal(lib.load().fontRegular, 'https://fonts.example.test/THSarabunPSK.ttf');
  assert.deepEqual(file.loads, [], 'nothing to resolve → no governance spent');
});

test('an unresolvable file id keeps the configured value and says why in the log', () => {
  const { lib, log } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: '9999' }),
    fail: ['9999'],
  });

  const cfg = lib.load();

  assert.equal(cfg.fontRegular, '9999', 'never turn a font problem into a failed print');
  const audits = log.entries.filter((e) => e.level === 'audit');
  assert.equal(audits.length, 1);
  assert.match(audits[0].title, /file url unresolved/);
  assert.match(audits[0].details, /fontRegular/);
  assert.match(audits[0].details, /9999/);
});

test('empty font/logo fields stay empty (null-safe bindings render on)', () => {
  const { lib, file } = buildLoader({ rows: rowWith({}) });

  const cfg = lib.load();

  assert.equal(cfg.fontRegular, '');
  assert.equal(cfg.fontBold, '');
  assert.equal(cfg.logo, '');
  assert.deepEqual(file.loads, []);
});

test('the same file id is loaded once per execution, not once per read', () => {
  const { lib, file } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4021' }),
  });

  const cfg = lib.load();
  lib.load(); // a copy set calls load() once per copy

  assert.equal(cfg.fontRegular, cfg.fontBold);
  assert.deepEqual(file.loads, ['4021'], 'cached for the rest of the request');
});

test('non-URL fields are untouched by the resolver', () => {
  const { lib } = buildLoader({ rows: rowWith({ [FIELD.fontRegular]: '4021' }) });

  assert.equal(lib.load().name, 'บริษัท ตัวอย่าง จำกัด');
});

// ─── subsidiary scoping (#144) — no coverage existed for this either ──────────
test('subsidiary config wins, then global, then the first active row', () => {
  const rows = [
    { id: '1', values: { [FIELD.name]: 'FIRST', [FIELD.subsidiary]: '7' } },
    { id: '2', values: { [FIELD.name]: 'GLOBAL', [FIELD.subsidiary]: '' } },
    { id: '3', values: { [FIELD.name]: 'SUB20', [FIELD.subsidiary]: '20' } },
  ];

  assert.equal(buildLoader({ rows }).lib.load('20').name, 'SUB20');
  assert.equal(buildLoader({ rows }).lib.load('99').name, 'GLOBAL', 'unknown subsidiary → global');
  assert.equal(buildLoader({ rows }).lib.load().name, 'GLOBAL', 'no record context → global');
  assert.equal(
    buildLoader({ rows: [rows[0]] }).lib.load('99').name,
    'FIRST',
    'no global row → first active (legacy single-subsidiary accounts)',
  );
});

test('no active config logs the reason and returns empty values', () => {
  const { lib, log } = buildLoader({ rows: [] });

  const cfg = lib.load('20');

  assert.equal(cfg.name, '');
  assert.equal(cfg.fontRegular, '');
  assert.match(log.entries[0].title, /company config missing/);
});

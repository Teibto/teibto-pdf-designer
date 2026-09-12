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
function fileStub({ fail = [], empty = [] } = {}) {
  const loads = [];
  return {
    loads,
    module: {
      load({ id }) {
        loads.push(String(id));
        if (fail.indexOf(String(id)) !== -1) throw new Error('That record does not exist. id=' + id);
        if (empty.indexOf(String(id)) !== -1) return { url: '' };
        return { url: `/core/media/media.nl?id=${id}&c=4089685_SB2&h=FRESH${id}&_xt=.ttf` };
      },
    },
  };
}

function buildLoader({ rows, fail, empty } = {}) {
  const search = searchStub(rows || []);
  const file = fileStub({ fail, empty });
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

test('setup inspection retains an unresolvable font value for repair and logs why', () => {
  const { lib, log } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: '9999' }),
    fail: ['9999'],
  });

  const cfg = lib.load();

  assert.equal(cfg.fontRegular, '9999', 'setup must be able to inspect and repair the value');
  const audits = log.entries.filter((e) => e.level === 'audit');
  assert.equal(audits.length, 1);
  assert.match(audits[0].title, /file url unresolved/);
  assert.match(audits[0].details, /fontRegular/);
  assert.match(audits[0].details, /9999/);
});

test('setup inspection permits empty font/logo fields', () => {
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
test('subsidiary config wins, then explicit global; another subsidiary never supplies a transaction', () => {
  const rows = [
    { id: '1', values: { [FIELD.name]: 'FIRST', [FIELD.subsidiary]: '7' } },
    { id: '2', values: { [FIELD.name]: 'GLOBAL', [FIELD.subsidiary]: '' } },
    { id: '3', values: { [FIELD.name]: 'SUB20', [FIELD.subsidiary]: '20' } },
  ];
  rows.forEach(row => Object.assign(row.values, { [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022' }));

  assert.equal(buildLoader({ rows }).lib.load('20').name, 'SUB20');
  assert.equal(buildLoader({ rows }).lib.load('99').name, 'GLOBAL', 'unknown subsidiary → global');
  assert.equal(buildLoader({ rows }).lib.load().name, 'GLOBAL', 'no record context → global');
  assert.throws(() => buildLoader({ rows: [rows[0]] }).lib.load('99'), { name: 'PLD_COMPANY_CONFIG_MISSING' });
  assert.equal(buildLoader({ rows: [rows[0]] }).lib.load().name, 'FIRST', 'setup preserves legacy selection without transaction context');
});

test('no active config logs the reason and returns empty values', () => {
  const { lib, log } = buildLoader({ rows: [] });

  const cfg = lib.load();

  assert.equal(cfg.name, '');
  assert.equal(cfg.fontRegular, '');
  assert.match(log.entries[0].title, /company config missing/);
});

test('render requires active company config both with and without subsidiary context', () => {
  const { lib } = buildLoader();
  assert.throws(() => lib.load('20'), { name: 'PLD_COMPANY_CONFIG_MISSING' });
  assert.throws(() => lib.load(undefined, { forRender: true }), { name: 'PLD_COMPANY_CONFIG_MISSING' });
});

test('render rejects each missing required Thai font before producing a PDF', () => {
  for (const missing of ['fontRegular', 'fontBold']) {
    const values = { [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022', [FIELD[missing]]: ' ' };
    const { lib } = buildLoader({ rows: rowWith(values) });
    assert.throws(() => lib.load(undefined, { forRender: true }), error => error.name === 'PLD_FONT_MISSING' && error.message.includes(missing));
    assert.throws(() => lib.load('20'), { name: 'PLD_FONT_MISSING' });
  }
});

test('render rejects unresolved font IDs and stale URLs instead of returning their configured values', () => {
  for (const alias of ['fontRegular', 'fontBold']) {
    for (const value of ['9999', '/core/media/media.nl?id=9999&h=STALE']) {
      const { lib } = buildLoader({
        rows: rowWith({ [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022', [FIELD[alias]]: value }),
        fail: ['9999'],
      });
      assert.throws(() => lib.load(undefined, { forRender: true }), error => error.name === 'PLD_FONT_UNRESOLVED' && error.message.includes(alias));
    }
  }
});

test('render requires fonts backed by File Cabinet and does not treat arbitrary URL IDs as files', () => {
  const { lib, file } = buildLoader({ rows: rowWith({
    [FIELD.fontRegular]: 'https://fonts.example.test/font.ttf?id=4021', [FIELD.fontBold]: '4022',
  }) });
  assert.throws(() => lib.load(undefined, { forRender: true }), { name: 'PLD_FONT_UNRESOLVED' });
  assert.deepEqual(file.loads, []);
});

test('a loaded font without a URL fails visibly and is not cached as a usable font', () => {
  const { lib, file } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022' }), empty: ['4021'],
  });
  assert.throws(() => lib.load(undefined, { forRender: true }), { name: 'PLD_FONT_UNRESOLVED' });
  assert.throws(() => lib.load(undefined, { forRender: true }), { name: 'PLD_FONT_UNRESOLVED' });
  assert.deepEqual(file.loads, ['4021', '4021']);
});

test('optional broken logo is omitted while correctly configured fonts render', () => {
  const { lib, log } = buildLoader({
    rows: rowWith({ [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022', [FIELD.logo]: '9999' }),
    fail: ['9999'],
  });
  const cfg = lib.load(undefined, { forRender: true });
  assert.equal(cfg.logo, '');
  assert.match(cfg.fontRegular, /FRESH4021/);
  assert.match(log.entries[0].details, /logo/);
});

test('an exact subsidiary with missing fonts cannot borrow healthy global company identity', () => {
  const { lib } = buildLoader({ rows: [
    { id: '1', values: { [FIELD.name]: 'GLOBAL', [FIELD.fontRegular]: '4021', [FIELD.fontBold]: '4022' } },
    { id: '2', values: { [FIELD.name]: 'SUB20', [FIELD.subsidiary]: '20' } },
  ] });
  assert.throws(() => lib.load('20'), { name: 'PLD_FONT_MISSING' });
});

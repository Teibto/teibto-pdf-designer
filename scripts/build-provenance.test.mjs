/** Synthetic build/deploy provenance regressions.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceHashes, seal, verify, stage, stamp } from './build-provenance.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), value); };
  write('designer/src/main.ts', 'export const sample = 1;');
  write('designer/package-lock.json', '{}');
  write('designer/dist-netsuite/index.html', '<script src="assets/app.js"></script>');
  write('designer/dist-netsuite/assets/app.js', 'console.log("synthetic")');
  write('engine/VERSION', '1.2.3');
  write('.gitignore', '**/dist-netsuite/\n**/dist/\n**/pld_version.txt\n.env\n');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init'); git('add', '.'); git('-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'fixture');
  const dist = path.join(root, 'designer/dist-netsuite');
  const build = () => seal(root, dist, sourceHashes(root));
  return { root, write, git, dist, build };
}

test('rejects missing manifest, changed inputs, altered/missing/extra assets', t => {
  const f = fixture(t);
  assert.throws(() => verify(f.root, f.dist));
  f.build(); verify(f.root, f.dist);
  f.write('designer/src/main.ts', 'changed');
  assert.throws(() => verify(f.root, f.dist), /Stale/);
  f.build(); f.write('designer/dist-netsuite/assets/app.js', 'tampered');
  assert.throws(() => verify(f.root, f.dist), /assets changed/);
  f.build(); f.write('designer/dist-netsuite/unexpected.txt', 'extra');
  assert.throws(() => verify(f.root, f.dist), /assets changed/);
  f.build(); fs.unlinkSync(path.join(f.dist, 'assets/app.js'));
  assert.throws(() => verify(f.root, f.dist), /Incomplete/);
});

test('rejects source changes during build and hashes env without storing content', t => {
  const f = fixture(t);
  const initial = sourceHashes(f.root);
  f.write('designer/.env.netsuite.local', 'VITE_SAMPLE=synthetic-private-value');
  assert.throws(() => seal(f.root, f.dist, initial), /during build/);
  f.build();
  assert.equal(fs.readFileSync(path.join(f.dist, 'pld-build-manifest.json'), 'utf8').includes('synthetic-private-value'), false);
});

test('stamps verified assets and detects staged and untracked changes', t => {
  const f = fixture(t);
  f.build(); stage(f.root);
  assert.equal(stamp(f.root).sha.endsWith('+dirty'), false);
  f.write('notes.txt', 'untracked');
  assert.equal(stamp(f.root).sha.endsWith('+dirty'), true);
  f.git('add', 'notes.txt');
  assert.equal(stamp(f.root).sha.endsWith('+dirty'), true);
  f.write('engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/dist/assets/app.js', 'tampered');
  const before = fs.readFileSync(path.join(f.root, 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_version.txt'), 'utf8');
  assert.throws(() => stamp(f.root), /assets changed/);
  assert.equal(fs.readFileSync(path.join(f.root, 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_version.txt'), 'utf8'), before);
});

test('deploy rejects stale bundle before CLI and restores account/scope after CLI failure', t => {
  const f = fixture(t);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  for (const name of ['deploy.sh', 'build-provenance.mjs']) f.write(`scripts/${name}`, fs.readFileSync(path.join(scriptDir, name)));
  const project = '{"defaultAuthId":"synthetic-original"}\r\n';
  const scope = '<deploy><files><path>synthetic-original</path></files></deploy>\r\n';
  f.write('engine/project.json', project);
  f.write('engine/src/deploy.xml', scope);
  // Local shell stub; it never resolves or invokes any real SuiteCloud binary.
  f.write('stub/suitecloud', '#!/usr/bin/env bash\nprintf called > "../cli-called"\nexit 17\n');
  fs.mkdirSync(path.join(f.root, 'tmp'));
  fs.chmodSync(path.join(f.root, 'stub/suitecloud'), 0o755);
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const invoke = () => execFileSync(bash, [path.join(f.root, 'scripts/deploy.sh').replaceAll('\\', '/'), '--no-build', '--dryrun', 'synthetic-test'], {
    cwd: f.root, encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, TMPDIR: path.join(f.root, 'tmp').replaceAll('\\', '/'), PATH: `${path.join(f.root, 'stub')}${path.delimiter}${process.env.PATH}` },
  });
  f.build(); f.write('designer/src/main.ts', 'stale');
  assert.throws(invoke, /Stale/);
  assert.equal(fs.existsSync(path.join(f.root, 'cli-called')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_version.txt')), false);
  f.build(); assert.throws(invoke);
  assert.equal(fs.readFileSync(path.join(f.root, 'cli-called'), 'utf8'), 'called');
  assert.equal(fs.readFileSync(path.join(f.root, 'engine/project.json'), 'utf8'), project);
  assert.equal(fs.readFileSync(path.join(f.root, 'engine/src/deploy.xml'), 'utf8'), scope);
  fs.unlinkSync(path.join(f.root, 'engine/project.json'));
  assert.throws(invoke);
  assert.equal(fs.existsSync(path.join(f.root, 'engine/project.json')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'engine/src/deploy.xml'), 'utf8'), scope);
});

test('engine fingerprint tracks dirty scripts and Objects without account metadata', t => {
  const f = fixture(t);
  const script = 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_sample.js';
  f.write(script, 'synthetic version one');
  f.write('engine/src/Objects/customrecord_sample.xml', '<record/>');
  f.write('engine/src/manifest.xml', '<manifest/>');
  f.write('engine/suitecloud.config.js', 'module.exports = {};');
  f.build(); stage(f.root);
  const first = stamp(f.root);
  f.write(script, 'synthetic version two');
  const second = stamp(f.root);
  assert.notEqual(first.enginePayload.sha256, second.enginePayload.sha256);
  assert.notEqual(first.enginePayload.files.find(entry => entry.path === script).sha256,
    second.enginePayload.files.find(entry => entry.path === script).sha256);
  f.write('engine/src/Objects/customrecord_sample.xml', '<record changed="true"/>');
  const third = stamp(f.root);
  assert.notEqual(second.enginePayload.sha256, third.enginePayload.sha256);
  f.write('engine/project.json', '{"defaultAuthId":"synthetic-private-account"}');
  f.write('engine/deploy-targets.txt', 'synthetic-private-account');
  f.write('engine/.env', 'SYNTHETIC_SECRET=synthetic-private-secret');
  const fourth = stamp(f.root);
  assert.equal(third.enginePayload.sha256, fourth.enginePayload.sha256);
  assert.equal(JSON.stringify(fourth).includes('synthetic-private'), false);
  const payloadPaths = fourth.enginePayload.files.map(entry => entry.path);
  assert.deepEqual(payloadPaths, [...payloadPaths].sort());
});

test('stamp revalidates source and environment after stage and preserves prior stamp', t => {
  const f = fixture(t);
  f.build(); stage(f.root); stamp(f.root);
  const stampPath = path.join(f.root, 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_version.txt');
  const before = fs.readFileSync(stampPath, 'utf8');
  f.write('designer/src/main.ts', 'changed after stage');
  assert.throws(() => stamp(f.root), /Stale/);
  assert.equal(fs.readFileSync(stampPath, 'utf8'), before);
  f.build(); stage(f.root);
  f.write('designer/.env.netsuite.local', 'VITE_SAMPLE=changed-after-stage');
  assert.throws(() => stamp(f.root), /Stale/);
  assert.equal(fs.readFileSync(stampPath, 'utf8'), before);
});

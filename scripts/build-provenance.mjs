/** Build/deployment provenance; contains hashes only, never source contents.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const manifestName = 'pld-build-manifest.json';
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function files(root, relative = '') {
  const target = path.join(root, relative);
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Symlinks are not supported in build inputs/outputs');
  if (!fs.statSync(target).isDirectory()) return [relative.replaceAll('\\', '/')];
  return fs.readdirSync(target).sort().flatMap(name => files(root, path.join(relative, name)));
}

export function sourceHashes(root) {
  const inputs = ['designer/src', 'designer/public', 'scripts/build-provenance.mjs', ...['.env', '.env.local', '.env.netsuite', '.env.netsuite.local'].map(name => `designer/${name}`)];
  for (const name of fs.readdirSync(path.join(root, 'designer')).sort()) {
    if (/^(package(?:-lock)?\.json|index\.html|(?:vite|tailwind|postcss)\.config\.[cm]?[jt]s|tsconfig(?:\.[\w-]+)?\.json)$/.test(name)) inputs.push(`designer/${name}`);
  }
  const result = {};
  result['$viteEnvironment'] = digest(JSON.stringify(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')).sort(([a], [b]) => a.localeCompare(b))));
  for (const input of inputs.sort()) {
    if (!fs.existsSync(path.join(root, input))) continue;
    for (const name of files(root, input)) result[name] = digest(fs.readFileSync(path.join(root, name)));
  }
  return result;
}

function assetHashes(dist) {
  const result = {};
  for (const name of files(dist).filter(name => name !== manifestName)) result[name] = digest(fs.readFileSync(path.join(dist, name)));
  if (!result['index.html'] || !Object.keys(result).some(name => name.endsWith('.js'))) throw new Error('Incomplete NetSuite bundle');
  return result;
}

export function seal(root, dist, initial) {
  const sources = sourceHashes(root);
  if (!equal(initial, sources)) throw new Error('Build inputs changed during build; rebuild');
  const manifest = { schema: 1, mode: 'netsuite', built: new Date().toISOString(), node: process.version, sources, assets: assetHashes(dist) };
  fs.writeFileSync(path.join(dist, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verify(root, dist) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, manifestName), 'utf8'));
  if (manifest.schema !== 1 || manifest.mode !== 'netsuite' || !equal(manifest.sources, sourceHashes(root))) throw new Error('Stale or unsupported bundle; run npm run build:netsuite');
  if (!equal(manifest.assets, assetHashes(dist))) throw new Error('Bundle assets changed; run npm run build:netsuite');
  return manifest;
}

export function stage(root) {
  const dist = path.join(root, 'designer/dist-netsuite');
  verify(root, dist);
  const destination = path.join(root, 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/dist');
  // Resolve each ancestor before recursive removal; never traverse a junction/symlink.
  for (let current = destination; current !== path.dirname(root); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Unsafe staging path');
    if (current === root) break;
  }
  if (!destination.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Staging path outside repository');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(dist, destination, { recursive: true });
  verify(root, destination);
}

export function enginePayload(root) {
  const app = 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer';
  const inputs = ['engine/VERSION', 'engine/src/manifest.xml', 'engine/suitecloud.config.js'];
  if (fs.existsSync(path.join(root, app))) {
    for (const name of fs.readdirSync(path.join(root, app)).sort()) {
      if (name.endsWith('.js')) inputs.push(`${app}/${name}`);
    }
  }
  if (fs.existsSync(path.join(root, 'engine/src/Objects'))) {
    inputs.push(...files(root, 'engine/src/Objects').filter(name => name.endsWith('.xml')));
  }
  const inventory = {};
  for (const name of inputs.sort()) {
    if (!fs.existsSync(path.join(root, name))) continue;
    if (fs.lstatSync(path.join(root, name)).isSymbolicLink()) throw new Error('Symlinks are not supported in engine payload');
    inventory[name] = digest(fs.readFileSync(path.join(root, name)));
  }
  return {
    schema: 1,
    scope: 'Application root JavaScript, Objects XML, VERSION, SDF manifest and SuiteCloud config; excludes fonts, SPA (separate bundle digest), generated deploy scope/stamp and account metadata',
    sha256: digest(JSON.stringify(inventory)),
    files: inventory,
  };
}

export function stamp(root) {
  const app = path.join(root, 'engine/src/FileCabinet/SuiteScripts/pdf-layout-designer');
  const manifest = verify(root, path.join(app, 'dist'));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0;
  const result = {
    version: fs.readFileSync(path.join(root, 'engine/VERSION'), 'utf8').trim(),
    sha: git(['rev-parse', '--short', 'HEAD']) + (dirty ? '+dirty' : ''),
    built: new Date().toISOString(),
    bundleBuilt: manifest.built,
    bundleSha256: digest(fs.readFileSync(path.join(app, 'dist', manifestName))),
    enginePayload: enginePayload(root),
  };
  fs.writeFileSync(path.join(app, 'pld_version.txt'), `${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, repo] = process.argv.slice(2);
  const root = path.resolve(repo || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  try {
    if (command === 'snapshot') process.stdout.write(JSON.stringify(sourceHashes(root)));
    else if (command === 'seal') seal(root, path.join(root, 'designer/dist-netsuite'), JSON.parse(fs.readFileSync(0, 'utf8')));
    else if (command === 'stage') stage(root);
    else if (command === 'stamp') process.stdout.write(JSON.stringify(stamp(root)));
    else throw new Error('Unknown provenance command');
  } catch (error) {
    process.stderr.write(`Build provenance: ${error.message}\n`);
    process.exitCode = 1;
  }
}

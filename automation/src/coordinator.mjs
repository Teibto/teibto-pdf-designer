/** @author Wichit Wongta
 * @since 2026-09-13
 * Reuse an explicitly owned sandbox tab through the shared session coordinator.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
const MAX_PDF = 20 * 1024 * 1024;
const MESSAGES = {
  PLD_CONFIG: 'Configure a sandbox account, owned target ID and absolute coordinator path.',
  PLD_SESSION: 'Registered sandbox browser is unavailable or its binding changed.',
  PLD_CONTEXT: 'Owned tab must contain the designer in the configured sandbox with a valid role.',
  PLD_RENDER_URL: 'Renderer must be a same-origin NetSuite Suitelet URL.',
  PLD_TRANSPORT: 'Shared coordinator command failed or timed out; inspect the owned session.',
  PLD_RESPONSE: 'Renderer did not return a valid PDF response.',
  PLD_SIZE: 'PDF response exceeds the size limit.',
  PLD_INPUT: 'Invalid render input.',
};
function fail(code) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.PLD_TRANSPORT), { code: MESSAGES[code] ? code : 'PLD_TRANSPORT' }); }
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";

// Function is serialized unchanged. Only JSON data varies; callers cannot supply JS.
async function browserCommand(input) {
  try {
    const context = window.__NS_CONTEXT__;
    if (location.origin !== input.origin || !context ||
        String(context.accountId).toUpperCase().replaceAll('-', '_') !== input.account ||
        context.environment !== 'SANDBOX' || !/^\d+$/.test(String(context.role)) || Number(context.role) < 1) {
      return JSON.stringify({ error: 'PLD_CONTEXT' });
    }
    let endpoint;
    try {
      endpoint = new URL(input.renderUrl || window.__NS_RENDER_URL__, location.origin);
      if (endpoint.origin !== input.origin || endpoint.pathname !== '/app/site/hosting/scriptlet.nl' ||
          endpoint.username || endpoint.password || endpoint.hash ||
          !endpoint.searchParams.get('script') || !endpoint.searchParams.get('deploy')) throw new Error();
    } catch { return JSON.stringify({ error: 'PLD_RENDER_URL' }); }
    const statusOnly = !input.payload;
    const limit = statusOnly ? 16384 : input.maxPdf;
    const responseError = statusOnly ? 'PLD_SESSION' : 'PLD_RESPONSE';
    endpoint.searchParams.set('action', statusOnly ? 'version' : 'preview-live');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const started = Date.now();
      const response = await fetch(endpoint.href, { method: statusOnly ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
        cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        ...(statusOnly ? {} : { body: JSON.stringify(input.payload) }), signal: controller.signal });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || response.redirected || response.url !== endpoint.href ||
          !(statusOnly ? /^application\/json(?:\s*;|$)/i : /^application\/pdf(?:\s*;|$)/i).test(contentType)) return JSON.stringify({ error: responseError });
      if (Number(response.headers.get('content-length')) > limit) return JSON.stringify({ error: statusOnly ? 'PLD_SESSION' : 'PLD_SIZE' });
      if (!response.body) return JSON.stringify({ error: responseError });
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) { await reader.cancel(); return JSON.stringify({ error: statusOnly ? 'PLD_SESSION' : 'PLD_SIZE' }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (statusOnly) {
        let version;
        try { version = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { return JSON.stringify({ error: 'PLD_SESSION' }); }
        if (!version || typeof version !== 'object' || Array.isArray(version) || typeof version.version !== 'string') return JSON.stringify({ error: 'PLD_SESSION' });
        return JSON.stringify({ account: input.account, environment: 'SANDBOX', role: Number(context.role), ready: true });
      }
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return JSON.stringify({ error: 'PLD_RESPONSE' });
      const elapsedMs = Date.now() - started;
      const metrics = { elapsedMs, pdfBytes: size, phases: {}, usage: null };
      if (input.measure) {
        const timing = response.headers.get('server-timing') || '';
        for (const part of timing.split(',')) {
          const match = /^\s*(total|data|reference|binding|bfo|combine);dur=(\d+(?:\.\d+)?)\s*$/.exec(part);
          if (match && Number.isFinite(Number(match[2]))) metrics.phases[match[1]] = Number(match[2]);
        }
        const usage = response.headers.get('x-pld-usage');
        if (usage !== null && /^\d+$/.test(usage) && Number.isSafeInteger(Number(usage))) metrics.usage = Number(usage);
      }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return JSON.stringify({ pdf: btoa(binary), ...(input.measure ? { metrics } : {}) });
    } finally { clearTimeout(timer); }
  } catch { return JSON.stringify({ error: 'PLD_TRANSPORT' }); }
}

export function createCoordinator(config) {
  const account = String(config.account || '').toUpperCase().replaceAll('-', '_');
  const targetId = config.targetId;
  if (!/^\d+_SB\d+$/.test(account) || typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(targetId) ||
      typeof config.coordinator !== 'string' || !(path.isAbsolute(config.coordinator) || path.win32.isAbsolute(config.coordinator)) ||
      !config.coordinator.toLowerCase().endsWith('ns-qa.ps1')) throw fail('PLD_CONFIG');
  const origin = `https://${account.toLowerCase().replaceAll('_', '-')}.app.netsuite.com`;
  const runner = config.runner || (async ({ action, scriptPath }) => {
    const command = `& ${quote(config.coordinator)} -Action ${quote(action)} -Account ${quote(account)}` +
      (action === 'command' ? ` -TargetId ${quote(targetId)} -CommandArgs @('evalf', ${quote(scriptPath)}, '55')` : '');
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      timeout: 65000, maxBuffer: MAX_PDF * 2, windowsHide: true,
    });
    return result.stdout;
  });
  let queue = Promise.resolve();
  async function perform(payload, measure) {
    let directory;
    try {
      const state = JSON.parse(await runner({ action: 'status', account, timeoutMs: 65000 }));
      if (state.account !== account || state.bound !== true || state.browser_running !== true || state.binding_match !== true) throw fail('PLD_SESSION');
      directory = await mkdtemp(path.join(tmpdir(), 'pld-coordinator-'));
      const scriptPath = path.join(directory, 'render.js');
      await writeFile(scriptPath, `(${browserCommand.toString()})(${JSON.stringify({ account, origin, renderUrl: config.renderUrl, maxPdf: MAX_PDF, payload, measure })})`, { mode: 0o600 });
      const result = JSON.parse(await runner({ action: 'command', account, targetId, scriptPath, timeoutMs: 65000 }));
      if (!result || typeof result !== 'object') throw fail('PLD_TRANSPORT');
      if (result.error) throw fail(result.error);
      if (!payload) {
        if (result.account !== account || result.environment !== 'SANDBOX' || !Number.isInteger(result.role) || result.role < 1 || result.ready !== true) throw fail('PLD_CONTEXT');
        return { account, environment: 'SANDBOX', role: result.role, targetId, ready: true };
      }
      if (typeof result.pdf !== 'string' || result.pdf.length > Math.ceil(MAX_PDF / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.pdf)) throw fail('PLD_RESPONSE');
      const bytes = Buffer.from(result.pdf, 'base64');
      if (bytes.length > MAX_PDF) throw fail('PLD_SIZE');
      if (bytes.subarray(0, 5).toString() !== '%PDF-') throw fail('PLD_RESPONSE');
      if (measure) {
        const metrics = result.metrics;
        if (!metrics || !Number.isFinite(metrics.elapsedMs) || metrics.elapsedMs < 0 || metrics.pdfBytes !== bytes.length ||
            (metrics.usage !== null && (!Number.isSafeInteger(metrics.usage) || metrics.usage < 0))) throw fail('PLD_RESPONSE');
        const phases = {};
        for (const name of ['total', 'data', 'reference', 'binding', 'bfo', 'combine']) {
          const value = metrics.phases?.[name];
          if (Number.isFinite(value) && value >= 0) phases[name] = value;
        }
        return { pdf: bytes, metrics: { elapsedMs: metrics.elapsedMs, requestBytes: Buffer.byteLength(JSON.stringify(payload)), pdfBytes: bytes.length, usage: metrics.usage, phases } };
      }
      return bytes;
    } catch (error) {
      throw fail(error?.code);
    } finally {
      if (directory) {
        try { await rm(directory, { recursive: true, force: true }); }
        catch { throw fail('PLD_TRANSPORT'); }
      }
    }
  }
  function enqueue(payload, measure = false) {
    const result = queue.then(() => perform(payload, measure));
    queue = result.catch(() => {});
    return result;
  }
  return {
    status: () => enqueue(),
    render: ({ xml, rectype, copies, recordId, measure = false } = {}) => {
      if (typeof measure !== 'boolean') return Promise.reject(fail('PLD_INPUT'));
      if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml) > 2 * 1024 * 1024 ||
          typeof rectype !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(rectype) ||
          (copies !== undefined && (!Array.isArray(copies) || copies.length > 10 || copies.some(c => !c || typeof c.th !== 'string' || typeof c.en !== 'string' || c.th.length > 100 || c.en.length > 100)))) return Promise.reject(fail('PLD_INPUT'));
      if (recordId !== undefined && (config.allowRecords !== true || !/^[1-9]\d{0,14}$/.test(String(recordId)))) return Promise.reject(fail('PLD_INPUT'));
      return enqueue({ xml, rectype, ...(recordId === undefined ? { sample: true } : { recid: String(recordId) }), ...(copies === undefined ? {} : { copies }) }, measure);
    },
  };
}

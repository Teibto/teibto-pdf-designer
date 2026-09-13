/** @author Wichit Wongta
 * @since 2026-09-13
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import { createCoordinator } from '../src/coordinator.mjs';

const account = '1234567_SB2';
const origin = 'https://1234567-sb2.app.netsuite.com';
const config = { account, targetId: 'OWNED_TARGET', coordinator: 'C:/shared/ns-qa.ps1' };
function harness(options = {}) {
  const paths = []; const calls = []; const requests = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.action === 'status') return JSON.stringify({ account, bound: true, browser_running: true, binding_match: true, ...options.state });
    paths.push(request.scriptPath);
    const script = await readFile(request.scriptPath, 'utf8');
    return vm.runInNewContext(script, {
      window: { __NS_CONTEXT__: { accountId: account, environment: 'SANDBOX', role: 3, ...options.context },
        __NS_RENDER_URL__: options.url || '/app/site/hosting/scriptlet.nl?script=customscript_pld&deploy=1' },
      location: { origin: options.origin || origin }, URL, AbortController, setTimeout, clearTimeout, Uint8Array, TextDecoder,
      btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (options.fetch) return options.fetch(url, init);
        const status = new URL(url).searchParams.get('action') === 'version';
        const response = new Response(status ? '{"version":"unknown"}' : '%PDF-1.7\nsynthetic',
          { headers: { 'Content-Type': status ? 'application/json' : 'application/pdf' } });
        Object.defineProperty(response, 'url', { value: url });
        return response;
      },
    });
  };
  return { coordinator: createCoordinator({ ...config, runner, allowRecords: options.allowRecords }), paths, calls, requests };
}
test('requires sandbox account, explicit target and absolute coordinator', () => {
  for (const invalid of [{ account: '1234567' }, { targetId: '' }, { coordinator: 'ns-qa.ps1' }]) {
    assert.throws(() => createCoordinator({ ...config, ...invalid }), { code: 'PLD_CONFIG' });
  }
});
test('returns only safe status and deletes evaluation files', async () => {
  const h = harness();
  assert.deepEqual(await h.coordinator.status(), { account, environment: 'SANDBOX', role: 3, targetId: config.targetId, ready: true });
  assert.equal(h.requests.length, 1);
  assert.equal(new URL(h.requests[0].url).searchParams.get('action'), 'version');
  assert.equal(h.requests[0].init.method, 'GET');
  assert.equal(h.requests[0].init.redirect, 'error');
  assert.equal(h.requests[0].init.cache, 'no-store');
  assert.equal(h.requests[0].init.credentials, 'same-origin');
  assert.equal(h.calls[1].targetId, config.targetId);
  await assert.rejects(access(h.paths[0]));
});
test('renders synthetic PDF through same-origin preview-live with supplied copies', async () => {
  const h = harness(); const copies = [{ th: 'สำเนา', en: 'Copy' }];
  const pdf = await h.coordinator.render({ xml: '<pdf>"\\\n</pdf>', rectype: 'invoice', copies });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const { url, init } = h.requests[0];
  assert.equal(new URL(url).searchParams.get('action'), 'preview-live');
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(init.body), { xml: '<pdf>"\\\n</pdf>', rectype: 'invoice', sample: true, copies });
});
test('cached designer context does not report ready when authentication returns login HTML or redirect', async () => {
  for (const entry of [
    { body: '<html>PRIVATE LOGIN</html>', type: 'text/html' },
    { body: '{"version":"unknown"}', type: 'application/json', redirected: true },
    { body: '<html>PRIVATE LOGIN</html>', type: 'application/json' },
    { body: '{"error":"PRIVATE LOGIN"}', type: 'application/json' },
    { body: '[]', type: 'application/json' },
  ]) {
    const h = harness({ fetch: url => {
      const response = new Response(entry.body, { headers: { 'content-type': entry.type } });
      Object.defineProperty(response, 'url', { value: url });
      if (entry.redirected) Object.defineProperty(response, 'redirected', { value: true });
      return response;
    } });
    await assert.rejects(h.coordinator.status(), error => error.code === 'PLD_SESSION' && !error.message.includes('PRIVATE'));
    await assert.rejects(access(h.paths[0]));
  }
});
test('status probe rejects and cancels a JSON stream exceeding 16 KiB', async () => {
  let canceled = false;
  const h = harness({ fetch: url => ({ url, ok: true, redirected: false,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(16385) }), cancel: async () => { canceled = true; } }) },
  }) });
  await assert.rejects(h.coordinator.status(), { code: 'PLD_SESSION' });
  assert.equal(canceled, true);
});
test('fails closed on stale browser, wrong origin/context/role and unsafe URL', async () => {
  for (const options of [
    { state: { binding_match: false } }, { state: { browser_running: false } }, { state: { bound: false } },
    { origin: 'https://1234567.app.netsuite.com' }, { context: { accountId: '1234567_SB1' } },
    { context: { environment: 'PRODUCTION' } }, { context: { role: null } },
    { url: 'https://example.com/app/site/hosting/scriptlet.nl?script=1&deploy=1' },
    { url: '/app/login/secure/enterpriselogin.nl?script=1&deploy=1' },
  ]) {
    const h = harness(options);
    await assert.rejects(h.coordinator.render({ xml: '<pdf/>', rectype: 'invoice' }), /Registered|Owned tab|Renderer must/);
    assert.equal(h.requests.length, 0);
  }
});
test('real record render requires explicit opt-in and positive record ID', async () => {
  await assert.rejects(harness().coordinator.render({ xml: '<pdf/>', rectype: 'invoice', recordId: '1' }), { code: 'PLD_INPUT' });
  const h = harness({ allowRecords: true });
  for (const recordId of ['0', '-1', '1&action=save']) await assert.rejects(h.coordinator.render({ xml: '<pdf/>', rectype: 'invoice', recordId }), { code: 'PLD_INPUT' });
  await h.coordinator.render({ xml: '<pdf/>', rectype: 'invoice', recordId: '1' });
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { xml: '<pdf/>', rectype: 'invoice', recid: '1' });
});
test('rejects HTML, redirects and oversized response before reading content', async () => {
  for (const options of [
    { ok: true, redirected: false, headers: new Headers({ 'content-type': 'text/html' }) },
    { ok: true, redirected: true, headers: new Headers({ 'content-type': 'application/pdf' }) },
    { ok: true, redirected: false, headers: new Headers({ 'content-type': 'application/pdf', 'content-length': '999999999' }) },
  ]) {
    const h = harness({ fetch: (url) => ({ url, ...options }) });
    await assert.rejects(h.coordinator.render({ xml: '<pdf/>', rectype: 'invoice' }), /valid PDF|size limit/);
  }
});
test('serializes target work and recovers queue after sanitized transport failure', async () => {
  let active = 0; let highest = 0; let failed = false;
  const h = harness();
  const coordinator = createCoordinator({ ...config, runner: async (request) => {
    active++; highest = Math.max(highest, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (!failed) { failed = true; throw new Error('PRIVATE CUSTOMER HTML'); }
    if (request.action === 'status') return JSON.stringify({ account, bound: true, browser_running: true, binding_match: true });
    return JSON.stringify({ account, environment: 'SANDBOX', role: 3, ready: true });
  } });
  const results = await Promise.allSettled([coordinator.status(), coordinator.status(), coordinator.status()]);
  assert.equal(results[0].reason.code, 'PLD_TRANSPORT');
  assert.doesNotMatch(results[0].reason.message, /PRIVATE/);
  assert.equal(results[1].status, 'fulfilled'); assert.equal(results[2].status, 'fulfilled');
  assert.equal(highest, 1); assert.equal(h.calls.length, 0);
});
test('rejects a forged PDF MIME type and cancels an oversized streamed PDF', async () => {
  const forged = harness({ fetch: (url) => {
    const response = new Response('<html>PRIVATE</html>', { headers: { 'content-type': 'application/pdf' } });
    Object.defineProperty(response, 'url', { value: url }); return response;
  } });
  await assert.rejects(forged.coordinator.render({ xml: '<pdf/>', rectype: 'invoice' }), { code: 'PLD_RESPONSE' });
  let canceled = false;
  const oversized = harness({ fetch: (url) => ({ url, ok: true, redirected: false,
    headers: new Headers({ 'content-type': 'application/pdf' }),
    body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(21 * 1024 * 1024) }), cancel: async () => { canceled = true; } }) },
  }) });
  await assert.rejects(oversized.coordinator.render({ xml: '<pdf/>', rectype: 'invoice' }), { code: 'PLD_SIZE' });
  assert.equal(canceled, true);
});

test('measured rendering allowlists numeric timing headers and preserves PDF bytes', async () => {
  const h = harness({ fetch: async (url) => {
    const response = new Response('%PDF-1.7\nsynthetic', { headers: {
      'Content-Type': 'application/pdf',
      'Server-Timing': 'total;dur=25, data;dur=12, bfo;dur=10, private-record;dur=42, binding;dur=NaN',
      'X-PLD-Usage': '35',
    } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  } });
  const result = await h.coordinator.render({ xml: '<pdf/>', rectype: 'invoice', measure: true });
  assert.equal(result.pdf.toString(), '%PDF-1.7\nsynthetic');
  assert.deepEqual(result.metrics.phases, { total: 25, data: 12, bfo: 10 });
  assert.equal(result.metrics.usage, 35);
  assert.equal(result.metrics.pdfBytes, result.pdf.length);
  assert.equal(result.metrics.requestBytes, Buffer.byteLength(h.requests[0].init.body));
  assert.ok(result.metrics.elapsedMs >= 0);
  assert.equal('measure' in JSON.parse(h.requests[0].init.body), false);
});

test('measured rendering reports absent server telemetry as missing', async () => {
  const h = harness();
  const result = await h.coordinator.render({ xml: '<pdf/>', rectype: 'invoice', measure: true });
  assert.deepEqual(result.metrics.phases, {});
  assert.equal(result.metrics.usage, null);
});

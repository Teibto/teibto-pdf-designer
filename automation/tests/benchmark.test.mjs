/** @author Wichit Wongta @since 2026-09-13 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark, summarize } from '../src/benchmark.mjs';

test('percentiles exclude missing metrics but retain every failure in denominator', () => {
  const result = summarize([
    { ok: true, performance: { elapsedMs: 30, usage: null, phases: {} } },
    { ok: false },
    { ok: true, performance: { elapsedMs: 10, usage: 0, phases: { data: 2 } } },
  ]);
  assert.deepEqual(result.responseMs, { samples: 2, p50: 10, p95: 30, max: 30 });
  assert.deepEqual(result.governance, { samples: 1, p50: 0, p95: 0, max: 0 });
  assert.equal(result.failureRate, 1 / 3);
  assert.equal(result.phases.bfo.p95, null);
  assert.equal(result.phases.data.samples, 1);
});

test('benchmark runs serially, preserves copies, separates first request and redacts private output', async () => {
  const calls = []; let active = 0;
  const service = { async render(input) {
    assert.equal(active++, 0);
    await Promise.resolve(); active--;
    calls.push(input);
    if (calls.length === 2) throw new Error('PRIVATE_RECORD');
    return { path: 'PRIVATE_PATH', performance: { elapsedMs: 100, pdfBytes: 20, usage: null, phases: {} } };
  } };
  const result = await runBenchmark(service, { template: 'invoice-reference', recordId: '123456', runs: 3, copies: 2 });
  assert.equal(result.firstRequest.successes, 1);
  assert.equal(result.subsequentRequests.failures, 1);
  assert.equal(result.allRequests.attempts, 3);
  assert.equal(new Set(calls.map(call => call.outputName)).size, 3);
  assert.ok(calls.every(call => call.measure && call.copies === 2 && call.recordId === '123456'));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|123456/);
});

test('invalid benchmark plan cannot start remote work', async () => {
  const service = { render() { assert.fail('must not render'); } };
  for (const options of [{ runs: 51 }, { copies: 0 }, { recordId: 'bad' }, { template: '../invoice' }]) {
    await assert.rejects(runBenchmark(service, { template: 'invoice', ...options }));
  }
});

test('systemic failures stop immediately and repeated render failures stop after three attempts', async () => {
  for (const code of ['PLD_SESSION', 'PLD_TRANSPORT', 'PRIVATE_EXCEPTION']) {
    let calls = 0;
    const result = await runBenchmark({ async render() {
      calls++;
      throw Object.assign(new Error('PRIVATE_CONTEXT'), { code });
    } }, { template: 'invoice', runs: 20 });
    const systemic = code !== 'PRIVATE_EXCEPTION';
    assert.equal(calls, systemic ? 1 : 3);
    assert.equal(result.notAttempted, 20 - calls);
    assert.equal(result.allRequests.failureRate, 1);
    assert.equal(result.stoppedReason, systemic ? code : 'CONSECUTIVE_FAILURES');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  }
});

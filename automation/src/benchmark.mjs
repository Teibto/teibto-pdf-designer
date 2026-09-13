/** @author Wichit Wongta @since 2026-09-13 */
import { randomUUID } from 'node:crypto';

function distribution(values) {
  const sorted = values.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, p50: null, p95: null, max: null };
  return { samples: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
}

export function summarize(samples) {
  const ok = samples.filter(sample => sample.ok);
  const failureCategories = {};
  for (const sample of samples.filter(sample => !sample.ok)) {
    const category = failureCategory(sample);
    failureCategories[category] = (failureCategories[category] || 0) + 1;
  }
  const phases = {};
  for (const name of ['total', 'data', 'reference', 'binding', 'bfo', 'combine']) {
    phases[name] = distribution(ok.map(sample => sample.performance?.phases?.[name]));
  }
  return {
    attempts: samples.length, successes: ok.length, failures: samples.length - ok.length,
    failureCategories,
    failureRate: samples.length ? (samples.length - ok.length) / samples.length : null,
    responseMs: distribution(ok.map(sample => sample.performance?.elapsedMs)),
    governance: distribution(ok.map(sample => sample.performance?.usage)),
    requestBytes: distribution(ok.map(sample => sample.performance?.requestBytes)),
    pdfBytes: distribution(ok.map(sample => sample.performance?.pdfBytes)), phases,
  };
}

const systemicCodes = new Set(['PLD_CONFIG', 'PLD_SESSION', 'PLD_CONTEXT', 'PLD_RENDER_URL', 'PLD_TRANSPORT', 'PLD_INPUT', 'PLD_SIZE']);
function failureCategory(error) {
  return systemicCodes.has(error?.code) || error?.code === 'PLD_RESPONSE' ? error.code : 'RENDER_FAILED';
}

// Serial requests preserve one owned browser target and avoid load-testing the
// shared account. First request is separate; it is not proof of a cold server.
export async function runBenchmark(service, { template, copies = 1, recordId, runs = 20 } = {}) {
  if (!Number.isInteger(runs) || runs < 2 || runs > 50) throw new Error('Runs must be an integer from 2 to 50.');
  if (typeof template !== 'string' || !/^[a-z0-9-]+$/.test(template)) throw new Error('Choose a canonical template ID.');
  if (!Number.isInteger(copies) || copies < 1 || copies > 10) throw new Error('Copies must be an integer from 1 to 10.');
  if (recordId !== undefined && (typeof recordId !== 'string' || !/^[1-9][0-9]{0,14}$/.test(recordId))) throw new Error('Record ID must be a positive numeric string.');
  const runId = randomUUID();
  const samples = [];
  let consecutiveFailures = 0;
  let stoppedReason = null;
  for (let index = 0; index < runs; index++) {
    try {
      const result = await service.render({ template, copies, recordId, measure: true, outputName: `benchmark-${runId}-${index + 1}.pdf` });
      samples.push({ ok: true, performance: result.performance });
      consecutiveFailures = 0;
    } catch (error) {
      // Remote failures can contain private account context; retain denominator,
      // never exception text. Inspect private coordinator evidence separately.
      const code = failureCategory(error);
      samples.push({ ok: false, code });
      consecutiveFailures++;
      if (systemicCodes.has(code) || consecutiveFailures >= 3) {
        stoppedReason = systemicCodes.has(code) ? code : 'CONSECUTIVE_FAILURES';
        break;
      }
    }
  }
  return {
    runId, template, copies, mode: recordId === undefined ? 'synthetic' : 'record',
    plannedRuns: runs, notAttempted: runs - samples.length, stoppedReason,
    firstRequest: summarize(samples.slice(0, 1)), subsequentRequests: summarize(samples.slice(1)),
    allRequests: summarize(samples),
    limits: 'Browser fetch through complete PDF bytes; excludes coordinator overhead, iframe paint and PDF page inspection. First request is not a verified cold server. Missing phase/governance samples remain missing.',
  };
}

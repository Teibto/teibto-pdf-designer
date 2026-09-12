#!/usr/bin/env node
/** @author Wichit Wongta @since 2026-09-13 */
import { parseArgs } from 'node:util';
import { createService } from '../src/service.mjs';
import { runBenchmark } from '../src/benchmark.mjs';

try {
  const { values } = parseArgs({ options: {
    template: { type: 'string' }, copies: { type: 'string', default: '1' },
    runs: { type: 'string', default: '20' }, 'record-id': { type: 'string' },
  } });
  if (!process.env.PLD_OUTPUT_DIR) throw new Error('Set PLD_OUTPUT_DIR to a private evidence directory outside version control.');
  if (values['record-id'] !== undefined && process.env.PLD_ALLOW_RECORDS !== 'true') throw new Error('Authorized sandbox record measurement requires PLD_ALLOW_RECORDS=true.');
  const result = await runBenchmark(createService(), {
    template: values.template, copies: Number(values.copies), runs: Number(values.runs), recordId: values['record-id'],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.allRequests.failures) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`PDF benchmark: ${error.message}\n`);
  process.exitCode = 1;
}

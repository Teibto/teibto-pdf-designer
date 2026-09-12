#!/usr/bin/env node
/**
 * CLI for the shared canonical PDF automation service.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { parseArgs } from 'node:util';
import { createService } from './service.mjs';

const help = `Usage:
  node src/cli.mjs templates
  node src/cli.mjs status
  node src/cli.mjs render --template <id> --output <basename.pdf> [--copies 1..10] [--record-id <id>] [--measure]

Render uses synthetic data and the existing NetSuite sandbox BFO renderer.
Actual sandbox records require --record-id and operator opt-in PLD_ALLOW_RECORDS=true.
Configuration: PLD_ACCOUNT, PLD_TARGET_ID, PLD_COORDINATOR, PLD_OUTPUT_DIR,
and optional PLD_RENDER_URL. See docs/MCP-CLI.md.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, template: { type: 'string' }, output: { type: 'string' }, copies: { type: 'string' }, 'record-id': { type: 'string' }, measure: { type: 'boolean' } },
  });
  if (values.help || positionals.length === 0) {
    process.stdout.write(help);
  } else {
    if (positionals.length !== 1 || !['templates', 'status', 'render'].includes(positionals[0])) {
      throw new Error('Expected one command: templates, status, or render. Use --help.');
    }
    const command = positionals[0];
    if (command !== 'render' && Object.keys(values).length) throw new Error('Render options require the render command.');
    if (command === 'render') {
      if (!values.template || !values.output) throw new Error('Render requires --template and --output.');
      if (values.copies !== undefined && !/^(?:[1-9]|10)$/.test(values.copies)) throw new Error('--copies must be an integer from 1 to 10.');
      if (values['record-id'] !== undefined && !/^[1-9][0-9]{0,14}$/.test(values['record-id'])) throw new Error('--record-id must be a positive numeric ID of at most 15 digits.');
    }
    const service = createService();
    const result = command === 'templates' ? await service.listTemplates()
      : command === 'status' ? await service.status()
        : await service.render({ template: values.template, outputName: values.output, ...(values.measure ? { measure: true } : {}), ...(values.copies === undefined ? {} : { copies: Number(values.copies) }), ...(values['record-id'] === undefined ? {} : { recordId: values['record-id'] }) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`PDF automation: ${error.message}\n`);
  process.exitCode = 1;
}

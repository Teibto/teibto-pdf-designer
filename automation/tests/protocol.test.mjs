/**
 * Real subprocess MCP/CLI contract tests; never render against a live account.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PLD_')));

test('MCP subprocess initializes, advertises tools, lists templates, and rejects invalid render arguments', { timeout: 20000 }, async () => {
  const client = new Client({ name: 'pdf-protocol-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'], cwd, env, stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion().name, 'teibto-pdf');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['pdf_list_templates', 'pdf_render', 'pdf_status']);
    const listed = await client.callTool({ name: 'pdf_list_templates', arguments: {} });
    assert.notEqual(listed.isError, true);
    const data = JSON.parse(listed.content[0].text);
    assert.equal(data.source, 'templates/master');
    assert.ok(data.templates.length > 0);
    assert.ok(data.templates.every((template) => typeof template.id === 'string' && template.id.length));
    for (const args of [
      {},
      { template: data.templates[0].id, outputName: '../escape.pdf' },
      { template: data.templates[0].id, outputName: 'test.pdf', copies: 11 },
      { template: data.templates[0].id, outputName: 'test.pdf', copies: 1.5 },
      { template: data.templates[0].id, outputName: 'test.pdf', recordId: '-1' },
      { template: data.templates[0].id, outputName: 'test.pdf', unknownField: '123' },
    ]) {
      const result = await client.callTool({ name: 'pdf_render', arguments: args });
      assert.equal(result.isError, true, JSON.stringify(args));
    }
    const unknown = await client.callTool({ name: 'pdf_render', arguments: { template: 'unknown-template-test', outputName: 'test.pdf' } });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /Unknown canonical template/);
    const forbiddenRecord = await client.callTool({ name: 'pdf_render', arguments: { template: data.templates[0].id, outputName: 'test.pdf', recordId: '123' } });
    assert.equal(forbiddenRecord.isError, true);
    assert.match(forbiddenRecord.content[0].text, /PLD_ALLOW_RECORDS/);
  } finally {
    await client.close();
  }
});

test('CLI help and templates need no sandbox configuration', () => {
  for (const args of [['--help'], ['templates']]) {
    const result = spawnSync(process.execPath, ['src/cli.mjs', ...args], { cwd, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    if (args[0] === 'templates') assert.ok(JSON.parse(result.stdout).templates.length);
    else assert.match(result.stdout, /Usage:/);
  }
});

test('CLI rejects malformed commands with a nonzero exit and no success JSON', () => {
  for (const args of [
    ['unknown'], ['status', '--output', 'test.pdf'], ['render'],
    ['render', '--template', 'invoice', '--output', 'test.pdf', '--copies', '1.5'],
    ['render', '--template', 'invoice', '--output', 'test.pdf', '--copies', '11'],
    ['render', '--template', 'invoice', '--output', 'test.pdf', '--unexpected'],
    ['render', '--template', 'invoice', '--output', 'test.pdf', '--record-id', '-1'],
  ]) {
    const result = spawnSync(process.execPath, ['src/cli.mjs', ...args], { cwd, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /PDF automation:/);
  }
});

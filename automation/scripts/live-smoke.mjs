#!/usr/bin/env node
/** @author Wichit Wongta @since 2026-09-13 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Deliberately outside npm test: this makes a real authenticated sandbox render.
if (!process.env.PLD_ACCOUNT || !process.env.PLD_TARGET_ID || !process.env.PLD_COORDINATOR) {
  throw new Error('Confirm sandbox intent, claim an owned designer tab, and set PLD_ACCOUNT, PLD_TARGET_ID, PLD_COORDINATOR first.');
}
const client = new Client({ name: 'teibto-pdf-live-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))],
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
});
try {
  await client.connect(transport);
  const invoke = async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (result.isError) throw new Error(result.content.find(item => item.type === 'text')?.text || 'MCP call failed.');
    return JSON.parse(result.content.find(item => item.type === 'text').text);
  };
  const status = await invoke('pdf_status', {});
  const catalog = await invoke('pdf_list_templates', {});
  if (!catalog.templates.some(template => template.id === 'invoice')) throw new Error('Canonical invoice is missing.');
  const artifact = await invoke('pdf_render', { template: 'invoice', copies: 2, outputName: `invoice-mcp-${Date.now()}.pdf` });
  const bytes = await readFile(artifact.path);
  if (artifact.mode !== 'synthetic' || artifact.copies !== 2 || bytes.length !== artifact.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Artifact metadata does not match saved PDF.');
  process.stdout.write(`${JSON.stringify({ status, artifact, visualReview: 'REQUIRED: inspect both copies, Thai glyphs and layout before sign-off' }, null, 2)}\n`);
} finally {
  await client.close();
}

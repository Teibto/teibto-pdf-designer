#!/usr/bin/env node
/**
 * Local stdio MCP access to the canonical PDF service.
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createService } from './service.mjs';

const server = new McpServer({ name: 'teibto-pdf', version: '0.1.0' });
const service = createService();
const invoke = (operation) => async (args) => {
  try {
    const result = await operation(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    // Service errors are sanitized at the boundary to the coordinator.
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
};

server.registerTool('pdf_list_templates', {
  description: 'List canonical templates available for synthetic PDF rendering.',
  inputSchema: z.object({}).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, invoke(() => service.listTemplates()));

server.registerTool('pdf_status', {
  description: 'Check the configured shared NetSuite sandbox session and owned tab.',
  inputSchema: z.object({}).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, invoke(() => service.status()));

server.registerTool('pdf_render', {
  description: 'Render a canonical template through NetSuite N/render and save a PDF in the configured output directory. Uses synthetic data by default; recordId requires operator opt-in PLD_ALLOW_RECORDS=true. Requires a configured sandbox session and owned tab.',
  inputSchema: z.object({
    template: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).describe('Template id returned by pdf_list_templates'),
    outputName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.pdf$/).describe('PDF basename using letters, numbers, hyphen or underscore, without directories'),
    copies: z.number().int().min(1).max(10).optional(),
    recordId: z.string().regex(/^[1-9][0-9]{0,14}$/).optional().describe('Sandbox record ID; requires operator opt-in PLD_ALLOW_RECORDS=true'),
  }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, invoke((args) => service.render(args)));

await server.connect(new StdioServerTransport());

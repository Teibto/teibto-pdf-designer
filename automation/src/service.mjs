/** @author Wichit Wongta @since 2026-09-13 */
import { readdir, readFile, realpath, mkdir, open, unlink, lstat, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createCoordinator } from './coordinator.mjs';

const master = fileURLToPath(new URL('../../templates/master/', import.meta.url));
const defaultOutput = fileURLToPath(new URL('../output/', import.meta.url));
const MAX_PDF = 20 * 1024 * 1024;
const validName = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.pdf$/;

function safeError(error) {
  if (/^(PLD_|NS_)[A-Z0-9_]+$/.test(error?.code || '')) return error;
  return new Error('PDF operation failed. Check the coordinator session and local output permissions; no fallback PDF was created.');
}

export function createService(config = {}) {
  const settings = {
    account: process.env.PLD_ACCOUNT,
    targetId: process.env.PLD_TARGET_ID,
    coordinator: process.env.PLD_COORDINATOR,
    renderUrl: process.env.PLD_RENDER_URL,
    allowRecords: process.env.PLD_ALLOW_RECORDS === 'true',
    outputDir: process.env.PLD_OUTPUT_DIR || defaultOutput,
    ...config,
  };
  let bridge;
  const coordinator = () => bridge ||= settings.transport || createCoordinator(settings);

  async function readCatalog() {
    const names = (await readdir(master)).filter(name => /^[a-z0-9-]+\.xml$/.test(name)).sort();
    return Promise.all(names.map(async name => {
      const filename = path.join(master, name);
      if (await realpath(filename) !== filename) throw new Error('Canonical template must not be a symbolic link.');
      const xml = await readFile(filename, 'utf8');
      const rectype = /pld:rectype\s+([a-z]+)/.exec(xml)?.[1];
      if (!rectype || xml.length > 1000000) throw new Error('Invalid canonical template metadata or size.');
      return { id: name.slice(0, -4), rectype, xml };
    }));
  }
  async function catalog() {
    try { return await readCatalog(); } catch (error) { throw safeError(error); }
  }

  return {
    async listTemplates() {
      return { source: 'templates/master', templates: (await catalog()).map(({ id, rectype }) => ({ id, rectype })) };
    },
    async status() {
      try { return await coordinator().status(); } catch (error) { throw safeError(error); }
    },
    async render({ template, outputName, copies = 1, recordId } = {}) {
      if (typeof template !== 'string' || !/^[a-z0-9-]+$/.test(template)) throw new Error('Choose a template ID from pdf_list_templates.');
      if (typeof outputName !== 'string' || !validName.test(outputName) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(outputName)) throw new Error('Output must be a simple filename ending in .pdf (letters, numbers, hyphen or underscore).');
      if (!Number.isInteger(copies) || copies < 1 || copies > 10) throw new Error('Copies must be an integer from 1 to 10.');
      if (recordId !== undefined && (typeof recordId !== 'string' || !/^[1-9][0-9]{0,14}$/.test(recordId))) throw new Error('Record ID must be a positive numeric string.');
      if (recordId !== undefined && settings.allowRecords !== true) throw new Error('Record rendering is disabled. The operator must enable PLD_ALLOW_RECORDS=true for authorized sandbox records.');
      const selected = (await catalog()).find(entry => entry.id === template);
      if (!selected) throw new Error('Unknown canonical template. Run templates to list supported IDs.');
      let handle;
      let destination;
      let temporary;
      try {
        await mkdir(settings.outputDir, { recursive: true });
        const root = await realpath(settings.outputDir);
        destination = path.join(root, outputName);
        // Check before remote work; the final hard-link publication also rejects races.
        try { await lstat(destination); throw Object.assign(new Error(), { code: 'EEXIST' }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        temporary = path.join(root, `.pld-${randomUUID()}.partial`);
        handle = await open(temporary, 'wx', 0o600);
        const labels = Array.from({ length: copies }, (_, index) => index === 0
          ? { th: 'ต้นฉบับ', en: 'Original' }
          : { th: `สำเนา ${index}`, en: `Copy ${index}` });
        const pdf = await coordinator().render({ xml: selected.xml, rectype: selected.rectype, copies: labels, ...(recordId === undefined ? {} : { recordId }) });
        if (!Buffer.isBuffer(pdf) || pdf.length < 20 || pdf.length > MAX_PDF || pdf.subarray(0, 5).toString() !== '%PDF-' || !pdf.subarray(-1024).includes(Buffer.from('%%EOF'))) {
          throw new Error('Invalid PDF result.');
        }
        await handle.writeFile(pdf);
        await handle.sync();
        await handle.close();
        handle = undefined;
        // Same-directory hard link publishes complete bytes atomically without overwrite.
        await link(temporary, destination);
        let cleanupWarning;
        try { await unlink(temporary); }
        catch { cleanupWarning = 'PDF is complete; a private .pld-*.partial hard link remains for operator cleanup.'; }
        temporary = undefined;
        return { path: destination, bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), template, rectype: selected.rectype, copies, mode: recordId === undefined ? 'synthetic' : 'record', account: settings.account, ...(cleanupWarning ? { cleanupWarning } : {}) };
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (temporary) await unlink(temporary).catch(() => {});
        if (error.code === 'EEXIST') throw new Error('Output already exists. Choose a new filename; existing PDFs are never overwritten.');
        throw safeError(error);
      }
    },
  };
}

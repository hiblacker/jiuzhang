import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, rename, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMATS = new Map([['.csv', 'csv'], ['.json', 'json'], ['.jsonl', 'jsonl'], ['.xlsx', 'xlsx'], ['.parquet', 'parquet']]);
const UNSUPPORTED = new Set(['.xls']);
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function fail(code) { throw new Error(code); }

function parseArgs(argv) {
  const options = { inbox: null, lakeRoot: path.join(ROOT, '.lake-data'), sourceCode: 'folder-source', deliveryDate: null, assumeReady: false, dryRun: false, maxFileBytes: 1024 * 1024 * 1024, maxRows: 10_000_000, jsonRecordsPath: '', parserPython: process.env.PYTHON || '/Users/carson/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' };
  const takes = new Set(['--inbox', '--lake-root', '--source-code', '--delivery-date', '--parser-python', '--max-file-bytes', '--max-rows', '--json-records-path']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--assume-ready') options.assumeReady = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (takes.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT_VALUE');
      if (arg === '--inbox') options.inbox = path.resolve(ROOT, value);
      if (arg === '--lake-root') options.lakeRoot = path.resolve(ROOT, value);
      if (arg === '--source-code') options.sourceCode = value;
      if (arg === '--delivery-date') options.deliveryDate = value;
      if (arg === '--parser-python') options.parserPython = value;
      if (arg === '--max-file-bytes') options.maxFileBytes = Number(value);
      if (arg === '--max-rows') options.maxRows = Number(value);
      if (arg === '--json-records-path') options.jsonRecordsPath = value;
    } else fail('INVALID_ARGUMENT');
  }
  if (!options.inbox) fail('INBOX_REQUIRED');
  if (!SAFE.test(options.sourceCode)) fail('INVALID_SOURCE_CODE');
  if (options.deliveryDate && !/^\d{4}-\d{2}-\d{2}$/u.test(options.deliveryDate)) fail('INVALID_DELIVERY_DATE');
  if (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes < 1 || options.maxFileBytes > 10 * 1024 * 1024 * 1024) fail('INVALID_MAX_FILE_BYTES');
  if (!Number.isSafeInteger(options.maxRows) || options.maxRows < 1 || options.maxRows > 100_000_000) fail('INVALID_MAX_ROWS');
  if (options.jsonRecordsPath.length > 300) fail('INVALID_JSON_RECORDS_PATH');
  return options;
}

function formatFor(file) { return FORMATS.get(path.extname(file).toLowerCase()) ?? null; }

async function walk(root, current = root, found = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(root, full, found);
    else if (entry.isFile() && (formatFor(full) || UNSUPPORTED.has(path.extname(full).toLowerCase()))) found.push(full);
  }
  return found;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

function readyFor(file, assumeReady, markerExists = false) { return Boolean(assumeReady || markerExists); }

async function runParser(options, format, input, output) {
  const parserArgs = [path.join(ROOT, 'tools/file-parser.py'), '--format', format, '--input', input, '--output', output, '--max-rows', String(options.maxRows)];
  if (options.jsonRecordsPath && (format === 'json' || format === 'jsonl')) parserArgs.push('--records-path', options.jsonRecordsPath);
  const child = spawn(options.parserPython, parserArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8').slice(0, 4000); });
  const stderr = once(child.stderr, 'end');
  const closeEvent = await once(child, 'close');
  await stderr.catch(() => {});
  const [code] = closeEvent;
  if (code !== 0) fail(`FILE_PARSER_FAILED_${format.toUpperCase()}`);
  try { return JSON.parse(stdout.trim()); } catch { fail('FILE_PARSER_PROTOCOL_FAILED'); }
}

async function readLedger(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return { version: 1, deliveries: {} }; }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.part`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

export async function scanDirectory(options = parseArgs([])) {
  options.maxFileBytes ??= 1024 * 1024 * 1024;
  options.maxRows ??= 10_000_000;
  options.jsonRecordsPath ??= '';
  const deliveryDate = options.deliveryDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const files = await walk(options.inbox);
  const ledgerFile = path.join(options.lakeRoot, 'file-ledger.json');
  const ledger = await readLedger(ledgerFile);
  await mkdir(options.lakeRoot, { recursive: true, mode: 0o700 });
  const batchId = `files-${deliveryDate.replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
  const batchRoot = path.join(options.lakeRoot, 'file-batches', batchId);
  const entries = [];
  for (const file of files.sort()) {
    const relativePath = path.relative(options.inbox, file);
    const format = formatFor(file);
    const fileStat = await lstat(file);
    if (!fileStat.isFile()) continue;
    const identity = await hashFile(file);
    const key = `${options.sourceCode}|${deliveryDate}|${relativePath}|${identity.sha256}`;
    if (ledger.deliveries[key]?.state === 'PARSED') { entries.push({ relativePath, state: 'DUPLICATE', key }); continue; }
    if (!format) { entries.push({ relativePath, format: path.extname(file).toLowerCase().slice(1), state: 'UNSUPPORTED_FORMAT', key }); continue; }
    if (identity.bytes > options.maxFileBytes) {
      const entry = { relativePath, format, state: 'TOO_LARGE', input: identity, deliveryDate, key, errorCode: 'FILE_SIZE_LIMIT_EXCEEDED' };
      entries.push(entry);
      ledger.deliveries[key] = { state: 'FAILED', batchId, relativePath, deliveryDate, sha256: identity.sha256, errorCode: entry.errorCode, receivedAt: new Date().toISOString() };
      continue;
    }
    const markerExists = await access(`${file}.done`).then(() => true).catch(() => false);
    if (!readyFor(file, options.assumeReady, markerExists)) { entries.push({ relativePath, state: 'WAITING_READY', key }); continue; }
    const entry = { relativePath, format, state: 'DISCOVERED', input: identity, deliveryDate, key };
    entries.push(entry);
    if (options.dryRun) continue;
    try {
      const safeName = relativePath.replace(/[\\/]/gu, '__');
      const staging = path.join(batchRoot, safeName);
      await mkdir(staging, { recursive: true, mode: 0o700 });
      const rawPath = path.join(staging, `original${path.extname(file).toLowerCase()}`);
      const parsedPath = path.join(staging, 'parsed.jsonl.part');
      await copyFile(file, rawPath);
      const copied = await hashFile(rawPath);
      if (copied.sha256 !== identity.sha256 || copied.bytes !== identity.bytes) fail('FILE_CHANGED_DURING_COPY');
      entry.state = 'PARSING';
      const parsed = await runParser(options, format, file, parsedPath);
      const parsedBytes = await hashFile(parsedPath);
      await rename(parsedPath, path.join(staging, 'parsed.jsonl'));
      entry.state = 'PARSED'; entry.rows = parsed.rows; entry.parsed = parsedBytes; entry.rawPath = path.relative(options.lakeRoot, rawPath);
      ledger.deliveries[key] = { state: 'PARSED', batchId, relativePath, deliveryDate, sha256: identity.sha256, receivedAt: new Date().toISOString() };
    } catch (error) {
      entry.state = 'FAILED';
      entry.errorCode = String(error?.message ?? 'FILE_INGEST_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120);
      ledger.deliveries[key] = { state: 'FAILED', batchId, relativePath, deliveryDate, sha256: identity.sha256, errorCode: entry.errorCode, receivedAt: new Date().toISOString() };
    }
  }
  const summaryState = entries.some((x) => ['FAILED', 'TOO_LARGE'].includes(x.state)) ? 'FAILED' : entries.some((x) => ['WAITING_READY', 'UNSUPPORTED_FORMAT'].includes(x.state)) ? 'INCOMPLETE' : 'COMPLETE';
  const summary = { version: 1, batchId, sourceCode: options.sourceCode, deliveryDate, inbox: 'configured-inbox', state: summaryState, entries };
  if (!options.dryRun) { await mkdir(batchRoot, { recursive: true, mode: 0o700 }); await atomicJson(path.join(batchRoot, 'batch.json'), summary); await atomicJson(ledgerFile, ledger); }
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await scanDirectory(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ batchId: summary.batchId, state: summary.state, files: summary.entries.length, parsed: summary.entries.filter((x) => x.state === 'PARSED').length, waiting: summary.entries.filter((x) => x.state === 'WAITING_READY').length, unsupported: summary.entries.filter((x) => x.state === 'UNSUPPORTED_FORMAT').length, duplicates: summary.entries.filter((x) => x.state === 'DUPLICATE').length }, null, 2));
    if (summary.state === 'FAILED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAILED', errorCode: String(error?.message ?? 'FILE_INGEST_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120) }));
    process.exitCode = 1;
  }
}

export { formatFor, parseArgs, readyFor, hashFile };

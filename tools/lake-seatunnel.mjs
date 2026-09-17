// Executes one registered-SQL extraction through SeaTunnel and produces the same RAW
// contract the mysql-CLI path produces: raw/<source>/<batch>/<object>/data.jsonl +
// schema.json + batches/<batch>/batch.json, with the platform computing rows/bytes/sha256.
//
// Two query shapes are used on purpose:
//   preview    : SELECT * FROM (<sql>) src LIMIT n        -> CSV sink (text, so decimals
//                                                           and timestamps keep their digits)
//   extraction : SELECT CAST(`c` AS CHAR) AS `c`, ... FROM (<sql>) src
//                                                          -> JSON sink (values as strings,
//                                                             source-local wall clock, matching
//                                                             the existing mysql-char-v2 contract)
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildClientConfig } from './datasource-test.mjs';

const IDENTIFIER = /^[A-Za-z0-9_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]{0,127}$/u;
const TERMINAL = new Set(['FINISHED', 'FAILED', 'CANCELED', 'CANCELLED']);

export function fail(code) { const error = new Error(code); error.code = code; throw error; }

export function quoteIdentifier(name, datasourceType = 'MYSQL') {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) fail('INVALID_RESULT_COLUMN');
  if (datasourceType === 'MYSQL' || datasourceType === 'TIDB') return `\`${name}\``;
  return `"${name}"`;
}

/** Wraps the user query and casts every column to text: no float rounding, no ambiguous
 *  UTC-without-offset timestamps, and deterministic column names. */
export function buildExtractionQuery(sqlText, resultColumns, datasourceType = 'MYSQL') {
  if (!Array.isArray(resultColumns) || resultColumns.length === 0) fail('RESULT_COLUMNS_REQUIRED');
  const projections = resultColumns.map(column => {
    const quoted = quoteIdentifier(column.name, datasourceType);
    return `CAST(${quoted} AS CHAR) AS ${quoted}`;
  });
  return `SELECT ${projections.join(', ')} FROM (${stripTrailingSemicolon(sqlText)}) AS seatunnel_src`;
}

/**
 * Metadata probe: mysql in batch mode only prints the result header when the query returns at
 * least one row, so this asks for exactly one. The row itself is discarded; it exists to make
 * the server report the column names.
 */
export function buildMetadataQuery(sqlText) {
  return `SELECT * FROM (${stripTrailingSemicolon(sqlText)}) AS seatunnel_src LIMIT 1`;
}

function stripTrailingSemicolon(sqlText) {
  if (typeof sqlText !== 'string' || sqlText.trim().length === 0) fail('SQL_TEXT_REQUIRED');
  return sqlText.trim().replace(/;+$/u, '');
}

export function buildJob({ config, query, sinkPath, format }) {
  const datasource = config.datasource ?? {};
  const credential = config.credential ?? {};
  if (!datasource.host || !datasource.port || !datasource.database) fail('DATASOURCE_CONFIG_INCOMPLETE');
  if (!credential.user || credential.password === undefined) fail('DATASOURCE_CREDENTIAL_REQUIRED');
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(datasource.host)) fail('INVALID_DATASOURCE_HOST');
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(datasource.database)) fail('INVALID_DATASOURCE_DATABASE');
  if (!/^[A-Za-z0-9_.@$-]{1,128}$/u.test(credential.user)) fail('INVALID_DATASOURCE_USER');
  const charset = datasource.charset ?? 'utf8mb4';
  if (!/^[A-Za-z0-9]{3,16}$/u.test(charset)) fail('INVALID_DATASOURCE_CHARSET');
  const timezone = datasource.timezone ?? 'Asia/Shanghai';
  if (!/^[A-Za-z0-9/_+-]{3,64}$/u.test(timezone)) fail('INVALID_DATASOURCE_TIMEZONE');
  const url = `jdbc:mysql://${datasource.host}:${Number(datasource.port)}/${datasource.database}`
    + `?useSSL=${datasource.sslmode === 'REQUIRED' ? 'true' : 'false'}&allowPublicKeyRetrieval=true`
    + `&serverTimezone=${encodeURIComponent(timezone)}&characterEncoding=UTF-8&useUnicode=true`;
  const sink = format === 'csv'
    ? { plugin_name: 'LocalFile', path: sinkPath, file_format_type: 'csv',
        field_delimiter: ',', row_delimiter: '\n', options: { use_header: true, is_enable_transaction: false } }
    : { plugin_name: 'LocalFile', path: sinkPath, file_format_type: 'json', options: { is_enable_transaction: false } };
  return {
    env: { 'job.mode': 'batch', parallelism: 1 },
    source: [{
      plugin_name: 'Jdbc',
      url,
      driver: 'com.mysql.cj.jdbc.Driver',
      user: credential.user,
      password: credential.password,
      query,
      fetch_size: Number(config.fetchSize ?? 1000),
      connection_check_timeout_sec: 30,
    }],
    transform: [],
    sink: [sink],
  };
}

/**
 * Reads the tab-separated header mysql prints in batch mode. The names are the source's own
 * result names, so non-ASCII identifiers and aliases come back exactly as the server sees them.
 * Types are not available this way; they are inferred from the previewed values and marked as
 * inferred in schema.json.
 */
export function parseHeaderLine(stdout) {
  const firstLine = String(stdout ?? '').split('\n')[0] ?? '';
  if (firstLine.trim() === '') return [];
  return firstLine.split('\t').map(name => name.trim()).filter(name => name !== '')
    .map(name => ({ name, type: 'unknown', inferred: true }));
}

/** Best-effort type for a text value; recorded as inferred, never as authoritative. */
export function inferType(value) {
  if (value === null || value === undefined || value === '') return 'unknown';
  if (/^-?\d+$/u.test(value)) return 'integer';
  if (/^-?\d+\.\d+$/u.test(value)) return 'numeric';
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/u.test(value)) return 'timestamp';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return 'date';
  return 'text';
}

function runMysql(cli, configFile, sql) {
  return new Promise(resolve => {
    const child = spawn(cli, [`--defaults-extra-file=${configFile}`, '--batch', '-e', sql],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes.toString(); });
    child.stderr.on('data', bytes => { stderr += bytes.toString(); });
    child.on('error', error => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

/** Reads the result column names without returning any row (LIMIT 0). */
async function probeColumns(config, sql) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jiuzhang-seatunnel-'));
  const configFile = path.join(directory, 'client.cnf');
  try {
    await writeFile(configFile, buildClientConfig(config.datasource ?? {}, config.credential ?? {}), { mode: 0o600 });
    const cli = process.env.MYSQL_CLI ?? 'mysql';
    const result = await runMysql(cli, configFile, buildMetadataQuery(sql));
    if (result.code !== 0) fail('SQL_METADATA_FAILED');
    const columns = parseHeaderLine(result.stdout);
    if (columns.length === 0) fail('SQL_RESULT_COLUMNS_UNKNOWN');
    return columns;
  } finally {
    await unlink(configFile).catch(() => {});
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** Minimal RFC4180 reader: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else if (!entry.name.endsWith('.crc')) files.push(full);
  }
  return files.sort();
}

/** One JSON object per line is the contract; an array or a scalar is not a row. */
function assertJsonObjectLine(line) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { fail('SEATUNNEL_OUTPUT_NOT_JSON'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('SEATUNNEL_OUTPUT_NOT_JSON');
}

/** Concatenates SeaTunnel's part files into data.jsonl and returns the integrity facts. */
export async function collectJsonl(sinkDir, objectDir) {
  const parts = await listFiles(sinkDir);
  if (parts.length === 0) fail('SEATUNNEL_OUTPUT_EMPTY');
  await mkdir(objectDir, { recursive: true, mode: 0o700 });
  const target = path.join(objectDir, 'data.jsonl');
  const out = createWriteStream(target, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  let rows = 0, bytes = 0, pending = '';
  for (const part of parts) {
    const stream = createReadStream(part, { encoding: 'utf8' });
    stream.on('data', () => {});
    for await (const chunk of stream) {
      pending += chunk;
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line.trim() === '') continue;
        assertJsonObjectLine(line);
        const buffer = Buffer.from(`${line}\n`, 'utf8');
        hash.update(buffer); bytes += buffer.length; rows += 1;
        if (!out.write(buffer)) await once(out, 'drain');
      }
    }
  }
  if (pending.trim() !== '') {
    assertJsonObjectLine(pending);
    const buffer = Buffer.from(`${pending}\n`, 'utf8');
    hash.update(buffer); bytes += buffer.length; rows += 1;
    out.write(buffer);
  }
  out.end();
  await once(out, 'close');
  await Promise.all(parts.map(part => rm(part, { force: true })));
  return { path: target, rows, bytes, sha256: hash.digest('hex') };
}

export async function postJson(url, route, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${url}${route}`, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) fail(`HTTP_${response.status}:${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : {};
}

export async function submitJob(seatunnelUrl, job) {
  const response = await fetch(`${seatunnelUrl}/hazelcast/rest/maps/submit-job`, {
    method: 'POST', body: JSON.stringify(job), headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { /* handled below */ }
  if (response.status !== 200 || !parsed.jobId) fail(`SEATUNNEL_SUBMIT_FAILED:${String(parsed.message ?? text).slice(0, 160)}`);
  return String(parsed.jobId);
}

export async function waitForJob(seatunnelUrl, jobId, { timeoutMs, signal, onStop }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await onStop?.(jobId);
      fail('WORKER_EXECUTION_ABORTED');
    }
    const response = await fetch(`${seatunnelUrl}/hazelcast/rest/maps/job-info/${jobId}`, { signal: AbortSignal.timeout(30000) });
    if (response.ok) {
      last = await response.json();
      const status = String(last.jobStatus ?? '');
      if (TERMINAL.has(status)) return { status, info: last };
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  await onStop?.(jobId);
  fail('SEATUNNEL_JOB_TIMEOUT');
}

export async function stopJob(seatunnelUrl, jobId) {
  try {
    await fetch(`${seatunnelUrl}/hazelcast/rest/maps/stop-job`, {
      method: 'POST', body: JSON.stringify({ jobId }), headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch { /* cancellation is best effort; the job is bounded by the platform limits */ }
}

export function parseArgs(argv) {
  const options = { mode: 'extract' };
  const takesValue = new Set(['--lake-root', '--source-code', '--batch-id', '--config', '--window', '--preview-out']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--preview') { options.mode = 'preview'; continue; }
    if (!takesValue.has(arg)) fail('INVALID_ARGUMENT');
    const value = argv[++i];
    if (value === undefined) fail('INVALID_ARGUMENT');
    if (arg === '--lake-root') options.lakeRoot = path.resolve(value);
    if (arg === '--source-code') options.sourceCode = value;
    if (arg === '--batch-id') options.batchId = value;
    if (arg === '--config') options.configFile = path.resolve(value);
    if (arg === '--window') options.window = value;
    if (arg === '--preview-out') options.previewOut = path.resolve(value);
  }
  for (const key of ['lakeRoot', 'sourceCode', 'batchId', 'configFile']) if (!options[key]) fail('MISSING_ARGUMENT');
  return options;
}

async function reportJob(config, jobId, state, errorCode, attemptId, sqlVersionId) {
  const base = process.env.CONTROL_API_URL ?? 'http://127.0.0.1:8080';
  const token = process.env.CONTROL_API_WORKER_TOKEN;
  if (!token) return;
  try {
    await postJson(base, '/api/v1/lake/seatunnel-jobs', {
      sourceId: config.sourceId, jobId, jobMode: config.extractionMode ?? 'FULL', state,
      errorCode: errorCode ?? null, executionAttemptId: attemptId ?? null, sqlVersionId: sqlVersionId ?? null,
    }, token);
  } catch { /* the run-centre mapping is informative, never a reason to fail the batch */ }
}

async function stagedPreviewDir(options, tag) {
  // A unique directory per attempt: a leftover from an older run (possibly written by a
  // different uid) must never block a new preview.
  const directory = path.join(options.lakeRoot, 'seatunnel-preview', `${options.batchId}-${tag}-${Date.now().toString(36)}`);
  const sinkPath = path.join(directory, 'rows');
  await rm(directory, { recursive: true, force: true }).catch(() => {});
  await mkdir(sinkPath, { recursive: true, mode: 0o777 });
  await chmod(sinkPath, 0o777);   // the engine may run as another user; deletion needs a writable directory
  return { directory, sinkPath };
}

async function runPreviewJob(options, config, query, sinkPath) {
  const job = buildJob({ config, query, sinkPath, format: 'csv' });
  const jobId = await submitJob(config.seatunnelUrl, job);
  await reportJob(config, jobId, 'RUNNING', null, config.executionAttemptId, config.sqlVersionId);
  const outcome = await waitForJob(config.seatunnelUrl, jobId, {
    timeoutMs: Number(config.statementTimeoutMs ?? 3600000), onStop: id => stopJob(config.seatunnelUrl, id),
  });
  if (outcome.status !== 'FINISHED') {
    await reportJob(config, jobId, outcome.status, 'SEATUNNEL_JOB_FAILED', config.executionAttemptId, config.sqlVersionId);
    fail('SEATUNNEL_JOB_FAILED');
  }
  await reportJob(config, jobId, 'FINISHED', null, config.executionAttemptId, config.sqlVersionId);
  const parts = await listFiles(sinkPath);
  if (parts.length === 0) fail('SEATUNNEL_OUTPUT_EMPTY');
  return (await Promise.all(parts.map(part => readFile(part, 'utf8')))).join('');
}

/**
 * Two jobs, for a reason: the column names are only knowable from the source, and the preview
 * must show exactly what the extraction will store. The probe reads one bounded result to learn
 * the columns; the second job runs the very same CAST-wrapped query the extraction uses, so
 * decimals keep every digit and timestamps are the source-local wall clock.
 */
async function runPreview(options, config) {
  const limit = Number(config.previewLimit ?? 1000);
  const started = Date.now();
  // Column names and types come from the source metadata; the rows come from the same
  // CAST-wrapped query the extraction runs, so the preview shows what will be stored.
  const columns = await probeColumns(config, config.sqlText);
  const names = columns.map(column => column.name);
  const cast = await stagedPreviewDir(options, 'cast');
  let castCsv;
  try {
    // buildExtractionQuery takes the column objects (it quotes each .name).
    castCsv = await runPreviewJob(options, config, buildExtractionQuery(config.sqlText, columns, config.datasourceType), cast.sinkPath);
  } finally { await rm(cast.directory, { recursive: true, force: true }).catch(() => {}); }
  const rows = parseCsv(castCsv).filter(row => row.length === names.length)
    .map(row => row.map(cell => (cell === '' ? null : cell)));
  const typed = names.map((name, index) => {
    const sample = rows.find(row => row[index] !== null)?.[index];
    return { name, type: inferType(sample), inferred: true };
  });
  const bounded = rows.slice(0, limit);
  const payload = {
    state: 'COMPLETE', columns: typed, rows: bounded, rowCount: bounded.length,
    truncated: rows.length >= limit, elapsedMs: Date.now() - started,
  };
  if (options.previewOut) await writeFile(options.previewOut, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  return payload;
}

async function runExtraction(options, config) {
  const objectName = config.objectName ?? options.sourceCode;
  const rawDir = path.join(options.lakeRoot, 'raw', options.sourceCode, options.batchId);
  const objectDir = path.join(rawDir, objectName);
  const sinkPath = path.join(objectDir, 'seatunnel');
  await mkdir(sinkPath, { recursive: true, mode: 0o777 });
  await chmod(sinkPath, 0o777);
  const batchRoot = path.join(options.lakeRoot, 'batches', options.batchId);
  await mkdir(batchRoot, { recursive: true, mode: 0o700 });
  const manifest = {
    version: 1, batchId: options.batchId, sourceCode: options.sourceCode,
    sourceDatabase: config.datasource?.database ?? null, mode: 'DAILY', window: options.window ?? null,
    state: 'RUNNING', startedAt: new Date().toISOString(), consistency: 'SINGLE_STATEMENT_READ',
    // The plan binds a synthetic single-object inventory, so the batch records that same plan
    // version and identifies the SQL definition by its hash below.
    inventoryVersion: config.inventoryVersion ?? null, sqlVersionId: config.sqlVersionId ?? null,
    scalarEncoding: 'mysql-char-v2', sourceTimeZone: '+00:00',
    expectedTableCount: 1, extractor: 'SEATUNNEL', sqlSha256: config.sqlSha256 ?? null,
    tables: [{ table: objectName, state: 'PENDING', rowCount: 0, bytes: 0 }],
  };
  await writeFile(path.join(batchRoot, 'batch.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const job = buildJob({
    config,
    query: buildExtractionQuery(config.sqlText, config.resultColumns, config.datasourceType),
    sinkPath, format: 'json',
  });
  const started = Date.now();
  const jobId = await submitJob(config.seatunnelUrl, job);
  await reportJob(config, jobId, 'RUNNING', null, config.executionAttemptId, config.sqlVersionId);
  const outcome = await waitForJob(config.seatunnelUrl, jobId, {
    timeoutMs: Number(config.statementTimeoutMs ?? 3600000), onStop: id => stopJob(config.seatunnelUrl, id),
  });
  if (outcome.status !== 'FINISHED') {
    manifest.state = 'FAILED';
    manifest.errorCode = 'SEATUNNEL_JOB_FAILED';
    manifest.finishedAt = new Date().toISOString();
    await writeFile(path.join(batchRoot, 'batch.failed.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await reportJob(config, jobId, outcome.status, 'SEATUNNEL_JOB_FAILED', config.executionAttemptId, config.sqlVersionId);
    fail('SEATUNNEL_JOB_FAILED');
  }
  await reportJob(config, jobId, 'FINISHED', null, config.executionAttemptId, config.sqlVersionId);
  const integrity = await collectJsonl(sinkPath, objectDir);
  await rm(sinkPath, { recursive: true, force: true });
  await writeFile(path.join(objectDir, 'schema.json'), `${JSON.stringify({
    table: objectName, columns: config.resultColumns, primaryKey: config.uniqueKey ?? [],
    scalarEncoding: 'mysql-char-v2', sourceTimeZone: '+00:00', typeSource: 'INFERRED',
  }, null, 2)}\n`, { mode: 0o600 });
  manifest.state = 'COMPLETE';
  manifest.finishedAt = new Date().toISOString();
  manifest.tables = [{ table: objectName, state: 'RAW_COMMITTED', rowCount: integrity.rows, bytes: integrity.bytes, sha256: integrity.sha256 }];
  await writeFile(path.join(batchRoot, 'batch.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { state: 'COMPLETE', batchId: options.batchId, elapsedMs: Date.now() - started, jobId, tables: manifest.tables };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(options.configFile, 'utf8'));
  if (!config.seatunnelUrl || !/^http:\/\/[A-Za-z0-9_.:-]{3,200}$/u.test(config.seatunnelUrl)) fail('INVALID_SEATUNNEL_URL');
  if (options.mode === 'preview') {
    process.stdout.write(`${JSON.stringify(await runPreview(options, config))}\n`);
    return;
  }
  const result = await runExtraction(options, config);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  let mode = 'extract';
  try {
    mode = process.argv.includes('--preview') ? 'preview' : 'extract';
    await main();
  } catch (error) {
    const code = /^[A-Z0-9_:-]{1,120}$/u.test(error.code ?? '') ? error.code : 'SEATUNNEL_EXTRACT_FAILED';
    // Preview failures are reported on stderr; extraction failures keep the batch id on
    // stdout so the worker's child() contract can return the real code with the batch.
    const detail = String(error.message ?? '').replace(/\s+/gu, ' ').slice(0, 200);
    const failure = mode === 'preview'
      ? { errorCode: code, errorDetail: detail }
      : { state: 'FAILED', batchId: batchFromArgs(), errorCode: code, errorDetail: detail };
    const stream = mode === 'preview' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
}

function batchFromArgs() {
  const index = process.argv.indexOf('--batch-id');
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

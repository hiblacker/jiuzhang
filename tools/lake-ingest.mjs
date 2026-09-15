import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOptions } from './mysql-discover.mjs';
import { atomicJson, currentDay, digest, durableRename, hashFile, readJson as readMetadata, validateDay, withLock } from './lake-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(ROOT, 'secrets/mysql-development.local.json');
const DEFAULT_INVENTORY = path.join(ROOT, 'work/lake-foundation/initial-full-snapshot-plan.json');
const DEFAULT_LAKE_ROOT = path.join(ROOT, '.lake-data');
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const WINDOW = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  throw new Error(message);
}

function identifier(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.includes('\0')) {
    fail(`INVALID_${label.toUpperCase()}`);
  }
  return `\`${value.replaceAll('`', '``')}\``;
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    fail(`INVALID_${label.toUpperCase()}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    mode: 'full',
    config: DEFAULT_CONFIG,
    inventory: DEFAULT_INVENTORY,
    lakeRoot: DEFAULT_LAKE_ROOT,
    queryTimeoutSeconds: 300,
    allowUnverifiedTestTls: false,
    dryRun: false,
    sourceCode: 'mysql-test-source',
  };
  const takesValue = new Set(['--config', '--inventory', '--lake-root', '--batch-id', '--window', '--mysql-cli', '--query-timeout-seconds', '--source-code']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--daily') options.mode = 'daily';
    else if (arg === '--full') options.mode = 'full';
    else if (arg === '--allow-unverified-test-tls') options.allowUnverifiedTestTls = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (takesValue.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT_VALUE');
      if (arg === '--config') options.config = path.resolve(ROOT, value);
      if (arg === '--inventory') options.inventory = path.resolve(ROOT, value);
      if (arg === '--lake-root') options.lakeRoot = path.resolve(ROOT, value);
      if (arg === '--batch-id') options.batchId = value;
      if (arg === '--window') options.window = value;
      if (arg === '--mysql-cli') options.mysqlCli = value;
      if (arg === '--query-timeout-seconds') options.queryTimeoutSeconds = Number(value);
      if (arg === '--source-code') options.sourceCode = value;
    } else fail('INVALID_ARGUMENT');
  }
  if (options.window) validateDay(options.window);
  if (options.batchId && !BATCH_ID.test(options.batchId)) fail('INVALID_BATCH_ID');
  if (!Number.isInteger(options.queryTimeoutSeconds) || options.queryTimeoutSeconds < 1 || options.queryTimeoutSeconds > 900) fail('INVALID_QUERY_TIMEOUT');
  if (!BATCH_ID.test(options.sourceCode)) fail('INVALID_SOURCE_CODE');
  return options;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    fail('LOCAL_JSON_READ_FAILED');
  }
}

async function validateAuthorization(configFile, config, allowUnverifiedTestTls) {
  if (!config || config.engine?.toLowerCase() !== 'mysql' || !config.database || config.tls?.require_encryption !== true) {
    fail('UNSAFE_SOURCE_CONFIG');
  }
  if (!config.tls?.verify_server_certificate) {
    fail('SOURCE_CONFIG_MUST_DEFAULT_TO_STRICT_TLS');
  }
  if (!allowUnverifiedTestTls) return;
  const authFile = path.join(ROOT, 'secrets/mysql-development-tls-authorization.local.json');
  const auth = await readJson(authFile);
  const hash = createHash('sha256').update(await readFile(configFile)).digest('hex');
  if (auth.source_config_sha256 !== hash || auth.tls_mode !== 'REQUIRED' || auth.production_allowed !== false || auth.source_writes_allowed !== false) {
    fail('TEST_TLS_AUTHORIZATION_MISMATCH');
  }
  if (!auth.scope?.includes('ingestion')) fail('TEST_TLS_AUTHORIZATION_SCOPE_MISSING');
}

function columnExpression(column) {
  const name = identifier(column.column, 'column');
  const binary = /^(binary|varbinary|tinyblob|blob|mediumblob|longblob)$/iu.test(String(column.data_type));
  const value = binary ? `HEX(${name})` : `CAST(${name} AS CHAR)`;
  return `IF(${name} IS NULL,NULL,${value})`;
}

function buildSnapshotSql(config, inventory, timeoutSeconds) {
  const schema = identifier(config.database, 'database');
  const lines = [
    'SET SESSION transaction_read_only = ON;',
    "SET SESSION time_zone = '+00:00';",
    `SET SESSION max_execution_time = ${timeoutSeconds * 1000};`,
    'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;',
    'START TRANSACTION WITH CONSISTENT SNAPSHOT;',
    "SELECT '##JIUZHANG_SNAPSHOT_BEGIN##';",
  ];
  inventory.tables.forEach((table, index) => {
    if (typeof table.table !== 'string' || table.table.includes('/') || table.table.includes('\\') || table.table === '.' || table.table === '..') fail('INVALID_TABLE_PATH');
    const tableName = identifier(table.table, 'table');
    const expressions = table.columns.map(columnExpression);
    if (expressions.length === 0) fail('TABLE_WITHOUT_COLUMNS');
    const order = table.primary_key?.length
      ? ` ORDER BY ${table.primary_key.map((column) => identifier(column, 'primary-key-column')).join(', ')}`
      : '';
    lines.push(`SELECT '##JIUZHANG_TABLE_${String(index).padStart(6, '0')}##';`);
    lines.push(`SELECT JSON_ARRAY(${expressions.join(',')}) FROM ${schema}.${tableName}${order};`);
  });
  lines.push("SELECT '##JIUZHANG_SNAPSHOT_END##';", 'ROLLBACK;');
  return `${lines.join('\n')}\n`;
}

function selectMysqlCli(explicit) {
  if (explicit) return explicit;
  return process.env.MYSQL_CLI || (process.platform === 'darwin' ? '/opt/homebrew/opt/mysql-client/bin/mysql' : 'mysql');
}

async function writeOptions(config, allowUnverifiedTestTls) {
  const directory = await (await import('node:fs/promises')).mkdtemp(path.join(ROOT, 'secrets/mysql-lake-'));
  await chmod(directory, 0o700);
  const options = makeOptions(config, config.tls.ca_cert_file ? path.resolve(ROOT, config.tls.ca_cert_file) : '/etc/ssl/cert.pem', allowUnverifiedTestTls);
  const file = path.join(directory, 'client.cnf');
  await writeFile(file, options, { mode: 0o600, flag: 'wx' });
  return { directory, file };
}

function spawnMysql(cli, optionsFile, sql) {
  const child = spawn(cli, [
    `--defaults-extra-file=${optionsFile}`,
    '--quick', '--batch', '--raw', '--skip-column-names', '--binary-mode', '--skip-reconnect',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(sql);
  return child;
}

class TableWriter {
  constructor(file, schema) {
    this.file = file;
    this.partial = `${file}.part`;
    this.schema = schema;
    this.stream = createWriteStream(this.partial, { flags: 'wx', mode: 0o600 });
    this.completion = finished(this.stream);
    this.completion.catch(() => {});
    this.hash = createHash('sha256');
    this.rows = 0;
    this.bytes = 0;
  }

  async write(line) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { fail('SOURCE_ROW_IS_NOT_JSON'); }
    if (!Array.isArray(parsed) || parsed.length !== this.schema.length) fail('SOURCE_ROW_SHAPE_MISMATCH');
    const bytes = Buffer.from(`${line}\n`, 'utf8');
    this.hash.update(bytes);
    this.bytes += bytes.length;
    this.rows += 1;
    if (!this.stream.write(bytes)) await Promise.race([once(this.stream, 'drain'), this.completion]);
  }

  async finish() {
    this.stream.end();
    await this.completion;
    await durableRename(this.partial, this.file);
    return { rowCount: this.rows, bytes: this.bytes, sha256: this.hash.digest('hex') };
  }

  async abort() {
    this.stream.destroy();
    try { await this.completion; } catch { /* expected after abort */ }
  }
}

async function readStderr(stream) {
  let bytes = 0;
  stream.on('data', (chunk) => { bytes += chunk.length; });
  await once(stream, 'end').catch(() => {});
  return bytes;
}

async function runSnapshot(options, config, inventory, batchId) {
  const batchRoot = path.join(options.lakeRoot, 'batches', batchId);
  const rawRoot = path.join(options.lakeRoot, 'raw', options.sourceCode, batchId);
  const sql = buildSnapshotSql(config, inventory, options.queryTimeoutSeconds);
  const sqlHash = createHash('sha256').update(sql).digest('hex');
  const manifest = {
    version: 1,
    batchId,
    sourceCode: options.sourceCode,
    sourceDatabase: config.database,
    mode: options.mode,
    window: options.window ?? null,
    state: 'RUNNING',
    startedAt: new Date().toISOString(),
    consistency: 'ONE_REPEATABLE_READ_TRANSACTION',
    inventoryObservedAt: inventory.inventory_observed_at,
    inventoryVersion: inventory.plan_version,
    inventorySha256: digest(JSON.stringify(inventory)),
    scalarEncoding: 'mysql-char-v2',
    sourceTimeZone: '+00:00',
    expectedTableCount: inventory.tables.length,
    sqlSha256: sqlHash,
    tables: inventory.tables.map((table) => ({ table: table.table, state: 'PENDING', rowCount: 0, bytes: 0 })),
  };
  if (options.dryRun) {
    manifest.state = 'DRY_RUN';
    return { ...manifest, sqlLength: sql.length };
  }
  await mkdir(path.dirname(batchRoot), { recursive: true, mode: 0o700 });
  await mkdir(batchRoot, { mode: 0o700 });
  await mkdir(rawRoot, { recursive: true, mode: 0o700 });
  await atomicJson(path.join(batchRoot, 'batch.json.part'), manifest);
  const tmp = await writeOptions(config, options.allowUnverifiedTestTls);
  let writer = null;
  let activeIndex = -1;
  let stderrBytes = 0;
  let child;
  let ended = false;
  try {
    child = spawnMysql(selectMysqlCli(options.mysqlCli), tmp.file, sql);
    const closePromise = once(child, 'close');
    closePromise.catch(() => {});
    const stderrPromise = readStderr(child.stderr).then((bytes) => { stderrBytes = bytes; });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      if (line === '##JIUZHANG_SNAPSHOT_BEGIN##') continue;
      if (line === '##JIUZHANG_SNAPSHOT_END##') { ended = true; continue; }
      const marker = line.match(/^##JIUZHANG_TABLE_(\d{6})##$/u);
      if (marker) {
        if (writer) {
          const result = await writer.finish();
          Object.assign(manifest.tables[activeIndex], result, { state: 'RAW_COMMITTED' });
          writer = null;
          await writeFile(path.join(batchRoot, 'batch.json.part'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
        }
        if (Number(marker[1]) !== activeIndex + 1) fail('SOURCE_TABLE_MARKER_OUT_OF_ORDER');
        activeIndex = Number(marker[1]);
        const table = inventory.tables[activeIndex];
        if (!table) fail('SOURCE_TABLE_MARKER_OUT_OF_RANGE');
        const tableRoot = path.join(rawRoot, table.table);
        await mkdir(tableRoot, { recursive: true, mode: 0o700 });
        await writeFile(path.join(tableRoot, 'schema.json'), `${JSON.stringify({ table: table.table, columns: table.columns, primaryKey: table.primary_key ?? [], scalarEncoding: 'mysql-char-v2', sourceTimeZone: '+00:00' }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        writer = new TableWriter(path.join(tableRoot, 'data.jsonl'), table.columns);
        manifest.tables[activeIndex].state = 'READING';
        continue;
      }
      if (!writer || activeIndex < 0) fail('SOURCE_ROW_OUTSIDE_TABLE');
      await writer.write(line);
    }
    const [closeEvent] = await Promise.all([closePromise, stderrPromise]);
    const [exitCode] = closeEvent;
    if (exitCode !== 0) fail(`MYSQL_EXIT_${exitCode ?? 'UNKNOWN'}`);
    if (!ended) fail('SOURCE_SNAPSHOT_NOT_CLOSED');
    if (writer) {
      const result = await writer.finish();
      Object.assign(manifest.tables[activeIndex], result, { state: 'RAW_COMMITTED' });
      writer = null;
      await writeFile(path.join(batchRoot, 'batch.json.part'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    if (exitCode !== 0) fail(`MYSQL_EXIT_${exitCode ?? 'UNKNOWN'}`);
    if (manifest.tables.some((table) => table.state !== 'RAW_COMMITTED')) fail('REQUIRED_TABLE_NOT_COMMITTED');
    manifest.state = 'COMPLETE';
    manifest.finishedAt = new Date().toISOString();
    manifest.stderrBytes = stderrBytes;
    await writeFile(path.join(batchRoot, 'batch.json.part'), `${JSON.stringify(manifest, null, 2)}\n`);
    await durableRename(path.join(batchRoot, 'batch.json.part'), path.join(batchRoot, 'batch.json'));
    return manifest;
  } catch (error) {
    if (writer) await writer.abort();
    manifest.state = 'FAILED';
    manifest.failedAt = new Date().toISOString();
    manifest.errorCode = String(error?.message ?? 'INGESTION_FAILED').replace(/[^A-Z0-9_:-]/gu, '_').slice(0, 120);
    manifest.stderrBytes = stderrBytes;
    await writeFile(path.join(batchRoot, 'batch.failed.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await rm(tmp.directory, { recursive: true, force: true });
  }
}

export async function verifySnapshot(options, manifest) {
  if (manifest.state !== 'COMPLETE' || !Array.isArray(manifest.tables)) fail('SNAPSHOT_NOT_COMPLETE');
  for (const table of manifest.tables) {
    if (table.state !== 'RAW_COMMITTED' || table.table.includes('/') || table.table.includes('\\') || ['.', '..'].includes(table.table)) fail('INVALID_TABLE_PATH');
    const actual = await hashFile(path.join(options.lakeRoot, 'raw', manifest.sourceCode, manifest.batchId, table.table, 'data.jsonl'));
    if (actual.sha256 !== table.sha256 || actual.bytes !== table.bytes || actual.rows !== table.rowCount) fail('RAW_INTEGRITY_MISMATCH');
  }
  return manifest;
}

export async function run(options = parseArgs([])) {
  const config = await readJson(options.config);
  await validateAuthorization(options.config, config, options.allowUnverifiedTestTls);
  const inventory = await readJson(options.inventory);
  if (!Array.isArray(inventory.tables) || inventory.tables.length === 0) fail('EMPTY_INVENTORY');
  for (const table of inventory.tables) {
    if (!table?.table || !Array.isArray(table.columns) || table.columns.length === 0
      || table.table.includes('/') || table.table.includes('\\') || ['.', '..'].includes(table.table)
      || table.columns.some((column) => !column?.column || typeof column.column !== 'string')) fail('INVALID_INVENTORY');
    if (table.engine && table.engine.toLowerCase() !== 'innodb') fail('SHARED_SNAPSHOT_ENGINE_UNSUPPORTED');
  }
  if (options.mode === 'daily') options.window = validateDay(options.window ?? currentDay());
  const batchId = options.batchId ?? `${options.mode}-${new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  if (!BATCH_ID.test(batchId)) fail('INVALID_BATCH_ID');
  if (options.dryRun) return runSnapshot(options, config, inventory, batchId);
  return withLock(path.join(options.lakeRoot, 'mysql-ingest.lock'), async () => {
    const ledgerPath = path.join(options.lakeRoot, 'daily-ledger.json');
    const ledger = await readMetadata(ledgerPath, { version: 2, windows: {} });
    const planHash = digest(JSON.stringify(inventory));
    const key = `${options.sourceCode}|${inventory.plan_version}|${planHash}|${options.window}`;
    if (options.mode === 'daily') {
      // Verify legacy entries against their actual manifest before adopting them.
      const existing = ledger.windows[key] ?? ledger.windows[options.window];
      if (existing?.state === 'COMPLETE') {
        const previous = await readMetadata(path.join(options.lakeRoot, 'batches', existing.batchId, 'batch.json'));
        if (previous.sourceCode === options.sourceCode && previous.inventoryVersion === inventory.plan_version
            && previous.window === options.window && previous.state === 'COMPLETE'
            && (previous.inventorySha256 === planHash || (!previous.inventorySha256
                && previous.inventoryObservedAt === inventory.inventory_observed_at
                && JSON.stringify(previous.tables.map(t => t.table)) === JSON.stringify(inventory.tables.map(t => t.table))))) {
          await verifySnapshot(options, previous);
          return { ...previous, reused: true };
        }
      }
      // A current-state source cannot recreate a missed historical snapshot.
      if (options.window !== currentDay()) fail('HISTORICAL_SNAPSHOT_UNAVAILABLE');
    }
    const result = await runSnapshot(options, config, inventory, batchId);
    if (options.mode === 'daily' && result.state === 'COMPLETE') {
      ledger.version = 2;
      ledger.windows[key] = { batchId, state: result.state, finishedAt: result.finishedAt, tableCount: result.tables.length };
      await atomicJson(ledgerPath, ledger);
    }
    return result;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await run(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      batchId: result.batchId,
      mode: result.mode,
      window: result.window,
      state: result.state,
      expectedTableCount: result.expectedTableCount,
      committedTableCount: result.tables?.filter((table) => table.state === 'RAW_COMMITTED').length ?? 0,
      rowCount: result.tables?.reduce((sum, table) => sum + (table.rowCount ?? 0), 0) ?? null,
      lakeRoot: result.state === 'DRY_RUN' ? undefined : 'configured-local-lake-root',
      reused: result.reused ?? false,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAILED', errorCode: String(error?.message ?? 'INGESTION_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120) }));
    process.exitCode = 1;
  }
}

export { buildSnapshotSql, columnExpression, identifier, parseArgs, runSnapshot, validateAuthorization, writeOptions, selectMysqlCli };

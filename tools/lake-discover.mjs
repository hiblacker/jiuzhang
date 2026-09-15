import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, digest } from './lake-runtime.mjs';
import { validateAuthorization, writeOptions, selectMysqlCli } from './lake-ingest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = code => { throw new Error(code); };

export function schemaShape(plan) {
  return plan.tables.map(table => ({ table: table.table, engine: table.engine,
    primaryKey: table.primary_key ?? [], columns: table.columns.map(column => ({
      name: column.column, type: column.type, dataType: column.data_type,
      nullable: column.nullable, key: column.key, extra: column.extra, position: column.position,
    })).sort((a, b) => a.position - b.position),
  })).sort((a, b) => a.table.localeCompare(b.table, 'en'));
}

export function compareSchemas(before, after) {
  const old = new Map(schemaShape(before).map(table => [table.table, table]));
  const current = new Map(schemaShape(after).map(table => [table.table, table]));
  return { added: [...current.keys()].filter(name => !old.has(name)),
    removed: [...old.keys()].filter(name => !current.has(name)),
    changed: [...current.keys()].filter(name => old.has(name) && digest(JSON.stringify(old.get(name))) !== digest(JSON.stringify(current.get(name)))),
  };
}

function discoverySql(database) {
  const scope = `CONVERT(0x${Buffer.from(database, 'utf8').toString('hex')} USING utf8mb4)`;
  return `SET SESSION transaction_read_only=ON; SET SESSION max_execution_time=15000;
SELECT JSON_OBJECT('kind','TABLE','table',TABLE_NAME,'table_type',TABLE_TYPE,'engine',ENGINE,'estimated_rows',TABLE_ROWS,'data_bytes',DATA_LENGTH) FROM information_schema.TABLES WHERE TABLE_SCHEMA=${scope} ORDER BY TABLE_NAME;
SELECT JSON_OBJECT('kind','COLUMN','table',TABLE_NAME,'column',COLUMN_NAME,'position',ORDINAL_POSITION,'type',COLUMN_TYPE,'data_type',DATA_TYPE,'nullable',IS_NULLABLE,'key',COLUMN_KEY,'extra',EXTRA) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${scope} ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT JSON_OBJECT('kind','KEY','table',TABLE_NAME,'column',COLUMN_NAME,'position',ORDINAL_POSITION) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=${scope} AND CONSTRAINT_NAME='PRIMARY' ORDER BY TABLE_NAME,ORDINAL_POSITION;
`;
}

export async function discover(profile, planVersion = 1) {
  const config = JSON.parse(await readFile(profile.config, 'utf8'));
  await validateAuthorization(profile.config, config, profile.allowUnverifiedTestTls === true);
  const options = await writeOptions(config, profile.allowUnverifiedTestTls === true);
  let child, output = '', timedOut = false, oversized = false;
  try {
    child = spawn(selectMysqlCli(profile.mysqlCli), [`--defaults-extra-file=${options.file}`, '--quick', '--batch', '--raw', '--skip-column-names', '--skip-reconnect'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(child, 'close'); closed.catch(() => {});
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', bytes => {
      if (Buffer.byteLength(output) + Buffer.byteLength(bytes) > 20 * 1024 * 1024) { oversized = true; child.kill('SIGTERM'); }
      else output += bytes;
    });
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60000);
    child.stdin.end(discoverySql(config.database));
    let code; try { [code] = await closed; } finally { clearTimeout(timeout); }
    if (timedOut) fail('DISCOVERY_TIMEOUT');
    if (oversized) fail('DISCOVERY_METADATA_LIMIT');
    if (code !== 0) fail('DISCOVERY_CONNECTION_FAILED');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await rm(options.directory, { recursive: true, force: true });
  }
  let records; try { records = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { fail('DISCOVERY_PROTOCOL_FAILED'); }
  const allTables = records.filter(row => row.kind === 'TABLE');
  const tables = allTables.filter(table => table.table_type === 'BASE TABLE').map(table => {
    const columns = records.filter(row => row.kind === 'COLUMN' && row.table === table.table);
    const keys = records.filter(row => row.kind === 'KEY' && row.table === table.table).sort((a, b) => a.position - b.position);
    if (!columns.length) fail('DISCOVERY_INCOMPLETE_SCHEMA');
    return { table: table.table, engine: table.engine, required: true, strategy: 'FULL_SNAPSHOT',
      columns, primary_key: keys.map(key => key.column), column_count: columns.length,
      schema_fingerprint: digest(JSON.stringify(columns)), estimated_rows: table.estimated_rows,
      estimated_data_bytes: table.data_bytes, incremental_approved: false, schema_change_policy: 'REVIEW_REQUIRED' };
  });
  if (!tables.length) fail('DISCOVERY_NO_BASE_TABLES');
  return { plan_version: planVersion, inventory_observed_at: new Date().toISOString(),
    source_scope: { database: config.database }, required_table_count: tables.length, tables,
    unsupported_objects: allTables.filter(table => table.table_type !== 'BASE TABLE').map(table => ({ name: table.table, type: table.table_type, state: 'UNSUPPORTED' })) };
}

export async function verifyCurrentSchema(profile, lakeRoot) {
  const approved = JSON.parse(await readFile(profile.inventory, 'utf8'));
  const current = await discover(profile, approved.plan_version + 1);
  const changes = compareSchemas(approved, current);
  if (Object.values(changes).some(items => items.length)) {
    const directory = path.join(lakeRoot, 'discoveries', profile.sourceCode); await mkdir(directory, { recursive: true, mode: 0o700 });
    const id = digest(JSON.stringify(schemaShape(current)));
    await atomicJson(path.join(directory, `${id}.json`), { state: 'REVIEW_REQUIRED', proposedInventory: current, changes });
    fail('SCHEMA_CHANGE_REVIEW_REQUIRED');
  }
  return { tableCount: current.tables.length, unsupportedObjectCount: current.unsupported_objects.length, schemaSha256: digest(JSON.stringify(schemaShape(current))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), input = args.indexOf('--profile'), output = args.indexOf('--output');
    if (input < 0 || output < 0 || args.length !== 4) fail('USAGE_PROFILE_AND_OUTPUT_REQUIRED');
    const profile = JSON.parse(await readFile(path.resolve(args[input + 1]), 'utf8'));
    const inventory = await discover(profile);
    const target = path.resolve(args[output + 1]); await mkdir(path.dirname(target), { recursive: true }); await atomicJson(target, inventory);
    console.log(JSON.stringify({ state: 'COMPLETE', tableCount: inventory.tables.length, unsupportedCount: inventory.unsupported_objects.length }));
  } catch (error) { console.error(JSON.stringify({ state: 'FAILED', errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'DISCOVERY_FAILED' })); process.exitCode = 1; }
}

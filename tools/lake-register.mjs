import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayBounds, hashFile, resolveInside } from './lake-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;

function fail(code) { throw new Error(code); }

function parseArgs(argv) {
  const options = { controlApi: 'http://127.0.0.1:8080', inventory: path.join(ROOT, 'work/lake-foundation/initial-full-snapshot-plan.json'), manifest: null, lakeRoot: path.join(ROOT, '.lake-data'), sourceCode: 'mysql-test-source', adminTokenEnv: 'CONTROL_API_ADMIN_TOKEN', workerTokenEnv: 'CONTROL_API_WORKER_TOKEN', dryRun: false };
  const takes = new Set(['--control-api', '--inventory', '--manifest', '--lake-root', '--source-code', '--admin-token-env', '--worker-token-env']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (takes.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT_VALUE');
      if (arg === '--control-api') options.controlApi = value.replace(/\/+$/u, '');
      if (arg === '--inventory') options.inventory = path.resolve(ROOT, value);
      if (arg === '--manifest') options.manifest = path.resolve(ROOT, value);
      if (arg === '--lake-root') options.lakeRoot = path.resolve(ROOT, value);
      if (arg === '--source-code') options.sourceCode = value;
      if (arg === '--admin-token-env') options.adminTokenEnv = value;
      if (arg === '--worker-token-env') options.workerTokenEnv = value;
    } else fail('INVALID_ARGUMENT');
  }
  if (!options.manifest) fail('MANIFEST_REQUIRED');
  if (!SAFE.test(options.sourceCode)) fail('INVALID_SOURCE_CODE');
  if (!ENV_NAME.test(options.adminTokenEnv) || !ENV_NAME.test(options.workerTokenEnv)) fail('INVALID_TOKEN_ENV');
  let base;
  try { base = new URL(options.controlApi); } catch { fail('CONTROL_API_URL_INVALID'); }
  if (base.username || base.password || base.search || base.hash) fail('CONTROL_API_URL_INVALID');
  if (base.protocol !== 'http:' && base.protocol !== 'https:') fail('CONTROL_API_URL_INVALID');
  if (base.protocol === 'http:' && !new Set(['localhost', '127.0.0.1', '[::1]']).has(base.hostname.toLowerCase())) fail('CONTROL_API_TLS_REQUIRED');
  options.controlApi = base.toString().replace(/\/+$/u, '');
  return options;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { fail('LOCAL_JSON_READ_FAILED'); }
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceSchemaHash(plan) {
  const value = plan.tables.map((table) => ({ table: table.table, schemaFingerprint: table.schema_fingerprint, columns: table.columns, primaryKey: table.primary_key ?? [] }));
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildInventoryRequest(plan, sourceCode) {
  if (!plan || !Array.isArray(plan.tables) || plan.tables.length === 0) fail('INVALID_INVENTORY');
  const objects = plan.tables.map((table) => ({
    objectName: table.table,
    objectType: 'TABLE',
    schema: { table: table.table, engine: table.engine, columns: table.columns, schemaFingerprint: table.schema_fingerprint },
    primaryKey: table.primary_key ?? [],
    required: table.required !== false,
    strategy: table.strategy ?? 'FULL_SNAPSHOT',
    state: 'READY',
  }));
  return { sourceCode, planVersion: plan.plan_version, observedAt: plan.inventory_observed_at, sourceScope: plan.source_scope ?? {}, schemaSha256: sourceSchemaHash(plan), objects };
}

async function buildManifestRequest(manifestFile, manifest, options) {
  if (!SAFE.test(manifest.batchId ?? '') || manifest.sourceCode !== options.sourceCode || !Array.isArray(manifest.tables)
      || (manifest.inventoryVersion && manifest.inventoryVersion !== options.planVersion)) fail('INVALID_BATCH_MANIFEST');
  const objects = [];
  for (const table of manifest.tables) {
    if (typeof table.table !== 'string' || !table.table || /[\\/]/u.test(table.table) || ['.', '..'].includes(table.table)) fail('INVALID_OBJECT_NAME');
    const rawFile = path.join(options.lakeRoot, 'raw', options.sourceCode, manifest.batchId, table.table, 'data.jsonl');
    const schemaFile = path.join(options.lakeRoot, 'raw', options.sourceCode, manifest.batchId, table.table, 'schema.json');
    if (table.state === 'RAW_COMMITTED') {
      await resolveInside(options.lakeRoot, path.relative(options.lakeRoot, rawFile));
      await resolveInside(options.lakeRoot, path.relative(options.lakeRoot, schemaFile));
      const actual = await hashFile(rawFile);
      if (actual.sha256 !== table.sha256 || actual.bytes !== table.bytes || actual.rows !== table.rowCount) fail('RAW_INTEGRITY_MISMATCH');
    }
    const rawPath = path.relative(options.lakeRoot, rawFile);
    if (rawPath.startsWith('..') || path.isAbsolute(rawPath)) fail('RAW_PATH_OUTSIDE_LAKE');
    objects.push({ objectName: table.table, state: table.state, rowCount: table.rowCount ?? 0, byteCount: table.bytes ?? 0, rawPath: table.state === 'RAW_COMMITTED' ? rawPath : null, rawSha256: table.state === 'RAW_COMMITTED' ? table.sha256 : null, schemaSha256: table.state === 'RAW_COMMITTED' ? await sha256File(schemaFile) : null, format: table.state === 'RAW_COMMITTED' ? 'JSONL' : null });
  }
  const state = manifest.state === 'COMPLETE' ? 'COMPLETE' : manifest.state === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
  const runKey = `batch:${manifest.batchId}`;
  const bounds = manifest.window ? dayBounds(manifest.window) : null;
  return { sourceCode: options.sourceCode, planVersion: options.planVersion, runKey, mode: String(manifest.mode).toUpperCase() === 'DAILY' ? 'DAILY' : 'FULL', attempt: 1, revision: 1, state, consistency: manifest.consistency, scheduledWindowStart: bounds?.start ?? null, scheduledWindowEnd: bounds?.end ?? null, startedAt: manifest.startedAt, finishedAt: manifest.finishedAt ?? null, errorCode: manifest.errorCode ?? null, objects };
}

async function postJson(base, route, token, payload) {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    let code = `CONTROL_API_HTTP_${response.status}`;
    try { code = JSON.parse(await response.text()).code ?? code; } catch { /* keep status-only code */ }
    fail(code);
  }
  return response.json();
}

export async function run(options) {
  const plan = await readJson(options.inventory);
  const manifest = await readJson(options.manifest);
  const inventoryPayload = buildInventoryRequest(plan, options.sourceCode);
  const manifestPayload = await buildManifestRequest(options.manifest, manifest, { ...options, planVersion: plan.plan_version });
  if (options.dryRun) return { state: 'DRY_RUN', inventory: { objectCount: inventoryPayload.objects.length, schemaSha256: inventoryPayload.schemaSha256 }, manifest: { batchId: manifest.batchId, state: manifestPayload.state, objectCount: manifestPayload.objects.length } };
  const adminToken = process.env[options.adminTokenEnv];
  const workerToken = process.env[options.workerTokenEnv];
  if (!adminToken || !workerToken) fail('CONTROL_API_TOKEN_MISSING');
  const inventory = await postJson(options.controlApi, '/api/v1/lake/inventories', adminToken, inventoryPayload);
  const registered = await postJson(options.controlApi, '/api/v1/lake/manifests', workerToken, manifestPayload);
  return { state: 'COMPLETE', inventory, manifest: registered };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(JSON.stringify({ status: 'FAILED', errorCode: String(error?.message ?? 'CONTROL_API_REGISTER_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120) })); process.exitCode = 1; }
}

export { buildManifestRequest, parseArgs, sourceSchemaHash };

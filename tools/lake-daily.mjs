import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LAKE_ROOT = path.join(ROOT, '.lake-data');
const WINDOW = /^\d{4}-\d{2}-\d{2}$/u;

function fail(code) { throw new Error(code); }

function parseArgs(argv) {
  const options = { window: null, lakeRoot: DEFAULT_LAKE_ROOT, mysqlConfig: path.join(ROOT, 'secrets/mysql-development.local.json'), inventory: path.join(ROOT, 'work/lake-foundation/initial-full-snapshot-plan.json'), inbox: null, apiConfig: null, controlApi: null, register: false, mysqlSourceCode: 'mysql-test-source', fileSourceCode: 'folder-source', allowUnverifiedTestTls: false, assumeReady: false, dryRun: false, requireApi: false };
  const takes = new Set(['--window', '--lake-root', '--mysql-config', '--inventory', '--inbox', '--api-config', '--control-api', '--mysql-source-code', '--file-source-code']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-unverified-test-tls') options.allowUnverifiedTestTls = true;
    else if (arg === '--assume-ready') options.assumeReady = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--require-api') options.requireApi = true;
    else if (arg === '--register') options.register = true;
    else if (takes.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT_VALUE');
      const resolved = path.resolve(ROOT, value);
      if (arg === '--window') options.window = value;
      if (arg === '--lake-root') options.lakeRoot = resolved;
      if (arg === '--mysql-config') options.mysqlConfig = resolved;
      if (arg === '--inventory') options.inventory = resolved;
      if (arg === '--inbox') options.inbox = resolved;
      if (arg === '--api-config') options.apiConfig = resolved;
      if (arg === '--control-api') options.controlApi = value.replace(/\/+$/u, '');
      if (arg === '--mysql-source-code') options.mysqlSourceCode = value;
      if (arg === '--file-source-code') options.fileSourceCode = value;
    } else fail('INVALID_ARGUMENT');
  }
  if (options.window && !WINDOW.test(options.window)) fail('INVALID_WINDOW');
  if (options.register && !options.controlApi) fail('CONTROL_API_REQUIRED_FOR_REGISTER');
  return options;
}

async function exists(file) { return access(file).then(() => true).catch(() => false); }

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.part`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

async function acquireLock(lockFile) {
  try {
    const handle = await open(lockFile, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return handle;
  } catch {
    try {
      const existing = JSON.parse(await readFile(lockFile, 'utf8'));
      if (Number.isInteger(existing.pid)) {
        try { process.kill(existing.pid, 0); fail('DAILY_RUN_ALREADY_ACTIVE'); } catch (error) {
          if (error?.message === 'DAILY_RUN_ALREADY_ACTIVE' || error?.code !== 'ESRCH') throw new Error('DAILY_RUN_ALREADY_ACTIVE');
          await rm(lockFile, { force: true });
          return acquireLock(lockFile);
        }
      }
    } catch (error) {
      if (error?.message === 'DAILY_RUN_ALREADY_ACTIVE') throw error;
      await rm(lockFile, { force: true });
      return acquireLock(lockFile);
    }
    fail('DAILY_RUN_ALREADY_ACTIVE');
  }
}

async function runChild(script, args) {
  const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8').slice(0, 20000); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 4000); });
  const [code] = await once(child, 'close');
  let parsed = null;
  try { parsed = JSON.parse(stdout.trim()); } catch { /* the child still has a bounded error code */ }
  if (code !== 0) {
    const error = new Error(parsed?.errorCode ?? 'DAILY_CHILD_FAILED');
    error.stdout = stdout; error.stderr = stderr;
    throw error;
  }
  return parsed ?? { state: 'COMPLETE' };
}

export async function run(options) {
  options.window ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  if (!WINDOW.test(options.window)) fail('INVALID_WINDOW');
  await mkdir(options.lakeRoot, { recursive: true, mode: 0o700 });
  const resultFile = path.join(options.lakeRoot, 'daily-runs', `${options.window}.json`);
  if (await exists(resultFile) && !options.dryRun) {
    try { const previous = JSON.parse(await readFile(resultFile, 'utf8')); if (previous.state === 'COMPLETE') return { ...previous, reused: true }; } catch { /* rerun a corrupt ledger entry */ }
  }
  const lockFile = path.join(options.lakeRoot, 'daily-run.lock');
  const lock = await acquireLock(lockFile);
  const runManifest = { version: 1, window: options.window, state: 'RUNNING', startedAt: new Date().toISOString(), tasks: {} };
  try {
    const mysqlArgs = ['--daily', '--window', options.window, '--config', options.mysqlConfig, '--inventory', options.inventory, '--lake-root', options.lakeRoot, '--source-code', options.mysqlSourceCode];
    if (options.allowUnverifiedTestTls) mysqlArgs.push('--allow-unverified-test-tls');
    if (options.dryRun) mysqlArgs.push('--dry-run');
    try { runManifest.tasks.mysql = await runChild(path.join(ROOT, 'tools/lake-ingest.mjs'), mysqlArgs); }
    catch (error) { runManifest.tasks.mysql = { state: 'FAILED', errorCode: error.message }; }

    if (options.register) {
      if (runManifest.tasks.mysql.batchId) {
        const registerArgs = ['--control-api', options.controlApi, '--inventory', options.inventory, '--manifest', path.join(options.lakeRoot, 'batches', runManifest.tasks.mysql.batchId, 'batch.json'), '--lake-root', options.lakeRoot, '--source-code', options.mysqlSourceCode];
        if (options.dryRun) registerArgs.push('--dry-run');
        try { runManifest.tasks.register = await runChild(path.join(ROOT, 'tools/lake-register.mjs'), registerArgs); }
        catch (error) { runManifest.tasks.register = { state: 'FAILED', errorCode: error.message }; }
      } else runManifest.tasks.register = { state: 'FAILED', errorCode: 'MYSQL_BATCH_NOT_AVAILABLE' };
    } else runManifest.tasks.register = { state: 'NOT_CONFIGURED' };

    if (options.inbox) {
      const fileArgs = ['--inbox', options.inbox, '--delivery-date', options.window, '--lake-root', options.lakeRoot, '--source-code', options.fileSourceCode];
      if (options.assumeReady) fileArgs.push('--assume-ready');
      if (options.dryRun) fileArgs.push('--dry-run');
      try { runManifest.tasks.files = await runChild(path.join(ROOT, 'tools/file-ingest.mjs'), fileArgs); }
      catch (error) { runManifest.tasks.files = { state: 'FAILED', errorCode: error.message }; }
    } else runManifest.tasks.files = { state: 'NOT_CONFIGURED' };

    if (options.apiConfig) {
      const apiArgs = ['--config', options.apiConfig, '--window', options.window, '--lake-root', options.lakeRoot];
      if (options.dryRun) apiArgs.push('--dry-run');
      try { runManifest.tasks.api = await runChild(path.join(ROOT, 'tools/rest-ingest.mjs'), apiArgs); }
      catch (error) { runManifest.tasks.api = { state: 'FAILED', errorCode: error.message }; }
    } else runManifest.tasks.api = { state: options.requireApi ? 'FAILED' : 'NOT_CONFIGURED', ...(options.requireApi ? { errorCode: 'API_CONFIG_REQUIRED' } : {}) };
    const states = Object.values(runManifest.tasks).map((task) => task.state);
    runManifest.state = states.some((state) => state === 'FAILED') ? 'FAILED'
      : states.some((state) => state === 'INCOMPLETE') ? 'INCOMPLETE' : 'COMPLETE';
    runManifest.finishedAt = new Date().toISOString();
    await mkdir(path.dirname(resultFile), { recursive: true, mode: 0o700 });
    await atomicJson(resultFile, runManifest);
    if (!options.dryRun && runManifest.state !== 'COMPLETE') fail(runManifest.state === 'INCOMPLETE' ? 'DAILY_RUN_INCOMPLETE' : 'DAILY_RUN_FAILED');
    return runManifest;
  } finally {
    await lock.close();
    await rm(lockFile, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await run(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ window: result.window, state: result.state, tasks: Object.fromEntries(Object.entries(result.tasks).map(([key, value]) => [key, value.state])), reused: result.reused ?? false }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAILED', errorCode: String(error?.message ?? 'DAILY_RUN_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120) }));
    process.exitCode = 1;
  }
}

export { parseArgs };

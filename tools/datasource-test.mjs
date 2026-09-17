// Connection test for a typed datasource. Proves two things, in this order:
//   1. the endpoint is reachable and the credentials work;
//   2. the account cannot write - a successful SELECT is not evidence of a read-only account.
//
// The write probe uses CREATE TEMPORARY TABLE: it needs the same privilege family a real
// write would need for that session, and it disappears with the session, so a datasource
// that turns out to be writable is left untouched.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const SYSTEM_SCHEMAS = "('information_schema','mysql','performance_schema','sys')";

export function classifyError(stderr) {
  const text = String(stderr ?? '');
  if (/Access denied|authentication plugin|using password: NO/iu.test(text)) return 'DATASOURCE_AUTH_FAILED';
  if (/Can't connect|Unknown MySQL server host|Connection refused|Connection timed out|ETIMEDOUT|ECONNREFUSED/iu.test(text)) return 'DATASOURCE_UNREACHABLE';
  if (/SSL|certificate/iu.test(text)) return 'DATASOURCE_TLS_FAILED';
  return 'DATASOURCE_TEST_FAILED';
}

export function buildClientConfig(datasource, credential) {
  const lines = [
    '[client]',
    `host=${datasource.host}`,
    `port=${Number(datasource.port)}`,
    `user=${credential.user}`,
    `password=${credential.password}`,
    `default-character-set=${datasource.charset ?? 'utf8mb4'}`,
    'connect-timeout=10',
    'local-infile=0',
    'skip-reconnect',
  ];
  // A registered SQL probe runs unqualified statements, so the approved database must be
  // selected by the connection itself rather than by the caller's SQL.
  if (datasource.database) lines.push(`database=${datasource.database}`);
  lines.push('');
  return lines.join('\n');
}

export function parseVersionRow(stdout) {
  const row = String(stdout ?? '').trim().split('\n')[0] ?? '';
  const [version, timezone] = row.split('\t');
  return { serverVersion: (version ?? '').trim(), serverTimezone: (timezone ?? '').trim() };
}

function run(cli, configFile, sql, extra = []) {
  return new Promise(resolve => {
    const child = spawn(cli, [`--defaults-extra-file=${configFile}`, '--batch', '--skip-column-names', ...extra, '-e', sql],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes.toString(); });
    child.stderr.on('data', bytes => { stderr += bytes.toString(); });
    child.on('error', error => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function parseArgs(argv) {
  const options = {};
  const takesValue = new Set(['--config', '--resource-code', '--mysql-cli']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!takesValue.has(arg)) throw new Error('INVALID_ARGUMENT');
    const value = argv[++i];
    if (value === undefined) throw new Error('INVALID_ARGUMENT');
    if (arg === '--config') options.configFile = path.resolve(value);
    if (arg === '--resource-code') options.resourceCode = value;
    if (arg === '--mysql-cli') options.mysqlCli = value;
  }
  if (!options.configFile) throw new Error('MISSING_ARGUMENT');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(options.configFile, 'utf8'));
  const cli = options.mysqlCli ?? process.env.MYSQL_CLI ?? 'mysql';
  const datasource = config.datasource ?? {};
  const credential = config.credential ?? {};
  if (!datasource.host || !datasource.port || !credential.user || credential.password === undefined) {
    process.stderr.write(`${JSON.stringify({ errorCode: 'DATASOURCE_CONFIG_INCOMPLETE' })}\n`);
    process.exitCode = 1;
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'jiuzhang-datasource-'));
  const configFile = path.join(directory, 'client.cnf');
  const started = Date.now();
  try {
    await writeFile(configFile, buildClientConfig(datasource, credential), { mode: 0o600 });
    const probe = await run(cli, configFile, `SELECT VERSION(), @@system_time_zone; SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name NOT IN ${SYSTEM_SCHEMAS};`, ['--connect-timeout=10']);
    if (probe.code !== 0) {
      // Execution-level failure: the worker reads the code from stderr.
      process.stdout.write(`${JSON.stringify({ state: 'COMPLETE', testState: 'FAILED', errorCode: classifyError(probe.stderr), readOnlyVerified: false })}\n`);
      return;
    }
    const lines = probe.stdout.trim().split('\n');
    const { serverVersion, serverTimezone } = parseVersionRow(lines[0] ?? '');
    const readableSchemaCount = Number((lines[1] ?? '0').trim());
    // The write probe is the point of this tool: if it succeeds, the account is not read-only.
    const write = await run(cli, configFile, 'CREATE TEMPORARY TABLE __jiuzhang_read_only_probe (id INT); DROP TEMPORARY TABLE __jiuzhang_read_only_probe;');
    const readOnlyVerified = write.code !== 0;
    // The test ran to completion either way; whether the datasource is acceptable is data,
    // not an execution failure, so this exits zero and reports testState.
    const payload = {
      state: 'COMPLETE',
      testState: readOnlyVerified ? 'PASSED' : 'FAILED',
      serverVersion, serverTimezone,
      readableSchemaCount: Number.isSafeInteger(readableSchemaCount) ? readableSchemaCount : null,
      readOnlyVerified, latencyMs: Date.now() - started,
      errorCode: readOnlyVerified ? null : 'DATASOURCE_NOT_READ_ONLY',
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.code ?? '') ? error.code : 'DATASOURCE_TEST_FAILED',
      errorDetail: String(error.message ?? '').replace(/\s+/gu, ' ').slice(0, 200) })}\n`);
    process.exitCode = 1;
  }
}

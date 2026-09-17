// P0-a spike driver: answers the five open questions in docs/45 section 1.
// Local synthetic fixtures only. Run: node poc/seatunnel-sql/run.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../..');
const COMPOSE = ['compose', '-p', 'jiuzhang-st-spike', '-f', path.join(ROOT, 'compose.yaml')];
const ST = 'http://127.0.0.1:5801';
// Throwaway credentials generated per run and written under the git-ignored work/
// directory; the repository itself never holds a password.
const SECRETS = path.join(REPO, 'work/seatunnel-sql-spike');
const randomPassword = () => `spike-${randomBytes(18).toString('base64url')}`;
const MYSQL_PASSWORD = randomPassword();
const RAW_PASSWORD = randomPassword();
rmSync(SECRETS, { recursive: true, force: true });
mkdirSync(path.join(SECRETS, 'init'), { recursive: true, mode: 0o700 });
writeFileSync(path.join(SECRETS, 'root_password'), RAW_PASSWORD, { mode: 0o600 });
writeFileSync(path.join(SECRETS, 'init/01-schema.sql'),
  readFileSync(path.join(ROOT, 'mysql/init/01-schema.sql'), 'utf8').replaceAll('__APP_PASSWORD__', MYSQL_PASSWORD), { mode: 0o644 });
const TERMINAL = new Set(['FINISHED', 'FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWABLE']);
const results = {};

const docker = (args, options = {}) => execFileSync('docker', args, { cwd: REPO, encoding: 'utf8', ...options,
  env: { ...process.env, SPIKE_INIT_FILE: path.join(SECRETS, 'init/01-schema.sql'), SPIKE_ROOT_PASSWORD_FILE: path.join(SECRETS, 'root_password') } });
const compose = (...args) => docker([...COMPOSE, ...args]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function mysql(sql, { user = 'root', password = RAW_PASSWORD, allowFail = false } = {}) {
  try {
    return { ok: true, out: compose('exec', '-T', 'spike-mysql', 'mysql', `-u${user}`, `-p${password}`, '-N', '-B', '-e', sql) };
  } catch (error) {
    if (!allowFail) throw error;
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() };
  }
}

async function rest(route, method = 'GET', body) {
  const response = await fetch(`${ST}${route}`, {
    method, body, headers: body ? { 'Content-Type': 'application/json' } : undefined, signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

const submit = async jobFile => {
  const template = readFileSync(path.join(ROOT, 'jobs', jobFile), 'utf8');
  const payload = template.replaceAll('__MYSQL_PASSWORD__', MYSQL_PASSWORD).replaceAll('__BATCH__', `spike-${Date.now()}`);
  JSON.parse(payload);
  const submitted = await rest('/hazelcast/rest/maps/submit-job', 'POST', payload);
  if (submitted.status !== 200) throw new Error(`submit failed: ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 300)}`);
  return { jobId: String(submitted.body.jobId ?? ''), raw: submitted.body };
};

const jobInfo = jobId => rest(`/hazelcast/rest/maps/job-info/${jobId}`);

async function waitFor(jobId, predicate, seconds = 120) {
  const until = Date.now() + seconds * 1000;
  let info = null;
  while (Date.now() < until) {
    info = await jobInfo(jobId);
    const status = info.body?.jobStatus;
    if (predicate(status, info)) return info;
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${jobId}; last=${JSON.stringify(info?.body)?.slice(0, 300)}`);
}

// ---------------------------------------------------------------- 0. bring up
compose('down', '-v', '--remove-orphans');
// SeaTunnel runs as root in the container, so its output files cannot be removed from
// the host. Clear the bind mount through a throwaway container instead.
const OUT = path.join(ROOT, 'out');
rmSync(path.join(ROOT, 'results.json'), { force: true });
try { rmSync(OUT, { recursive: true, force: true }); } catch { /* root-owned leftovers */ }
docker(['run', '--rm', '--entrypoint', 'sh', '-v', `${OUT}:/out`, 'apache/seatunnel:2.3.13', '-c', 'rm -rf /out/* 2>/dev/null || true'], { stdio: 'ignore' });
mkdirSync(OUT, { recursive: true });
compose('up', '-d', '--wait', '--wait-timeout', '300');
results.environment = { images: {}, seed: {} };
results.environment.images = Object.fromEntries(docker(['image', 'inspect', 'apache/seatunnel:2.3.13', 'mysql:8.0.43',
  '--format', '{{.RepoTags}} {{index .RepoDigests 0}}']).trim().split('\n').map(line => [line.split(' ')[0].replace(/[[\]]/g, ''), line.trim()]));
results.environment.seed.orders = mysql('SELECT COUNT(*) FROM spike.spike_orders').out.trim();
results.environment.seed.slow = mysql('SELECT COUNT(*) FROM spike.spike_slow').out.trim();
results.environment.seed.chineseColumnNameHexOk = mysql("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='spike' AND table_name='spike_orders' AND HEX(column_name)='E8AEA2E58D95E7BC96E58FB7'").out.trim();

// ------------------------------------------------- 1. read-only account proof
const writeAttempt = mysql('CREATE TABLE spike.should_fail (id INT);', { user: 'spike_ro', password: MYSQL_PASSWORD, allowFail: true });
results.readOnlyAccount = { writeDenied: !writeAttempt.ok, message: writeAttempt.out.split('\n').filter(Boolean).slice(-1)[0] ?? '' };
const selectAttempt = mysql('SELECT COUNT(*) FROM spike.spike_orders;', { user: 'spike_ro', password: MYSQL_PASSWORD, allowFail: true });
results.readOnlyAccount.selectWorks = selectAttempt.ok;

// --------------------------------------------------- 2. JSONL file sink format
const started = Date.now();
const orders = await submit('orders-jsonl.json');
const ordersInfo = await waitFor(orders.jobId, status => TERMINAL.has(status));
results.fileSink = { jobId: orders.jobId, jobStatus: ordersInfo.body.jobStatus, elapsedMs: Date.now() - started, acceptedConfig: true };
const ordersDir = path.join(ROOT, 'out/jsonl/orders');
const listFiles = dir => (() => { try { return readdirSync(dir); } catch { return []; } })();
results.fileSink.files = listFiles(ordersDir).map(name => ({ name, bytes: statSync(path.join(ordersDir, name)).size }));
const partFile = results.fileSink.files.find(file => !file.name.endsWith('.crc'));
if (partFile) {
  const content = readFileSync(path.join(ordersDir, partFile.name), 'utf8');
  const lines = content.trimEnd().split('\n');
  results.fileSink.rawHead = content.slice(0, 400);
  results.fileSink.isJsonl = lines.length > 1 && lines.every(line => { try { JSON.parse(line); return true; } catch { return false; } });
  results.fileSink.isJsonArray = (() => { try { return Array.isArray(JSON.parse(content)); } catch { return false; } })();
  results.fileSink.lineCount = lines.length;
  const rows = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  results.typeFidelity = {
    decimalExactInFileText: {
      '12345678901234567.89': content.includes('12345678901234567.89'),
      '999999999999999999.99': content.includes('999999999999999999.99'),
      '-0.01': content.includes('-0.01'),
      decimalsAreUnquotedJsonNumbers: /"amount":\s*-?[0-9]/.test(content),
    },
    keys: Object.keys(rows[0] ?? {}),
    decimalPreserved: rows.map(row => row.amount),
    decimalExact: rows[0]?.amount === '12345678901234567.89' || rows[0]?.amount === 12345678901234567.89,
    bigDecimalPreserved: rows[2]?.amount,
    negativeDecimalPreserved: rows[1]?.amount,
    datetime: rows.map(row => row.updated_at),
    nullPreserved: rows[0]?.note === null,
    chineseTextPreserved: rows[1]?.note,
    leadingZeroPreserved: rows[2]?.note,
    batchColumn: rows[0]?.batch_id,
    jsonTypes: Object.fromEntries(Object.entries(rows[0] ?? {}).map(([key, value]) => [key, typeof value])),
  };
}

// ------------------------------------------- 2b. character-cast variant (contract-aligned)
const castJob = await submit('orders-char-cast.json');
const castInfo = await waitFor(castJob.jobId, status => TERMINAL.has(status));
const castDir = path.join(ROOT, 'out/cast/orders');
const castFile = listFiles(castDir).find(name => !name.endsWith('.crc'));
results.charCastVariant = { jobId: castJob.jobId, jobStatus: castInfo.body.jobStatus };
if (castFile) {
  const castContent = readFileSync(path.join(castDir, castFile), 'utf8');
  const castRows = castContent.trimEnd().split('\n').map(line => JSON.parse(line));
  results.charCastVariant.rawHead = castContent.slice(0, 400);
  results.charCastVariant.decimalIsString = typeof castRows[0].amount === 'string';
  results.charCastVariant.decimalExactString = castRows[0].amount;
  results.charCastVariant.updatedAtString = castRows[0].updated_at;
  results.charCastVariant.updatedAtIsSourceLocalWallClock = castRows[0].updated_at.startsWith('2026-09-17 09:58:11');
}

// ---------------------------------------------------- 3. stop-job / cancel API
const slow = await submit('slow-cancel.json');
await sleep(4000);
const runningBefore = await rest('/hazelcast/rest/maps/running-jobs');
const stopAttempts = [];
for (const [route, method, body] of [
  ['/hazelcast/rest/maps/stop-job', 'POST', JSON.stringify({ jobId: slow.jobId })],
  [`/hazelcast/rest/maps/stop-job/${slow.jobId}`, 'POST', undefined],
  [`/hazelcast/rest/maps/stop-job?jobId=${slow.jobId}`, 'POST', undefined],
]) {
  const attempt = await rest(route, method, body);
  stopAttempts.push({ route, status: attempt.status, body: JSON.stringify(attempt.body).slice(0, 160) });
  if (attempt.status === 200) break;
}
let canceled = null;
try { canceled = await waitFor(slow.jobId, status => ['CANCELED', 'CANCELLED', 'FAILED', 'FINISHED'].includes(status), 60); }
catch (error) { canceled = { body: { jobStatus: 'STILL_RUNNING', error: error.message.slice(0, 160) } }; }
results.cancel = {
  jobId: slow.jobId, runningBeforeCancel: runningBefore.body?.jobs?.length ?? runningBefore.body?.length ?? null,
  stopAttempts, statusAfterStop: canceled.body?.jobStatus,
  filesAfterCancel: listFiles(path.join(ROOT, 'out/slow/rows')).length,
};

// -------------------------------------------------- 4. concurrency and memory
const parallel = await Promise.all([submit('slow-cancel.json'), submit('slow-cancel.json')]);
await sleep(5000);
const runningNow = await rest('/hazelcast/rest/maps/running-jobs');
const pending = await rest('/hazelcast/rest/maps/pending-jobs');
const infos = await Promise.all(parallel.map(job => jobInfo(job.jobId)));
results.concurrency = {
  submitted: parallel.map(job => job.jobId), statuses: infos.map(info => info.body?.jobStatus),
  runningJobs: runningNow.body?.jobs?.length ?? runningNow.body?.length ?? null,
  pendingJobs: pending.body?.jobs?.length ?? pending.body?.length ?? null,
  stats: docker(['stats', '--no-stream', '--format', '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}', 'jiuzhang-st-spike-spike-seatunnel-1']).trim(),
};
for (const job of [...parallel, slow]) { try { await rest('/hazelcast/rest/maps/stop-job', 'POST', JSON.stringify({ jobId: job.jobId })); } catch {} }

// ---------------------------------------------------------------- 5. write out
writeFileSync(path.join(ROOT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ fileSink: results.fileSink, typeFidelity: results.typeFidelity, cancel: results.cancel, concurrency: results.concurrency, readOnlyAccount: results.readOnlyAccount }, null, 2));

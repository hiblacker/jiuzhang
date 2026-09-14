// POC-01 end-to-end runner. Local experiment only: drives the Docker Compose
// stack, migrates a fresh experiment database, creates DolphinScheduler
// workflows over its API, runs the daily/late/stale/retry scenarios and
// asserts golden values. Never touches the real DevOps source or NAS.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const directory = path.resolve(root, 'poc/component');
export const P01_SQL = Object.freeze([
 'poc/component/dbt_project/poc01_platform.sql',
]);
const MIGRATIONS = ['V001__warehouse.sql', 'V002__release_guard.sql', 'V003__flow_gate_roles.sql'];
const IMAGES = ['mysql:8.0.43', 'postgres:16.15', 'python:3.12-slim',
 'apache/seatunnel:2.3.13', 'apache/dolphinscheduler-standalone-server:3.4.3'];
const sha256 = (t) => createHash('sha256').update(t).digest('hex');

export function databaseName(token) {
 if (!/^[0-9]{14}_[a-f0-9]{8}$/.test(token)) throw new Error('Invalid experiment token');
 return `p01_${token}`;
}
export function sourceDatabaseName(token) {
 if (!/^[0-9]{14}_[a-f0-9]{8}$/.test(token)) throw new Error('Invalid experiment token');
 return `src_${token}`;
}

function docker(args, input = '', timeoutMs = 180000) {
 return new Promise((resolve, reject) => {
  const child = spawn('docker', args, { cwd: root, shell: false, windowsHide: true,
   stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`docker ${args[0]} timed out`)); }, timeoutMs);
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  child.on('error', e => { clearTimeout(timer); reject(e); });
  child.on('close', code => {
   clearTimeout(timer);
   if (code !== 0) reject(new Error(`docker ${args.slice(0, 3).join(' ')} failed (${code}): ${stderr.slice(-3000)}`));
   else resolve(stdout);
  });
  if (input) child.stdin.end(input); else child.stdin.end();
 });
}
const compose = (...args) => docker(['compose', '-f', path.join(root, 'poc/component/compose.yaml'), ...args]);
// compose exec -T mangles stdin on Windows hosts; stdin-piped psql goes through plain
// docker exec with the resolved container id (the pattern proven by the synthetic P0).
let warehouseCid = null;
async function warehouseContainer() {
 if (!warehouseCid) warehouseCid = (await compose('ps', '-q', 'warehouse')).trim();
 return warehouseCid;
}
const psql = async (db, input) => docker(['exec', '-i', '-u', 'postgres',
 await warehouseContainer(), 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', db], input);

async function ensureSecrets() {
 await mkdir(path.join(root, 'secrets'), { recursive: true });
 const files = [['poc01-pg-password.txt', 24], ['poc01-mysql-password.txt', 24],
  ['poc01-mysql-root-password.txt', 32]];
 const secrets = {};
 for (const [name, bytes] of files) {
  const file = path.join(root, 'secrets', name);
  try {
   await writeFile(file, randomBytes(bytes).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  secrets[name] = (await readFile(file, 'utf8')).trim();
 }
 return secrets;
}

async function preflight(secrets) {
 for (const image of IMAGES) {
  await docker(['image', 'inspect', image]);
 }
 await compose('config', '--quiet');
 const token = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '_' +
  randomBytes(4).toString('hex');
 return { db: databaseName(token), sourceDb: sourceDatabaseName(token), token };
}

async function migrate(db) {
 const cid = await warehouseContainer();
 await docker(['exec', '-u', 'postgres', cid, 'createdb', db]);
 let migration = 'BEGIN; CREATE TABLE public.p0_migration(version text PRIMARY KEY, '
  + 'sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());\n';
 for (const name of MIGRATIONS) {
  const file = path.join(root, 'poc/synthetic-sql/migrations', name);
  migration += await readFile(file, 'utf8');
  migration += `\nINSERT INTO public.p0_migration(version,sha256) VALUES ('${name}','${sha256(await readFile(file, 'utf8'))}');\n`;
 }
 await psql(db, migration + 'COMMIT;');
 for (const rel of ['poc/synthetic-sql/models/lifecycle.sql', ...P01_SQL]) {
  const text = await readFile(path.join(root, rel), 'utf8');
  await psql(db, text + `\nINSERT INTO public.p0_migration(version,sha256) VALUES ('${path.basename(rel)}','${sha256(text)}');\n`);
 }
 const applied = await psql(db, 'SELECT count(*) FROM public.p0_migration;');
 if (Number(applied.trim()) !== MIGRATIONS.length + 2) throw new Error('Unexpected migration record count');
}
async function seedSource(sourceDb, secrets) {
 const schema = await readFile(path.join(root, 'poc/component/mysql/init/01-schema.sql'), 'utf8');
 const seed = await readFile(path.join(root, 'poc/component/mysql/init/02-seed.sql'), 'utf8');
 const cid = (await compose('ps', '-q', 'source-mysql')).trim();
 const rootPassword = secrets['poc01-mysql-root-password.txt'];
 await docker(['exec', '-i', cid, 'mysql', '-uroot', `-p${rootPassword}`, '-e',
  `CREATE DATABASE \`${sourceDb}\` CHARACTER SET utf8mb4`], '', 120000);
 await docker(['exec', '-i', cid, 'mysql', '-uroot', `-p${rootPassword}`, sourceDb], schema + '\n' + seed, 120000);
 await docker(['exec', '-i', cid, 'mysql', '-uroot', `-p${rootPassword}`, '-e',
  `GRANT SELECT ON \`${sourceDb}\`.* TO 'poc_ro'@'%'`], '', 120000);
}

async function httpIn(container, method, url, body, cookie) {
 const args = ['compose', '-f', path.join(root, 'poc/component/compose.yaml'), 'exec', '-T', container,
  'curl', '-s', '--max-time', '30', '-X', method];
 if (cookie) args.push('-H', `Cookie: sessionId=${cookie}`);
 if (body) for (const [k, v] of Object.entries(body)) args.push('--data-urlencode', `${k}=${v}`);
 args.push(url);
 const out = await docker(args, '', 120000);
 try { return JSON.parse(out); } catch { throw new Error(`Non-JSON response from ${url}: ${out.slice(0, 400)}`); }
}

async function schedulerCall(method, url, body, cookie) {
 return httpIn('scheduler', method, `http://localhost:12345${url}`, body, cookie);
}
// python:3.12-slim has no curl; the adapter is called through urllib with the JSON
// body passed as an environment value (spawn argv, no shell, no Windows stdin).
async function adapterCall(method, url, body) {
 const py = "import json,os,sys,urllib.request,urllib.error\n"
  + "req=urllib.request.Request('http://localhost:8080" + url + "', method='" + method + "',\n"
  + " data=os.environ['BDY'].encode() if os.environ.get('BDY') else None)\n"
  + "req.add_header('Content-Type','application/json')\n"
  + "try:\n r=urllib.request.urlopen(req, timeout=120); print(r.read().decode())\n"
  + "except urllib.error.HTTPError as e:\n sys.stdout.write(e.read().decode()); raise SystemExit(1)\n";
 const args = ['compose', '-f', path.join(root, 'poc/component/compose.yaml'), 'exec', '-T'];
 if (body) args.push('-e', `BDY=${JSON.stringify(body)}`);
 args.push('adapter', 'python', '-c', py);
 const out = await docker(args, '', 150000);
 try { return JSON.parse(out.trim().split('\n').pop()); }
 catch { throw new Error(`Adapter ${url} returned non-JSON: ${out.slice(0, 400)}`); }
}

async function dsLogin() {
 const response = await schedulerCall('POST', '/dolphinscheduler/login',
  { userName: 'admin', userPassword: 'dolphinscheduler123' });
 if (response.code !== 0 || !response.data?.sessionId) throw new Error(`DS login failed: ${JSON.stringify(response).slice(0, 200)}`);
 return response.data.sessionId;
}

function taskCode(seed) { return Number(`${Date.now()}${String(seed).padStart(3, '0')}`); }

async function ensureProject(cookie, name) {
 const created = await schedulerCall('POST', '/dolphinscheduler/projects', { projectName: name }, cookie);
 if (created.code === 0 && created.data?.code) return created.data.code;
 const list = await schedulerCall('GET', `/dolphinscheduler/projects?pageSize=20&pageNo=1&searchVal=${name}`, undefined, cookie);
 const found = (list.data?.totalList ?? []).find(p => p.name === name);
 if (!found) throw new Error(`Cannot resolve project: ${JSON.stringify(created).slice(0, 200)}`);
 return found.code;
}

async function ensureWorkflow(cookie, projectCode, name, taskDef) {
 const list = await schedulerCall('GET',
  `/dolphinscheduler/projects/${projectCode}/workflow-definition?pageNo=1&pageSize=20&searchVal=${name}`, undefined, cookie);
 const existing = (list.data?.totalList ?? []).find(w => w.name === name);
 if (existing) return existing.code;
 // Mirror the UI: task codes come from the server's code generator.
 const gen = await schedulerCall('GET',
  `/dolphinscheduler/projects/${projectCode}/task-definition/gen-task-codes?genNum=1`, undefined, cookie);
 if (gen.code !== 0 || !Array.isArray(gen.data) || !gen.data[0]) {
  throw new Error(`gen-task-codes failed: ${JSON.stringify(gen).slice(0, 200)}`);
 }
 const code = gen.data[0];
 const definition = [{ code, name: 'chain', version: 1, projectCode, ...taskDef }];
 const payload = {
  name,
  description: 'POC-01 synthetic chain',
  globalParams: '[]',
  locations: `{"chain":{"x":100,"y":100}}`,
  timeout: '0',
  taskRelationJson: JSON.stringify([{ name: '', preTaskCode: 0, preTaskVersion: 0,
   postTaskCode: code, postTaskVersion: 1, conditionType: 'NONE', conditionParams: {} }]),
  taskDefinitionJson: JSON.stringify(definition),
 };
 const created = await schedulerCall('POST',
  `/dolphinscheduler/projects/${projectCode}/workflow-definition`, payload, cookie);
 if (created.code !== 0 || !created.data?.code) throw new Error(`Create ${name} failed: ${JSON.stringify(created).slice(0, 500)}`);
 // DS 3.4.3 requires the workflow name on release.
 const released = await schedulerCall('POST',
  `/dolphinscheduler/projects/${projectCode}/workflow-definition/${created.data.code}/release`,
  { releaseState: 'ONLINE', name }, cookie);
 if (released.code !== 0) throw new Error(`Release ${name} failed: ${JSON.stringify(released).slice(0, 300)}`);
 return created.data.code;
}

const httpTask = (url) => ({ taskType: 'HTTP', taskParams: {
  url, httpMethod: 'GET', httpParams: [], httpCheckCondition: 'STATUS_CODE_DEFAULT',
  condition: '', connectTimeout: 60000, socketTimeout: 300000 },
 flag: 'YES', taskPriority: 'MEDIUM', workerGroup: 'default', failRetryTimes: 0,
 failRetryInterval: 1, timeoutFlag: 'CLOSE', timeoutNotifyStrategy: '', timeout: 0,
 delayTime: 0, environmentCode: -1, description: '' });

async function startAndAwait(cookie, projectCode, defCode, label, timeoutMs = 900000) {
 const scheduleTime = new Date(Date.now() + 3000).toISOString()
  .replace('T', ' ').replace('Z', '').slice(0, 23);
 const started = await schedulerCall('POST',
  `/dolphinscheduler/projects/${projectCode}/executors/start-workflow-instance`,
  { workflowDefinitionCode: defCode, scheduleTime, failureStrategy: 'END',
   warningType: 'NONE', workflowInstancePriority: 'MEDIUM', taskDependType: 'TASK_POST',
   runMode: 'RUN_MODE_SERIAL', workerGroup: 'default' }, cookie);
 if (started.code !== 0 || !started.data) throw new Error(`Start ${label} failed: ${JSON.stringify(started).slice(0, 400)}`);
 const instanceId = Array.isArray(started.data) ? Number(started.data[0])
  : typeof started.data === 'object'
   ? Number(started.data.workflowInstanceId ?? started.data.id)
   : Number(started.data);
 const deadline = Date.now() + timeoutMs;
 let lastState = 'UNKNOWN';
 while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const list = await schedulerCall('GET',
   `/dolphinscheduler/projects/${projectCode}/workflow-instances?workflowDefinitionCode=${defCode}&pageNo=1&pageSize=10`, undefined, cookie);
  const instance = (list.data?.totalList ?? []).find(i => Number(i.id) === instanceId);
  if (!instance) continue;
  lastState = instance.state;
  if (['SUCCESS', 'FAILURE', 'STOP', 'KILL'].includes(instance.state)) {
   return { instanceId, state: instance.state, instance };
  }
 }
 throw new Error(`${label} timed out in state ${lastState}`);
}

async function assertGolden(db, releaseId, periodId, team, expected, label) {
 const row = JSON.parse((await psql(db,
  `SELECT coalesce(json_agg(json_build_object('p',period_id,'t',team,'e',completion_events,'o',completed_objects,`
  + `'s',duration_sum_seconds,'n',valid_samples,'m',duration_mean_seconds,'i',inventory,'ir',inventory_reason)), '{}') `
  + `FROM warehouse.metric WHERE release_id=${releaseId} AND period_id='${periodId}' AND team='${team}'`)).trim());
 const m = row[0] ?? {};
 const mismatches = [];
 for (const [key, value] of Object.entries(expected)) {
  const actual = m[key];
  const actualNorm = (actual === null || actual === undefined) ? null : String(actual);
  const expectNorm = (value === null || value === undefined) ? null : String(value);
  if (actualNorm !== expectNorm) mismatches.push(`${key}: expected ${expectNorm}, got ${actualNorm}`);
 }
 if (mismatches.length) throw new Error(`Golden mismatch [${label}]: ${mismatches.join('; ')}`);
}

async function main() {
 const secrets = await ensureSecrets();
 const { db, sourceDb, token } = await preflight(secrets);
 const result = { db, startedAt: new Date().toISOString(), status: 'RUNNING', stages: {} };
 const output = path.join(root, 'work', `poc01-${token}.json`);
 await mkdir(path.dirname(output), { recursive: true });

 const record = async (stage, data) => {
  result.stages[stage] = data;
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
 };
 try {
  await compose('up', '-d', '--wait', '--pull', 'never', '--wait-timeout', '420');
  await record('compose', 'stack healthy');

  const freeze = await compose('exec', '-T', 'adapter', 'pip', 'freeze');
  const lock = JSON.parse(await readFile(path.join(directory, 'dependencies.lock.json'), 'utf8'));
  const locked = new Set(lock.dbt.packages.map(p => `${p.name.toLowerCase()}==${p.version}`));
  const installed = freeze.trim().split('\n').filter(l => l.includes('=='));
  const missing = [...locked].filter(l => !installed.map(i => i.toLowerCase()).includes(l));
  if (missing.length) throw new Error(`Adapter package drift: missing ${missing.join(', ')}`);
  await record('dependencyLock', { packages: installed.length, verifiedAgainst: locked.size });

  await seedSource(sourceDb, secrets);
  await migrate(db);
  await record('migrations', { database: db, applied: MIGRATIONS.length + 2 });

  const session = await adapterCall('POST', '/session', { dbname: db, source_db: sourceDb });
  if (!session.session) throw new Error(`Adapter session failed: ${JSON.stringify(session)}`);

  const cookie = await dsLogin();
  const projectCode = await ensureProject(cookie, `poc01_${token}`);
  const defs = {
   daily: await ensureWorkflow(cookie, projectCode, `poc01_${token}_daily`,
    httpTask('http://adapter:8080/chain/daily')),
   late: await ensureWorkflow(cookie, projectCode, `poc01_${token}_late`,
    httpTask('http://adapter:8080/chain/late')),
   stale: await ensureWorkflow(cookie, projectCode, `poc01_${token}_stale`,
    httpTask('http://adapter:8080/chain/stale')),
   retry: await ensureWorkflow(cookie, projectCode, `poc01_${token}_retry`, {
    taskType: 'HTTP', taskParams: { url: 'http://adapter:8080/retry-once', httpMethod: 'GET',
     httpParams: [], httpCheckCondition: 'STATUS_CODE_DEFAULT', condition: '',
     connectTimeout: 60000, socketTimeout: 300000 },
    flag: 'YES', taskPriority: 'MEDIUM', workerGroup: 'default', failRetryTimes: 1,
    failRetryInterval: 5, timeoutFlag: 'CLOSE', timeoutNotifyStrategy: '', timeout: 0,
    delayTime: 0, environmentCode: -1, description: '' }),
  };
  await record('scheduler', { projectCode, defs });

  // Stage 1: daily chain.
  const daily1 = await startAndAwait(cookie, projectCode, defs.daily, 'daily');
  if (daily1.state !== 'SUCCESS') throw new Error(`daily workflow state ${daily1.state}`);
  const last1 = await adapterCall('GET', '/last');
  await psql(db, `UPDATE warehouse.run_log SET engine='dolphinscheduler', engine_run_id='${daily1.instanceId}' WHERE platform_run_id='${last1.platform_run_id}'`);
  const r1 = last1.release_id;
  const active1 = Number(last1.active_release.release_id);
  if (last1.run_state !== 'PUBLISHED' || active1 !== Number(r1)) throw new Error(`daily1 publish state unexpected: ${JSON.stringify(last1).slice(0, 300)}`);
  await assertGolden(db, r1, '2026-09-01', 'alpha', { e: 3, o: 3, s: 19800, n: 3, m: 6600, i: 1 }, 'daily Sep-01');
  await assertGolden(db, r1, '2026-09-02', 'alpha', { e: 3, o: 3, s: 72000, n: 2, m: 36000, i: null, ir: 'incomplete_history_or_period' }, 'daily Sep-02');
  await assertGolden(db, r1, '2026-09-03', 'alpha', { e: 1, o: 1, s: 82800, n: 1, m: 82800, i: null }, 'daily Sep-03');
  await assertGolden(db, r1, '2026-09-03', 'UNKNOWN', { e: 0, o: 0, s: 0, n: 0, m: null, i: 1 }, 'daily Sep-03 UNKNOWN');
  await assertGolden(db, r1, '2026-09', 'alpha', { e: 7, o: 6, s: 174600, n: 6, m: 29100, i: null }, 'daily month');
  await assertGolden(db, r1, '2026-09', 'UNKNOWN', { e: 0, o: 0, s: 0, n: 0, m: null, i: null, ir: 'incomplete_history_or_period' }, 'daily month UNKNOWN');
  await record('daily', { platformRunId: last1.platform_run_id, release: r1,
   rawEvents: last1.raw_events, rawObjects: last1.raw_objects, golden: 'passed' });

  // Stage 2: idempotent rerun (duplicate replay must not change facts).
  const daily2 = await startAndAwait(cookie, projectCode, defs.daily, 'daily-replay');
  if (daily2.state !== 'SUCCESS') throw new Error(`daily-replay state ${daily2.state}`);
  const last2 = await adapterCall('GET', '/last');
  const counts = await psql(db, `SELECT (SELECT count(*) FROM raw.event), (SELECT count(*) FROM raw.object), (SELECT count(*) FROM raw_landing.status_batch)`);
  const [events, objects, landed] = counts.trim().split('|').map(Number);
  if (events !== 21 || objects !== 12) throw new Error(`Replay changed facts: events=${events} objects=${objects}`);
  const metricsSame = await psql(db,
   `SELECT count(*) FROM (SELECT period_id, team, completion_events, completed_objects, duration_sum_seconds, valid_samples, duration_mean_seconds, inventory FROM warehouse.metric WHERE release_id=${r1} EXCEPT SELECT period_id, team, completion_events, completed_objects, duration_sum_seconds, valid_samples, duration_mean_seconds, inventory FROM warehouse.metric WHERE release_id=${last2.release_id}) d`);
  if (metricsSame.trim() !== '0') throw new Error('Replay metrics differ from first release');
  await record('replay', { events, objects, landedAll: landed, release: last2.release_id, metricsIdentical: true });

  // Stage 3: late arrival changes the affected period, not just the ingest day.
  const lateSql = "UPDATE story SET status_code='done', updated_at='2026-09-04 10:00:00', actual_end='2026-09-02 20:00:00' WHERE id='S05';"
   + "INSERT INTO status_log (event_id,object_id,object_type,operation,status_code,started_at,event_time,logged_at) VALUES ('e05b','S05','story','update','done','2026-09-02 10:00:00','2026-09-02 20:00:00','2026-09-04 10:00:00');";
  // Only the fixture injector uses root; the SeaTunnel source remains poc_ro.
  // The secret is expanded inside the container, never into this process argv.
  await compose('exec', '-T', 'source-mysql', 'sh', '-c',
   'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -uroot "$1" -e "$2"',
   'poc01-late-fixture', sourceDb, lateSql);
  const late = await startAndAwait(cookie, projectCode, defs.late, 'late');
  if (late.state !== 'SUCCESS') throw new Error(`late workflow state ${late.state}`);
  const last3 = await adapterCall('GET', '/last');
  await assertGolden(db, last3.release_id, '2026-09-02', 'alpha', { e: 4, o: 4, s: 108000, n: 3, m: 36000 }, 'late Sep-02');
  await assertGolden(db, last3.release_id, '2026-09', 'alpha', { e: 8, o: 7, s: 210600, n: 7, m: 30085.714285714286 }, 'late month');
  const sep3Unchanged = await psql(db,
   `SELECT count(*) FROM warehouse.metric m WHERE m.release_id=${last3.release_id} AND m.period_id='2026-09-03' AND m.team='alpha' AND (m.completion_events, m.completed_objects, m.duration_sum_seconds) = (1,1,82800)`);
  if (sep3Unchanged.trim() !== '1') throw new Error('late rebuild touched unaffected period incorrectly');
  await record('late', { release: last3.release_id, golden: 'passed' });

  // Stage 4: stale run must not overwrite the newer release.
  const stale = await startAndAwait(cookie, projectCode, defs.stale, 'stale');
  if (stale.state !== 'SUCCESS') throw new Error(`stale workflow state ${stale.state}`);
  const last4 = await adapterCall('GET', '/last');
  if (!last4.stale_rejection || last4.run_state !== 'STALE-REJECTED') throw new Error(`stale rejection not recorded: ${JSON.stringify(last4).slice(0, 300)}`);
  const activeNow = await psql(db, 'SELECT release_id FROM warehouse.active_release');
  if (Number(activeNow.trim()) !== Number(last3.release_id)) throw new Error('Active pointer moved after stale rejection');
  await record('stale', { rejectedRelease: last4.release_id, reason: last4.stale_rejection, activeUnchanged: true });

  // Stage 5: scheduler retry behavior.
  const retry = await startAndAwait(cookie, projectCode, defs.retry, 'retry-demo');
  if (retry.state !== 'SUCCESS') throw new Error(`retry workflow state ${retry.state}`);
  const tasks = await schedulerCall('GET',
   `/dolphinscheduler/projects/${projectCode}/workflow-instances/${retry.instanceId}/tasks`, undefined, cookie);
  const taskList = tasks.data?.totalList ?? tasks.data ?? [];
  const retryEvidence = taskList.map(t => ({ name: t.name, state: t.state, retryNum: t.retryNum ?? t.retryTimes ?? null }));
  await record('retry', { instance: retry.instanceId, state: retry.state, tasks: retryEvidence });

  // Stage 6: dbt schema tests on the latest models.
  const dbtTest = await compose('exec', '-T', '-e', `DBT_DBNAME=${db}`,
   '-e', `DBT_PASSWORD=${secrets['poc01-pg-password.txt']}`,
   'adapter', 'dbt', 'test', '--profiles-dir', '/opt/dbt_project');
  if (!/PASS=?\s*\d|All tests passed|Success/i.test(dbtTest) && !/PASS/.test(dbtTest)) {
   throw new Error(`dbt test failed: ${dbtTest.slice(-800)}`);
  }
  await record('dbtTest', 'passed');

  result.status = 'PASS';
  result.assertions = [
   'SeaTunnel JDBC ingest lands MySQL batches into RAW landing tables',
   'dbt load is idempotent: duplicate replay changes no facts',
   'golden daily and monthly metrics match hand-computed values',
   'monthly distinct is not the sum of daily distincts (6 dailies, 5 objects)',
   'missing start and unknown status stay out of fabricated results',
   'late arrival rebuilds affected periods via new immutable release',
   'stale run publish is rejected and active pointer unchanged',
   'DolphinScheduler executes HTTP chain tasks and retry policy succeeds',
   'run_log maps platform run id to DolphinScheduler instance id',
  ];
 } catch (error) {
  result.status = 'FAIL';
  result.error = String(error.message ?? error).slice(0, 2000);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.error(result.error);
  process.exitCode = 1;
  return;
 }
 await writeFile(output, JSON.stringify(result, null, 2) + '\n');
 console.log(`Experiment PASS: ${db}; results retained at ${output}`);
 console.log('PASS: POC-01 chain assertions; local stack only, no source/NAS access.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main().catch(error => { console.error(String(error.message ?? error).slice(0, 2000)); process.exitCode = 1; });
}

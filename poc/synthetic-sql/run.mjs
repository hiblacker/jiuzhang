import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(directory, '../..');
export const sqlFiles = Object.freeze([
 'migrations/V001__warehouse.sql', 'migrations/V002__release_guard.sql', 'migrations/V003__flow_gate_roles.sql',
 'models/lifecycle.sql', 'fixtures/baseline.sql', 'tests/acceptance.sql',
]);
export function databaseName(token) {
 if (!/^[0-9]{14}_[a-f0-9]{8}$/.test(token)) throw new Error('Invalid experiment token');
 return `p0_${token}`;
}
export function sha256(text) { return createHash('sha256').update(text).digest('hex'); }
export async function verifyLocks() {
 const lock = JSON.parse(await readFile(path.join(directory, 'sql.lock.json'), 'utf8'));
 if (JSON.stringify(Object.keys(lock)) !== JSON.stringify(sqlFiles)) throw new Error('Unexpected SQL allowlist');
 for (const file of sqlFiles) {
  if (sha256(await readFile(path.join(directory, file))) !== lock[file]) throw new Error(`SQL checksum mismatch: ${file}`);
 }
 return sha256(JSON.stringify(lock));
}
export function docker(args, input = '') {
 return new Promise((resolve, reject) => {
  const child = spawn('docker', args, { cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Docker operation exceeded 120 seconds')); }, 120_000);
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.on('error', () => {});
  child.on('error', error => { clearTimeout(timeout); reject(error); });
  child.on('close', code => {
   clearTimeout(timeout);
   if (code !== 0) reject(new Error(`Docker operation failed (${code}): ${stderr.slice(-6000)}`));
   else resolve(stdout.trim());
  });
  child.stdin.end(input);
 });
}

async function main() {
 if (process.argv.length !== 2) throw new Error('This runner accepts no SQL, paths, credentials or CLI options');
 const dependency = JSON.parse(await readFile(path.join(directory, 'dependencies.lock.json'), 'utf8'));
 if (process.versions.node !== dependency.node) throw new Error(`Use pinned Node ${dependency.node}`);
 const rule = await verifyLocks(); // All checks before starting the database.
 const image = JSON.parse(await docker(['image', 'inspect', dependency.image]))[0];
 if (image.Id !== dependency.imageId || image.Architecture !== 'amd64') throw new Error('Cached image identity mismatch');
 await mkdir(path.join(root, 'secrets'), { recursive: true });
 try {
  await writeFile(path.join(root, 'secrets/synthetic-poc-password.txt'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
 } catch (error) { if (error.code !== 'EEXIST') throw error; }
 const compose = ['compose', '-f', path.join(directory, 'compose.yaml')];
 await docker([...compose, 'config', '--quiet']);
 await docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '90', '--pull', 'never']);
 const container = await docker([...compose, 'ps', '-q', 'warehouse']);
 if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error('Expected exactly one PoC container');
 const version = await docker(['exec', container, 'postgres', '--version']);
 if (version !== `postgres (PostgreSQL) ${dependency.postgres}`) throw new Error('PostgreSQL runtime mismatch');
 const token = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '_' + randomBytes(4).toString('hex');
 const db = databaseName(token);
 await docker(['exec', '-u', 'postgres', container, 'createdb', '--', db]);
 const psql = input => docker(['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-qAt',
  '--set', 'ON_ERROR_STOP=1', '--set', `rule_version=${rule}`, '--dbname', db], input);
 const result = { database: db, startedAt: new Date().toISOString(), ruleSha256: rule, postgres: version,
  source: 'synthetic only', status: 'RUNNING' };
 const output = path.join(root, 'work', `synthetic-p0-${token}.json`);
 await mkdir(path.dirname(output), { recursive: true });
 try {
  const migrationLock = JSON.parse(await readFile(path.join(directory, 'sql.lock.json'), 'utf8'));
  let migration = 'BEGIN; CREATE TABLE public.p0_migration(version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());\n';
  for (const file of sqlFiles.slice(0, 3)) {
   migration += await readFile(path.join(directory, file), 'utf8');
   migration += `\nINSERT INTO public.p0_migration(version,sha256) VALUES ('${file}','${migrationLock[file]}');\n`;
  }
  await psql(migration + 'COMMIT;');
  // Report login passwords are runtime-only: hex bytes sent on stdin, never in argv,
  // migration files, logs or run reports. V003 provisions the LOGIN roles without secrets.
  await psql(`ALTER ROLE p0_report_a LOGIN PASSWORD '${randomBytes(24).toString('hex')}';\n`
   + `ALTER ROLE p0_report_b LOGIN PASSWORD '${randomBytes(24).toString('hex')}';`);
  for (const file of sqlFiles.slice(3)) await psql(await readFile(path.join(directory, file), 'utf8'));
  const checked = (await psql('SELECT label FROM verification.result ORDER BY label;')).split('\n').filter(Boolean);
  // Login identities must really resolve to the database role in a separate session.
  const scram = await psql(`SELECT count(*) FROM pg_authid WHERE rolname LIKE 'p0_report_%' AND rolpassword LIKE 'SCRAM-SHA-256$%';`);
  if (scram !== '2') throw new Error('Report login passwords are not SCRAM-stored');
  const loginProbe = await docker(['exec', '-u', 'postgres', container, 'psql', '-X', '-qAt', '--dbname', db,
   '-U', 'p0_report_a', '-c', 'SELECT session_user;']);
  if (loginProbe !== 'p0_report_a') throw new Error('Report login session identity mismatch');
  const localAuth = await psql(`SELECT coalesce(string_agg(DISTINCT auth_method::text, ','), 'none') FROM pg_hba_file_rules WHERE type='local';`);
  // Real independent database sessions contend on the same release pointer.
  const candidates = await psql(`
   SELECT warehouse.build('2026-02-06 00:00+08', :'rule_version',true);
   SELECT warehouse.build('2026-02-06 00:00+08', :'rule_version',true);
   INSERT INTO warehouse.approval(release_id,approver,reason)
    SELECT release_id,'synthetic-approver','concurrent publication simulation' FROM warehouse.release WHERE state='READY' AND input_cutoff='2026-02-06 00:00+08';
   INSERT INTO warehouse.flow_exception(release_id,domain,approver,reason)
    SELECT release_id,'devops','synthetic-approver','concurrent publication simulation' FROM warehouse.release WHERE state='READY' AND input_cutoff='2026-02-06 00:00+08';
  `);
  const ids = candidates.split('\n').filter(x => /^\d+$/.test(x));
  if (ids.length !== 2) throw new Error('Expected two concurrent candidates');
  const active = await psql('SELECT release_id FROM warehouse.active_release;');
  if (!/^\d+$/.test(active)) throw new Error('Invalid active release identifier');
  const outcomes = await Promise.allSettled(ids.map(id => psql(`BEGIN; SELECT warehouse.publish(${id},${active}); SELECT pg_sleep(1); COMMIT;`)));
  if (outcomes.filter(x => x.status === 'fulfilled').length !== 1 ||
   !outcomes.some(x => x.status === 'rejected' && /compare-and-swap failed/.test(x.reason.message))) {
   throw new Error('Concurrent publication did not produce exactly one winner');
  }
  const current = await psql('SELECT release_id FROM warehouse.active_release;');
  const winner = ids[outcomes.findIndex(x => x.status === 'fulfilled')];
  if (current !== winner) throw new Error('Active pointer differs from committed winner');
  result.assertions = [...checked, 'two concurrent sessions publish exactly one winner'];
  result.passed = result.assertions.length;
  result.activeRelease = current;
  result.monthlyMetrics = JSON.parse(await psql(`SELECT json_agg(m ORDER BY release_id,domain,team) FROM warehouse.metric m WHERE period_id='2026-01';`));
  result.reportLogin = {
   passwordStorage: 'SCRAM-SHA-256 (verified for p0_report_a/p0_report_b)',
   loginProbeSession: loginProbe,
   localSocketAuthMethod: localAuth,
   boundaryNote: 'Image-local socket auth is trust; password+TLS enforcement over TCP is production work, not validated here.',
  };
  result.status = 'PASS';
 } catch (error) {
  result.status = 'FAIL'; result.error = error.message; throw error;
 } finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(`Experiment ${result.status}: ${db}; results retained at ${output}`);
 }
 console.log(`PASS: ${result.passed} SQL/integration assertions; no source access, host port or NAS deployment.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE = 'sha256:8f51417dfdbf3f6c2434b2fff64530fba6e0f244c616cb62846faaaf18f65135';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYSTEM_CA = '/etc/pki/tls/certs/ca-bundle.crt';

// MySQL option-file double-quoted values. Never reuse this for SQL literals.
export function optionValue(value) {
  if (typeof value !== 'string' || /[\0\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) {
    throw new Error('INVALID_OPTION_VALUE');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

export function makeOptions(config, caPath = SYSTEM_CA) {
  if (config.engine?.toLowerCase() !== 'mysql' ||
      !['host', 'username', 'password'].every(key => typeof config[key] === 'string' && config[key].length > 0) ||
      !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      config.tls?.require_encryption !== true || config.tls?.verify_server_certificate !== true) {
    throw new Error('INVALID_OR_UNSAFE_CONFIG');
  }
  const requested = config.limits?.connect_timeout_seconds ?? 10;
  if (!Number.isInteger(requested) || requested < 1) throw new Error('INVALID_LIMIT');
  return ['[client]', `host=${optionValue(config.host)}`, `port=${config.port}`,
    `user=${optionValue(config.username)}`, `password=${optionValue(config.password)}`,
    'protocol=TCP', 'ssl-mode=VERIFY_IDENTITY', `ssl-ca=${optionValue(caPath)}`,
    `connect-timeout=${Math.min(requested, 10)}`, 'local-infile=0', 'default-character-set=utf8mb4', ''].join('\n');
}

export function classifyResult(result) {
  const stderr = String(result.stderr ?? '');
  const match = stderr.match(/ERROR\s+(\d{3,5})\b/);
  const code = match ? Number(match[1]) : null;
  if (result.error?.code === 'ETIMEDOUT') return { status: 'failed', category: 'CLIENT_TIMEOUT', mysql_error_code: code };
  if (result.error?.code === 'ENOENT') return { status: 'failed', category: 'DOCKER_NOT_FOUND', mysql_error_code: null };
  if (result.status === 0 && !result.error) return { status: 'succeeded', category: 'OK', mysql_error_code: null };
  const category = code === 2026 ? 'TLS_CONNECTION_FAILED'
    : [1044, 1045, 1698].includes(code) ? 'ACCESS_DENIED'
    : [2002, 2003, 2005, 2013].includes(code) ? 'CONNECTION_FAILED'
    : code === 3024 ? 'QUERY_TIMEOUT'
    : code ? 'MYSQL_QUERY_FAILED' : 'DOCKER_OR_CLIENT_FAILED';
  const safe = { status: 'failed', category, mysql_error_code: code };
  if (code === 2026) safe.tls_reason = /self[- ]signed/i.test(stderr) ? 'SELF_SIGNED_CERTIFICATE'
    : /certificate verify failed|unable to get.*issuer|unable to verify/i.test(stderr) ? 'CERTIFICATE_TRUST_FAILED'
    : /identity|hostname|IP address mismatch/i.test(stderr) ? 'SERVER_IDENTITY_FAILED'
    : 'TLS_FAILURE_UNCLASSIFIED';
  return safe;
}

export async function runDiscovery() {
  const report = { recorded_at: new Date().toISOString(), image_id: IMAGE,
    authorization: 'existing-test-account-all-visible-schemas-metadata-only',
    tls_mode: 'VERIFY_IDENTITY', source_modified: false };
  let temporary;
  let containerName;
  let stage = 'CONFIG';
  try {
    const config = JSON.parse(await readFile(path.join(ROOT, 'secrets/devops-db.local.json'), 'utf8'));
    // Validate before materializing any credential. Schema scope is this investigation's
    // explicit user authorization, not a generic interpretation of an empty allowlist.
    makeOptions(config);
    const sqlLimit = config.limits?.query_timeout_seconds ?? 15;
    if (!Number.isInteger(sqlLimit) || sqlLimit < 1) throw new Error('INVALID_LIMIT');
    const sql = (await readFile(path.join(ROOT, 'tools/sql/mysql-discover-metadata.sql'), 'utf8'))
      .replaceAll('15000', String(Math.min(sqlLimit, 15) * 1000));
    temporary = await mkdtemp(path.join(ROOT, 'secrets/mysql-client-'));
    if (temporary.includes(',')) throw new Error('UNSUPPORTED_MOUNT_PATH');
    let caPath = SYSTEM_CA;
    if (config.tls.ca_cert_file) {
      // Relative certificate paths resolve against the project, never the container cwd.
      const ca = await readFile(path.resolve(ROOT, config.tls.ca_cert_file));
      await writeFile(path.join(temporary, 'ca.pem'), ca, { mode: 0o600, flag: 'wx' });
      caPath = '/run/secrets/mysql/ca.pem';
    }
    await writeFile(path.join(temporary, 'client.cnf'), makeOptions(config, caPath), { mode: 0o600, flag: 'wx' });
    containerName = `bydw-discovery-${randomUUID()}`;
    stage = 'CLIENT';
    const result = spawnSync('docker', ['run', '--rm', '--pull=never', '--name', containerName,
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64', '--interactive',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=1m,mode=0700',
      '--mount', `type=bind,source=${temporary},target=/run/secrets/mysql,readonly`,
      // Windows bind mounts may appear world-writable; MySQL ignores such option files.
      // Copy only our generated file into container tmpfs with restrictive permissions.
      '--entrypoint', '/bin/sh', IMAGE, '-c',
      'umask 077; cp /run/secrets/mysql/client.cnf /tmp/client.cnf && chmod 600 /tmp/client.cnf && exec mysql --defaults-extra-file=/tmp/client.cnf --batch --skip-reconnect'],
    { input: sql, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false });
    Object.assign(report, classifyResult(result));
    // Preserve successful and partial metadata privately; never dump stdout to terminal.
    if (result.stdout) {
      await mkdir(path.join(ROOT, 'work'), { recursive: true });
      const name = `mysql-metadata-${containerName.slice('bydw-discovery-'.length)}.tsv`;
      await writeFile(path.join(ROOT, 'work', name), result.stdout, { mode: 0o600, flag: 'wx' });
      report.local_metadata_file = `work/${name}`;
      report.metadata_may_be_partial = true;
    }
  } catch {
    Object.assign(report, { status: 'failed', category: `${stage}_LOCAL_FAILURE` });
  } finally {
    // A killed Docker CLI can leave its container running: clean only our unique name.
    if (containerName) {
      const cleanup = spawnSync('docker', ['rm', '--force', containerName],
        { encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false });
      report.container_cleanup_ok = !cleanup.error && (cleanup.status === 0 || /No such container/i.test(cleanup.stderr ?? ''));
    }
    if (temporary) {
      const parent = path.resolve(ROOT, 'secrets');
      if (path.dirname(path.resolve(temporary)) !== parent || !path.basename(temporary).startsWith('mysql-client-')) {
        report.credential_cleanup_ok = false;
      } else {
        try { await rm(temporary, { recursive: true, force: true }); report.credential_cleanup_ok = true; }
        catch { report.credential_cleanup_ok = false; }
      }
    }
  }
  await mkdir(path.join(ROOT, 'work'), { recursive: true });
  await writeFile(path.join(ROOT, 'work/mysql-discovery-result.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_ALLOWED');
    const report = await runDiscovery();
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'succeeded' || report.credential_cleanup_ok === false || report.container_cleanup_ok === false) process.exitCode = 1;
  } catch { console.error('DISCOVERY_LOCAL_FAILURE'); process.exitCode = 1; }
}

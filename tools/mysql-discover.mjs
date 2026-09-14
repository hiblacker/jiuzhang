import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDetailsSql, parseDetailsOutput } from './mysql-metadata.mjs';

import { buildSamplingSql, buildStatusSamplingSql, parseSamplingOutput, summarizeSamples, summarizeStatusSamples, sourceFingerprint, validateSeedReference } from './devops-history-sampling.mjs';

export const IMAGE = 'mysql:8.0.43';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYSTEM_CA = '/etc/pki/tls/certs/ca-bundle.crt';

// MySQL option-file double-quoted values. Never reuse this for SQL literals.
export function optionValue(value) {
  if (typeof value !== 'string' || /[\0\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) {
    throw new Error('INVALID_OPTION_VALUE');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

export function makeOptions(config, caPath = SYSTEM_CA, allowUnverifiedTestTls = false) {
  if (typeof allowUnverifiedTestTls !== 'boolean') throw new Error('INVALID_TLS_EXCEPTION');
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
    'protocol=TCP', `ssl-mode=${allowUnverifiedTestTls ? 'REQUIRED' : 'VERIFY_IDENTITY'}`,
    ...(allowUnverifiedTestTls ? [] : [`ssl-ca=${optionValue(caPath)}`]),
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

export function inspectSession(text) {
  const cipher = text.match(/^Ssl_cipher\t([^\r\n]+)$/m)?.[1];
  const version = text.match(/^Ssl_version\t([^\r\n]+)$/m)?.[1];
  return {
    session_tls_confirmed: Boolean(cipher?.trim()),
    session_tls_version: /^TLSv[0-9.]+$/.test(version ?? '') ? version : null,
    session_read_only_confirmed: /^session_read_only\tselect_timeout_ms\r?\n1\t[0-9]+$/m.test(text),
  };
}

export async function runDiscovery({ allowUnverifiedTestTls = false, details = false, samplePhase = null, allowTestBusinessSamples = false } = {}) {
  const report = { run_id: randomUUID(), recorded_at: new Date().toISOString(), image_id: IMAGE,
    authorization: samplePhase ? 'user-continue-bounded-test-business-samples' : 'existing-test-account-all-visible-schemas-metadata-only',
    phase: samplePhase ? `sample-${samplePhase}` : details ? 'details' : 'inventory',
    completeness_scope: samplePhase ? 'bounded-convenience-sample-not-full-history' : 'selected-metadata-queries-not-entire-source',
    tls_mode: allowUnverifiedTestTls ? 'REQUIRED' : 'VERIFY_IDENTITY',
    tls_identity_exception: allowUnverifiedTestTls ? 'user-confirmed-test-discovery-only' : null, source_modified: false };
  let temporary;
  let containerName;
  let stage = 'CONFIG';
  let configHash;
  let sampleRows;
  let sampleSchema;
  try {
    if (typeof details !== 'boolean' || ![null,'seeds','history','statuses'].includes(samplePhase) || typeof allowTestBusinessSamples !== 'boolean' || (samplePhase && (details || !allowTestBusinessSamples)) || (!samplePhase && allowTestBusinessSamples)) throw new Error('INVALID_PHASE_OR_AUTHORIZATION');
    const configBytes = await readFile(path.join(ROOT, 'secrets/devops-db.local.json'));
    configHash = createHash('sha256').update(configBytes).digest('hex');
    const config = JSON.parse(configBytes.toString('utf8'));
    sampleSchema = config.database;
    // Validate before materializing any credential. Schema scope is this investigation's
    // explicit user authorization, not a generic interpretation of an empty allowlist.
    makeOptions(config, SYSTEM_CA, allowUnverifiedTestTls);
    const sqlLimit = config.limits?.query_timeout_seconds ?? 15;
    if (!Number.isInteger(sqlLimit) || sqlLimit < 1) throw new Error('INVALID_LIMIT');
    const timeoutMs = Math.min(sqlLimit, 15) * 1000;
    let sql = details
      ? buildDetailsSql(JSON.parse(await readFile(path.join(ROOT, 'work/mysql-metadata-targets.json'), 'utf8')), timeoutMs)
      : (await readFile(path.join(ROOT, 'tools/sql/mysql-discover-metadata.sql'), 'utf8')).replaceAll('15000', String(timeoutMs));
    if (samplePhase) {
      const dictionary = JSON.parse(await readFile(path.join(ROOT, 'work/mysql-source-dictionary.json'), 'utf8'));
      let seeds;
      if (samplePhase === 'history') {
        const pointer = JSON.parse(await readFile(path.join(ROOT, 'work/mysql-sample-seeds.json'), 'utf8'));
        validateSeedReference(pointer, config.database, configHash);
        const bytes = await readFile(path.join(ROOT, 'work', pointer.file));
        if (createHash('sha256').update(bytes).digest('hex') !== pointer.sha256) throw new Error('SEED_HASH_MISMATCH');
        seeds = JSON.parse(bytes);
      }
      if (samplePhase === 'seeds') await writeFile(path.join(ROOT,'work/mysql-sample-seeds.json'),JSON.stringify({status:'pending',run_id:report.run_id})+'\n',{mode:0o600});
      sql = samplePhase === 'statuses'
        ? buildStatusSamplingSql({schema:config.database,records:dictionary.records,authorized:allowTestBusinessSamples,timeoutMs})
        : buildSamplingSql({schema:config.database,records:dictionary.records,phase:samplePhase,seeds,authorized:allowTestBusinessSamples,timeoutMs});
    }
    report.sql_sha256 = createHash('sha256').update(sql).digest('hex');
    if (samplePhase) report.sampling_module_sha256 = createHash('sha256').update(await readFile(path.join(ROOT,'tools/devops-history-sampling.mjs'))).digest('hex');
    temporary = await mkdtemp(path.join(ROOT, 'secrets/mysql-client-'));
    if (temporary.includes(',')) throw new Error('UNSUPPORTED_MOUNT_PATH');
    let caPath = SYSTEM_CA;
    if (!allowUnverifiedTestTls && config.tls.ca_cert_file) {
      // Relative certificate paths resolve against the project, never the container cwd.
      const ca = await readFile(path.resolve(ROOT, config.tls.ca_cert_file));
      await writeFile(path.join(temporary, 'ca.pem'), ca, { mode: 0o600, flag: 'wx' });
      caPath = '/run/secrets/mysql/ca.pem';
    }
    await writeFile(path.join(temporary, 'client.cnf'), makeOptions(config, caPath, allowUnverifiedTestTls), { mode: 0o600, flag: 'wx' });
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
      const name = `${samplePhase ? 'mysql-sample' : 'mysql-metadata'}-${containerName.slice('bydw-discovery-'.length)}.tsv`;
      await writeFile(path.join(ROOT, 'work', name), result.stdout, { mode: 0o600, flag: 'wx' });
      if (samplePhase) {
        report.local_sample_file = `work/${name}`;
        sampleRows = parseSamplingOutput(result.stdout);
        report.sample_summary = samplePhase === 'statuses' ? summarizeStatusSamples(sampleRows) : summarizeSamples(sampleRows);
        await writeFile(path.join(ROOT, 'work', name.replace('.tsv','.json')), JSON.stringify(sampleRows,null,2)+'\n', {mode:0o600,flag:'wx'});
      } else report.local_metadata_file = `work/${name}`;
      if (samplePhase) report.sample_may_be_partial = true;
      else report.metadata_may_be_partial = true;
      if (details) {
        const parsed = parseDetailsOutput(result.stdout);
        report.metadata_record_count = parsed.records.length;
        report.capped_group_count = parsed.capped_groups.length;
        report.metadata_may_be_partial = report.status !== 'succeeded' || parsed.capped_groups.length > 0;
        await writeFile(path.join(ROOT, 'work', name.replace('.tsv', '.json')), JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      }
    }
    Object.assign(report, inspectSession(result.stdout ?? ''));
    if (report.status === 'succeeded' && (!report.session_tls_confirmed || !report.session_read_only_confirmed)) {
      report.status = 'failed'; report.category = 'SESSION_GUARD_NOT_CONFIRMED';
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
  if (configHash) {
    report.connection_file_unchanged = createHash('sha256').update(await readFile(path.join(ROOT, 'secrets/devops-db.local.json'))).digest('hex') === configHash;
    if (!report.connection_file_unchanged) { report.status='failed'; report.category='CONNECTION_FILE_CHANGED'; }
  }
  if (samplePhase === 'seeds' && report.status === 'succeeded' && report.container_cleanup_ok && report.credential_cleanup_ok) {
    const file=path.basename(report.local_sample_file).replace('.tsv','.json');
    const bytes=await readFile(path.join(ROOT,'work',file));
    await writeFile(path.join(ROOT,'work/mysql-sample-seeds.json'),JSON.stringify({status:'ready',run_id:report.run_id,config_fingerprint:configHash,source_fingerprint:sourceFingerprint(sampleSchema),file,sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n',{mode:0o600});
  }
  await mkdir(path.join(ROOT, 'work'), { recursive: true });
  await writeFile(path.join(ROOT, samplePhase ? 'work/mysql-sampling-result.json' : 'work/mysql-discovery-result.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (samplePhase) await writeFile(path.join(ROOT,`work/mysql-sampling-run-${report.run_id}.json`),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (new Set(args).size !== args.length || args.some(arg => !['--allow-unverified-test-tls', '--details', '--sample-devops-seeds', '--sample-devops-history', '--sample-devops-statuses', '--allow-test-business-samples'].includes(arg))) throw new Error('INVALID_ARGUMENT');
    if ([args.includes('--sample-devops-seeds'),args.includes('--sample-devops-history'),args.includes('--sample-devops-statuses')].filter(Boolean).length > 1) throw new Error('INVALID_ARGUMENT');
    const report = await runDiscovery({ samplePhase: args.includes('--sample-devops-seeds') ? 'seeds' : args.includes('--sample-devops-history') ? 'history' : args.includes('--sample-devops-statuses') ? 'statuses' : null, allowTestBusinessSamples: args.includes('--allow-test-business-samples'), allowUnverifiedTestTls: args.includes('--allow-unverified-test-tls'), details: args.includes('--details') });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'succeeded' || report.credential_cleanup_ok === false || report.container_cleanup_ok === false) process.exitCode = 1;
  } catch { console.error('DISCOVERY_LOCAL_FAILURE'); process.exitCode = 1; }
}

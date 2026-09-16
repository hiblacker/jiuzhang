import { spawn } from 'node:child_process';
import { mkdir, readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, readJson, withLock, digest } from '../../tools/lake-runtime.mjs';
import { buildManifestRequest, buildInventoryRequest } from '../../tools/lake-register.mjs';
import { verifyCurrentSchema } from '../../tools/lake-discover.mjs';
import { fileAssets, apiAssets } from '../../tools/lake-assets.mjs';
import { validateManagedRegistry, managedProfile, probeManaged } from './managed-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CODE = /^[a-z][a-z0-9_-]{1,99}$/u;
const INSTANCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = code => { throw new Error(code); };

export function validateRegistry(value) {
  if (value?.version === 2) {
    validateManagedRegistry(value);
    if(Object.keys(value.profiles??{}).length>99)fail('TOO_MANY_LEGACY_PROFILES');
    if (Object.keys(value.profiles ?? {}).length) validateRegistry({ ...value, version: 1 });
    return { ...value, profiles: value.profiles ?? {} };
  }
  if (value?.version !== 1 || !path.isAbsolute(value.lakeRoot ?? '')
      || !value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles)) fail('INVALID_RUNTIME_REGISTRY');
  const entries = Object.entries(value.profiles);
  if (!entries.length || entries.length > 100) fail('INVALID_RUNTIME_REGISTRY');
  for (const [ref, profile] of entries) {
    if (!CODE.test(ref) || !profile || !['MYSQL_SNAPSHOT', 'FILE_SCAN', 'REST_PULL'].includes(profile.kind)
        || !CODE.test(profile.sourceCode ?? '')) fail('INVALID_RUNTIME_PROFILE');
    const fields = profile.kind === 'MYSQL_SNAPSHOT' ? ['config', 'inventory'] : profile.kind === 'FILE_SCAN' ? ['inboxRoot'] : ['config'];
    for (const field of fields) if (!path.isAbsolute(profile[field] ?? '')) fail('RUNTIME_PATH_MUST_BE_ABSOLUTE');
    if (profile.deliveryContract && !path.isAbsolute(profile.deliveryContract)) fail('RUNTIME_PATH_MUST_BE_ABSOLUTE');
  }
  return value;
}

export function parseArgs(args) {
  const options = { registry: null, controlApi: process.env.CONTROL_API_BASE_URL ?? 'http://127.0.0.1:8080',
    instance: process.env.WORKER_INSTANCE_ID ?? 'lake-worker', once: false, pollMs: 2000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--once') options.once = true;
    else if (['--registry', '--control-api', '--instance', '--poll-ms'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT');
      if (arg === '--registry') options.registry = path.resolve(value);
      if (arg === '--control-api') options.controlApi = value;
      if (arg === '--instance') options.instance = value;
      if (arg === '--poll-ms') options.pollMs = Number(value);
    } else fail('INVALID_ARGUMENT');
  }
  if (!options.registry || !INSTANCE.test(options.instance) || !Number.isInteger(options.pollMs) || options.pollMs < 250 || options.pollMs > 60000) fail('INVALID_WORKER_OPTIONS');
  const url = new URL(options.controlApi);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('UNSAFE_CONTROL_API_URL');
  options.controlApi = url.toString().replace(/\/+$/u, '');
  return options;
}

async function request(options, route, body) {
  const response = await fetch(options.controlApi + '/api/v1/lake/' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}`,
      'x-worker-instance': options.instance }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let code = `CONTROL_API_HTTP_${response.status}`;
    try { const result = await response.json(); if (/^[A-Z0-9_:-]{1,120}$/u.test(result.code)) code = result.code; } catch {}
    fail(code);
  }
  return response.json();
}

async function child(script, args, signal, extraEnv = {}) {
  const processGroup = process.platform !== 'win32';
  const running = spawn(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'], detached: processGroup, env: { ...process.env, ...extraEnv } });
  let stdout = '', stderr = '', killTimer;
  running.stdout.on('data', bytes => { stdout = (stdout + bytes.toString()).slice(0, 20000); });
  running.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(0, 4000); });
  const stop = () => {
    const kill = signal => { try { process.kill(processGroup ? -running.pid : running.pid, signal); } catch {} };
    kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 2000);
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    const code = await new Promise((resolve, reject) => { running.once('error', reject); running.once('close', resolve); });
    if (signal.aborted) fail('WORKER_EXECUTION_ABORTED');
    if (code !== 0) {
      let completed; try { completed = JSON.parse(stdout); } catch {}
      if (completed?.state === 'FAILED' && completed.batchId) return completed;
      let detail; try { detail = JSON.parse(stderr); } catch {}
      fail(/^[A-Z0-9_:-]{1,120}$/u.test(detail?.errorCode ?? '') ? detail.errorCode : 'ADAPTER_EXECUTION_FAILED');
    }
    let result; try { result = JSON.parse(stdout); } catch { fail('ADAPTER_PROTOCOL_FAILED'); }
    if (!['COMPLETE', 'INCOMPLETE', 'NOT_OBSERVED'].includes(result.state)) fail('ADAPTER_PROTOCOL_FAILED');
    return result;
  } finally { clearTimeout(killTimer); signal.removeEventListener('abort', stop); }
}

async function execute(registry, task, signal, options) {
  let profile = task.configurationJson ? await managedProfile(registry, task) : registry.profiles[task.runtime_ref];
  if (!profile || profile.kind !== task.kind || profile.sourceCode !== task.source_code) fail('RUNTIME_SCOPE_MISMATCH');
  if (task.configurationJson && task.kind === 'REST_PULL') profile.environment = { ...profile.environment,
    LAKE_REQUEST_BUDGET: JSON.stringify({url:options.controlApi,worker:options.instance,scope:'execution',id:task.id,leaseToken:task.leaseToken}) };
  const batch = `exec-${task.id}`;
  const common = ['--lake-root', registry.lakeRoot];
  let result, manifest;
  if (task.kind === 'MYSQL_SNAPSHOT') {
    if (task.runtime_inventory) {
      const inventory = path.join(registry.lakeRoot, 'inventories', profile.sourceCode, `${task.inventory_version}.json`);
      await mkdir(path.dirname(inventory), { recursive: true, mode: 0o700 });
      const prior = await readJson(inventory, null);
      if (prior && digest(JSON.stringify(prior)) !== digest(JSON.stringify(task.runtime_inventory))) fail('APPROVED_INVENTORY_IMMUTABLE');
      if (!prior) await atomicJson(inventory, task.runtime_inventory);
      profile = { ...profile, inventory };
    }
    await verifyCurrentSchema(profile, registry.lakeRoot);
    if (signal.aborted) fail('WORKER_EXECUTION_ABORTED');
    const args = [...common, '--daily', '--window', task.business_date, '--source-code', profile.sourceCode,
      '--batch-id', batch, '--config', profile.config, '--inventory', profile.inventory];
    if (profile.allowUnverifiedTestTls === true) args.push('--allow-unverified-test-tls');
    if (profile.mysqlCli) args.push('--mysql-cli', profile.mysqlCli);
    if (profile.maxSnapshotBytes !== undefined) args.push('--max-snapshot-bytes', String(profile.maxSnapshotBytes));
    result = await child('tools/lake-ingest.mjs', args, signal);
    await verifyCurrentSchema(profile, registry.lakeRoot);
    if (signal.aborted) fail('WORKER_EXECUTION_ABORTED');
    const local = path.join(registry.lakeRoot, 'batches', result.batchId, 'batch.json');
    manifest = await buildManifestRequest(local, await readJson(local), { lakeRoot: registry.lakeRoot,
      sourceCode: profile.sourceCode, planVersion: task.inventory_version });
    manifest.runKey = `execution:${task.id}`; manifest.attempt = task.attempt; manifest.revision = task.revision;
  } else if (task.kind === 'FILE_SCAN') {
    if (task.processing_input?.batchId) {
      const settings = profile.deliveryContract ? (await readJson(profile.deliveryContract)).parser ?? {} : {};
      const args = [...common, '--batch-id', task.processing_input.batchId, '--source-code', profile.sourceCode,
        '--delivery-date', task.business_date, '--parser-settings', JSON.stringify(settings)];
      if (profile.parserPython) args.push('--parser-python', profile.parserPython);
      result = await child('tools/file-reprocess.mjs', args, signal);
    } else {
    const inbox = profile.datePartitioned ? path.join(profile.inboxRoot, task.business_date) : profile.inboxRoot;
    const args = [...common, '--inbox', inbox, '--delivery-date', task.business_date, '--source-code', profile.sourceCode, '--batch-id', batch];
    if (profile.assumeReady === true) args.push('--assume-ready');
    if (profile.parserPython) args.push('--parser-python', profile.parserPython);
    if (profile.maxRows) args.push('--max-rows', String(profile.maxRows));
    if (profile.maxFileBytes) args.push('--max-file-bytes', String(profile.maxFileBytes));
    if (profile.deliveryContract) args.push('--contract', profile.deliveryContract);
    result = await child(profile.deliveryContract ? 'tools/file-delivery.mjs' : 'tools/file-ingest.mjs', args, signal);
    }
    result.assets = result.batchId ? await fileAssets(registry.lakeRoot, result.batchId, result.contractSha256) : [];
    if (task.processing_input?.batchId && profile.deliveryContract && result.state === 'COMPLETE') {
      const contract = await readJson(profile.deliveryContract);
      const evidence = task.processing_input.deliveryEvidence;
      const ledger = await readJson(path.join(registry.lakeRoot, 'delivery-ledgers', profile.sourceCode, `${task.business_date}.json`), null);
      const previous = ledger?.revisions?.at(-1);
      if (!contract.allowEmpty && result.assets.every(asset => asset.rows === 0)) {
        result.state = 'INCOMPLETE'; result.errorCode = 'EMPTY_DELIVERY_NOT_APPROVED';
      } else if (!evidence?.signature || (previous && previous.signature !== evidence.signature && contract.mode !== 'EVENT'
          && !(contract.mode === 'MANIFEST' ? evidence.revision > previous.revision : contract.allowContentRevision === true))) {
        result.state = 'INCOMPLETE'; result.errorCode = 'DELIVERY_REVISION_REVIEW_REQUIRED';
      }
    }
  } else {
    if (task.processing_input?.batchId) {
      result = await child('tools/api-reprocess.mjs', [...common, '--config', profile.config, '--source-code', profile.sourceCode,
        '--window', task.business_date, '--batch-id', task.processing_input.batchId], signal, profile.environment);
    } else {
    try { result = await child('tools/rest-ingest.mjs', [...common, '--config', profile.config,
      '--window', task.business_date, '--batch-id', batch], signal, profile.environment); }
    catch (error) {
      const failed = await readJson(path.join(registry.lakeRoot, 'api', profile.sourceCode, batch, 'batch.failed.json'), null);
      if (!failed || signal.aborted) throw error;
      result = { batchId: batch, state: 'FAILED', errorCode: failed.errorCode };
    }
    }
    result.assets = await apiAssets(registry.lakeRoot, profile.sourceCode, result.batchId);
  }
  return { state: result.state === 'COMPLETE' ? 'COMPLETE' : result.state === 'FAILED' ? 'FAILED' : 'INCOMPLETE',
    errorCode: result.errorCode ?? (result.state === 'NOT_OBSERVED' ? 'DELIVERY_NOT_OBSERVED' : null), result, manifest: manifest ?? null };
}

async function flush(options, directory) {
  for (const name of (await readdir(directory)).filter(name => /^(?:probe-)?\d+\.json$/u.test(name)).sort()) {
    const file = path.join(directory, name), receipt = await readJson(file);
    if (receipt.acknowledged || receipt.abandoned) continue;
    try {
      receipt.response = await request(options, `${receipt.probeId ? 'probes' : 'executions'}/${receipt.probeId ?? receipt.executionId}/finish`, receipt.completion);
      receipt.acknowledged = true; await atomicJson(file, receipt);
    } catch (error) {
      if (['EXECUTION_LEASE_LOST', 'EXECUTION_RESULT_IMMUTABLE', 'PROBE_LEASE_LOST', 'PROBE_RESULT_IMMUTABLE'].includes(error.message)) {
        receipt.abandoned = error.message; await atomicJson(file, receipt);
      } else return false;
    }
  }
  return true;
}

export async function runOnce(options, registry) {
  const outbox = path.join(registry.lakeRoot, 'worker-outbox', options.instance);
  await mkdir(outbox, { recursive: true, mode: 0o700 });
  if(registry.version===2){
    const storage=await statfs(registry.lakeRoot,{bigint:true});
    await request(options,'environment-heartbeat',{environment:registry.environment,availableBytes:String(storage.bavail*storage.bsize),totalBytes:String(storage.blocks*storage.bsize)});
  }
  if (!await flush(options, outbox)) return { state: 'OUTBOX_PENDING' };
  const runtimeRefs = [...Object.keys(registry.profiles), ...(registry.version === 2 ? [`managed-${registry.environment}`] : [])];
  const turnFile = path.join(outbox,'dispatch-turn.json');
  const turn = await readJson(turnFile,{preferProbe:true});
  let task;
  if(registry.version===2&&!turn.preferProbe)task=await request(options,'executions/claim',{runtimeRefs});
  if (registry.version === 2 && (!task || task.state==='IDLE')) {
    const probe = await request(options, 'probes/claim', { environment: registry.environment });
    if (probe.state !== 'IDLE') {
      let completion;
      try { completion = { state: 'COMPLETE', result: await probeManaged(registry, probe,
        {url:options.controlApi,worker:options.instance,scope:'probe',id:probe.id,leaseToken:probe.leaseToken}) }; }
      catch (error) { completion = { state: 'FAILED', result: null, errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'MANAGED_PROBE_FAILED' }; }
      const receiptFile=path.join(outbox,`probe-${probe.id}.json`);
      await atomicJson(receiptFile,{probeId:probe.id,completion:{...completion,leaseToken:probe.leaseToken},acknowledged:false});
      await atomicJson(turnFile,{preferProbe:false});
      await flush(options,outbox);
      const receipt=await readJson(receiptFile);
      return { state:receipt.abandoned?'LEASE_LOST':receipt.acknowledged?receipt.response.state:'OUTBOX_PENDING',probeId:probe.id };
    }
  }
  if(!task||task.state==='IDLE')task=await request(options, 'executions/claim', { runtimeRefs });
  if (task.state === 'IDLE') return task;
  if(registry.version===2)await atomicJson(turnFile,{preferProbe:true});
  const abort = new AbortController();
  let heartbeatBusy = false, cancelled = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy || abort.signal.aborted) return;
    heartbeatBusy = true;
    try {
      const result = await request(options, `executions/${task.id}/heartbeat`, { leaseToken: task.leaseToken });
      if (result.state === 'CANCEL_REQUESTED') { cancelled = true; abort.abort(); }
    } catch { abort.abort(); } finally { heartbeatBusy = false; }
  }, 15000);
  const timeout = setTimeout(() => abort.abort(), task.timeout_seconds * 1000);
  const terminate = () => abort.abort();
  process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
  let completion;
  try { completion = await execute(registry, task, abort.signal, options); }
  catch (error) { completion = { state: cancelled ? 'CANCELLED' : 'FAILED',
    errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'WORKER_EXECUTION_FAILED',
    result: error.schemaChange ? { schemaChange: { ...error.schemaChange,
      inventoryRequest: buildInventoryRequest(error.schemaChange.proposedInventory, task.source_code) } } : null, manifest: null }; }
  finally { clearInterval(heartbeat); clearTimeout(timeout); process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', terminate); }
  completion.leaseToken = task.leaseToken;
  await atomicJson(path.join(outbox, `${task.id}.json`), { executionId: task.id, completion, acknowledged: false });
  await flush(options, outbox);
  const receipt = await readJson(path.join(outbox, `${task.id}.json`));
  return { executionId: task.id, state: receipt.abandoned ? 'LEASE_LOST'
    : receipt.acknowledged ? receipt.response.state : 'OUTBOX_PENDING' };
}

export async function run(options) {
  const registry = validateRegistry(await readJson(options.registry));
  options.token = process.env.CONTROL_API_WORKER_TOKEN;
  if (!options.token || options.token.length < 24) fail('WORKER_TOKEN_REQUIRED');
  return withLock(path.join(registry.lakeRoot, `worker-${options.instance}.lock`), async () => {
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    let lastMessage;
    try {
    do {
      let result;
      try { result = await runOnce(options, registry); }
      catch (error) { if (options.once) throw error; result = { state: 'CONTROL_API_UNAVAILABLE' }; }
      const message = JSON.stringify(result);
      if (result.state !== 'IDLE' && message !== lastMessage) console.log(message);
      lastMessage = message;
      if (options.once) return result;
      await pause(options.pollMs);
    } while (!stopping);
    return { state: 'STOPPED' };
    } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await run(parseArgs(process.argv.slice(2))); if (result && !['IDLE','COMPLETE','STOPPED'].includes(result.state)) process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ state: 'FAILED', errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'WORKER_FAILED' })); process.exitCode = 1; }
}

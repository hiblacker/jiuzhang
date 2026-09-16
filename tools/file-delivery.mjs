import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, currentDay, digest, readJson, resolveInside, validateDay, withLock } from './lake-runtime.mjs';
import { formatFor, hashFile, parseArgs as fileArgs, scanDirectory } from './file-ingest.mjs';

const fail = code => { throw new Error(code); };
const exists = file => access(file).then(() => true).catch(() => false);
const relativePath = value => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).some(part => part === '..' || part === '');

export function validateContract(value) {
  if (value?.version !== 1 || !['DAILY_SET','MANIFEST','EVENT'].includes(value.mode)
      || !['DONE','STABLE'].includes(value.readiness ?? 'DONE')) fail('INVALID_DELIVERY_CONTRACT');
  if (value.mode === 'DAILY_SET' && (!Array.isArray(value.expectedFiles) || !value.expectedFiles.length
      || value.expectedFiles.some(file => !relativePath(file)) || new Set(value.expectedFiles).size !== value.expectedFiles.length)) fail('EXPECTED_FILES_REQUIRED');
  if (value.manifestFile !== undefined && !relativePath(value.manifestFile)) fail('INVALID_DELIVERY_MANIFEST_PATH');
  if (value.dueTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value.dueTime)) fail('INVALID_DELIVERY_DUE_TIME');
  const stableMs = value.stableMs ?? 120000, maxFiles = value.maxFiles ?? 1000, maxDepth = value.maxDepth ?? 4, dueDayOffset = value.dueDayOffset ?? 0;
  if (!Number.isInteger(stableMs) || stableMs < 1000 || stableMs > 86400000
      || !Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 10000
      || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16
      || !Number.isInteger(dueDayOffset) || dueDayOffset < 0 || dueDayOffset > 31) fail('INVALID_DELIVERY_LIMIT');
  for (const patterns of [value.include, value.exclude]) if (patterns !== undefined && (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string' || !pattern || pattern.length > 200))) fail('INVALID_FILE_PATTERN');
  return { ...value, readiness: value.readiness ?? 'DONE', stableMs, maxFiles, maxDepth, dueDayOffset, manifestFile: value.manifestFile ?? '_delivery.json' };
}

function matches(value, patterns) {
  return !patterns || patterns.some(pattern => new RegExp('^' + pattern.split('').map(char => char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$', 'u').test(value));
}

async function listFiles(root, contract, current = root, depth = 0, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(current, entry.name), relative = path.relative(root, full);
    if (entry.isDirectory() && depth < contract.maxDepth) await listFiles(root, contract, full, depth + 1, result);
    if (entry.isFile() && relative !== contract.manifestFile && (formatFor(full) || path.extname(full).toLowerCase() === '.xls')
        && matches(relative, contract.include) && !(contract.exclude && matches(relative, contract.exclude))) result.push(relative);
    if (result.length > contract.maxFiles) fail('DELIVERY_BACKLOG_LIMIT');
  }
  return result;
}

function deadline(contract, day) {
  if (!contract.dueTime || contract.mode === 'EVENT') return null;
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + contract.dueDayOffset);
  // The initial delivery calendar is explicitly Asia/Shanghai, never host-local.
  return Date.parse(`${date.toISOString().slice(0, 10)}T${contract.dueTime}:00+08:00`);
}

async function receive(options, contract) {
  const now = options.now ?? Date.now(); const day = validateDay(options.deliveryDate ?? currentDay());
  const directory = path.join(options.lakeRoot, 'delivery-ledgers', options.sourceCode);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ledgerFile = path.join(directory, `${day}.json`);
  const ledger = await readJson(ledgerFile, { version: 1, sourceCode: options.sourceCode, day, revisions: [], observations: {} });
  const due = deadline(contract, day);
  const observation = { observedAt: new Date(now).toISOString(), day, sourceCode: options.sourceCode, state: 'INCOMPLETE', deliveryState: 'NOT_OBSERVED', confidence: contract.readiness === 'STABLE' ? 'HEURISTIC' : 'COMPLETION_SIGNAL' };
  const save = async result => {
    ledger.lastObservation = result; await atomicJson(ledgerFile, ledger); return result;
  };
  let available;
  try { available = await listFiles(options.inbox, contract); }
  catch (error) {
    if (['ENOENT','EACCES','EIO','ENOTDIR'].includes(error.code)) return save({ ...observation, deliveryState: 'DIRECTORY_UNAVAILABLE', errorCode: 'DELIVERY_DIRECTORY_UNAVAILABLE' });
    throw error;
  }
  let members = available.map(file => ({ path: file, logicalId: file })), producerRevision = null, explicitlyEmpty = false, manifestHash = null;
  if (contract.mode === 'DAILY_SET') members = contract.expectedFiles.map(file => ({ path: file, logicalId: file }));
  if (contract.mode === 'MANIFEST') {
    const manifestPath = path.join(options.inbox, contract.manifestFile);
    if (!await exists(manifestPath)) return save({ ...observation, deliveryState: due !== null && now > due ? 'MISSING' : 'NOT_OBSERVED' });
    if (!await exists(`${manifestPath}.done`)) return save({ ...observation, deliveryState: 'WAITING_READY' });
    let manifest;
    try {
      const content = await readFile(await resolveInside(options.inbox, contract.manifestFile)); manifestHash = digest(content);
      const proof = path.join(directory, `${manifestHash}.manifest.json`);
      try { await writeFile(proof, content, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST' || digest(await readFile(proof)) !== manifestHash) throw error; }
      manifest = JSON.parse(content);
    }
    catch { return save({ ...observation, deliveryState: 'FAILED', errorCode: 'INVALID_DELIVERY_MANIFEST' }); }
    if (manifest.deliveryDate !== day || !Number.isInteger(manifest.revision) || manifest.revision < 1
        || !Array.isArray(manifest.files) || manifest.files.length > contract.maxFiles
        || manifest.files.some(file => !relativePath(file.path) || typeof file.logicalId !== 'string' || !file.logicalId || !/^[0-9a-f]{64}$/u.test(file.sha256 ?? ''))
        || new Set(manifest.files.map(file => file.logicalId)).size !== manifest.files.length
        || new Set(manifest.files.map(file => file.path)).size !== manifest.files.length) return save({ ...observation, deliveryState: 'FAILED', manifestHash, errorCode: 'INVALID_DELIVERY_MANIFEST' });
    members = manifest.files; producerRevision = manifest.revision; explicitlyEmpty = manifest.empty === true && !members.length;
    if (!members.length && !explicitlyEmpty) return save({ ...observation, deliveryState: 'FAILED', errorCode: 'EMPTY_DELIVERY_SIGNAL_REQUIRED' });
  }
  const missing = members.filter(member => !available.includes(member.path));
  if (missing.length || (!members.length && !explicitlyEmpty)) return save({ ...observation,
    deliveryState: due !== null && now > due ? (available.length ? 'OVERDUE' : 'MISSING') : available.length ? 'WAITING_READY' : 'NOT_OBSERVED', missingCount: missing.length });
  const ready = [], hashes = [], logicalIds = {}, expectedHashes = {};
  for (const member of members) {
    const full = await resolveInside(options.inbox, member.path), info = await stat(full);
    if (info.size > (options.maxFileBytes ?? 1073741824)) return save({ ...observation, deliveryState: 'FAILED', errorCode: 'FILE_SIZE_LIMIT_EXCEEDED' });
    const previous = ledger.observations[member.path];
    const unchanged = previous && previous.bytes === info.size && previous.mtimeMs === info.mtimeMs;
    const observed = unchanged ? { ...previous, observations: previous.observations + 1 } : { bytes: info.size, mtimeMs: info.mtimeMs, firstSeenAt: now, observations: 1 };
    ledger.observations[member.path] = observed;
    const closed = contract.mode === 'MANIFEST' || await exists(`${full}.done`)
      || (contract.readiness === 'STABLE' && observed.observations >= 2 && now - observed.firstSeenAt >= contract.stableMs);
    if (closed) {
      const identity = await hashFile(full);
      if (member.sha256 && identity.sha256 !== member.sha256) return save({ ...observation, deliveryState: 'WAITING_READY', errorCode: 'DELIVERY_HASH_MISMATCH' });
      ready.push(member.path); hashes.push({ logicalId: member.logicalId, sha256: identity.sha256 }); logicalIds[member.path] = member.logicalId; expectedHashes[member.path] = identity.sha256;
    }
  }
  const waitingCount = members.length - ready.length;
  if (waitingCount && (contract.mode !== 'EVENT' || !ready.length)) return save({ ...observation, deliveryState: 'WAITING_READY', waitingCount });
  members = members.filter(member => ready.includes(member.path));
  const signature = digest(JSON.stringify(hashes.sort((a, b) => a.logicalId.localeCompare(b.logicalId))));
  const previous = ledger.revisions.at(-1);
  const same = previous?.signature === signature;
  const revision = producerRevision ?? (same ? previous.revision : (previous?.revision ?? 0) + 1);
  const contractSha256 = digest(JSON.stringify(contract));
  const sameProcessing = same && previous.contractSha256 === contractSha256 && previous.revision === revision;
  const parsed = members.length ? await scanDirectory({ ...options, deliveryDate: day, onlyRelativePaths: ready,
    logicalIds, expectedHashes, parserContract: contract.parser, parserVersion: contractSha256, assumeReady: true }) : { state: 'COMPLETE', entries: [], batchId: null };
  const result = { ...observation, batchId: parsed.batchId, files: members.length, revision, signature, contractSha256, manifestHash,
    rawState: members.length ? (parsed.entries.every(entry => entry.rawPath) ? 'RECEIVED' : 'INCOMPLETE') : 'EMPTY_CONFIRMED', waitingCount, parsed: parsed.entries.filter(entry => entry.state === 'PARSED').length,
    duplicates: parsed.entries.filter(entry => entry.state === 'DUPLICATE').length, rows: parsed.entries.reduce((sum, entry) => sum + (entry.rows ?? 0), 0) };
  if (parsed.state !== 'COMPLETE') return save({ ...result, state: parsed.state, deliveryState: 'FAILED', errorCode: 'DELIVERY_PARSE_INCOMPLETE' });
  if ((explicitlyEmpty || (result.rows === 0 && result.duplicates === 0)) && !contract.allowEmpty) return save({ ...result, deliveryState: 'REVIEW_REQUIRED', errorCode: 'EMPTY_DELIVERY_NOT_APPROVED' });
  if (previous && contract.mode !== 'EVENT' && !same && (producerRevision !== null ? revision <= previous.revision : contract.allowContentRevision !== true)) return save({ ...result, deliveryState: 'REVIEW_REQUIRED', errorCode: 'DELIVERY_REVISION_REVIEW_REQUIRED' });
  result.state = 'COMPLETE';
  result.deliveryState = sameProcessing ? 'DUPLICATE' : same ? 'REPROCESSED' : previous ? 'REVISED' : explicitlyEmpty ? 'EMPTY_CONFIRMED' : due !== null && now > due ? 'LATE' : 'RECEIVED';
  if (!sameProcessing) ledger.revisions.push({ signature, revision, batchId: parsed.batchId, receivedAt: result.observedAt, contractSha256, manifestHash, rows: result.rows });
  if (waitingCount) { result.state = 'INCOMPLETE'; result.deliveryState = 'WAITING_READY'; }
  return save(result);
}

export async function run(options) {
  const contract = validateContract(JSON.parse(await readFile(options.contract, 'utf8')));
  if (!/^[a-z][a-z0-9_-]{1,99}$/u.test(options.sourceCode)) fail('INVALID_SOURCE_CODE');
  if (options.dryRun) return { state: 'DRY_RUN', mode: contract.mode };
  return withLock(path.join(options.lakeRoot, `delivery-${options.sourceCode}.lock`), () => receive(options, contract));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), at = args.indexOf('--contract');
    if (at < 0 || !args[at + 1]) fail('DELIVERY_CONTRACT_REQUIRED');
    const contract = path.resolve(args[at + 1]); args.splice(at, 2);
    const result = await run({ ...fileArgs(args), contract }); console.log(JSON.stringify(result));
    if (result.state === 'FAILED') process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ state: 'FAILED', errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'DELIVERY_FAILED' })); process.exitCode = 1; }
}

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LAKE_ROOT = path.join(ROOT, '.lake-data');
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

function fail(code) { throw new Error(code); }

function parseArgs(argv) {
  const options = { contract: null, lakeRoot: DEFAULT_LAKE_ROOT, dryRun: false };
  const takes = new Set(['--contract', '--lake-root']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (takes.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT_VALUE');
      if (arg === '--contract') options.contract = path.resolve(ROOT, value);
      if (arg === '--lake-root') options.lakeRoot = path.resolve(ROOT, value);
    } else fail('INVALID_ARGUMENT');
  }
  if (!options.contract) fail('MODEL_CONTRACT_REQUIRED');
  return options;
}

function safeRelative(value, code) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) fail(code);
  return value;
}

function validateContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract) || contract.version !== 1 || !SAFE.test(contract.dataset_code ?? '')) fail('INVALID_MODEL_CONTRACT');
  if (!contract.input || typeof contract.input !== 'object') fail('MODEL_INPUT_REQUIRED');
  const inputPath = safeRelative(contract.input.path, 'MODEL_INPUT_PATH_INVALID');
  const schemaPath = contract.input.schema_path ? safeRelative(contract.input.schema_path, 'MODEL_SCHEMA_PATH_INVALID') : null;
  if (!['jsonl', 'mysql-jsonl'].includes(contract.input.format ?? 'jsonl')) fail('MODEL_INPUT_FORMAT_INVALID');
  const key = contract.key;
  if (!Array.isArray(key) || key.length === 0 || key.length > 32 || key.some((name) => typeof name !== 'string' || !name)) fail('MODEL_KEY_INVALID');
  const required = contract.required ?? [];
  if (!Array.isArray(required) || required.some((name) => typeof name !== 'string' || !name)) fail('MODEL_REQUIRED_FIELDS_INVALID');
  const outputFields = contract.output?.fields ?? null;
  if (outputFields !== null && (!Array.isArray(outputFields) || outputFields.length === 0 || outputFields.some((name) => typeof name !== 'string' || !name))) fail('MODEL_OUTPUT_FIELDS_INVALID');
  const maxDuplicateKeys = contract.quality?.max_duplicate_keys ?? 0;
  if (!Number.isInteger(maxDuplicateKeys) || maxDuplicateKeys < 0) fail('MODEL_DUPLICATE_THRESHOLD_INVALID');
  return { ...contract, input: { ...contract.input, path: inputPath, schema_path: schemaPath, format: contract.input.format ?? 'jsonl' }, key, required, output: { fields: outputFields }, quality: { max_duplicate_keys: maxDuplicateKeys } };
}

async function readSchema(options, contract) {
  if (contract.input.schema_path) {
    try { return JSON.parse(await readFile(path.join(options.lakeRoot, contract.input.schema_path), 'utf8')); } catch { fail('MODEL_SCHEMA_READ_FAILED'); }
  }
  return null;
}

function columnsFromSchema(schema) {
  if (!schema) return null;
  if (!Array.isArray(schema.columns)) fail('MODEL_SCHEMA_INVALID');
  return schema.columns.map((column) => {
    if (!column || typeof column.column !== 'string' || !column.column) fail('MODEL_SCHEMA_INVALID');
    return column.column;
  });
}

function keyFor(row, key) {
  const values = key.map((field) => row[field]);
  return JSON.stringify(values);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.part`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

export async function run(options) {
  const contract = validateContract(JSON.parse(await readFile(options.contract, 'utf8')));
  const inputPath = path.join(options.lakeRoot, contract.input.path);
  const schema = await readSchema(options, contract);
  const schemaFields = columnsFromSchema(schema);
  const knownFields = schemaFields ? new Set(schemaFields) : null;
  if (knownFields && [...contract.key, ...contract.required, ...(contract.output.fields ?? [])].some((field) => !knownFields.has(field))) fail('MODEL_FIELD_NOT_IN_SCHEMA');
  const candidateId = `r-${new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const base = { version: 1, datasetCode: contract.dataset_code, candidateId, contractVersion: contract.version, inputPath: contract.input.path, state: options.dryRun ? 'DRY_RUN' : 'BUILDING', startedAt: new Date().toISOString() };
  if (options.dryRun) return base;
  try { await access(inputPath); } catch { fail('MODEL_INPUT_NOT_FOUND'); }
  const outputFields = contract.output.fields ?? schemaFields;
  const candidateRoot = path.join(options.lakeRoot, 'datasets', contract.dataset_code, candidateId);
  await mkdir(candidateRoot, { recursive: true, mode: 0o700 });
  const candidatePart = path.join(candidateRoot, 'candidate.jsonl.part');
  const candidateFile = path.join(candidateRoot, 'candidate.jsonl');
  const output = (await import('node:fs')).createWriteStream(candidatePart, { flags: 'wx', mode: 0o600 });
  const outputHash = createHash('sha256');
  let outputBytes = 0;
  let rowCount = 0;
  let duplicateCount = 0;
  let missingRequiredCount = 0;
  let invalidCount = 0;
  const seenKeys = new Set();
  let inferredFields = schemaFields;
  try {
    const lines = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let source;
      try { source = JSON.parse(line); } catch { invalidCount += 1; continue; }
      let row;
      if (Array.isArray(source)) {
        if (!inferredFields || source.length !== inferredFields.length) { invalidCount += 1; continue; }
        row = Object.fromEntries(inferredFields.map((field, index) => [field, source[index]]));
      } else if (source && typeof source === 'object') row = source;
      else { invalidCount += 1; continue; }
      if (!inferredFields) inferredFields = Object.keys(row);
      if ([...contract.key, ...contract.required, ...(outputFields ?? [])].some((field) => !(field in row))) { invalidCount += 1; continue; }
      if (contract.required.some((field) => row[field] === null || row[field] === undefined)) missingRequiredCount += 1;
      const key = keyFor(row, contract.key);
      if (seenKeys.has(key)) duplicateCount += 1;
      seenKeys.add(key);
      const projected = outputFields ? Object.fromEntries(outputFields.map((field) => [field, row[field]])) : row;
      const encoded = Buffer.from(`${JSON.stringify(projected, null, 0)}\n`, 'utf8');
      outputHash.update(encoded); outputBytes += encoded.length; rowCount += 1;
      if (!output.write(encoded)) await new Promise((resolve) => output.once('drain', resolve));
    }
    output.end();
    await new Promise((resolve, reject) => { output.once('close', resolve); output.once('error', reject); });
  } catch (error) {
    output.destroy();
    throw error;
  }
  await rename(candidatePart, candidateFile);
  const input = await sha256File(inputPath);
  const quality = { passed: duplicateCount <= contract.quality.max_duplicate_keys && missingRequiredCount === 0 && invalidCount === 0, duplicateCount, missingRequiredCount, invalidCount, maxDuplicateKeys: contract.quality.max_duplicate_keys };
  const manifest = { ...base, state: quality.passed ? 'READY' : 'REJECTED', finishedAt: new Date().toISOString(), rowCount, input: { path: contract.input.path, ...input }, candidate: { path: path.relative(options.lakeRoot, candidateFile), bytes: outputBytes, sha256: outputHash.digest('hex') }, fields: outputFields ?? inferredFields, quality };
  const manifestFile = path.join(candidateRoot, 'manifest.json');
  await atomicJson(manifestFile, manifest);
  if (quality.passed) {
    const publishLockPath = path.join(options.lakeRoot, 'datasets', contract.dataset_code, 'publish.lock');
    let lock;
    try { lock = await open(publishLockPath, 'wx', 0o600); } catch { fail('MODEL_PUBLISH_BUSY'); }
    try {
      manifest.state = 'PUBLISHED';
      manifest.publishedAt = new Date().toISOString();
      await atomicJson(manifestFile, manifest);
      const manifestHash = await sha256File(manifestFile);
      await atomicJson(path.join(options.lakeRoot, 'datasets', contract.dataset_code, 'active.json'), { version: 1, datasetCode: contract.dataset_code, candidateId, manifestPath: path.relative(options.lakeRoot, manifestFile), manifestSha256: manifestHash.sha256, activatedAt: manifest.publishedAt });
    } finally {
      await lock.close();
      await rm(publishLockPath, { force: true });
    }
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await run(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ datasetCode: result.datasetCode, candidateId: result.candidateId, state: result.state, rowCount: result.rowCount ?? null, quality: result.quality ?? null }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAILED', errorCode: String(error?.message ?? 'MODEL_BUILD_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120) }));
    process.exitCode = 1;
  }
}

export { keyFor, parseArgs, safeRelative, validateContract };

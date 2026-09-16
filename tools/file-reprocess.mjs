import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { atomicJson, digest, readJson, resolveInside } from './lake-runtime.mjs';
import { scanDirectory } from './file-ingest.mjs';

export async function reprocess(options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(options.batchId ?? '')) throw new Error('INVALID_BATCH_ID');
  const root = await resolveInside(options.lakeRoot, `file-batches/${options.batchId}`);
  const batch = await readJson(path.join(root, 'batch.json'), null) ?? await readJson(path.join(root, 'batch.json.part'));
  if (options.sourceCode && options.sourceCode !== batch.sourceCode) throw new Error('REPROCESS_SOURCE_MISMATCH');
  if (options.deliveryDate && options.deliveryDate !== batch.deliveryDate) throw new Error('REPROCESS_WINDOW_MISMATCH');
  const contract = options.parserContract ?? {};
  const entries = batch.entries.filter(entry => entry.rawPath);
  if (!entries.length) throw new Error('NO_SEALED_INPUT');
  const processingRoot = path.join(options.lakeRoot, 'reprocessing', digest(options.batchId + JSON.stringify(contract)));
  const result = await scanDirectory({ inbox: path.resolve(options.lakeRoot), lakeRoot: processingRoot, sourceCode: batch.sourceCode,
    deliveryDate: batch.deliveryDate, parserPython: options.parserPython || process.env.LAKE_PYTHON || 'python3', parserContract: contract,
    parserVersion: digest(JSON.stringify(contract)), onlyRelativePaths: entries.map(entry => entry.rawPath),
    logicalPaths: Object.fromEntries(entries.map(entry => [entry.rawPath, entry.relativePath])),
    expectedHashes: Object.fromEntries(entries.map(entry => [entry.rawPath, entry.input.sha256])), assumeReady: true,
    sealedInput: true });
  for (const entry of result.entries) {
    for (const field of ['rawPath', 'parsedPath']) if (entry[field]) entry[field] = path.relative(options.lakeRoot, path.join(processingRoot, entry[field]));
  }
  const summary = { ...result, parentBatchId: batch.batchId, processingRoot: path.relative(options.lakeRoot, processingRoot), parserSha256: digest(JSON.stringify(contract)) };
  if (entries.length !== (batch.expectedFileCount ?? batch.entries.length) && summary.state === 'COMPLETE') {
    summary.state = 'INCOMPLETE'; summary.errorCode = 'UNSEALED_PACKAGE_MEMBERS';
  }
  const published = path.join(options.lakeRoot, 'file-batches', result.batchId);
  await mkdir(published, { recursive: true, mode: 0o700 });
  await atomicJson(path.join(published, 'batch.json'), summary);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = process.argv[i], value = process.argv[i + 1];
      if (!value) throw new Error('INVALID_ARGUMENT');
      if (name === '--lake-root') options.lakeRoot = path.resolve(value);
      else if (name === '--batch-id') options.batchId = value;
      else if (name === '--parser-contract') options.parserContract = await readJson(path.resolve(value));
      else if (name === '--parser-settings') options.parserContract = JSON.parse(value);
      else if (name === '--parser-python') options.parserPython = value;
      else if (name === '--source-code') options.sourceCode = value;
      else if (name === '--delivery-date') options.deliveryDate = value;
      else throw new Error('INVALID_ARGUMENT');
    }
    if (!options.lakeRoot) throw new Error('LAKE_ROOT_REQUIRED');
    const result = await reprocess(options); console.log(JSON.stringify({ batchId: result.batchId, state: result.state, parentBatchId: result.parentBatchId, contractSha256: result.parserSha256 }));
    if (result.state === 'FAILED') process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ state: 'FAILED', errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'FILE_REPROCESS_FAILED' })); process.exitCode = 1; }
}

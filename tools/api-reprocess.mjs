import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicJson, digest, durableRename, hashFile, parseExactJson, readJson, resolveInside } from './lake-runtime.mjs';
import { recordsFrom, validateConfig, valueAt } from './rest-ingest.mjs';

export async function reprocess(options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(options.batchId ?? '')) throw new Error('INVALID_BATCH_ID');
  const configText = await readFile(options.config, 'utf8'), config = validateConfig(JSON.parse(configText));
  if (options.sourceCode && options.sourceCode !== config.source_code) throw new Error('REPROCESS_SOURCE_MISMATCH');
  const originalRoot = await resolveInside(options.lakeRoot, `api/${config.source_code}/${options.batchId}`);
  const original = await readJson(path.join(originalRoot, 'batch.json'), null) ?? await readJson(path.join(originalRoot, 'batch.failed.json'));
  if (options.window && options.window !== original.window) throw new Error('REPROCESS_WINDOW_MISMATCH');
  if (!original.pages?.length) throw new Error('NO_SEALED_INPUT');
  const batchId = `api-reprocess-${randomUUID()}`, target = path.join(options.lakeRoot, 'api', config.source_code, batchId);
  await mkdir(path.join(target, 'pages'), { recursive: true, mode: 0o700 });
  const manifest = { ...original, batchId, parentBatchId: original.batchId, originalConfigSha256: original.configSha256,
    configSha256: digest(configText), pages: [], state: 'RUNNING', startedAt: new Date().toISOString(), rowCount: 0 };
  delete manifest.errorCode; delete manifest.failedAt;
  try {
    for (const page of original.pages) {
      const rawFile = await resolveInside(options.lakeRoot, page.raw.path), actual = await hashFile(rawFile);
      if (actual.sha256 !== page.raw.sha256 || actual.bytes !== page.raw.bytes) throw new Error('API_RAW_INTEGRITY_MISMATCH');
      const entry = { page: page.page, request: page.request, status: page.status, raw: page.raw, state: 'RAW_COMMITTED' };
      manifest.pages.push(entry); await atomicJson(path.join(target, 'batch.json.part'), manifest);
      const payload = parseExactJson(await readFile(rawFile, 'utf8'));
      if (config.success && valueAt(payload, config.success.path) !== config.success.equals) throw new Error('API_BUSINESS_ERROR');
      const records = recordsFrom(payload, config), file = path.join(target, 'pages', `page-${page.page}.jsonl`);
      await writeFile(file + '.part', records.map(row => JSON.stringify(row) + '\n').join(''), { flag: 'wx', mode: 0o600 });
      await durableRename(file + '.part', file);
      const normalized = await hashFile(file); delete normalized.rows;
      Object.assign(entry, { state: 'PARSED', rows: records.length, normalized: { path: path.relative(options.lakeRoot, file), ...normalized } });
      manifest.rowCount += records.length;
    }
    // Re-parsing cannot recover pages that were never received.
    manifest.state = original.state === 'COMPLETE' || (original.pagination === 'none' && original.pages.length === 1) ? 'COMPLETE' : 'INCOMPLETE';
    if (manifest.state === 'INCOMPLETE') manifest.errorCode = 'RAW_PAGESET_INCOMPLETE';
    manifest.finishedAt = new Date().toISOString(); await atomicJson(path.join(target, 'batch.json'), manifest); return manifest;
  } catch (error) {
    manifest.state = 'FAILED'; manifest.errorCode = /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'API_PARSE_FAILED';
    await atomicJson(path.join(target, 'batch.failed.json'), manifest); return manifest;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i], value = process.argv[i + 1]; if (!value) throw new Error('INVALID_ARGUMENT');
      if (key === '--config') options.config = path.resolve(value);
      else if (key === '--lake-root') options.lakeRoot = path.resolve(value);
      else if (key === '--batch-id') options.batchId = value;
      else if (key === '--source-code') options.sourceCode = value;
      else if (key === '--window') options.window = value;
      else throw new Error('INVALID_ARGUMENT');
    }
    if (!options.lakeRoot || !options.config) throw new Error('REPROCESS_CONFIG_REQUIRED');
    const result = await reprocess(options); console.log(JSON.stringify({ batchId: result.batchId, state: result.state, rowCount: result.rowCount, errorCode: result.errorCode }));
    if (result.state === 'FAILED') process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ state: 'FAILED', errorCode: /^[A-Z0-9_:-]{1,120}$/u.test(error.message) ? error.message : 'API_REPROCESS_FAILED' })); process.exitCode = 1; }
}

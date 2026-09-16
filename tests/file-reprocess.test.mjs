import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../tools/file-ingest.mjs';
import { reprocess } from '../tools/file-reprocess.mjs';

test('failed parsing resumes from sealed originals after the delivery directory is gone', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'file-reprocess-')); t.after(() => rm(root, { recursive: true, force: true }));
  const inbox = path.join(root, 'inbox'), lakeRoot = path.join(root, 'lake'); await mkdir(inbox);
  await writeFile(path.join(inbox, 'data.json'), '{"data":{"items":[{"id":"001"},{"id":"002"}]}}');
  const failed = await scanDirectory({ inbox, lakeRoot, sourceCode: 'repair-files', deliveryDate: '2026-09-16', assumeReady: true, parserContract: { requiredFields: ['id'] } });
  assert.equal(failed.state, 'FAILED'); assert.ok(failed.entries[0].rawPath);
  await rm(inbox, { recursive: true });
  const options = { lakeRoot, batchId: failed.batchId, parserContract: { recordsPath: 'data.items', requiredFields: ['id'] } };
  const result = await reprocess(options); assert.equal(result.state, 'COMPLETE');
  assert.equal(result.entries[0].relativePath, 'data.json'); assert.equal(result.entries[0].rows, 2);
  assert.equal((await readFile(path.join(lakeRoot, result.entries[0].parsedPath), 'utf8')).split('\n')[0], '{"id":"001"}');
  assert.equal((await reprocess(options)).entries[0].state, 'DUPLICATE');
  assert.equal(JSON.parse(await readFile(path.join(lakeRoot, 'file-batches', failed.batchId, 'batch.json'))).state, 'FAILED');
  await writeFile(path.join(lakeRoot, failed.entries[0].rawPath), 'corrupt');
  await assert.rejects(reprocess(options), /DELIVERY_HASH_MISMATCH/);
});

test('reprocessing a partial raw package cannot silently claim full delivery', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'partial-reprocess-')); t.after(() => rm(root, { recursive: true, force: true }));
  const inbox = path.join(root, 'inbox'), lakeRoot = path.join(root, 'lake'); await mkdir(inbox);
  await writeFile(path.join(inbox, 'a.csv'), 'id\n1\n'); await writeFile(path.join(inbox, 'b.xls'), 'unsupported');
  const result = await scanDirectory({ inbox, lakeRoot, assumeReady: true });
  assert.equal(result.state, 'INCOMPLETE');
  const parsed = await reprocess({ lakeRoot, batchId: result.batchId });
  assert.equal(parsed.state, 'INCOMPLETE'); assert.equal(parsed.errorCode, 'UNSEALED_PACKAGE_MEMBERS');
});

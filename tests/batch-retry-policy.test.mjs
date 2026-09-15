import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('batch retry contract uses attempt-scoped uniqueness and worker-only routes', async () => {
  const migration = await readFile(path.join(root, 'migrations/V006__batch_retry_cancel.sql'), 'utf8');
  const repository = await readFile(
    path.join(root, 'apps/control-api/src/main/java/com/bydw/batch/JdbcBatchRepository.java'), 'utf8');
  const controller = await readFile(
    path.join(root, 'apps/control-api/src/main/java/com/bydw/batch/BatchController.java'), 'utf8');
  const filter = await readFile(
    path.join(root, 'apps/control-api/src/main/java/com/bydw/api/RequestAuthenticationFilter.java'), 'utf8');

  assert.match(migration, /DROP CONSTRAINT ingestion_batch_job_run_key_uk/);
  assert.match(migration, /UNIQUE \(job_id, run_key, attempt\)/);
  assert.match(repository, /attempt \+ 1/);
  assert.match(repository, /state IN \('FAILED','CANCELLED'\)/);
  assert.match(controller, /ingestion-batches\/\{batchId\}\/retry/);
  assert.match(controller, /ingestion-batches\/\{batchId\}\/cancel/);
  assert.match(filter, /complete\|fail\|retry\|cancel/);
});

test('retry and cancel do not expose an admin route or direct data payload endpoint', async () => {
  const controller = await readFile(
    path.join(root, 'apps/control-api/src/main/java/com/bydw/batch/BatchController.java'), 'utf8');
  assert.doesNotMatch(controller, /@PostMapping\("[^\"]*\/retry"\)[\s\S]*?@RequestBody/);
  assert.doesNotMatch(controller, /@PostMapping\("[^\"]*\/cancel"\)[\s\S]*?@RequestBody/);
});

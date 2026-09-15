import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('ingestion worker uses the worker database login and never the owner or admin token', async () => {
  const config = await read('apps/ingestion-worker/src/main/resources/application.yml');
  const compose = await read('deploy/compose.yaml');
  const dockerfile = await read('deploy/Dockerfile.worker');
  assert.match(config, /web-application-type: none/);
  assert.match(config, /username: \$\{INGESTION_WORKER_DB_USERNAME:bydw_ingestion_worker_login\}/);
  assert.doesNotMatch(config, /CONTROL_API_ADMIN_TOKEN/);
  assert.doesNotMatch(config, /WAREHOUSE_DB_USERNAME/);
  assert.match(compose, /image: bydw\/ingestion-worker:0\.1\.0-dev\.1/);
  assert.match(compose, /INGESTION_WORKER_DB_USERNAME: bydw_ingestion_worker_login/);
  assert.doesNotMatch(compose, /ingestion-worker:[\s\S]*CONTROL_API_ADMIN_TOKEN/);
  assert.doesNotMatch(compose, /ingestion-worker:[\s\S]*WAREHOUSE_DB_PASSWORD:/);
  assert.match(dockerfile, /eclipse-temurin:21\.0\.12_8-jre-jammy/);
  assert.doesNotMatch(dockerfile, /latest/);
});

test('worker writes RAW through functions and heartbeats over the worker HTTP API', async () => {
  const runner = await read('apps/ingestion-worker/src/main/java/com/bydw/worker/WorkerRunner.java');
  const raw = await read('apps/ingestion-worker/src/main/java/com/bydw/worker/RawIngestRepository.java');
  const client = await read('apps/ingestion-worker/src/main/java/com/bydw/worker/ControlApiClient.java');
  const filter = await read('apps/control-api/src/main/java/com/bydw/api/RequestAuthenticationFilter.java');
  assert.match(raw, /raw\.ingest_record/);
  assert.match(raw, /raw\.seal_ingestion_batch/);
  assert.match(runner, /startHeartbeats/);
  assert.match(client, /X-Worker-Instance/);
  assert.match(client, /ingestion-batches\/" \+ batchId \+ "\/heartbeat/);
  assert.match(filter, /X-Worker-Instance/);
  assert.match(filter, /JOB_READ/);
  assert.doesNotMatch(runner, /mysql/i);
  assert.doesNotMatch(raw, /SELECT \* FROM raw\.ingestion_record/);
});

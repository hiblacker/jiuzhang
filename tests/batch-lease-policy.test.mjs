import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function source(file) {
  return readFile(path.join(root, file), 'utf8');
}

test('V007 establishes active lease invariants without deleting batch evidence', async () => {
  const migration = await source('migrations/V007__batch_lease_heartbeat.sql');
  assert.match(migration, /lease_owner VARCHAR\(200\)/);
  assert.match(migration, /lease_expires_at TIMESTAMPTZ/);
  assert.match(migration, /last_heartbeat_at TIMESTAMPTZ/);
  assert.match(migration, /LEASE_MIGRATION_REQUIRED/);
  assert.match(migration, /state <> 'RUNNING'/);
  assert.match(migration, /RAW_BATCH_LEASE_NOT_ACTIVE/);
  assert.match(migration, /RAW_BATCH_LEASE_OWNER_MISMATCH/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
});

test('lease operations are bounded and use database-time guards', async () => {
  const repository = await source(
    'apps/control-api/src/main/java/com/bydw/batch/JdbcBatchRepository.java');
  const service = await source('apps/control-api/src/main/java/com/bydw/batch/BatchService.java');
  assert.match(repository, /FOR UPDATE SKIP LOCKED LIMIT \?/);
  assert.match(repository, /lease_expires_at > statement_timestamp\(\)/);
  assert.match(repository, /error_code = 'LEASE_EXPIRED'/);
  assert.match(service, /limit < 1 \|\| limit > 1000/);
  assert.match(service, /leaseSeconds < 30 \|\| leaseSeconds > 3600/);
  assert.match(service, /BATCH_LEASE_NOT_ACTIVE/);
});

test('heartbeat is worker-only and reconciliation remains an admin operation', async () => {
  const controller = await source(
    'apps/control-api/src/main/java/com/bydw/batch/BatchController.java');
  const filter = await source(
    'apps/control-api/src/main/java/com/bydw/api/RequestAuthenticationFilter.java');
  assert.match(controller, /\{batchId\}\/heartbeat/);
  assert.match(controller, /ingestion-batches\/reconcile-expired/);
  assert.match(filter, /complete\|fail\|retry\|cancel\|heartbeat/);
  assert.doesNotMatch(filter, /BATCH_MUTATION[\s\S]*reconcile-expired/);
});

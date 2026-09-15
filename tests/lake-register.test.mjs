import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildInventoryRequest, buildManifestRequest, parseArgs, sourceSchemaHash } from '../tools/lake-register.mjs';

const plan = { plan_version: 1, inventory_observed_at: '2026-09-15T00:00:00Z', source_scope: { database: 'test' }, tables: [{ table: 'orders', engine: 'InnoDB', required: true, strategy: 'FULL_SNAPSHOT', primary_key: ['id'], schema_fingerprint: 'a'.repeat(64), columns: [{ column: 'id', data_type: 'varchar' }] }] };

test('registration payloads are bounded and never take tokens on the command line', () => {
  const inventory = buildInventoryRequest(plan, 'mysql-test-source');
  assert.equal(inventory.objects.length, 1);
  assert.match(sourceSchemaHash(plan), /^[0-9a-f]{64}$/);
  assert.throws(() => parseArgs(['--manifest', '/tmp/x', '--control-api', 'http://remote.example']), /CONTROL_API_TLS_REQUIRED/);
  assert.throws(() => parseArgs(['--manifest', '/tmp/x', '--worker-token-env', 'bad-name']), /INVALID_TOKEN_ENV/);
});

test('manifest registration maps committed files to relative immutable objects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-register-'));
  try {
    const raw = path.join(root, 'raw', 'mysql-test-source', 'batch-1', 'orders');
    await mkdir(raw, { recursive: true });
    await writeFile(path.join(raw, 'data.jsonl'), '["1"]\n');
    await writeFile(path.join(raw, 'schema.json'), JSON.stringify({ columns: [{ column: 'id' }] }));
    const manifestFile = path.join(root, 'batch.json');
    const manifest = { batchId: 'batch-1', sourceCode: 'mysql-test-source', mode: 'daily', window: '2026-09-30', state: 'COMPLETE', consistency: 'ONE_REPEATABLE_READ_TRANSACTION', startedAt: '2026-09-15T00:00:00Z', finishedAt: '2026-09-15T00:01:00Z', tables: [{ table: 'orders', state: 'RAW_COMMITTED', rowCount: 1, bytes: 6, sha256: createHash('sha256').update('["1"]\n').digest('hex') }] };
    await writeFile(manifestFile, JSON.stringify(manifest));
    const payload = await buildManifestRequest(manifestFile, manifest, { lakeRoot: root, sourceCode: 'mysql-test-source', planVersion: 1 });
    assert.equal(payload.state, 'COMPLETE');
    assert.equal(payload.mode, 'DAILY');
    assert.equal(payload.scheduledWindowEnd, '2026-10-01T00:00:00+08:00');
    assert.equal(payload.objects[0].rawPath, 'raw/mysql-test-source/batch-1/orders/data.jsonl');
    assert.equal(payload.objects[0].format, 'JSONL');
  } finally { await rm(root, { recursive: true, force: true }); }
});

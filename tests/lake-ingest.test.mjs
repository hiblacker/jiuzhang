import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSnapshotSql, columnExpression, identifier, parseArgs, runSnapshot } from '../tools/lake-ingest.mjs';

const inventory = {
  inventory_observed_at: '2026-09-15T00:00:00Z',
  plan_version: 1,
  tables: [{
    table: 'orders',
    primary_key: ['id'],
    columns: [
      { column: 'id', data_type: 'bigint' },
      { column: 'total', data_type: 'decimal' },
      { column: 'payload', data_type: 'blob' },
    ],
  }],
};

test('identifiers are quoted and cannot inject SQL', () => {
  assert.equal(identifier('a`b', 'table'), '`a``b`');
  assert.throws(() => identifier('\0', 'table'), /INVALID_TABLE/);
  const sql = buildSnapshotSql({ database: 'warehouse' }, inventory, 30);
  assert.match(sql, /START TRANSACTION WITH CONSISTENT SNAPSHOT/);
  assert.match(sql, /FROM `warehouse`\.`orders` ORDER BY `id`/);
  assert.match(sql, /JSON_ARRAY\(/);
  assert.match(sql, /HEX\(`payload`\)/);
  assert.doesNotMatch(sql, /DROP TABLE/);
});

test('raw row expressions preserve exact scalar spellings as JSON strings and null', () => {
  assert.match(columnExpression({ column: 'amount', data_type: 'decimal' }), /CAST\(`amount` AS CHAR\)/);
  assert.match(columnExpression({ column: 'amount', data_type: 'decimal' }), /`amount` IS NULL,NULL/);
  assert.match(columnExpression({ column: 'bytes', data_type: 'varbinary' }), /HEX\(`bytes`\)/);
});

test('argument parsing requires explicit TLS exception and bounds inputs', () => {
  assert.equal(parseArgs(['--daily', '--allow-unverified-test-tls', '--window', '2026-09-15']).mode, 'daily');
  assert.throws(() => parseArgs(['--window', 'today']), /INVALID_WINDOW/);
  assert.throws(() => parseArgs(['--query-timeout-seconds', '901']), /INVALID_QUERY_TIMEOUT/);
  assert.throws(() => parseArgs(['--batch-id', '../escape']), /INVALID_BATCH_ID/);
  assert.throws(() => parseArgs(['--unknown']), /INVALID_ARGUMENT/);
});

test('snapshot inventory cannot escape the raw object root', () => {
  assert.throws(() => buildSnapshotSql({ database: 'warehouse' }, {
    ...inventory,
    tables: [{ ...inventory.tables[0], table: '../outside' }],
  }, 30), /(?:INVALID_INVENTORY|INVALID_TABLE)/);
});

test('final table is included in the atomically committed manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-lake-'));
  const fakeMysql = path.join(root, 'fake-mysql');
  await writeFile(fakeMysql, '#!/usr/bin/env node\nconsole.log("##JIUZHANG_SNAPSHOT_BEGIN##");\nconsole.log("##JIUZHANG_TABLE_000000##");\nconsole.log("[\\"1\\"]");\nconsole.log("##JIUZHANG_SNAPSHOT_END##");\n', { mode: 0o700 });
  await chmod(fakeMysql, 0o700);
  const config = { engine: 'mysql', host: '127.0.0.1', port: 3306, username: 'u', password: 'p', database: 'd', tls: { require_encryption: true, verify_server_certificate: true }, limits: { connect_timeout_seconds: 1 } };
  const smallInventory = { inventory_observed_at: '2026-09-15T00:00:00Z', plan_version: 1, tables: [{ table: 'orders', primary_key: ['id'], columns: [{ column: 'id', data_type: 'varchar' }] }] };
  try {
    const result = await runSnapshot({ lakeRoot: root, sourceCode: 'test-source', mode: 'full', window: null, queryTimeoutSeconds: 10, allowUnverifiedTestTls: true, mysqlCli: fakeMysql, dryRun: false }, config, smallInventory, 'batch-final-table');
    const manifest = JSON.parse(await readFile(path.join(root, 'batches', 'batch-final-table', 'batch.json'), 'utf8'));
    assert.equal(result.state, 'COMPLETE');
    assert.equal(manifest.state, 'COMPLETE');
    assert.deepEqual(manifest.tables[0].state, 'RAW_COMMITTED');
    assert.equal(manifest.tables[0].rowCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

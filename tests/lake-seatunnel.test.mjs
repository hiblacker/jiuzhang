// Unit tests for the registered-SQL execution tool: query shaping, job assembly, CSV
// reading and the JSONL integrity scan. No SeaTunnel or database is contacted.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildExtractionQuery, buildJob, buildMetadataQuery, collectJsonl, inferType, parseCsv, parseHeaderLine, quoteIdentifier,
} from '../tools/lake-seatunnel.mjs';

const baseConfig = {
  sourceId: 7,
  datasourceType: 'MYSQL',
  sqlText: 'SELECT id, 金额 AS amount FROM orders',
  resultColumns: [{ name: 'id', type: 'integer' }, { name: 'amount', type: 'numeric' }],
  datasource: { host: 'source-mysql', port: 3306, database: 'erp', charset: 'utf8mb4', timezone: 'Asia/Shanghai' },
  credential: { user: 'readonly', password: 'synthetic' },
  seatunnelUrl: 'http://seatunnel:5801',
};

test('extraction query wraps the registered SQL and casts every column to text', () => {
  const query = buildExtractionQuery(baseConfig.sqlText, baseConfig.resultColumns);
  assert.equal(query,
    'SELECT CAST(`id` AS CHAR) AS `id`, CAST(`amount` AS CHAR) AS `amount` '
    + 'FROM (SELECT id, 金额 AS amount FROM orders) AS seatunnel_src');
  assert.ok(!query.includes(';'));
});

test('extraction query strips a trailing semicolon and refuses bad column names', () => {
  assert.ok(buildExtractionQuery('SELECT 1 AS id;', [{ name: 'id' }]).endsWith('AS seatunnel_src'));
  assert.throws(() => buildExtractionQuery('SELECT 1', [{ name: 'a`b' }]), /INVALID_RESULT_COLUMN/);
  assert.throws(() => buildExtractionQuery('   ', [{ name: 'id' }]), /SQL_TEXT_REQUIRED/);
  assert.throws(() => buildExtractionQuery('SELECT 1', []), /RESULT_COLUMNS_REQUIRED/);
});

test('metadata query asks for exactly one row so the server reports column names', () => {
  assert.equal(buildMetadataQuery('SELECT * FROM orders'), 'SELECT * FROM (SELECT * FROM orders) AS seatunnel_src LIMIT 1');
  assert.equal(buildMetadataQuery('SELECT 1 AS id;'), 'SELECT * FROM (SELECT 1 AS id) AS seatunnel_src LIMIT 1');
  assert.throws(() => buildMetadataQuery('   '), /SQL_TEXT_REQUIRED/);
});

test('extraction query requires column objects, not bare names', () => {
  // Regression guard: passing names instead of {name} produced INVALID_RESULT_COLUMN at runtime.
  assert.throws(() => buildExtractionQuery('SELECT 1', ['order_id']), /INVALID_RESULT_COLUMN/);
  assert.ok(buildExtractionQuery('SELECT 1', [{ name: 'order_id' }]).includes('CAST(`order_id` AS CHAR)'));
});

test('identifiers are quoted per dialect and rejected when unsafe', () => {
  assert.equal(quoteIdentifier('订单编号', 'MYSQL'), '`订单编号`');
  assert.equal(quoteIdentifier('order_id', 'POSTGRESQL'), '"order_id"');
  assert.throws(() => quoteIdentifier('a; DROP TABLE x', 'MYSQL'), /INVALID_RESULT_COLUMN/);
});

test('job carries the connection, the query and the sink format', () => {
  const job = buildJob({ config: baseConfig, query: 'SELECT 1 AS id', sinkPath: '/out/rows', format: 'json' });
  assert.equal(job.env['job.mode'], 'batch');
  assert.equal(job.source[0].plugin_name, 'Jdbc');
  assert.equal(job.source[0].user, 'readonly');
  assert.match(job.source[0].url, /^jdbc:mysql:\/\/source-mysql:3306\/erp\?/);
  assert.match(job.source[0].url, /characterEncoding=UTF-8/);
  assert.match(job.source[0].url, /serverTimezone=Asia%2FShanghai/);
  assert.equal(job.sink[0].file_format_type, 'json');
  const csv = buildJob({ config: baseConfig, query: 'SELECT 1', sinkPath: '/out/rows', format: 'csv' });
  // CSV (not text) so the sink can emit the header the preview reads column names from.
  assert.equal(csv.sink[0].file_format_type, 'csv');
  assert.equal(csv.sink[0].options.use_header, true);
});

test('job rejects incomplete or unsafe connection details', () => {
  const withoutHost = { ...baseConfig, datasource: { ...baseConfig.datasource, host: '' } };
  assert.throws(() => buildJob({ config: withoutHost, query: 'SELECT 1', sinkPath: '/out', format: 'json' }),
    /DATASOURCE_CONFIG_INCOMPLETE/);
  const withoutCredential = { ...baseConfig, credential: {} };
  assert.throws(() => buildJob({ config: withoutCredential, query: 'SELECT 1', sinkPath: '/out', format: 'json' }),
    /DATASOURCE_CREDENTIAL_REQUIRED/);
  const badUser = { ...baseConfig, credential: { user: 'ro; DROP', password: 'x' } };
  assert.throws(() => buildJob({ config: badUser, query: 'SELECT 1', sinkPath: '/out', format: 'json' }),
    /INVALID_DATASOURCE_USER/);
});

test('CSV reader handles quoting, embedded delimiters and newlines', () => {
  const rows = parseCsv('id,name\n1,"east, north"\n2,"line\nbreak"\n3,"say ""hi"""\n');
  assert.deepEqual(rows[0], ['id', 'name']);
  assert.deepEqual(rows[1], ['1', 'east, north']);
  assert.deepEqual(rows[2], ['2', 'line\nbreak']);
  assert.deepEqual(rows[3], ['3', 'say "hi"']);
});

test('mysql header line yields exact column names, including non-ASCII ones', () => {
  assert.deepEqual(parseHeaderLine('order_id\t订单编号\t金额\t更新时间\n'), [
    { name: 'order_id', type: 'unknown', inferred: true },
    { name: '订单编号', type: 'unknown', inferred: true },
    { name: '金额', type: 'unknown', inferred: true },
    { name: '更新时间', type: 'unknown', inferred: true },
  ]);
  assert.deepEqual(parseHeaderLine(''), []);
  assert.deepEqual(parseHeaderLine('   \n1\t2'), []);
});

test('value type inference covers the shapes the preview sees', () => {
  assert.equal(inferType('123'), 'integer');
  assert.equal(inferType('12345678901234567.89'), 'numeric');
  assert.equal(inferType('2026-09-17 09:58:11.123'), 'timestamp');
  assert.equal(inferType('2026-09-17'), 'date');
  assert.equal(inferType('007'), 'integer');
  assert.equal(inferType('含中文'), 'text');
  assert.equal(inferType(null), 'unknown');
});

test('JSONL collection concatenates part files, hashes them and removes the parts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'seatunnel-test-'));
  try {
    const sink = path.join(root, 'sink');
    const object = path.join(root, 'raw', 'orders');
    await mkdir(sink, { recursive: true });
    await writeFile(path.join(sink, 'T_1_a.json'), '{"id":"1","amount":"12345678901234567.89"}\n');
    await writeFile(path.join(sink, 'T_1_b.json'), '{"id":"2","amount":"0.01"}\n');
    await writeFile(path.join(sink, 'ignore.crc'), 'x');
    const result = await collectJsonl(sink, object);
    assert.equal(result.rows, 2);
    const text = await readFile(path.join(object, 'data.jsonl'), 'utf8');
    assert.equal(text, '{"id":"1","amount":"12345678901234567.89"}\n{"id":"2","amount":"0.01"}\n');
    assert.equal(result.bytes, Buffer.byteLength(text));
    assert.equal(result.sha256.length, 64);
    await assert.rejects(readFile(path.join(sink, 'T_1_a.json')), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JSONL collection refuses output that is not one JSON object per line', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'seatunnel-test-'));
  try {
    const sink = path.join(root, 'sink');
    await mkdir(sink, { recursive: true });
    await writeFile(path.join(sink, 'T_1_a.json'), '[{"id":"1"}]\n');
    await assert.rejects(collectJsonl(sink, path.join(root, 'raw')), /SEATUNNEL_OUTPUT_NOT_JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

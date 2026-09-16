import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../tools/rest-ingest.mjs';
import { reprocess } from '../tools/api-reprocess.mjs';

test('API parsing can be repaired from the exact response while the source is offline', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-reprocess-')); t.after(() => rm(root, { recursive: true, force: true }));
  let requests = 0;
  const bytes = '{"data":{"items":[{"id":"001","value":123456789.123456789}]}}';
  const server = http.createServer((_, res) => { requests++; res.setHeader('content-type', 'application/json'); res.end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const config = { version: 1, source_code: 'api-repair', base_url: `http://127.0.0.1:${server.address().port}`, path: '/data', pagination: { mode: 'none', records_path: 'wrong' } };
  const file = path.join(root, 'config.json'), lakeRoot = path.join(root, 'lake'); await writeFile(file, JSON.stringify(config));
  await assert.rejects(run({ config: file, lakeRoot, batchId: 'received', window: '2026-09-16' }), /API_RECORDS_ARRAY_REQUIRED/);
  await new Promise(resolve => server.close(resolve));
  config.pagination.records_path = 'data.items'; await writeFile(file, JSON.stringify(config));
  const result = await reprocess({ config: file, lakeRoot, batchId: 'received', window: '2026-09-16' });
  assert.equal(result.state, 'COMPLETE'); assert.equal(requests, 1);
  assert.equal(await readFile(path.join(lakeRoot, result.pages[0].raw.path), 'utf8'), bytes);
  assert.deepEqual(JSON.parse(await readFile(path.join(lakeRoot, result.pages[0].normalized.path))), { id: '001', value: '123456789.123456789' });
  const old = JSON.parse(await readFile(path.join(lakeRoot, 'api/api-repair/received/batch.failed.json')));
  assert.equal(old.state, 'FAILED'); assert.equal(result.parentBatchId, old.batchId);
});

test('reprocessing cannot turn a partially received page set into a complete window', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-partial-')); t.after(() => rm(root, { recursive: true, force: true }));
  const server = http.createServer((req, res) => { if (new URL(req.url, 'http://localhost').searchParams.get('page') === '1') res.end('[{"id":1}]'); else { res.statusCode = 503; res.end('unavailable'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const file = path.join(root, 'config.json'), lakeRoot = path.join(root, 'lake');
  await writeFile(file, JSON.stringify({ version: 1, source_code: 'api-partial', base_url: `http://127.0.0.1:${server.address().port}`, path: '/data', pagination: { mode: 'page', page_size: 1 }, retry: { max_attempts: 1 }, requests_per_second: 100 }));
  await assert.rejects(run({ config: file, lakeRoot, batchId: 'partial', window: '2026-09-16' }), /API_HTTP_503/);
  const result = await reprocess({ config: file, lakeRoot, batchId: 'partial', window: '2026-09-16' });
  assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.errorCode, 'RAW_PAGESET_INCOMPLETE'); assert.equal(result.rowCount, 1);
});

test('API request pacing limits successive pages', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-pacing-')); t.after(() => rm(root, { recursive: true, force: true }));
  const times = [];
  const server = http.createServer((req, res) => { times.push(Date.now()); const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page')); res.end(page < 3 ? JSON.stringify([{ id: page }]) : '[]'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const file = path.join(root, 'config.json');
  await writeFile(file, JSON.stringify({ version: 1, source_code: 'api-paced', base_url: `http://127.0.0.1:${server.address().port}`, path: '/data', pagination: { mode: 'page', page_size: 1 }, requests_per_second: 10 }));
  assert.equal((await run({ config: file, lakeRoot: path.join(root, 'lake'), window: '2026-09-16' })).state, 'COMPLETE');
  assert.equal(times.length, 3); assert.ok(times[2] - times[0] >= 180);
});

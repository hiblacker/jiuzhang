import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, validateConfig, valueAt } from '../tools/rest-ingest.mjs';

test('REST config rejects writes and secret query parameters', () => {
  assert.throws(() => validateConfig({ version: 1, source_code: 'api', base_url: 'https://api.example.com', path: '/items', method: 'POST' }), /API_METHOD_MUST_BE_GET/);
  assert.throws(() => validateConfig({ version: 1, source_code: 'api', base_url: 'https://api.example.com', path: '/items', query: { api_token: 'x' } }), /API_QUERY_SECRET_FORBIDDEN/);
  assert.equal(valueAt({ data: { items: [1] } }, 'data.items')[0], 1);
});

test('REST page ingestion retries 429, preserves pages, and stops at a short page', async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    const page = Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('page'));
    if (page === 1 && calls === 1) {
      response.writeHead(429, { 'retry-after': '0', 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'busy' }));
      return;
    }
    const items = page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { items } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-api-'));
  const configFile = path.join(root, 'config.json');
  const config = {
    version: 1,
    source_code: 'test-api',
    base_url: `http://127.0.0.1:${address.port}`,
    allowed_hosts: ['127.0.0.1'],
    path: '/items',
    auth_env: 'JIUZHANG_TEST_TOKEN',
    pagination: { mode: 'page', page_size: 2, max_pages: 4, records_path: 'data.items' },
    retry: { max_attempts: 2, max_delay_ms: 0 },
    max_response_bytes: 1024 * 1024,
  };
  process.env.JIUZHANG_TEST_TOKEN = 'token-not-written';
  await writeFile(configFile, JSON.stringify(config));
  try {
    const result = await run({ config: configFile, lakeRoot: root, batchId: 'api-test', window: '2026-09-15', dryRun: false });
    assert.equal(result.state, 'COMPLETE');
    assert.equal(result.pages.length, 2);
    assert.equal(result.rowCount, 3);
    assert.equal(calls, 3);
    const manifest = await readFile(path.join(root, 'api', 'test-api', 'api-test', 'batch.json'), 'utf8');
    assert.doesNotMatch(manifest, /token-not-written/);
    assert.match(manifest, /"rowCount": 3/);
    delete process.env.JIUZHANG_TEST_TOKEN;
    const reused = await run({ config: configFile, lakeRoot: root, batchId: 'api-test-retry', window: '2026-09-15', dryRun: false });
    assert.equal(reused.reused, true);
    assert.equal(reused.batchId, 'api-test');
  } finally {
    delete process.env.JIUZHANG_TEST_TOKEN;
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

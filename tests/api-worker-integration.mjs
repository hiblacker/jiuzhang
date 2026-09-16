import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const api = process.env.MODEL_TEST_API, admin = process.env.MODEL_TEST_ADMIN, workerToken = process.env.CONTROL_API_WORKER_TOKEN;
assert.equal(new URL(api).hostname, '127.0.0.1');
const root = await mkdtemp(path.join(os.tmpdir(), 'api-worker-'));
const source = `api_worker_${Date.now()}`;
let calls = 0, plan;
const server = http.createServer((_, res) => { calls++; res.end('{"data":{"items":[{"id":"001"}]}}'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function request(route, body, status = 200) {
  const response = await fetch(`${api}/api/v1/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json(); assert.equal(response.status, status, result.code); return result;
}
try {
  await request('sources', { code: source, sourceType: 'REST', credentialRef: 'env://SYNTHETIC_API', config: {} }, 201);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  plan = (await request('lake/plans', { sourceCode: source, expectedVersion: 0, kind: 'REST_PULL', runtimeRef: source,
    timezone: 'Asia/Shanghai', triggerTime: '00:00:00', startDate: day, historicalRead: true, maxAttempts: 3, timeoutSeconds: 300, contract: {} })).id;
  await request(`lake/plans/${plan}/trigger`, { day, reason: 'synthetic API receipt' });
  const config = { version: 1, source_code: source, base_url: `http://127.0.0.1:${server.address().port}`, path: '/data', pagination: { mode: 'none', records_path: 'wrong' } };
  const file = path.join(root, 'api.json'), registry = path.join(root, 'registry.json');
  await writeFile(file, JSON.stringify(config));
  await writeFile(registry, JSON.stringify({ version: 1, lakeRoot: path.join(root, 'lake'), profiles: { [source]: { kind: 'REST_PULL', sourceCode: source, config: file } } }));
  const command = ['apps/ingestion-worker/lake-runtime.mjs', '--registry', registry, '--control-api', api, '--instance', source, '--once'];
  const env = { ...process.env, CONTROL_API_WORKER_TOKEN: workerToken };
  await assert.rejects(promisify(execFile)(process.execPath, command, { env, timeout: 30000 }), error => error.code === 1);
  let attempts = await request(`lake/executions?planId=${plan}`);
  assert.equal(attempts[0].state, 'FAILED'); assert.equal(attempts[0].result.assets[0].state, 'RAW_COMMITTED');
  await new Promise(resolve => server.close(resolve));
  config.pagination.records_path = 'data.items'; await writeFile(file, JSON.stringify(config));
  await request(`lake/executions/${attempts[0].id}/reprocess`, {});
  await promisify(execFile)(process.execPath, command, { env, timeout: 30000 });
  attempts = await request(`lake/executions?planId=${plan}`);
  assert.equal(attempts[0].state, 'COMPLETE'); assert.equal(attempts[0].result.assets[0].state, 'PARSED'); assert.equal(calls, 1);
  const parsed = attempts[0].result.assets[0].evidence.parsed.path;
  assert.equal(JSON.parse(await readFile(path.join(root, 'lake', parsed))).id, '001');
  console.log(JSON.stringify({ state: 'PASS', sourceCalls: calls, initial: 'FAILED_WITH_RAW', reprocessed: 'COMPLETE_FROM_SEALED_RESPONSE' }));
} finally {
  server.close();
  if (plan) await request(`lake/plans/${plan}/state`, { state: 'PAUSED' });
  await rm(root, { recursive: true, force: true });
}

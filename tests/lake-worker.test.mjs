import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runOnce, validateRegistry } from '../apps/ingestion-worker/lake-runtime.mjs';

test('worker replays a durable completion after response loss without re-reading the delivery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-worker-outbox-'));
  let claims = 0; const completions = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/claim')) {
      claims++;
      response.end(JSON.stringify(claims > 1 ? { state: 'IDLE' } : { state: 'RUNNING', id: 17,
        kind: 'FILE_SCAN', runtime_ref: 'fixture', source_code: 'fixture', timeout_seconds: 60,
        business_date: '2026-09-16', leaseToken: 'synthetic-lease', attempt: 1, revision: 1 }));
    } else {
      completions.push(JSON.parse(body));
      if (completions.length === 1) request.socket.destroy();
      else response.end(JSON.stringify({ id: 17, state: 'COMPLETE' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const inbox = path.join(root, 'inbox'); await mkdir(inbox); await writeFile(path.join(inbox, 'data.csv'), 'id\n001\n');
    const registry = validateRegistry({ version: 1, lakeRoot: path.join(root, 'lake'), profiles: {
      fixture: { kind: 'FILE_SCAN', sourceCode: 'fixture', inboxRoot: inbox, assumeReady: true },
    } });
    const options = { controlApi: `http://127.0.0.1:${server.address().port}`, instance: 'test-worker', token: 'synthetic-worker-token-for-test' };
    assert.equal((await runOnce(options, registry)).state, 'OUTBOX_PENDING');
    await writeFile(path.join(inbox, 'data.csv'), 'different\ninput\n');
    assert.equal((await runOnce(options, registry)).state, 'IDLE');
    assert.equal(completions.length, 2); assert.deepEqual(completions[0], completions[1]);
    const receipt = JSON.parse(await readFile(path.join(registry.lakeRoot, 'worker-outbox/test-worker/17.json')));
    assert.equal(receipt.acknowledged, true);
    assert.equal((await readdir(path.join(registry.lakeRoot, 'file-batches'))).length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});

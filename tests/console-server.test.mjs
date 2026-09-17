import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createConsoleServer } from '../apps/console/server.mjs';

test('console serves built assets and forwards scoped auth and browser session state only upstream', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-console-server-'));
  const root = path.join(directory, 'dist');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<html>synthetic console</html>');
  await writeFile(path.join(root, 'assets/main.js'), 'export const synthetic = true;');
  await writeFile(path.join(directory, 'private.txt'), 'synthetic outside root');
  const calls = [];
  const upstream = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    calls.push({ url: request.url, token: request.headers.authorization, cookie: request.headers.cookie, csrf: request.headers['x-csrf-token'], body });
    if (request.url.endsWith('/redirect')) { response.writeHead(302, { Location: 'http://example.invalid/' }); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'JIUZHANG_SESSION=synthetic; Path=/; HttpOnly; SameSite=Lax' }); response.end(JSON.stringify({ ok: true }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const consoleServer = createConsoleServer({ root, origin: `http://127.0.0.1:${upstream.address().port}` });
  consoleServer.listen(0, '127.0.0.1'); await once(consoleServer, 'listening');
  const base = `http://127.0.0.1:${consoleServer.address().port}`;
  try {
    const index = await fetch(base);
    assert.equal(index.status, 200); assert.match(await index.text(), /synthetic console/);
    assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const asset = await fetch(base + '/assets/main.js'); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/private.txt')).status, 404);
    const deepLink = await fetch(base + '/systems');
    assert.equal(deepLink.status, 200); assert.match(await deepLink.text(), /synthetic console/);
    assert.equal((await fetch(base + '/runs/12')).status, 200);
    assert.equal((await fetch(base + '/missing.js')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e%5cprivate.txt')).status, 403);
    assert.equal((await fetch(base + '/api/v1/projects', { method: 'DELETE' })).status, 405);
    const query = await fetch(base + '/api/v1/warehouse/projects?scope=1', { method: 'POST', headers: { Authorization: 'Bearer synthetic-only', Cookie: 'synthetic-session=1', 'X-CSRF-TOKEN': 'synthetic-csrf', 'Content-Type': 'application/json' }, body: '{"test":true}' });
    assert.equal(query.status, 200);
    assert.match(query.headers.get('set-cookie'), /JIUZHANG_SESSION=synthetic/);
    assert.deepEqual(calls, [{ url: '/api/v1/warehouse/projects?scope=1', token: 'Bearer synthetic-only', cookie: 'synthetic-session=1', csrf: 'synthetic-csrf', body: '{"test":true}' }]);
    assert.equal((await fetch(base + '/api/v1/redirect')).status, 502);
    assert.equal((await fetch(base + '/api/v1/large', { method: 'POST', body: 'x'.repeat(1048577) })).status, 413);
  } finally {
    await Promise.all([new Promise(resolve => consoleServer.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  }
});

test('console rejects administrator-configured upstream URL credentials and paths', () => {
  for (const origin of ['ftp://127.0.0.1', 'http://user:password@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1?secret=bad']) {
    assert.throws(() => createConsoleServer({ origin }), /INVALID_CONSOLE_API_ORIGIN/);
  }
});

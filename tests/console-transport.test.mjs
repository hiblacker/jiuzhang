import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createTransport, validateBase } from '../apps/console/src/api/transport.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function setup(fetcher) {
  const session = { base: 'http://127.0.0.1:18080', token: 'synthetic-old-token', generation: 0 };
  let invalidations = 0;
  const transport = createTransport(() => session, () => { invalidations++; session.token = ''; }, fetcher);
  return { session, transport, invalidations: () => invalidations };
}

test('late 401 parsing cannot invalidate a newer identity session', async () => {
  const parsed = deferred(), parsing = deferred();
  const state = setup(async () => ({ ok: false, status: 401, json: () => { parsing.resolve(); return parsed.promise; } }));
  const request = state.transport.request('warehouse/projects');
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await parsing.promise;
  state.session.generation++; state.session.token = 'synthetic-new-token';
  parsed.resolve({ code: 'UNAUTHORIZED' });
  await rejected;
  assert.equal(state.invalidations(), 0);
  assert.equal(state.session.token, 'synthetic-new-token');
});

test('late successful parsing is discarded after logout or view cancellation', async () => {
  for (const reason of ['session', 'view', 'all']) {
    const parsed = deferred(), parsing = deferred(), controller = new AbortController();
    const state = setup(async () => ({ ok: true, json: () => { parsing.resolve(); return parsed.promise; } }));
    const request = state.transport.request('warehouse/projects/1/assets', undefined, controller.signal);
    const rejected = assert.rejects(request, { name: 'AbortError' });
    await parsing.promise;
    if (reason === 'session') state.session.generation++;
    else if (reason === 'view') controller.abort();
    else state.transport.abort();
    parsed.resolve([{ id: 'synthetic-private-asset' }]);
    await rejected;
  }
});

test('current 401 invalidates exactly once and non-JSON errors remain bounded', async () => {
  const state = setup(async () => new Response('{"code":"UNAUTHORIZED"}', { status: 401 }));
  await assert.rejects(state.transport.request('warehouse/projects'), error => error instanceof ApiError && error.status === 401);
  assert.equal(state.invalidations(), 1);
  const other = setup(async () => new Response('upstream failed', { status: 502 }));
  await assert.rejects(other.transport.request('warehouse/projects'), { code: 'HTTP_502', status: 502 });
  assert.equal(other.invalidations(), 0);
});

test('transport pins request credentials, omits cookies, rejects redirects and returns CSV blobs', async () => {
  const calls = [];
  const state = setup(async (url, options) => { calls.push({ url, options }); return new Response('id\r\n001\r\n', { headers: { 'Content-Type': 'text/csv' } }); });
  const body = { releaseId: 7, limit: 100, offset: 0 };
  const result = await state.transport.request('warehouse/projects/1/datasets/2/export', body, undefined, true);
  assert.equal(await result.text(), 'id\r\n001\r\n');
  assert.equal(calls[0].url, 'http://127.0.0.1:18080/api/v1/warehouse/projects/1/datasets/2/export');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-old-token');
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
});

test('invalid targets and already-cancelled views never transmit tokens', async () => {
  let calls = 0;
  const state = setup(async () => { calls++; return new Response('{}'); });
  for (const base of ['http://example.org', 'https://u:p@example.org', 'https://example.org?secret=x', 'https://example.org#fragment', 'file:///tmp']) {
    state.session.base = base;
    await assert.rejects(state.transport.request('warehouse/projects'));
  }
  state.session.base = 'https://example.org';
  const controller = new AbortController(); controller.abort();
  await assert.rejects(state.transport.request('warehouse/projects', undefined, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  assert.equal(validateBase('https://example.org/control/'), 'https://example.org/control');
  assert.equal(validateBase('http://[::1]:8080'), 'http://[::1]:8080');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { usePermissionStore } from '../apps/console/src/stores/permission.ts';
import { useProjectStore } from '../apps/console/src/stores/project.ts';

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    return handler(String(url), options);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('the project store loads the first page, keeps the total and selects the first project', async () => {
  setActivePinia(createPinia());
  const stub = stubFetch(() => json({ items: [{ id: 7, name: '测试项目', code: 'test', role: 'OWNER' }], total: 1, limit: 25, offset: 0 }));
  try {
    const store = useProjectStore();
    await store.load();
    assert.equal(store.items.length, 1);
    assert.equal(store.total, 1);
    assert.equal(store.selected?.id, 7);
    assert.match(stub.calls[0], /limit=25&offset=0/);
  } finally { stub.restore(); }
});

test('selecting a project closes the picker and drives the permission capabilities', async () => {
  setActivePinia(createPinia());
  const project = useProjectStore();
  const permission = usePermissionStore();
  project.select({ id: 1, name: 'a', code: 'a', role: 'VIEWER' });
  assert.equal(permission.role, 'VIEWER');
  assert.equal(permission.canManage, false);
  assert.equal(permission.canIngest, false);
  assert.equal(permission.canOperate, false);
  project.select({ id: 2, name: 'b', code: 'b', role: 'ENGINEER' });
  assert.equal(permission.canIngest, true);
  assert.equal(permission.canOperate, true);
  assert.equal(permission.canManage, false);
  project.select({ id: 3, name: 'c', code: 'c', role: 'OWNER' });
  assert.equal(permission.canManage, true);
  assert.equal(project.modal, false);
});

test('the project store drops a stale response instead of overwriting a newer page', async () => {
  setActivePinia(createPinia());
  let resolveFirst;
  const stub = stubFetch((url) => (url.includes('offset=25')
    ? Promise.resolve(json({ items: [{ id: 2, name: 'second', code: 'b', role: 'OWNER' }], total: 2, limit: 25, offset: 25 }))
    : new Promise((resolve) => { resolveFirst = () => resolve(json({ items: [{ id: 1, name: 'first', code: 'a', role: 'OWNER' }], total: 2, limit: 25, offset: 0 })); })));
  try {
    const store = useProjectStore();
    const first = store.load();
    store.page = 2;
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirst();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(store.items.map((item) => item.id), [2]);
  } finally { stub.restore(); }
});

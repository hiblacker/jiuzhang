import test from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import { usePagedQuery } from '../apps/console/src/composables/usePagedQuery.ts';

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return handler(String(url));
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('the paged query asks for the first page, then follows the page and the search text', async () => {
  const stub = stubFetch((url) => json({ items: [{ id: url.includes('offset=25') ? 2 : 1 }], total: 30, limit: 25, offset: 0 }));
  try {
    const list = usePagedQuery({ route: ({ page, query, limit }) => `/x?q=${query}&limit=${limit}&offset=${(page - 1) * limit}` });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(list.total.value, 30);
    assert.equal(list.rows.value.length, 1);
    list.page.value = 2;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(stub.calls.at(-1), /offset=25/);
    list.query.value = 'orders';
    list.search();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(stub.calls.at(-1), /q=orders&limit=25&offset=0/);
    assert.equal(list.page.value, 1);
  } finally { stub.restore(); }
});

test('a failing request reports the message instead of throwing into the page', async () => {
  const stub = stubFetch(() => new Response(JSON.stringify({ code: 'BOOM', message: '读取失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  try {
    const list = usePagedQuery({ route: () => '/x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(list.listError.value, /读取失败/);
    assert.equal(list.loading.value, false);
  } finally { stub.restore(); }
});

test('changing the reset key restarts at page one', async () => {
  const stub = stubFetch(() => json({ items: [], total: 0, limit: 25, offset: 0 }));
  try {
    // Reactive like the real call sites, which pass the selected project id.
    const projectId = ref(1);
    const list = usePagedQuery({
      route: ({ page }) => `/x?project=${projectId.value}&offset=${(page - 1) * 25}`,
      resetKey: () => projectId.value,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    list.page.value = 3;
    await new Promise((resolve) => setTimeout(resolve, 0));
    projectId.value = 2;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(list.page.value, 1);
    assert.match(stub.calls.at(-1), /project=2&offset=0/);
  } finally { stub.restore(); }
});

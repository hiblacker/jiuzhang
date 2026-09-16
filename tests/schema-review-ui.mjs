// Synthetic schema drift through the real local UI/API; no source connection.
import assert from 'node:assert/strict';
import { chromium, expect, connect, navigate, submit, launchOptions } from './console-browser.mjs';
const { LAKE_UI_API: api, LAKE_UI_URL: ui, LAKE_UI_TOKEN: admin, LAKE_UI_WORKER_TOKEN: worker } = process.env;
assert.ok(api && ui && admin && worker, 'Set local UI/API/admin/worker environment variables');
for (const value of [api, ui]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(value).hostname));
const call = async (route, body, token = admin) => {
  const response = await fetch(api + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error' });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`); return response.json();
};
const code = 'ui_schema_' + Date.now(), day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
await call('sources', { code, sourceType: 'MYSQL', credentialRef: 'env://SYNTHETIC', config: {} });
const object = { objectName: 'example', objectType: 'TABLE', schema: { engine: 'InnoDB', columns: [] }, primaryKey: ['id'], required: true, strategy: 'FULL_SNAPSHOT', state: 'READY' };
const inventory = { sourceCode: code, planVersion: 1, observedAt: new Date().toISOString(), sourceScope: { database: 'synthetic' }, schemaSha256: 'a'.repeat(64), objects: [object] };
await call('lake/inventories', inventory);
const plan = await call('lake/plans', { sourceCode: code, expectedVersion: 0, inventoryVersion: 1, kind: 'MYSQL_SNAPSHOT', runtimeRef: code, timezone: 'Asia/Shanghai', triggerTime: '00:00:00', startDate: day, historicalRead: false, maxAttempts: 3, timeoutSeconds: 300, contract: {} });
let browser;
try {
  browser = await chromium.launch(launchOptions());
  await call(`lake/plans/${plan.id}/trigger`, { day, reason: 'synthetic schema review' });
  const task = await call('lake/executions/claim', { runtimeRefs: [code] }, worker);
  const runtime = { plan_version: 2, source_scope: inventory.sourceScope, tables: [{ table: 'example', engine: 'InnoDB', columns: [{ column: 'id', type: 'int' }], primary_key: ['id'] }] };
  inventory.planVersion = 2; inventory.schemaSha256 = 'b'.repeat(64); object.schema.columns = runtime.tables[0].columns;
  await call(`lake/executions/${task.id}/finish`, { leaseToken: task.leaseToken, state: 'FAILED', errorCode: 'SCHEMA_CHANGE_REVIEW_REQUIRED', result: { schemaChange: { proposedInventory: runtime, inventoryRequest: inventory, changes: { added: [], removed: [], changed: ['example'] } } } }, worker);
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await connect(page, ui, api, admin); await navigate(page, '执行与交付');
  await page.getByLabel('筛选来源', { exact: true }).fill(code);
  const execution = page.getByRole('row').filter({ hasText: code });
  await execution.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.locator('.n-drawer').getByText(/schemaChange/).first()).toBeVisible(); await page.keyboard.press('Escape');
  await execution.getByRole('button', { name: '确认结构变更' }).click();
  await expect(page.locator('.action-modal').getByText(/example/).first()).toBeVisible();
  await page.getByLabel('确认理由').fill('已核对合成字段变化'); await submit(page);
  const active = (await call('lake/plans')).find(item => item.id === plan.id);
  assert.equal(active.active_version, 2); assert.equal(active.inventory_version, 2); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ state: 'PASS', operations: ['review-schema-diff', 'approve-schema', 'new-inventory-and-plan'], pageErrors: 0 }));
} finally {
  try { await call(`lake/plans/${plan.id}/state`, { state: 'PAUSED' }); }
  finally { await browser?.close(); }
}

// Synthetic schema drift through the real UI/API, without any source connection.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { LAKE_UI_API: api, LAKE_UI_URL: ui, LAKE_UI_TOKEN: admin, LAKE_UI_WORKER_TOKEN: worker } = process.env;
assert.ok(api && ui && admin && worker);
for (const value of [api, ui]) assert.equal(new URL(value).hostname, '127.0.0.1');
const call = async (route, body, token = admin) => {
  const response = await fetch(api + '/api/v1/' + route, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `${route}: ${response.status}`); return response.json();
};
const code = 'ui_schema_' + Date.now(), day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
await call('sources', { code, sourceType: 'MYSQL', credentialRef: 'env://SYNTHETIC', config: {} });
const object = { objectName: 'example', objectType: 'TABLE', schema: { engine: 'InnoDB', columns: [] }, primaryKey: ['id'], required: true, strategy: 'FULL_SNAPSHOT', state: 'READY' };
const inventory = { sourceCode: code, planVersion: 1, observedAt: new Date().toISOString(), sourceScope: { database: 'synthetic' }, schemaSha256: 'a'.repeat(64), objects: [object] };
await call('lake/inventories', inventory);
const plan = await call('lake/plans', { sourceCode: code, expectedVersion: 0, inventoryVersion: 1, kind: 'MYSQL_SNAPSHOT', runtimeRef: code, timezone: 'Asia/Shanghai', triggerTime: '00:00:00', startDate: day, historicalRead: false, maxAttempts: 3, timeoutSeconds: 300, contract: {} });
const browser = await chromium.launch({ headless: true });
try {
  await call(`lake/plans/${plan.id}/trigger`, { day, reason: 'synthetic schema review' });
  const task = await call('lake/executions/claim', { runtimeRefs: [code] }, worker);
  const runtime = { plan_version: 2, source_scope: inventory.sourceScope, tables: [{ table: 'example', engine: 'InnoDB', columns: [{ column: 'id', type: 'int' }], primary_key: ['id'] }] };
  inventory.planVersion = 2; inventory.schemaSha256 = 'b'.repeat(64); object.schema.columns = runtime.tables[0].columns;
  await call(`lake/executions/${task.id}/finish`, { leaseToken: task.leaseToken, state: 'FAILED', errorCode: 'SCHEMA_CHANGE_REVIEW_REQUIRED', result: { schemaChange: { proposedInventory: runtime, inventoryRequest: inventory, changes: { added: [], removed: [], changed: ['example'] } } } }, worker);
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(ui); await page.locator('#base-url').fill(api); await page.locator('#token').fill(admin); await page.locator('#refresh').click();
  const execution = page.locator('#executions tr').filter({ hasText: code });
  await execution.getByRole('button', { name: '详情', exact: true }).click();
  await page.locator('#detail').filter({ hasText: 'schemaChange' }).waitFor();
  page.once('dialog', dialog => dialog.accept('已核对合成字段变化'));
  await execution.getByRole('button', { name: '确认结构变更' }).click();
  await page.locator('#detail').filter({ hasText: 'inventoryVersion' }).waitFor();
  const active = (await call('lake/plans')).find(item => item.id === plan.id);
  assert.equal(active.active_version, 2); assert.equal(active.inventory_version, 2); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ state: 'PASS', operations: ['review-schema-diff', 'approve-schema', 'new-inventory-and-plan'], pageErrors: 0 }));
} finally { await call(`lake/plans/${plan.id}/state`, { state: 'PAUSED' }); await browser.close(); }

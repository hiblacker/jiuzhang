// Opt-in acceptance against the real local API; only synthetic objects are created.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect, connect, choose, navigate, confirm, submit, launchOptions } from './console-browser.mjs';

const { LAKE_UI_URL: ui, LAKE_UI_API: api, LAKE_UI_TOKEN: token } = process.env;
assert.ok(ui && api && token, 'Set LAKE_UI_URL, LAKE_UI_API and LAKE_UI_TOKEN for an isolated local test environment');
for (const target of [ui, api]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(target).hostname));
const call = async (route, body) => {
  const response = await fetch(`${api}/api/v1/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`); return response.json();
};
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const source = `ui_review_${Date.now()}`, projectName = `合成资产验收 ${Date.now()}`;
let planId, testRoot;
try {
  await connect(page, ui, api, token);
  await navigate(page, '数据来源');
  await page.getByRole('button', { name: '登记来源', exact: true }).click();
  await page.getByLabel('来源编码', { exact: true }).fill(source); await choose(page, '来源类型', 'FILE');
  await page.getByLabel('凭证引用').fill('env://SYNTHETIC_UI_FOLDER'); await submit(page);
  await navigate(page, '接入计划');
  await page.getByRole('button', { name: '新建计划' }).click();
  await choose(page, '来源', source); await choose(page, '接入方式', '目录文件');
  await page.getByLabel('执行配置名').fill(source); await page.getByRole('checkbox', { name: '来源允许重读过去日期' }).check(); await submit(page);
  const row = page.getByRole('row').filter({ hasText: source });
  await row.getByRole('button', { name: '暂停', exact: true }).click(); await confirm(page);
  await expect(row.getByText('PAUSED', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: '恢复', exact: true }).click(); await confirm(page);
  await expect(row.getByText('ACTIVE', { exact: true })).toBeVisible();
  planId = (await call('lake/plans')).find(plan => plan.source_code === source).id;
  await row.getByRole('button', { name: '触发', exact: true }).click(); await submit(page);
  await navigate(page, '执行与交付'); await page.getByLabel('筛选来源', { exact: true }).fill(source);
  const execution = page.getByRole('row').filter({ hasText: source }).first();
  await expect(execution.getByText('QUEUED', { exact: true })).toBeVisible();
  await execution.getByRole('button', { name: '取消', exact: true }).click(); await confirm(page);
  await expect(execution.getByText('CANCELLED', { exact: true })).toBeVisible();
  await execution.getByRole('button', { name: '重试', exact: true }).click(); await confirm(page);
  await expect(execution.getByText('QUEUED', { exact: true })).toBeVisible();

  await navigate(page, '项目权限'); await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByLabel('项目编码').fill(source); await page.getByLabel('项目名称').fill(projectName); await submit(page);
  await choose(page, '当前项目', projectName);
  await page.getByRole('tab', { name: '来源归属' }).click(); await page.getByRole('button', { name: '分配来源', exact: true }).click();
  await page.getByLabel('来源编码', { exact: true }).fill(source); await submit(page);

  if (process.env.LAKE_UI_WORKER_TOKEN) {
    testRoot = await mkdtemp(path.join(os.tmpdir(), 'warehouse-vue-ui-'));
    const inbox = path.join(testRoot, 'inbox'); await mkdir(inbox);
    await writeFile(path.join(inbox, 'orders.csv'), 'id,team\n001,east\n'); await writeFile(path.join(inbox, 'orders.csv.done'), '');
    const registry = path.join(testRoot, 'registry.json');
    await writeFile(registry, JSON.stringify({ version: 1, lakeRoot: path.join(testRoot, 'lake'), profiles: { [source]: { kind: 'FILE_SCAN', sourceCode: source, inboxRoot: inbox } } }));
    const worker = () => promisify(execFile)(process.execPath, ['apps/ingestion-worker/lake-runtime.mjs', '--registry', registry, '--control-api', api, '--instance', source, '--once'], { env: { ...process.env, CONTROL_API_WORKER_TOKEN: process.env.LAKE_UI_WORKER_TOKEN }, timeout: 30000 });
    await worker(); await navigate(page, '资产目录');
    const asset = page.getByRole('row').filter({ hasText: 'orders.csv' }).first();
    await asset.getByRole('button', { name: '结构与来源' }).click();
    await expect(page.locator('.n-drawer').getByText(/OBSERVED_SAMPLE/).first()).toBeVisible(); await page.keyboard.press('Escape');
    await rm(inbox, { recursive: true, force: true });
    await navigate(page, '执行与交付'); await page.getByLabel('筛选来源', { exact: true }).fill(source);
    await page.getByRole('row').filter({ hasText: source }).filter({ hasText: 'COMPLETE' }).first().getByRole('button', { name: '重解析原件' }).click(); await confirm(page);
    await expect(page.getByRole('row').filter({ hasText: source }).first().getByText('QUEUED', { exact: true })).toBeVisible();
    await worker(); await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.getByLabel('筛选来源', { exact: true }).fill(source);
    await expect(page.getByRole('row').filter({ hasText: source }).first().getByText('COMPLETE', { exact: true })).toBeVisible();
  }

  await navigate(page, '项目权限'); await page.getByRole('tab', { name: '身份', exact: true }).click();
  await page.getByRole('button', { name: '创建身份' }).click(); await page.getByLabel('身份编码', { exact: true }).fill(source); await submit(page);
  const memberToken = await page.getByLabel('新身份令牌').inputValue(); assert.ok(memberToken.length >= 24);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '项目成员' }).click(); await page.getByRole('button', { name: '添加成员' }).click();
  await page.getByLabel('身份编码', { exact: true }).fill(source); await submit(page);
  await connect(page, ui, api, memberToken, '项目成员');
  await expect(page.getByRole('navigation').getByRole('button', { name: '接入计划' })).toHaveCount(0);
  await navigate(page, '项目权限'); await expect(page.getByRole('tab', { name: '项目成员' })).toHaveCount(0);
  await expect(page.getByText(projectName, { exact: true })).toBeVisible();
  await connect(page, ui, api, token);

  if (process.env.LAKE_UI_MODEL_PROJECT) {
    const project = (await call('warehouse/projects')).find(p => String(p.id) === process.env.LAKE_UI_MODEL_PROJECT);
    assert.ok(project, 'Requested model project is not accessible');
    await navigate(page, '模型与数据集'); await choose(page, '当前项目', project.name);
    await page.getByRole('tab', { name: '模型版本', exact: true }).click();
    await page.getByRole('button', { name: '契约详情' }).first().click(); await expect(page.locator('.n-drawer').getByText(/grain/).first()).toBeVisible(); await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '发布历史' }).click(); await expect(page.locator('.n-data-table-tbody tr').first()).toBeVisible();
    await page.getByRole('tab', { name: '数据查询' }).click(); await page.getByRole('button', { name: '查询数据' }).click();
    await expect(page.locator('.query-meta')).toContainText('Release');
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出当前页' }).click();
    assert.match((await download).suggestedFilename(), /^dataset-\d+-release-\d+\.csv$/);
  }
  await mkdir('work/lake-review/ui', { recursive: true });
  await page.screenshot({ path: 'work/lake-review/ui/vue-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile viewport overflow');
  await page.screenshot({ path: 'work/lake-review/ui/vue-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ state: 'PASS', operations: ['source', 'plan', 'pause', 'resume', 'trigger', 'cancel', 'retry', 'project', 'source-binding', 'identity', 'membership', 'viewer-scope', ...(process.env.LAKE_UI_WORKER_TOKEN ? ['file-worker', 'asset-schema', 'file-reprocess'] : []), ...(process.env.LAKE_UI_MODEL_PROJECT ? ['model-versions', 'release-history', 'dataset-query', 'csv-export'] : [])], pageErrors: 0 }));
} finally {
  try { if (planId) await call(`lake/plans/${planId}/state`, { state: 'PAUSED' }); }
  finally { await browser.close(); if (testRoot) await rm(testRoot, { recursive: true, force: true }); }
}

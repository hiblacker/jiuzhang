// Opt-in: drive the registered-SQL console panel in a real browser against a running product
// stack. The script prepares its own synthetic source through the admin API, then verifies what
// only a browser can show: the approved-object tree, validation feedback, the capped preview with
// masking, version save + enablement, the honest refusal of the unimplemented incremental mode,
// and the delivery-plan step. Runtime effects (asset row count) are checked through the API.
//
// Usage: node tests/sql-ingestion-ui.mjs [--settings secrets/product-next.json]
// Requires: the product stack, the synthetic MySQL source and the datasource credential file.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {chromium} from '../apps/console/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const settingsPath = argv.includes('--settings') ? argv[argv.indexOf('--settings') + 1] : 'secrets/product-next.json';
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const base = `http://127.0.0.1:${settings.PRODUCT_API_PORT}`;
const consoleUrl = `http://127.0.0.1:${settings.PRODUCT_CONSOLE_PORT}`;
const admin = settings.CONTROL_API_ADMIN_TOKEN;
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const evidence = {steps: [], state: 'RUNNING'};

function step(name, value) {
  evidence.steps.push({step: name, value: value ?? null});
  console.log(`[ok] ${name}${value === undefined ? '' : ' :: ' + JSON.stringify(value)}`);
}

async function api(route, body, token = admin) {
  const response = await fetch(`${base}/api/v1/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : {};
  assert.ok(response.ok, `${route} -> HTTP ${response.status} ${text.slice(0, 200)}`);
  return value;
}

async function waitFor(route, predicate, description, seconds = 180) {
  const until = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < until) {
    last = await api(route);
    if (predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`TIMEOUT waiting for ${description}; last=${JSON.stringify(last).slice(0, 300)}`);
}

// ------------------------------------------------------------------ synthetic source and channel
const project = (await api('warehouse/projects'))[0];
const owner = `sqlui_${suffix}`, password = `Synthetic-${randomUUID()}`;
const invitation = await api('warehouse/accounts/invite', {identity: owner, displayName: '合成 SQL 验收账号', projectId: project.id, role: 'OWNER'});
// The invitation is single use; the browser activates the account and then signs in.
const environment = (await api('warehouse/environments')).find(item => item.enabled).code;
const resourceCode = `sqlui_${suffix}`;
const resource = await api('warehouse/resources', {
  code: resourceCode, name: `合成 SQL 数据源 ${suffix}`, kind: 'MYSQL_SNAPSHOT', environment,
  resourceGroup: resourceCode, maxParallel: 1, maxBytes: 1073741824, requestsPerSecond: 5});
await api(`warehouse/resources/${resource.id}/grant`, {projectId: project.id});
await api(`warehouse/resources/${resource.id}/datasource`, {
  datasourceType: 'MYSQL',
  config: {host: process.env.SQL_UI_SOURCE_HOST ?? 'jiuzhang-source-mysql', port: 3306, database: 'erp',
    charset: 'utf8mb4', timezone: 'Asia/Shanghai'},
  credentialRef: process.env.SQL_UI_CREDENTIAL_REF ?? 'erp-readonly', statementTimeoutMs: 600000,
  allowedTables: ['biz_order', 'customer'], allowedSchemas: ['erp']});
const test = await api(`warehouse/resources/${resource.id}/tests`, {requestKey: `test-${suffix}`});
const tested = await waitFor(`warehouse/resources/${resource.id}/tests`,
  rows => rows.some(row => row.id === test.id && ['PASSED', 'FAILED'].includes(row.state)), 'connection test');
assert.equal(tested.find(row => row.id === test.id).state, 'PASSED', 'connection test must pass');
const system = await api(`warehouse/projects/${project.id}/systems`,
  {code: resourceCode, name: `合成 SQL 系统 ${suffix}`, businessOwner: '合成业务', technicalOwner: '合成技术'});
const instance = await api(`warehouse/projects/${project.id}/systems/${system.id}/instances`,
  {code: 'ui', name: `合成 UI 实例 ${suffix}`, environment: 'TEST'});
const connectionName = `ERP 只读连接 ${suffix}`;
const connection = await api(`warehouse/projects/${project.id}/instances/${instance.id}/connections`,
  {code: 'erp', name: connectionName, resourceId: resource.id, config: {database: 'erp'}});
const channel = await api(`warehouse/projects/${project.id}/connections/${connection.id}/channels`,
  {code: resourceCode, name: `登记式 SQL ${suffix}`, config: {sourceMode: 'REGISTERED_SQL'}});
const source = channel.source_id;
const route = `warehouse/projects/${project.id}/channels/${source}`;
step('synthetic source prepared', {projectId: project.id, sourceId: source, resourceCode});

// ------------------------------------------------------------------------------ browser session
const errors = [];
const browser = await chromium.launch({headless: true});
const page = await (await browser.newContext({viewport: {width: 1500, height: 1050}})).newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => errors.push(error.message));
const button = (name, scope = page) => scope.getByRole('button', {name, exact: true});
// Naive UI puts the aria-label on the wrapper, so the control is addressed explicitly.
const field = label => page.locator(
  `[aria-label="${label}"] input, [aria-label="${label}"] textarea, input[aria-label="${label}"], textarea[aria-label="${label}"]`).first();
const fillLabel = async (label, value) => field(label).fill(value);

try {
  await page.goto(consoleUrl);
  await button('使用邀请码开户 / 重置密码').click();
  await fillLabel('邀请码', invitation.invitation);
  await fillLabel('密码', password);
  await button('设置密码').click();
  await page.getByLabel('账号', {exact: true}).waitFor();
  step('owner account activated through the console form');
  await fillLabel('账号', owner);
  await fillLabel('密码', password);
  await button('登录').click();
  await page.getByRole('heading', {name: '工作台', exact: true}).waitFor();
  step('owner signed in through the console');

  await page.getByRole('menuitem', {name: '接入管理', exact: true}).click();
  // The catalogue is paged, so the run finds its own system by the unique code instead of scrolling.
  await page.getByPlaceholder('系统、编码、组织或责任人').fill(resourceCode);
  await button('搜索').click();
  await button(`合成 SQL 系统 ${suffix}`).click();
  // The system has one instance, so the detail page preselects it; a second instance would need
  // an explicit choice in the environment selector.
  try {
    await button(connectionName).click({timeout: 6000});
  } catch {
    await page.locator('.n-base-selection').first().click();
    await page.locator('.n-base-select-option:visible').filter({hasText: `合成 UI 实例 ${suffix}`}).click();
    await button(connectionName).click();
  }
  await button('继续配置').click();
  await page.getByText('自定义 SQL（登记式）').waitFor();
  step('wizard opened the SQL panel for the registered-SQL channel');

  const tree = page.locator('[data-test="approved-table-tree"]');
  await tree.waitFor();
  assert.match(await tree.innerText(), /biz_order/, 'the tree lists approved tables');
  assert.match(await tree.innerText(), /customer/, 'the tree lists approved tables');
  const search = field('搜索已批准对象');
  await search.fill('customer');
  await page.waitForTimeout(400);
  assert.doesNotMatch(await tree.innerText(), /biz_order/, 'the tree search filters out other tables');
  await search.fill('');
  await page.waitForTimeout(400);
  await tree.getByText('biz_order', {exact: true}).click();
  const editor = field('SQL 文本');
  assert.match(await editor.inputValue(), /`biz_order`/, 'clicking a table inserts a quoted identifier');
  step('approved-object tree filters and inserts at the caret');

  await editor.fill('DELETE FROM biz_order');
  await button('校验').click();
  await page.locator('.n-alert').filter({hasText: '阻断'}).first().waitFor();
  assert.match(await page.locator('.n-alert').filter({hasText: '阻断'}).first().innerText(), /阻断/, 'a write statement is blocked');
  step('static validation reports a blocking issue in the panel');

  const sql = 'SELECT o.id AS order_id, o.`订单编号` AS order_no, o.`金额` AS amount, '
    + 'o.`更新时间` AS updated_at, c.name AS customer_name FROM biz_order o '
    + 'LEFT JOIN customer c ON c.id = o.id ORDER BY o.id';
  await editor.fill(sql);
  await fillLabel('粒度', '一行一个订单');
  await fillLabel('唯一键', 'order_id');
  await fillLabel('脱敏列', 'customer_name');
  await button('校验').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.n-alert').filter({hasText: '阻断'}).count(), 0, 'the read-only query is accepted');
  await button('保存草稿').click();
  await page.getByText('草稿已保存').waitFor();
  step('draft saved from the panel');

  await button(/预览数据/).click();
  await page.getByText(/预览完成/).waitFor({timeout: 120000});
  const previewGrid = page.locator('[data-test="sql-preview-grid"]');
  await previewGrid.waitFor();
  const grid = await previewGrid.innerText();
  assert.match(grid, /12345678901234567\.89/, 'the preview shows the exact decimal as text');
  assert.match(grid, /\*\*\*/, 'the masked column is hidden in the preview');
  step('capped preview rendered with exact decimals and masking');

  // The panel keeps its status line after a save, so waiting on that text would race the API.
  const waitVersion = async mode => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const versions = await api(`${route}/sql/versions`);
      const found = versions.find(item => item.extraction_mode === mode && item.state === 'VALIDATED');
      if (found) return found.version;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`no VALIDATED ${mode} version appeared`);
  };

  await page.locator('.n-radio').filter({hasText: '水位增量'}).click();
  await page.locator('[data-test="incremental-not-implemented"]').waitFor();
  await page.locator('.n-base-selection').filter({hasText: '来自预览结果列'}).click();
  await page.locator('.n-base-select-option:visible').filter({hasText: 'updated_at'}).click();
  await button('保存为新版本').click();
  await page.getByText('已保存为新版本（待启用）').waitFor();
  const incrementalVersion = await waitVersion('UPDATED_AT_KEYSET');
  await fillLabel('启用原因', 'P0-b 浏览器验收负例');
  await button(`启用版本 ${incrementalVersion}`).click();
  await page.locator('.n-alert').filter({hasText: 'EXTRACTION_MODE_NOT_IMPLEMENTED'}).first().waitFor();
  step('the panel refuses to enable the unimplemented incremental version', {version: incrementalVersion});

  await page.locator('.n-radio').filter({hasText: '全量快照'}).click();
  await page.locator('[data-test="incremental-not-implemented"]').waitFor({state: 'hidden'});
  await button('保存为新版本').click();
  const fullVersion = await waitVersion('FULL');
  await fillLabel('启用原因', 'P0-b 浏览器验收');
  await button(`启用版本 ${fullVersion}`).click();
  await page.getByText(`当前启用：版本 ${fullVersion}`).waitFor();
  step('full-snapshot version saved and enabled from the panel', {version: fullVersion});

  await button('设置交付计划').click();
  await page.getByText(/迟到等待天数|交付计划/).first().waitFor();
  await button('确认范围并启用').click();
  await page.locator('.n-modal').waitFor({state: 'hidden', timeout: 30000}).catch(() => {});
  const channels = await api(`warehouse/projects/${project.id}/connections/${connection.id}/channels`);
  assert.ok(channels.some(item => item.source_id === source && item.plan_id), 'the plan is active after the wizard step');
  step('delivery plan activated through the wizard');

  await page.getByRole('menuitem', {name: '运行中心', exact: true}).click();
  await page.waitForTimeout(1500);
  step('run centre reachable for the operator');

  await api(`${route}/trigger`, {day: new Date().toISOString().slice(0, 10), reason: 'P0-b 浏览器验收', revision: true});
  const assets = await waitFor(`warehouse/projects/${project.id}/assets`,
    rows => rows.some(row => row.source_code === resourceCode && ['RAW_COMMITTED', 'PARSED'].includes(row.state)), 'ingested asset');
  const asset = assets.find(row => row.source_code === resourceCode);
  assert.equal(asset.row_count, 3, JSON.stringify(asset));
  step('runtime asset registered through the UI-configured plan', {assetId: asset.id, rowCount: asset.row_count});

  // ---- P1 routing: real paths, reload stays, history works, unknown paths explain themselves.
  await page.goto(`${consoleUrl}/assets`);
  await page.getByRole('heading', {name: '资产目录', exact: true}).waitFor();
  await page.reload();
  await page.getByRole('heading', {name: '资产目录', exact: true}).waitFor();
  step('deep link opens the page and a reload stays there', {path: '/assets'});
  await page.goBack();
  await page.getByRole('heading', {name: '运行中心', exact: true}).waitFor();
  step('browser back returns to the previous page');
  await page.goto(`${consoleUrl}/no-such-page`);
  await page.getByText('这个地址没有对应的页面，可能链接已过期。', {exact: true}).waitFor();
  step('unknown path renders the not-found page instead of a blank screen');

  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  evidence.state = 'PASS';
  evidence.owner = owner;
  evidence.sourceId = source;
  console.log(JSON.stringify({state: 'PASS', owner, sourceId: source, assetId: asset.id}));
} finally {
  await browser.close();
  mkdirSync('work/diagnostics', {recursive: true});
  writeFileSync('work/diagnostics/sql-ingestion-ui-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
}

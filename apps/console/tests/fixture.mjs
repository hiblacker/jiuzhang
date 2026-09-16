import { expect } from '@playwright/test'

export const adminToken = 'synthetic-admin-frontend-test-only'
export const viewerToken = 'synthetic-viewer-frontend-test-only'
export const engineerToken = 'synthetic-engineer-frontend-test-only'
export const ownerToken = 'synthetic-owner-frontend-test-only'
export async function select(page, label, option) {
  await page.getByLabel(label, { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText(option, { exact: true }).click()
}
export async function connect(page, { token = adminToken, mode = '平台管理' } = {}) {
  await page.goto('/')
  await page.getByLabel('控制 API 地址', { exact: true }).fill('http://127.0.0.1:18080')
  await page.getByLabel('访问令牌', { exact: true }).fill(token)
  if (mode !== '平台管理') {
    await select(page, '访问视图', mode)
  }
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await expect(page.locator('.connection-modal')).toHaveCount(0)
  await expect(page.locator('.sidebar-bottom')).toContainText('控制 API 已连接')
}
export async function nav(page, name) {
  const toggle = page.getByRole('button', { name: '打开导航', exact: true })
  if (await toggle.isVisible()) {
    await toggle.click()
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
}
export async function fixture(page, options = {}) {
  const calls = []
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  let planState = 'ACTIVE'
  let executionState = 'QUEUED'
  let released = false
  const projectRows = [
    { id: 1, code: 'commerce', name: '商业数据', role: 'OWNER', description: '合成测试' },
    { id: 2, code: 'service', name: '服务资产', role: 'OWNER', description: '合成测试' },
  ]
  const contract = {
    version: 1,
    domain: 'commerce',
    grain: 'one order',
    output: 'orders',
    fields: [
      { name: 'id', type: 'text' },
      { name: 'amount', type: 'numeric(18,2)' },
    ],
    uniqueKey: ['id'],
    required: ['id'],
    inputs: [
      {
        alias: 'orders',
        sourceCode: 'file-orders',
        objectName: 'orders.csv',
        columns: [{ name: 'id', type: 'text' }],
      },
    ],
    maxInputRows: 10000,
    maxOutputRows: 10000,
    timeoutSeconds: 120,
  }
  const plan = () => ({
    id: 1,
    source_code: 'file-orders',
    active_version: 2,
    kind: 'FILE_SCAN',
    state: planState,
    trigger_time: '02:00:00',
    timezone: 'Asia/Shanghai',
    runtime_ref: 'file-orders',
    inventory_version: null,
    start_date: '2026-09-15',
    historical_read: false,
    max_attempts: 3,
    timeout_seconds: 3600,
    contract: { pollSeconds: 300 },
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1/', '')
    const body = request.postDataJSON()
    const token = request.headers().authorization?.replace('Bearer ', '')
    calls.push({ path, query: url.search, body, token, method: request.method() })
    const send = (value, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (options.override && (await options.override({ route, request, path, body, send }))) {
      return
    }
    if (![adminToken, viewerToken, engineerToken, ownerToken].includes(token)) {
      return send({ code: 'UNAUTHORIZED' }, 401)
    }
    const isAdmin = token === adminToken
    const role = token === viewerToken ? 'VIEWER' : token === engineerToken ? 'ENGINEER' : 'OWNER'
    if (
      !isAdmin
      && (path.startsWith('lake/')
        || path.startsWith('sources')
        || path.startsWith('warehouse/identities'))
    ) {
      return send({ code: 'FORBIDDEN' }, 403)
    }
    if (path === 'warehouse/projects') {
      return send(
        request.method() === 'POST' ? { id: 3, ...body } : projectRows.map(p => ({ ...p, role })),
      )
    }
    if (path === 'lake/summary') {
      return send({
        runs: { run_count: 12, complete_count: 11 },
        objects: { row_count: 1617565, failed_object_count: 1 },
      })
    }
    if (path === 'lake/runs') {
      return send([
        {
          id: 10,
          source_code: 'file-orders',
          mode: 'DAILY',
          scheduled_window_start: '2026-09-16T00:00:00+08:00',
          state: 'COMPLETE',
        },
      ])
    }
    if (path === 'lake/deliveries') {
      return send([
        {
          source_code: 'file-orders',
          delivery_kind: 'FILE',
          observed_state: 'RECEIVED',
          scheduled_window_start: '2026-09-16T00:00:00+08:00',
          received_at: '2026-09-16T02:03:00+08:00',
        },
      ])
    }
    if (path === 'sources') {
      if (body) {
        return send({ id: 2, ...body, state: 'ACTIVE' })
      }
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Number(url.searchParams.get('limit') || 100)
      const all = options.manySources
        ? Array.from({ length: 115 }, (_, i) => ({
            id: i + 1,
            code: `source-${i + 1}`,
            sourceType: 'FILE',
            state: 'ACTIVE',
          }))
        : [
            {
              id: 1,
              code: 'file-orders',
              sourceType: 'FILE',
              state: 'ACTIVE',
              createdAt: '2026-09-16T02:00:00Z',
            },
          ]
      return send({
        items: all.slice(offset, offset + limit),
        limit,
        offset,
        count: Math.min(limit, all.length - offset),
      })
    }
    if (path === 'lake/plans') {
      return send(body ? { id: 1, version: 3 } : [plan()])
    }
    if (path === 'lake/plans/1/state') {
      planState = body.state
      return send({ id: 1, state: planState })
    }
    if (path.endsWith('/trigger')) {
      executionState = 'QUEUED'
      return send({ id: 1, state: 'QUEUED' })
    }
    if (path === 'lake/executions') {
      return send([
        {
          id: 1,
          source_code: 'file-orders',
          business_date: '2026-09-16',
          attempt: 1,
          kind: 'FILE_SCAN',
          state: executionState,
        },
        {
          id: 2,
          source_code: 'file-orders',
          business_date: '2026-09-15',
          attempt: 1,
          kind: 'FILE_SCAN',
          state: 'COMPLETE',
          result: { assets: [{ kind: 'FILE' }] },
        },
        {
          id: 3,
          source_code: 'mysql-core',
          business_date: '2026-09-16',
          attempt: 1,
          kind: 'MYSQL_SNAPSHOT',
          state: 'FAILED',
          error_code: 'SCHEMA_CHANGE_REVIEW_REQUIRED',
          result: {
            schemaChange: {
              changes: [{ table: 'orders', change: 'COLUMN_ADDED' }],
              proposalId: 'synthetic',
            },
          },
        },
      ])
    }
    if (path.endsWith('/cancel') && path.startsWith('lake/')) {
      executionState = 'CANCELLED'
      return send({ id: 1 })
    }
    if (path.endsWith('/retry')) {
      executionState = 'QUEUED'
      return send({ id: 1 })
    }
    if (path === 'lake/windows') {
      return send([
        {
          source_code: 'file-orders',
          business_date: '2026-09-16',
          revision: 1,
          state: executionState,
        },
      ])
    }
    if (path.startsWith('lake/')) {
      return send({ id: 1, state: 'QUEUED' })
    }
    if (/warehouse\/projects\/\d+\/assets$/.test(path)) {
      const project = path.split('/')[2]
      const offset = Number(url.searchParams.get('offset') || 0)
      return send(
        Array.from({ length: options.manyAssets && offset === 0 ? 100 : 1 }, (_, i) => ({
          id: `mysql:${offset + i + 1}`,
          name: project === '1' ? `orders-${offset + i + 1}` : 'services',
          source_code: 'file-orders',
          kind: 'TABLE',
          state: 'RAW_COMMITTED',
          row_count: 295,
          data_window: '2026-09-16',
          run_id: 10,
          contract_version: 2,
        })),
      )
    }
    if (path.includes('/assets/')) {
      return send({
        id: 'mysql:1',
        name: 'orders',
        schema: { fields: [{ name: 'id', type: 'text' }] },
        primary_key: ['id'],
      })
    }
    if (path.includes('/coverage/')) {
      return send({
        coverage: { required: 157, committed: 157, failed: 0, missing: 0, rows: 1617565 },
      })
    }
    if (path.endsWith('/sources')) {
      return send(
        body ? { projectId: 1, ...body } : [{ id: 1, code: 'file-orders', source_type: 'FILE' }],
      )
    }
    if (path.endsWith('/members')) {
      return send(body ? body : [{ identity_id: 'analyst', role: 'VIEWER', enabled: true }])
    }
    if (path === 'warehouse/identities') {
      return send(
        body
          ? { id: body.id, token: 'synthetic-issued-token-frontend-only' }
          : [{ id: 'analyst', enabled: true, created_at: '2026-09-16' }],
      )
    }
    if (path.endsWith('/revoke')) {
      return send({ enabled: false })
    }
    if (path.endsWith('/datasets')) {
      return send([
        {
          id: 1,
          code: 'orders',
          name: '订单明细',
          active_model_version: 2,
          active_release_id: released ? 8 : 7,
        },
        {
          id: 2,
          code: 'services',
          name: '服务明细',
          active_model_version: 1,
          active_release_id: 9,
        },
      ])
    }
    if (path.endsWith('/versions')) {
      return send([
        {
          version: 2,
          runtime_ref: 'commerce',
          git_revision: 'a'.repeat(40),
          bundle_sha256: 'b'.repeat(64),
          contract,
          created_by: 'local-admin',
          created_at: '2026-09-16',
        },
      ])
    }
    if (path.endsWith('/models')) {
      return send({ id: 1, version: 3 })
    }
    if (path.endsWith('/builds')) {
      return send(
        body
          ? { id: 22 }
          : [
              {
                id: 21,
                model_version: 2,
                state: 'READY',
                result: { quality: 'PASS', dependencies: ['orders'] },
              },
              { id: 22, model_version: 2, state: 'RUNNING' },
            ],
      )
    }
    if (path.endsWith('/publish')) {
      released = true
      return send({ releaseId: 8 })
    }
    if (path.endsWith('/releases')) {
      return send([
        {
          id: 7,
          model_version: 2,
          published_by: 'local-admin',
          published_at: '2026-09-16',
          reason: 'synthetic acceptance',
        },
      ])
    }
    if (path.endsWith('/impact')) {
      return send({ changedContractSections: ['fields'], buildStrategy: 'FULL_FROM_PINNED_ASSETS' })
    }
    if (path.endsWith('/query')) {
      const columns = body.columns || ['id', 'amount']
      return send({
        datasetId: Number(path.split('/')[4]),
        releaseId: body.releaseId || (released ? 8 : 7),
        policyRevision: 2,
        columns,
        rows: [{ id: '001', amount: '1234567890123456.78' }],
        limit: body.limit,
        offset: body.offset || 0,
      })
    }
    if (path.endsWith('/export')) {
      return route.fulfill({
        contentType: 'text/csv',
        body: '"id","amount"\r\n"001","1234567890123456.78"\r\n',
      })
    }
    if (path.endsWith('/policy') || path.endsWith('/cancel')) {
      return send({ ok: true })
    }
    return send({ code: 'UNEXPECTED_TEST_ROUTE' }, 404)
  })
  return { calls, errors }
}

import { test, expect } from '@playwright/test'
import {
  connect,
  fixture,
  nav,
  select,
  viewerToken,
  engineerToken,
  ownerToken,
} from './fixture.mjs'

test('model dialogs reset drafts on reopen and preserve expectedVersion on conflict', async ({
  page,
}) => {
  const state = await fixture(page, {
    override: async ({ path, body, send }) => {
      if (path.endsWith('/models') && body) {
        await send({ code: 'MODEL_VERSION_CHANGED' }, 409)
        return true
      }
    },
  })
  await connect(page)
  await nav(page, '模型与数据集')
  await page.getByRole('tab', { name: '模型版本', exact: true }).click()
  await page.getByRole('button', { name: '登记新版本', exact: true }).click()
  await page.getByLabel('数据集名称', { exact: true }).fill('edited synthetic dataset')
  await page.getByRole('button', { name: '确认提交', exact: true }).click()
  await expect(page.locator('.action-modal')).toContainText('MODEL_VERSION_CHANGED')
  await expect(page.getByLabel('数据集名称', { exact: true })).toHaveValue(
    'edited synthetic dataset',
  )
  expect(
    state.calls.find(call => call.path.endsWith('/models') && call.body).body.expectedVersion,
  ).toBe(2)
  await page.keyboard.press('Escape')
  await expect(page.locator('.action-modal')).toHaveCount(0)
  await page.getByRole('button', { name: '登记模型', exact: true }).click()
  await expect(page.getByLabel('数据集名称', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('当前模型版本', { exact: true })).toHaveValue('0')
})

test('project switching discards an in-flight dataset query and export scope', async ({ page }) => {
  let release
  let started = false
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const state = await fixture(page, {
    override: async ({ path, body, send }) => {
      if (path === 'warehouse/projects/1/datasets/1/query') {
        started = true
        await gate
        await send({
          datasetId: 1,
          releaseId: 7,
          policyRevision: 2,
          columns: ['id'],
          rows: [{ id: 'stale-dataset-result' }],
          limit: body.limit,
          offset: 0,
        }).catch(() => {})
        return true
      }
    },
  })
  await connect(page)
  await nav(page, '模型与数据集')
  await page.getByRole('button', { name: '查询数据' }).click()
  await expect.poll(() => started).toBe(true)
  await select(page, '当前项目', '服务资产')
  release()
  await expect
    .poll(() => state.calls.some(call => call.path === 'warehouse/projects/2/datasets'))
    .toBe(true)
  await expect(page.getByText('stale-dataset-result', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出当前页' })).toHaveCount(0)
  await page.getByRole('button', { name: '查询数据' }).click()
  await expect(page.getByText('1234567890123456.78', { exact: true })).toBeVisible()
})

test('overview loads real-shaped API data and filters by source', async ({ page }) => {
  const state = await fixture(page)
  await connect(page)
  await expect(page.getByText('1,617,565', { exact: true })).toBeVisible()
  await page.getByLabel('筛选来源编码').fill('file-orders')
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await expect
    .poll(() =>
      state.calls.some(
        c => c.path === 'lake/summary' && c.query.includes('sourceCode=file-orders'),
      ),
    )
    .toBeTruthy()
  expect(state.errors).toEqual([])
})

test('sources paginate beyond first 100 and registration uses credential references', async ({
  page,
}) => {
  const state = await fixture(page, { manySources: true })
  await connect(page)
  await nav(page, '数据来源')
  await expect(page.getByText('source-1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('source-51', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('source-101', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '登记来源', exact: true }).click()
  await page.getByLabel('来源编码', { exact: true }).fill('new-orders')
  await select(page, '来源类型', 'FILE')
  await page.getByLabel('凭证引用').fill('env://SYNTHETIC_FOLDER')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path === 'sources' && c.body)?.body)
    .toEqual({
      code: 'new-orders',
      sourceType: 'FILE',
      credentialRef: 'env://SYNTHETIC_FOLDER',
      config: {},
    })
})

test('plan edit preserves contract and version, pause/resume require confirmation', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '接入计划')
  await page.getByRole('button', { name: '修改', exact: true }).click()
  await expect(page.getByLabel('执行配置名')).toHaveValue('file-orders')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path === 'lake/plans' && c.body)?.body?.expectedVersion)
    .toBe(2)
  expect(state.calls.find(c => c.path === 'lake/plans' && c.body).body.contract).toEqual({
    pollSeconds: 300,
  })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  expect(state.calls.filter(c => c.path.endsWith('/state'))).toHaveLength(0)
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('PAUSED', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible()
})

test('execution trigger, cancel, retry, reprocess, calendar and schema approval', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '执行与交付')
  await page.getByRole('button', { name: '触发运行', exact: true }).click()
  await select(page, '计划', 'file-orders · v2')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect.poll(() => state.calls.some(c => c.path.endsWith('/trigger'))).toBeTruthy()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('CANCELLED', { exact: true })).toBeVisible()
  await page
    .getByRole('row')
    .filter({ hasText: 'CANCELLED' })
    .getByRole('button', { name: '重试', exact: true })
    .click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('QUEUED', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重解析原件' }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => state.calls.some(c => c.path.endsWith('/reprocess'))).toBeTruthy()
  await page.getByRole('button', { name: '检查遗漏窗口' }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => state.calls.some(c => c.path.endsWith('/reconcile'))).toBeTruthy()
  await page.getByRole('button', { name: '确认结构变更' }).click()
  await expect(page.getByText(/COLUMN_ADDED/)).toBeVisible()
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByText('请填写确认理由')).toBeVisible()
  await page.getByLabel('确认理由').fill('合成结构变化审核')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/approve-schema'))?.body)
    .toEqual({ reason: '合成结构变化审核' })
  await page.getByRole('tab', { name: '交付窗口' }).click()
  await expect(
    page
      .getByRole('tabpanel', { name: '交付窗口', exact: true })
      .getByText('2026-09-16', { exact: true }),
  ).toBeVisible()
  expect(state.errors).toEqual([])
})

test('assets paginate and reset scope when changing project', async ({ page }) => {
  const state = await fixture(page, { manyAssets: true })
  await connect(page)
  await nav(page, '资产目录')
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('orders-101', { exact: true })).toBeVisible()
  await select(page, '当前项目', '服务资产')
  await expect
    .poll(() =>
      state.calls.some(
        c => c.path === 'warehouse/projects/2/assets' && c.query.includes('offset=0'),
      ),
    )
    .toBeTruthy()
  await expect(page.getByText('orders-101', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '结构与来源' }).first().click()
  await expect(page.getByText('primary_key', { exact: true })).toHaveCount(0)
  await expect(page.locator('.n-drawer').getByText(/primary_key/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '批次覆盖' }).first().click()
  await expect
    .poll(() => state.calls.some(c => c.path === 'warehouse/projects/2/coverage/10'))
    .toBeTruthy()
  await expect(page.locator('.n-drawer').getByText(/"committed": 157/)).toBeVisible()
})

test('query/export and pagination stay on resolved release and preserve decimal text', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '模型与数据集')
  await page.getByLabel('每页行数').fill('1')
  await page.getByLabel('列（逗号分隔，留空使用授权范围）').fill('id,amount')
  await page.getByLabel('等值筛选').fill('{"id":"001"}')
  await page.getByRole('button', { name: '查询数据' }).click()
  await expect(page.getByText('1234567890123456.78', { exact: true })).toBeVisible()
  await page.getByLabel('发布 ID（留空使用当前版本）').fill('99')
  await page.getByLabel('列（逗号分隔，留空使用授权范围）').fill('id')
  await page.getByLabel('等值筛选').fill('{"id":"edited-but-not-submitted"}')
  await page.getByRole('button', { name: '下一页' }).click()
  await expect
    .poll(() => state.calls.filter(c => c.path.endsWith('/query')).at(-1)?.body?.offset)
    .toBe(1)
  expect(state.calls.filter(c => c.path.endsWith('/query')).at(-1).body.releaseId).toBe(7)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前页' }).click()
  expect((await download).suggestedFilename()).toBe('dataset-1-release-7.csv')
  expect(state.calls.find(c => c.path.endsWith('/export')).body).toMatchObject({
    releaseId: 7,
    offset: 1,
    limit: 1,
    columns: ['id', 'amount'],
    equals: { id: '001' },
  })
  await select(page, '当前数据集', '服务明细')
  await expect(page.getByText('1234567890123456.78', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出当前页' })).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test('invalid JSON is rejected locally and 409 preserves form for correction', async ({ page }) => {
  const state = await fixture(page, {
    override: async ({ path, body, send }) => {
      if (path === 'lake/plans' && body) {
        await send({ code: 'PLAN_VERSION_CHANGED' }, 409)
        return true
      }
    },
  })
  await connect(page)
  await nav(page, '接入计划')
  await page.getByRole('button', { name: '修改', exact: true }).click()
  await page.getByLabel('交付契约').fill('{')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByText('交付契约不是有效 JSON')).toBeVisible()
  expect(state.calls.some(c => c.path === 'lake/plans' && c.body)).toBeFalsy()
  await page.getByLabel('交付契约').fill('{}')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect(page.locator('.action-modal').getByText(/PLAN_VERSION_CHANGED/)).toBeVisible()
  await expect(page.getByLabel('执行配置名')).toHaveValue('file-orders')
})

test('model versions, impact, build, publish, history and row-column policy', async ({ page }) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '模型与数据集')
  await page.getByRole('tab', { name: '模型版本', exact: true }).click()
  await page.getByRole('button', { name: '变更影响' }).click()
  await expect(
    page
      .locator('.n-drawer')
      .getByText(/FULL_FROM_PINNED_ASSETS/)
      .first(),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '登记新版本' }).click()
  await page.getByLabel('Git 提交（40 位）').fill('c'.repeat(40))
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/models'))?.body?.expectedVersion)
    .toBe(2)
  await page.getByRole('tab', { name: '构建与质量' }).click()
  await page.getByRole('button', { name: '构建候选' }).click()
  await page.getByLabel('输入资产（别名与资产 ID）').fill('{"orders":"mysql:1"}')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/builds') && c.body)?.body?.inputs)
    .toEqual({ orders: 'mysql:1' })
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await page.getByLabel('发布理由').fill('合成测试质量通过')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByText('Release 8', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '发布历史' }).click()
  await expect(page.getByText('synthetic acceptance', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '行列授权' }).click()
  await page.getByRole('button', { name: '配置数据授权' }).click()
  await page.getByLabel('身份编码', { exact: true }).fill('analyst')
  await page.getByLabel('允许列（逗号分隔）').fill('id,amount')
  await page.getByLabel('行范围（等值条件）').fill('{"team":"east"}')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/policy'))?.body)
    .toEqual({ identity: 'analyst', columns: ['id', 'amount'], rowEquals: { team: 'east' } })
  expect(state.errors).toEqual([])
})

test('project, identity, source assignment, membership and revoke operations', async ({ page }) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '项目权限')
  await page.getByRole('button', { name: '创建项目' }).click()
  await page.getByLabel('项目编码').fill('finance')
  await page.getByLabel('项目名称').fill('财务项目')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() =>
      state.calls.some(c => c.path === 'warehouse/projects' && c.body?.code === 'finance'),
    )
    .toBeTruthy()
  await page.getByRole('tab', { name: '身份', exact: true }).click()
  await page.getByRole('button', { name: '创建身份' }).click()
  await page.getByLabel('身份编码', { exact: true }).fill('reader')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByLabel('新身份令牌')).toHaveValue('synthetic-issued-token-frontend-only')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByLabel('新身份令牌')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: '确认撤销' }).click()
  await expect.poll(() => state.calls.some(c => c.path.endsWith('/revoke'))).toBeTruthy()
  await page.getByRole('tab', { name: '来源归属' }).click()
  await page.getByRole('button', { name: '分配来源' }).click()
  await page.getByLabel('来源编码', { exact: true }).fill('file-orders')
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('tab', { name: '项目成员' }).click()
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByLabel('身份编码', { exact: true }).fill('reader')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/members') && c.body)?.body)
    .toEqual({ identity: 'reader', role: 'VIEWER' })
  expect(state.errors).toEqual([])
})

for (const [name, token] of [
  ['VIEWER', viewerToken],
  ['ENGINEER', engineerToken],
]) {
  test(`${name} sees only authorized controls`, async ({ page }) => {
    const state = await fixture(page)
    await connect(page, { token, mode: '项目成员' })
    await expect(
      page.getByRole('navigation').getByRole('button', { name: '接入计划' }),
    ).toHaveCount(0)
    await nav(page, '模型与数据集')
    await expect(page.getByRole('tab', { name: '行列授权' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '登记模型', exact: true })).toHaveCount(
      name === 'ENGINEER' ? 1 : 0,
    )
    if (name === 'ENGINEER') {
      await page.getByRole('tab', { name: '构建与质量' }).click()
      await expect(page.getByRole('button', { name: '发布', exact: true })).toHaveCount(0)
    }
    await nav(page, '项目权限')
    await expect(page.getByRole('tab', { name: '项目成员' })).toHaveCount(0)
    expect(
      state.calls.some(
        c => c.path.startsWith('lake/') || c.path === 'sources' || c.path.endsWith('/members'),
      ),
    ).toBeFalsy()
  })
}

test('401 clears session data and nothing sensitive is persisted', async ({ page }) => {
  let expire = false
  await fixture(page, {
    override: async ({ send }) => {
      if (expire) {
        await send({ code: 'UNAUTHORIZED' }, 401)
        return true
      }
    },
  })
  await connect(page)
  await nav(page, '资产目录')
  await expect(page.getByText('orders-1', { exact: true })).toBeVisible()
  expire = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByLabel('访问令牌', { exact: true })).toHaveValue('')
  await expect(page.getByText('orders-1', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
})

test('non-local HTTP and URL credentials are rejected before token transmission', async ({
  page,
}) => {
  const state = await fixture(page)
  await page.goto('/')
  await page.getByLabel('控制 API 地址', { exact: true }).fill('http://example.org')
  await page.getByLabel('访问令牌', { exact: true }).fill('synthetic-secret')
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await expect(page.getByText('控制 API 需要 HTTPS，本机可使用 HTTP')).toBeVisible()
  expect(state.calls).toHaveLength(0)
})

test('late project response cannot repopulate data after a scope switch', async ({ page }) => {
  let releaseOld
  let oldStarted
  const started = new Promise((resolve) => {
    oldStarted = resolve
  })
  const released = new Promise((resolve) => {
    releaseOld = resolve
  })
  const state = await fixture(page, {
    override: async ({ path, send }) => {
      if (path === 'warehouse/projects/1/assets') {
        oldStarted()
        await released
        await send([
          { id: 'mysql:999', name: 'stale-project-one', kind: 'TABLE', state: 'RAW_COMMITTED' },
        ]).catch(() => {})
        return true
      }
    },
  })
  await connect(page)
  await nav(page, '资产目录')
  await started
  await select(page, '当前项目', '服务资产')
  await expect(page.getByText('services', { exact: true })).toBeVisible()
  releaseOld()
  await expect(page.getByText('stale-project-one', { exact: true })).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test('HTTP failures are visible and an explicit refresh can recover', async ({ page }) => {
  let fail = true
  const state = await fixture(page, {
    override: async ({ path, send }) => {
      if (path === 'lake/summary' && fail) {
        await send({ code: 'SERVICE_UNAVAILABLE' }, 503)
        return true
      }
    },
  })
  await connect(page)
  await expect(page.getByText(/SERVICE_UNAVAILABLE/)).toBeVisible()
  fail = false
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('1,617,565', { exact: true })).toBeVisible()
  await expect(page.getByText(/SERVICE_UNAVAILABLE/)).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test('all workspaces render without errors or overflow on desktop and mobile', async ({ page }) => {
  const state = await fixture(page)
  await connect(page)
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    const menu = page.getByRole('button', { name: '打开导航', exact: true })
    if (viewport.width > 700) {
      await expect(menu).toBeHidden()
    }
    else {
      await expect(menu).toBeVisible()
    }
    for (const [key, name, cell] of [
      ['overview', '运行概览', null],
      ['sources', '数据来源', 'file-orders'],
      ['plans', '接入计划', 'file-orders'],
      ['runs', '执行与交付', 'mysql-core'],
      ['assets', '资产目录', 'orders-1'],
      ['models', '模型与数据集', null],
      ['access', '项目权限', 'commerce'],
    ]) {
      await nav(page, name)
      if (cell) {
        await expect(page.getByRole('cell', { name: cell, exact: true }).first()).toBeVisible()
      }
      else if (key === 'overview') {
        await expect(page.getByText('1,617,565', { exact: true })).toBeVisible()
      }
      else {
        await expect(page.getByRole('button', { name: '查询数据', exact: true })).toBeEnabled()
        expect(
          (await page.getByLabel('列（逗号分隔，留空使用授权范围）').boundingBox()).width,
        ).toBeGreaterThan(150)
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${name} overflow at ${viewport.width}`,
      ).toBeTruthy()
      await page.screenshot({
        path: `../../work/console-${key}-${viewport.width}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }
    await nav(page, '运行概览')
    await page.screenshot({
      path: `../../work/console-ui-${viewport.width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
  expect(state.errors).toEqual([])
})

test('new plan preserves scheduling choices and triggers an explicit revision', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '接入计划')
  await page.getByRole('button', { name: '新建计划', exact: true }).click()
  await select(page, '来源', 'file-orders')
  await select(page, '接入方式', '目录文件')
  await page.getByLabel('执行配置名').fill('file-orders')
  await page.getByLabel('开始日期').fill('2026-09-16')
  await page.getByLabel('每日触发时间').fill('03:15')
  await select(page, '时区', 'UTC')
  await page.getByRole('checkbox', { name: '来源允许重读过去日期' }).check()
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path === 'lake/plans' && c.body)?.body)
    .toMatchObject({
      sourceCode: 'file-orders',
      kind: 'FILE_SCAN',
      startDate: '2026-09-16',
      triggerTime: '03:15:00',
      timezone: 'UTC',
      maxAttempts: 3,
      timeoutSeconds: 3600,
      historicalRead: true,
      expectedVersion: 2,
    })
  await expect(page.locator('.action-modal')).toHaveCount(0)
  await page.getByRole('button', { name: '触发', exact: true }).click()
  await page.getByRole('checkbox', { name: '生成新修订' }).check()
  await page.getByLabel('触发原因').fill('合成修订')
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/trigger'))?.body)
    .toMatchObject({ revision: true, reason: '合成修订' })
  expect(state.errors).toEqual([])
})

test('model cancellation requires confirmation and keyboard tabs expose the selected panel', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '模型与数据集')
  const query = page.getByRole('tab', { name: '数据查询', exact: true })
  await expect(query).toHaveAttribute('aria-selected', 'true')
  await query.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '模型版本', exact: true })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: '模型版本', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '构建与质量', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  expect(state.calls.some(c => c.path.endsWith('/cancel'))).toBeFalsy()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '确认取消', exact: true }).click()
  await expect
    .poll(() =>
      state.calls.some(c => c.path === 'warehouse/projects/1/datasets/1/builds/22/cancel'),
    )
    .toBeTruthy()
  expect(state.errors).toEqual([])
})

test('empty project scope does not issue unscoped asset or dataset requests', async ({ page }) => {
  const state = await fixture(page, {
    override: async ({ path, send }) => {
      if (path === 'warehouse/projects') {
        await send([])
        return true
      }
    },
  })
  await connect(page, { token: viewerToken, mode: '项目成员' })
  await expect(page.getByText('暂无可访问的项目', { exact: true })).toBeVisible()
  await nav(page, '模型与数据集')
  await expect(page.getByText('暂无可访问的项目', { exact: true })).toBeVisible()
  expect(state.calls.every(c => c.path === 'warehouse/projects')).toBeTruthy()
  expect(state.errors).toEqual([])
})

test('server authorization refusal remains visible without losing the current identity', async ({
  page,
}) => {
  const state = await fixture(page, {
    override: async ({ path, send }) => {
      if (path.endsWith('/query')) {
        await send({ code: 'DATASET_ACCESS_DENIED' }, 403)
        return true
      }
    },
  })
  await connect(page, { token: viewerToken, mode: '项目成员' })
  await nav(page, '模型与数据集')
  await page.getByRole('button', { name: '查询数据' }).click()
  await expect(
    page.getByText('无权执行此操作（DATASET_ACCESS_DENIED）', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.sidebar-bottom')).toContainText('控制 API 已连接')
  await expect(page.getByRole('button', { name: '导出当前页' })).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test('plan dialogs remain usable on desktop and narrow mobile screens', async ({ page }) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '接入计划')
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: '修改', exact: true }).click()
    const modal = page.locator('.action-modal')
    await expect(modal).toBeVisible()
    await expect
      .poll(async () => (await page.getByLabel('执行配置名').boundingBox())?.width ?? 0)
      .toBeGreaterThan(150)
    const bounds = await modal.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(
      await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    ).toBeTruthy()
    await page.screenshot({
      path: `../../work/console-plan-form-${viewport.width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByLabel('执行配置名').fill('synthetic-mobile-edit')
    await page.getByRole('button', { name: '确认提交', exact: true }).scrollIntoViewIfNeeded()
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  }
  expect(state.calls.some(c => c.path === 'lake/plans' && c.body)).toBeFalsy()
  expect(state.errors).toEqual([])
})

test('new model registration validates immutable references and sends version zero', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page)
  await nav(page, '模型与数据集')
  await page.getByRole('button', { name: '登记模型', exact: true }).click()
  await page.getByLabel('数据集编码').fill('synthetic-orders')
  await page.getByLabel('数据集名称').fill('合成订单')
  await page.getByLabel('执行配置名').fill('commerce')
  await page.getByLabel('Git 提交（40 位）').fill('invalid')
  await page.getByLabel('模型包 SHA-256').fill('b'.repeat(64))
  const contract = {
    version: 1,
    domain: 'commerce',
    grain: 'one order',
    output: 'orders',
    fields: [{ name: 'id', type: 'text' }],
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
  await page.getByLabel('数据契约').fill(JSON.stringify(contract))
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect(
    page.locator('.action-modal').getByText('Git 提交必须为 40 位十六进制值'),
  ).toBeVisible()
  expect(state.calls.some(c => c.path.endsWith('/models'))).toBeFalsy()
  await page.getByLabel('Git 提交（40 位）').fill('a'.repeat(40))
  await page.getByRole('button', { name: '确认提交' }).click()
  await expect
    .poll(() => state.calls.find(c => c.path.endsWith('/models'))?.body)
    .toEqual({
      code: 'synthetic-orders',
      name: '合成订单',
      runtimeRef: 'commerce',
      expectedVersion: 0,
      gitRevision: 'a'.repeat(40),
      bundleSha256: 'b'.repeat(64),
      contract,
    })
  expect(state.errors).toEqual([])
})

test('project OWNER manages members and policy but not platform identities or source assignment', async ({
  page,
}) => {
  const state = await fixture(page)
  await connect(page, { token: ownerToken, mode: '项目成员' })
  await nav(page, '项目权限')
  await expect(page.getByRole('button', { name: '分配来源', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '身份', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: '项目成员', exact: true }).click()
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeVisible()
  await nav(page, '模型与数据集')
  await page.getByRole('tab', { name: '行列授权', exact: true }).click()
  await expect(page.getByRole('button', { name: '配置数据授权', exact: true })).toBeVisible()
  expect(
    state.calls.some(
      c =>
        c.path === 'warehouse/identities' || c.path === 'sources' || c.path.startsWith('lake/'),
    ),
  ).toBeFalsy()
  expect(state.errors).toEqual([])
})

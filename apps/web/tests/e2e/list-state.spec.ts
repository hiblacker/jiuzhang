import { test, expect } from '@playwright/test'

test('deleting the final row returns to the last populated page and URL navigation restores filters', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  await page.goto('/sources')
  await expect(page.getByRole('heading', { name: '数据源', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const source = (await (await fetch('/api/v1/sources/1001')).json()).data
    const {
      name: _name,
      id: _id,
      status: _status,
      updatedAt: _updatedAt,
      objectCount: _objectCount,
      ...input
    } = source
    for (let index = 0; index < 21; index++) {
      const response = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ ...input, name: '分页验收 ' + String(index).padStart(2, '0') }),
      })
      if (!response.ok) throw new Error('Cannot create pagination fixture')
    }
  })
  await page.goto('/sources?q=分页验收&page=2&sort=name')
  const row = page.getByRole('row').filter({ hasText: '分页验收 20' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page).not.toHaveURL(/page=2/)
  await expect(page.getByRole('row').filter({ hasText: '分页验收 00' })).toBeVisible()
  await page.getByPlaceholder('搜索名称、标签或负责人', { exact: true }).fill('零售订单库')
  await expect(page.getByRole('row').filter({ hasText: '零售订单库' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('row').filter({ hasText: '分页验收 00' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: '分页验收 00' })).toBeVisible()
  await page.goto('/warehouse/tables?page=999')
  await expect(page).toHaveURL('http://localhost:5174/warehouse/tables?page=2')
  await expect(page.getByRole('row')).toHaveCount(5)
})

for (const domain of ['quality', 'masking'] as const) {
  test(
    domain + ' list paginates HTTP results and recovers from empty, failed and forbidden reads',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
      })
      const path = '/governance/' + domain
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await page.evaluate(async (domain) => {
        const records = (await (await fetch('/api/v1/governance/' + domain)).json()).data
        const { id: _id, updatedAt: _updatedAt, version: _version, ...input } = records[0]
        for (let index = 0; index < 21; index++) {
          const response = await fetch('/api/v1/governance/' + domain, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
            body: JSON.stringify({ ...input, name: '治理分页 ' + String(index).padStart(2, '0') }),
          })
          if (!response.ok) throw new Error('Cannot create governance pagination fixture')
        }
      }, domain)
      await page.goto(path + '?q=治理分页&page=2&sort=name')
      await expect(page.getByRole('button', { name: '治理分页 20', exact: true })).toBeVisible()
      await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(1)
      await page.reload()
      await expect(page.getByRole('button', { name: '治理分页 20', exact: true })).toBeVisible()
      await page
        .getByPlaceholder(domain === 'quality' ? '搜索规则名称' : '搜索策略名称')
        .fill('不存在的治理项')
      await expect(page.getByText('暂无数据', { exact: true })).toBeVisible()
      await expect(page).not.toHaveURL(/page=2/)
      await page.goBack()
      await expect(page.getByRole('button', { name: '治理分页 20', exact: true })).toBeVisible()
      for (const scenario of ['error', 'forbidden'] as const) {
        await page.evaluate(async (scenario) => {
          await fetch('/api/v1/demo/control', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: 'governance', scenario }),
          })
        }, scenario)
        await page.reload()
        await expect(
          page.getByText(
            scenario === 'error'
              ? '当前已启用接口失败演示，可从演示控制台恢复'
              : '当前角色没有操作权限',
            { exact: true },
          ),
        ).toBeVisible()
        await page.evaluate(async () => {
          await fetch('/api/v1/demo/control', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: 'governance', scenario: 'normal' }),
          })
        })
        await page.getByRole('button', { name: '重试', exact: true }).click()
        await expect(page.getByRole('button', { name: '治理分页 20', exact: true })).toBeVisible()
      }
    },
  )
}

for (const resource of ['users', 'services'] as const) {
  test(
    resource + ' list keeps server pagination and search through reload, back and failed reads',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
      })
      const path = resource === 'users' ? '/system/users' : '/services'
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await page.evaluate(
        async ({ resource, path }) => {
          const input =
            resource === 'users'
              ? { role: 'viewer', enabled: true }
              : {
                  description: '虚构分页服务',
                  owner: '演示组',
                  tags: [],
                  tableId: '4001',
                  fields: ['id'],
                  parameters: [],
                  pageSize: 20,
                  sortField: 'id',
                  allowedRoles: ['admin'],
                }
          for (let index = 0; index < 21; index++) {
            const response = await fetch('/api/v1' + path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
              body: JSON.stringify({
                ...input,
                name: '分页管理 ' + String(index).padStart(2, '0'),
              }),
            })
            if (!response.ok)
              throw new Error('Cannot create list resource: ' + (await response.text()))
          }
        },
        { resource, path },
      )
      await page.goto(path + '?q=分页管理&page=2&sort=name')
      const row = page.getByRole('row').filter({ hasText: '分页管理 20' })
      await expect(row).toBeVisible()
      await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(1)
      await page.reload()
      await expect(row).toBeVisible()
      await page
        .getByPlaceholder(resource === 'users' ? '搜索用户' : '搜索服务', { exact: true })
        .fill('不存在的管理项')
      await expect(page.getByText('暂无数据', { exact: true })).toBeVisible()
      await expect(page).not.toHaveURL(/page=2/)
      await page.goBack()
      await expect(row).toBeVisible()
      await page.evaluate(
        async (domain) => {
          await fetch('/api/v1/demo/control', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, scenario: 'error' }),
          })
        },
        resource === 'users' ? 'system' : 'services',
      )
      await page.reload()
      await expect(
        page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
      ).toBeVisible()
      await page.evaluate(
        async (domain) => {
          await fetch('/api/v1/demo/control', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, scenario: 'normal' }),
          })
        },
        resource === 'users' ? 'system' : 'services',
      )
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await expect(row).toBeVisible()
      await page.goto(path + '?q=分页管理&page=999&sort=name')
      await expect(page).toHaveURL(new RegExp('page=2'))
      await expect(row).toBeVisible()
    },
  )
}

for (const resource of ['imports', 'exports', 'queries'] as const) {
  test(
    resource + ' list paginates, persists URL state and recovers from empty and failed reads',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
      })
      const path =
        resource === 'queries' ? '/warehouse/query?tab=history' : '/warehouse/' + resource
      const list = resource === 'queries' ? page.getByRole('tabpanel', { name: '查询历史' }) : page
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await page.evaluate(async (resource) => {
        async function post(path: string, body: unknown) {
          const response = await fetch('/api/v1' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
            body: JSON.stringify(body),
          })
          if (!response.ok) throw new Error(await response.text())
          return (await response.json()).data
        }
        let queryId = ''
        const table = (await (await fetch('/api/v1/warehouse/tables/4001')).json()).data
        if (resource === 'exports') {
          queryId = (await post('/queries', { sql: 'SELECT * FROM ' + table.name + ' LIMIT 100' }))
            .id
          await post('/demo/tick', { advanceSeconds: 3 })
        }
        for (let index = 0; index < 21; index++) {
          if (resource === 'imports') {
            await post('/imports', {
              name: '仓库分页 ' + String(index).padStart(2, '0'),
              tableName: 'ods_list_' + index,
              layer: 'ODS',
              csv: 'id,value\n1,demo',
              mapping: [
                { source: 'id', target: 'id' },
                { source: 'value', target: 'value' },
              ],
              outcome: 'failed',
            })
          } else if (resource === 'queries') {
            await post('/queries', { sql: 'SELECT * FROM ' + table.name + ' LIMIT 100' })
          } else {
            await post('/exports', { queryId, format: 'csv' })
          }
        }
        await post('/demo/tick', { advanceSeconds: 3 })
      }, resource)
      await page.goto(path + (resource === 'queries' ? '&' : '?') + 'page=2')
      await expect(page.getByText('共 21 条', { exact: true })).toBeVisible()
      const rows =
        resource === 'queries'
          ? page.locator('.history-row')
          : page.locator('.n-data-table-tbody tr')
      await expect(rows).toHaveCount(1)
      await page.reload()
      await expect(rows).toHaveCount(1)
      await page
        .getByPlaceholder(resource === 'queries' ? '搜索历史 SQL' : '搜索任务、文件或目标表', {
          exact: true,
        })
        .fill('没有这样的仓库任务')
      await expect(page.getByText('暂无数据', { exact: true })).toBeVisible()
      await expect(page).not.toHaveURL(/page=2/)
      await page.goBack()
      await expect(rows).toHaveCount(1)
      await page.evaluate(async (domain) => {
        await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, scenario: 'error' }),
        })
      }, 'warehouse')
      await page.reload()
      await expect(
        list.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
      ).toBeVisible()
      await page.evaluate(async (domain) => {
        await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, scenario: 'normal' }),
        })
      }, 'warehouse')
      await list.getByRole('button', { name: '重试', exact: true }).click()
      await expect(rows).toHaveCount(1)
      await page.goto(path + (resource === 'queries' ? '&' : '?') + 'page=999')
      await expect(page).toHaveURL(/page=2/)
      await expect(rows).toHaveCount(1)
    },
  )
}

for (const entry of [
  { path: '/sources', domain: 'sources' },
  { path: '/datasets', domain: 'datasets' },
  { path: '/tasks', domain: 'tasks' },
  { path: '/runs', domain: 'runs' },
  { path: '/warehouse/tables', domain: 'warehouse' },
  { path: '/warehouse/imports', domain: 'warehouse' },
  { path: '/warehouse/exports', domain: 'warehouse' },
  { path: '/warehouse/query?tab=history', domain: 'warehouse' },
  { path: '/governance/catalog', domain: 'governance' },
  { path: '/governance/quality', domain: 'governance' },
  { path: '/governance/masking', domain: 'governance' },
  { path: '/services', domain: 'services' },
  { path: '/system/users', domain: 'system' },
  { path: '/system/audit', domain: 'system' },
]) {
  test(
    entry.path + ' list renders empty, error and forbidden states and retries without losing URL',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
      })
      await page.goto(entry.path)
      await expect(page.locator('h1')).toBeVisible()
      const queryHistory = entry.path.startsWith('/warehouse/query')
      const expectedPath = queryHistory ? entry.path + '&tableId=4001' : entry.path
      const list = queryHistory ? page.getByRole('tabpanel', { name: '查询历史' }) : page
      await expect(page).toHaveURL('http://localhost:5174' + expectedPath)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const scenario of ['empty', 'error', 'forbidden'] as const) {
        const status = await page.evaluate(
          async ({ domain, scenario }) => {
            const response = await fetch('/api/v1/demo/control', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
              body: JSON.stringify({ domain, scenario }),
            })
            return response.status
          },
          { domain: entry.domain, scenario },
        )
        expect(status).toBe(200)
        await page.reload()
        const label = {
          empty: '暂无数据',
          error: '当前已启用接口失败演示，可从演示控制台恢复',
          forbidden: '当前角色没有操作权限',
        }[scenario]
        await expect(list.getByText(label, { exact: true }).first()).toBeVisible()
        if (queryHistory && scenario !== 'empty')
          await expect(
            page.locator('.warehouse-table-select').getByText(label, { exact: true }),
          ).toBeVisible()
        await expect(page).toHaveURL('http://localhost:5174' + expectedPath)
        await page.evaluate(async (domain) => {
          const response = await fetch('/api/v1/demo/control', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
            body: JSON.stringify({ domain, scenario: 'normal' }),
          })
          if (!response.ok) throw new Error('Cannot restore mock scenario')
        }, entry.domain)
        if (scenario === 'empty') await page.reload()
        else {
          await list.getByRole('button', { name: '重试', exact: true }).last().click()
          if (queryHistory) {
            await page
              .locator('.warehouse-table-select')
              .getByRole('button', { name: '重试', exact: true })
              .click()
            await expect(page.getByRole('button', { name: '运行查询', exact: true })).toBeEnabled()
          }
        }
        await expect(page.getByText(label, { exact: true })).toHaveCount(0)
        await expect(page.locator('.main-content .loading')).toHaveCount(0)
        await expect(page).toHaveURL('http://localhost:5174' + expectedPath)
      }
      expect(errors).toEqual([])
    },
  )
}

import { expect, test } from '@playwright/test'

const filters = [
  {
    path: '/sources',
    api: '/sources',
    label: '类型',
    option: 'MySQL',
    key: 'type',
    value: 'MySQL',
    field: 'type',
    expected: 'MySQL',
  },
  {
    path: '/sources',
    api: '/sources',
    label: '状态',
    option: '需关注',
    key: 'status',
    value: 'warning',
    field: 'status',
    expected: 'warning',
  },
  {
    path: '/datasets',
    api: '/datasets',
    label: '状态',
    option: '草稿',
    key: 'status',
    value: 'draft',
    field: 'status',
    expected: 'draft',
  },
  {
    path: '/datasets',
    api: '/datasets',
    label: '排序',
    option: '按名称',
    key: 'sort',
    value: 'name',
  },
  {
    path: '/tasks',
    api: '/tasks',
    label: '状态',
    option: '已暂停',
    key: 'status',
    apiKey: 'enabled',
    value: 'false',
    field: 'enabled',
    expected: false,
  },
  {
    path: '/runs',
    api: '/runs',
    label: '运行状态',
    option: '失败',
    key: 'status',
    value: 'failed',
    field: 'status',
    expected: 'failed',
  },
  {
    path: '/runs',
    api: '/runs',
    label: '触发方式',
    option: 'schedule',
    key: 'trigger',
    value: 'schedule',
    field: 'trigger',
    expected: 'schedule',
  },
  {
    path: '/warehouse/tables',
    api: '/warehouse/tables',
    label: '数据分层',
    option: 'DWD',
    key: 'layer',
    value: 'DWD',
    field: 'layer',
    expected: 'DWD',
  },
  {
    path: '/warehouse/tables',
    api: '/warehouse/tables',
    label: '主题域',
    option: '交易',
    key: 'subjectDomain',
    value: '交易',
    field: 'subjectDomain',
    expected: '交易',
  },
  {
    path: '/warehouse/imports',
    api: '/imports',
    label: '状态',
    option: '成功',
    key: 'status',
    value: 'succeeded',
    field: 'status',
    expected: 'succeeded',
  },
  {
    path: '/warehouse/exports',
    api: '/exports',
    label: '状态',
    option: '可下载',
    key: 'status',
    value: 'ready',
    field: 'status',
    expected: 'ready',
  },
  {
    path: '/governance/catalog',
    api: '/governance/catalog',
    label: '类型',
    option: '数据源',
    key: 'kind',
    value: 'source',
    field: 'kind',
    expected: 'source',
  },
  {
    path: '/governance/catalog',
    api: '/governance/catalog',
    label: '认证',
    option: '已发布',
    key: 'certified',
    value: 'true',
    field: 'certified',
    expected: true,
  },
  {
    path: '/governance/catalog',
    api: '/governance/catalog',
    label: '收藏',
    option: '收藏',
    key: 'favorite',
    value: 'true',
    field: 'favorite',
    expected: true,
  },
  {
    path: '/system/audit',
    api: '/system/audit',
    label: '行为',
    option: '初始化',
    key: 'action',
    value: 'seed',
    field: 'action',
    expected: 'seed',
  },
  {
    path: '/system/audit',
    api: '/system/audit',
    label: '资源类型',
    option: 'demo',
    key: 'resource',
    value: 'demo',
    field: 'resource',
    expected: 'demo',
  },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

for (const filter of filters) {
  test(
    filter.path +
      ' ' +
      filter.label +
      ' keyboard filter preserves URL history and shows matching HTTP rows',
    async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(filter.path + '?trace=keyboard')
      await expect(page.locator('h1')).toBeVisible()
      if (
        ['/tasks', '/warehouse/imports', '/warehouse/exports', '/governance/catalog'].includes(
          filter.path,
        )
      ) {
        await page.evaluate(async (path) => {
          async function write(endpoint: string, body?: unknown) {
            const response = await fetch('/api/v1' + endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
              body: body === undefined ? undefined : JSON.stringify(body),
            })
            if (!response.ok) throw new Error(await response.text())
            return (await response.json()).data
          }
          if (path === '/tasks') await write('/tasks/3001/pause')
          if (path === '/governance/catalog')
            await write('/governance/catalog/source-1001/favorite', { favorite: true })
          if (path === '/warehouse/imports') {
            await write('/imports', {
              name: '键盘筛选导入',
              tableName: 'ods_keyboard_filter',
              layer: 'ODS',
              csv: 'id,city\n1,杭州',
              mapping: [
                { source: 'id', target: 'id' },
                { source: 'city', target: 'city' },
              ],
            })
            await write('/demo/tick', { advanceSeconds: 3 })
          }
          if (path === '/warehouse/exports') {
            const query = await write('/queries', { sql: 'SELECT * FROM dwd_retail_1 LIMIT 100' })
            await write('/demo/tick', { advanceSeconds: 3 })
            await write('/exports', { queryId: query.id, format: 'csv' })
            await write('/demo/tick', { advanceSeconds: 2 })
          }
        }, filter.path)
        await page.reload()
        await expect(page.locator('h1')).toBeVisible()
      }
      const control = page
        .locator('.query-toolbar')
        .getByRole('button', { name: filter.label, exact: true })
      await control.press('Enter')
      await expect(control).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('Escape')
      await expect(control).toHaveAttribute('aria-expanded', 'false')
      await expect(control).toBeFocused()
      await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
      await control.press('Enter')
      await expect(control).toHaveAttribute('aria-expanded', 'true')
      const options = page.locator('.n-base-select-menu:visible .n-base-select-option')
      const target = options.filter({ has: page.getByText(filter.option, { exact: true }) })
      const pending = page.locator('.n-base-select-menu:visible .n-base-select-option--pending')
      if ((await pending.count()) === 0) await page.keyboard.press('ArrowDown')
      await expect(pending).toBeVisible()
      const visited = new Set<string>()
      for (;;) {
        const label = (await pending.innerText()).trim()
        if (label === filter.option) break
        expect(visited.has(label), 'Keyboard navigation must reach ' + filter.option).toBe(false)
        visited.add(label)
        await page.keyboard.press('ArrowDown')
        await expect
          .poll(async () => {
            const labels = await pending.allTextContents()
            return labels.length === 1 && labels[0]!.trim() !== label && labels[0]!.trim() !== ''
          })
          .toBe(true)
      }
      await expect(target).toBeVisible()
      await expect(target).toHaveClass(/n-base-select-option--pending/)
      await page.keyboard.press('Enter')
      await expect.poll(() => new URL(page.url()).searchParams.get(filter.key)).toBe(filter.value)
      await expect(control).toContainText(filter.option)
      const selectedUrl = page.url()
      const result = await page.evaluate(async (filter) => {
        const query = new URL(location.href).searchParams
        if (filter.apiKey) {
          query.set(filter.apiKey, query.get(filter.key)!)
          query.delete(filter.key)
        }
        const response = await fetch('/api/v1' + filter.api + '?' + query.toString(), {
          headers: { 'x-demo-role': 'admin' },
        })
        if (!response.ok) throw new Error(await response.text())
        return (await response.json()) as {
          data: Record<string, unknown>[]
          meta: { total: number }
        }
      }, filter)
      expect(result.data.length).toBeGreaterThan(0)
      if (filter.field)
        for (const row of result.data) expect(row[filter.field]).toEqual(filter.expected)
      if (filter.key === 'sort') {
        const names = result.data.map((row) => String(row.name))
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
      }
      await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(result.data.length)
      const expectedNames = result.data.map((row) =>
        String(
          row.name ?? row.fileName ?? (filter.path === '/system/audit' ? row.resourceId : row.id),
        ),
      )
      const first = expectedNames[0]!
      await expect(
        page.locator('.n-data-table-tbody').getByText(first, { exact: true }),
      ).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(filter.path + '?trace=keyboard')
      await page.goForward()
      await expect(page).toHaveURL(selectedUrl)
      await expect(control).toContainText(filter.option)
      await page.reload()
      await expect(control).toContainText(filter.option)
      await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(result.data.length)
      expect(new URL(page.url()).searchParams.get('trace')).toBe('keyboard')
      expect(errors).toEqual([])
    },
  )
}

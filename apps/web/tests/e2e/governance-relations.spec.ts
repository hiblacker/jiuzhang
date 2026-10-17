import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('quality and masking related datasets paginate and search all draft references with independent URL state', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/governance/quality/5001')
  await expect(page.locator('h1')).toHaveText('主键不能为空')
  const fixture = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return await response.json()
    }
    const template = (await request('/datasets/2001')).data
    const ids: string[] = []
    for (const related of [true, false]) {
      for (let batch = 0; batch < 6; batch++) {
        const entries = await Promise.all(
          Array.from({ length: 20 }, async (_, offset) => {
            const index = batch * 20 + offset
            return await request('/datasets', 'POST', {
              name: (related ? 'A_relation_' : 'Z_unrelated_') + String(index).padStart(3, '0'),
              description: '虚构关联分页样本',
              owner: 'demo',
              tags: [],
              folderId: null,
              definition: {
                ...template.definition,
                qualityRuleIds: related ? ['5001'] : [],
                maskPolicyIds: related && index % 2 ? ['6001'] : [],
                fields: template.definition.fields.map((field: { name: string }) => ({
                  ...field,
                  maskPolicyId: related && index % 2 === 0 && field.name === 'phone' ? '6001' : '',
                })),
              },
            })
          }),
        )
        if (related) ids.push(...entries.map((entry) => entry.data.id))
      }
    }
    return { ids }
  })
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v1/datasets') requests.push(url.search)
  })
  for (const kind of ['quality', 'masking']) {
    const path = '/governance/' + kind + '/' + (kind === 'quality' ? '5001' : '6001')
    const url =
      path +
      '?datasetsQ=A_relation_&datasetsPage=6&datasetsPageSize=20&qualityRunsPageSize=50&page=7&trace=keep'
    await page.goto(url)
    const related = page.getByRole('region', { name: '关联数据集', exact: true })
    const rows = related.locator('.n-data-table-tbody tr')
    await expect(rows).toHaveCount(20)
    await expect(related.getByText('共 120 条', { exact: true })).toBeVisible()
    for (let index = 100; index < 120; index++)
      await expect(
        related.getByRole('button', { name: 'A_relation_' + index, exact: true }),
      ).toBeVisible()
    await related.locator('.n-pagination').getByText('1', { exact: true }).click()
    expect(new URL(page.url()).searchParams.get('datasetsPage')).toBeNull()
    expect(new URL(page.url()).searchParams.get('page')).toBe('7')
    expect(new URL(page.url()).searchParams.get('qualityRunsPageSize')).toBe('50')
    await expect(related.getByRole('button', { name: 'A_relation_000', exact: true })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/datasetsPage=6/)
    await page.reload()
    await expect(related.getByRole('button', { name: 'A_relation_119', exact: true })).toBeVisible()
    const search = related.getByRole('textbox', { name: '搜索关联数据集', exact: true })
    await search.fill('A_relation_119')
    await expect(rows).toHaveCount(1)
    await expect(related.getByText('共 1 条', { exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('datasetsPage')).toBeNull()
    expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
    for (const scenario of ['error', 'forbidden', 'empty'] as const) {
      await page.evaluate(async (scenario) => {
        const response = await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
          body: JSON.stringify({ domain: 'datasets', scenario }),
        })
        if (!response.ok) throw new Error(await response.text())
      }, scenario)
      await page.reload()
      const messages = {
        error: '当前已启用接口失败演示，可从演示控制台恢复',
        forbidden: '当前角色没有操作权限',
        empty: '暂无数据',
      }
      await expect(related.getByText(messages[scenario], { exact: true })).toBeVisible()
      await expect(page.locator('h1')).not.toHaveText('')
      await page.evaluate(async () => {
        const response = await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
          body: JSON.stringify({ domain: 'datasets', scenario: 'normal' }),
        })
        if (!response.ok) throw new Error(await response.text())
      })
      if (scenario === 'empty') await page.reload()
      else await related.getByRole('button', { name: '重试', exact: true }).click()
      await expect(rows).toHaveCount(1)
      await expect(search).toHaveValue('A_relation_119')
    }
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
        await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
        .toBe(theme)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(page.viewportSize()?.width)
      await page.screenshot({
        path: '/tmp/jiuzhang-desktop-1280-governance-relations-' + kind + '-' + theme + '.png',
        fullPage: true,
        animations: 'disabled',
      })
    }
    await related.getByRole('button', { name: 'A_relation_119', exact: true }).press('Enter')
    await expect(page).toHaveURL('/datasets/' + fixture.ids[119])
  }
  expect(requests.length).toBeGreaterThan(10)
  expect(
    requests.every((query) => {
      const params = new URLSearchParams(query)
      return (
        params.get('pageSize') === '20' &&
        Boolean(params.get('qualityRuleId') || params.get('maskPolicyId'))
      )
    }),
  ).toBe(true)
  expect(errors).toEqual([])
})

test('quality history finds captured results beyond 100 newer unrelated runs and keeps separate pagination', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.goto('/governance/quality/5001')
  await expect(page.locator('h1')).toHaveText('主键不能为空')
  const fixture = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return await response.json()
    }
    const tasks = (await request('/tasks?pageSize=100')).data
    for (const task of tasks)
      await request('/tasks/' + task.id, 'PATCH', {
        schedule: {
          ...task.schedule,
          mode: 'manual',
          concurrency: 10,
          timeoutSeconds: 86400,
          retries: 0,
          dependencies: [],
        },
      })
    const targetIds: string[] = []
    for (const datasetId of ['2001', '2002']) {
      const dataset = (await request('/datasets/' + datasetId)).data
      await request('/datasets/' + datasetId, 'PATCH', {
        definition: {
          ...dataset.definition,
          qualityRuleIds: datasetId === '2001' ? ['5001'] : ['5002'],
          schedule: {
            ...dataset.definition.schedule,
            mode: 'manual',
            concurrency: 10,
            timeoutSeconds: 86400,
            retries: 0,
            dependencies: [],
          },
        },
      })
      await request('/datasets/' + datasetId + '/publish', 'POST')
      const task = tasks.find((item: { datasetId: string }) => item.datasetId === datasetId)
      for (let batch = 0; batch < 4; batch++) {
        const result = await request('/tasks/' + task.id + '/backfills', 'POST', {
          from: '2026-01-01',
          to: '2026-01-31',
          outcome: 'blocked',
        })
        if (datasetId === '2001')
          targetIds.push(...result.data.map((run: { id: string }) => run.id))
      }
      let checked = false
      for (let step = 0; step < 40; step++) {
        await request('/demo/tick', 'POST', { advanceSeconds: 10 })
        const first = await request('/runs?datasetId=' + datasetId + '&pageSize=100')
        const second = await request('/runs?datasetId=' + datasetId + '&pageSize=100&page=2')
        const completed = [...first.data, ...second.data].filter(
          (run: { trigger: string; qualityResults: unknown[] }) =>
            run.trigger === 'backfill' && run.qualityResults.length > 0,
        )
        if (completed.length === 124) {
          checked = true
          break
        }
      }
      if (!checked) throw new Error('Backfill quality checks did not finish for ' + datasetId)
    }
    const rule = (await request('/governance/quality/5001')).data
    await request('/governance/quality/5001', 'PATCH', {
      parameter: rule.parameter,
      enabled: false,
    })
    const expected = await request('/runs?qualityRuleId=5001&page=2&pageSize=100')
    if (expected.meta.total < 124 || expected.data.length === 0)
      throw new Error('Missing historical target runs')
    return { targetIds, expected }
  })
  await page.goto(
    '/governance/quality/5001?qualityRunsPage=2&qualityRunsPageSize=100&datasetsPageSize=50&trace=keep',
  )
  const history = page.getByRole('region', { name: '质量历史运行', exact: true })
  const rows = history.locator('.n-data-table-tbody tr')
  await expect(rows).toHaveCount(fixture.expected.data.length)
  await expect(
    history.getByText('共 ' + fixture.expected.meta.total + ' 次运行', { exact: true }),
  ).toBeVisible()
  for (const run of fixture.expected.data)
    await expect(history.getByRole('button', { name: run.id, exact: true })).toBeVisible()
  for (const run of fixture.expected.data) {
    const row = rows.filter({ has: page.getByRole('button', { name: run.id, exact: true }) })
    const quality = run.qualityResults.find(
      (result: { ruleId: string }) => result.ruleId === '5001',
    )
    await expect(row.getByRole('cell').nth(1)).toHaveText('v' + quality.version)
    await expect(row.getByRole('cell').nth(2)).toHaveText('v' + run.datasetVersion)
  }
  await history.locator('.n-pagination').getByText('1', { exact: true }).click()
  await expect(rows).toHaveCount(100)
  expect(new URL(page.url()).searchParams.get('datasetsPageSize')).toBe('50')
  await page.goBack()
  await page.reload()
  await expect(rows).toHaveCount(fixture.expected.data.length)
  await page.evaluate(async () => {
    const response = await fetch('/api/v1/demo/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({ domain: 'runs', scenario: 'error' }),
    })
    if (!response.ok) throw new Error(await response.text())
  })
  await page.reload()
  await expect(
    history.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: '关联数据集', exact: true })
      .getByRole('button', { name: '订单明细宽表', exact: true }),
  ).toBeVisible()
  await page.evaluate(async () => {
    const response = await fetch('/api/v1/demo/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({ domain: 'runs', scenario: 'normal' }),
    })
    if (!response.ok) throw new Error(await response.text())
  })
  await history.getByRole('button', { name: '重试', exact: true }).click()
  await expect(rows).toHaveCount(fixture.expected.data.length)
  expect(new URL(page.url()).searchParams.get('qualityRunsPage')).toBe('2')
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-desktop-1280-governance-quality-history-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await history
    .getByRole('button', { name: fixture.expected.data[0].id, exact: true })
    .press('Enter')
  await expect(page).toHaveURL('/runs/' + fixture.expected.data[0].id)
})

test('independent related-list pagination clamps out-of-range pages and preserves unrelated URL values', async ({
  page,
}) => {
  await page.goto(
    '/governance/quality/5001?datasetsPage=999&qualityRunsPage=999&datasetsPageSize=20&qualityRunsPageSize=20&page=8&trace=keep',
  )
  const datasets = page.getByRole('region', { name: '关联数据集', exact: true })
  const history = page.getByRole('region', { name: '质量历史运行', exact: true })
  await expect(datasets.locator('.n-data-table-tbody tr').first()).toBeVisible()
  await expect(history.locator('.n-data-table-tbody tr').first()).toBeVisible()
  await expect.poll(() => new URL(page.url()).searchParams.get('datasetsPage')).toBeNull()
  await expect.poll(() => new URL(page.url()).searchParams.get('qualityRunsPage')).toBe('2')
  expect(new URL(page.url()).searchParams.get('page')).toBe('8')
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  await page.reload()
  await expect(history.locator('.n-data-table-tbody tr')).toHaveCount(16)
  const expected = await page.evaluate(async () => {
    const response = await fetch('/api/v1/datasets?qualityRuleId=5001&pageSize=20')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data.length as number
  })
  expect(expected).toBeGreaterThan(0)
  await expect(datasets.locator('.n-data-table-tbody tr')).toHaveCount(expected)
})

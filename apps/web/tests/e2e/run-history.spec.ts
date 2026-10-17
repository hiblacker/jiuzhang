import { test, expect } from '@playwright/test'

test('resource histories paginate beyond 100, isolate scopes and recover without losing URL state', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/tasks/3001')
  await expect(page.locator('h1')).toBeVisible()
  await page.evaluate(async () => {
    async function request(path: string, body: unknown) {
      const response = await fetch('/api/v1' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
    }
    // Add target runs first, then enough unrelated newer runs to expose global-page filtering.
    for (const task of ['3001', '3002']) {
      for (let batch = 0; batch < 4; batch++)
        await request('/tasks/' + task + '/backfills', {
          from: '2026-01-01',
          to: '2026-01-31',
          outcome: 'blocked',
        })
    }
  })
  const entries = [
    { name: 'source', path: '/sources/1001?tab=sync', filter: 'sourceId=1001' },
    { name: 'dataset', path: '/datasets/2001?tab=runs', filter: 'datasetId=2001' },
    { name: 'task', path: '/tasks/3001?', filter: 'taskId=3001' },
  ]
  for (const entry of entries) {
    const expected = await page.evaluate(async (filter) => {
      const response = await fetch('/api/v1/runs?' + filter + '&page=2&pageSize=100')
      return (await response.json()) as { data: { id: string }[]; meta: { total: number } }
    }, entry.filter)
    expect(expected.meta.total).toBeGreaterThan(100)
    expect(expected.data.length).toBeGreaterThan(0)
    const url = entry.path + '&page=2&pageSize=100&trace=keep'
    await page.goto(url)
    const history = page.getByRole('region', { name: '运行历史', exact: true })
    const rows = history.locator('.n-data-table-tbody tr')
    await expect(rows).toHaveCount(expected.data.length)
    await expect(
      history.getByText('共 ' + expected.meta.total + ' 条', { exact: true }),
    ).toBeVisible()
    for (const run of expected.data)
      await expect(history.getByRole('button', { name: run.id, exact: true })).toBeVisible()
    await expect(
      history.getByRole('cell', { name: /^(queued|running|succeeded|failed|blocked)$/ }),
    ).toHaveCount(0)
    await expect(history.getByRole('cell', { name: /^20[0-9]{2}-.*T.*Z$/ })).toHaveCount(0)
    await history.locator('.n-pagination').getByText('1', { exact: true }).click()
    await expect(page).not.toHaveURL(/page=2/)
    await expect(rows).toHaveCount(100)
    await page.goBack()
    await expect(page).toHaveURL(/page=2/)
    await expect(rows).toHaveCount(expected.data.length)
    await page.goForward()
    await expect(rows).toHaveCount(100)
    await page.goBack()
    await page.reload()
    await expect(rows).toHaveCount(expected.data.length)
    expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
    for (const scenario of ['empty', 'error', 'forbidden'] as const) {
      await page.evaluate(async (scenario) => {
        await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'runs', scenario }),
        })
      }, scenario)
      await page.reload()
      const message = {
        empty: '暂无数据',
        error: '当前已启用接口失败演示，可从演示控制台恢复',
        forbidden: '当前角色没有操作权限',
      }[scenario]
      await expect(history.getByText(message, { exact: true })).toBeVisible()
      await page.evaluate(async () => {
        await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'runs', scenario: 'normal' }),
        })
      })
      if (scenario === 'empty') await page.reload()
      else await history.getByRole('button', { name: '重试', exact: true }).click()
      if (scenario !== 'empty') expect(new URL(page.url()).searchParams.get('page')).toBe('2')
      await expect(history.locator('.n-data-table-tbody tr').first()).toBeVisible()
      await page.goto(url)
      await expect(rows).toHaveCount(expected.data.length)
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
        await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
        .toBe(theme)
      await page.screenshot({
        path: '/tmp/jiuzhang-desktop-1280-run-history-' + entry.name + '-' + theme + '.png',
        fullPage: true,
        animations: 'disabled',
      })
    }
    await history.getByRole('button', { name: expected.data[0]!.id, exact: true }).click()
    await expect(page).toHaveURL('/runs/' + expected.data[0]!.id)
  }
  expect(errors).toEqual([])
})

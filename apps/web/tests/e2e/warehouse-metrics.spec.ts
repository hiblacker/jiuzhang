import { expect, test } from '@playwright/test'

test('warehouse overview aggregates every table across pages and restores failures', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  await page.goto('/warehouse/tables')
  await expect(page.locator('h1')).toBeVisible()
  const importIds = await page.evaluate(async () => {
    const layers = ['ODS', 'DWD', 'DWS', 'ADS'] as const
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    const ids: string[] = []
    for (let batch = 0; batch < 13; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, offset) => {
          const index = batch * 8 + offset
          return fetch('/api/v1/imports', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name: '分层统计样本' + index,
              tableName: 'demo_metrics_' + index,
              layer: layers[index % 4],
              csv: 'id,city\n1,杭州\n2,宁波',
              mapping: [
                { source: 'id', target: 'id' },
                { source: 'city', target: 'city' },
              ],
            }),
          })
        }),
      )
      for (const response of responses) {
        if (!response.ok) throw new Error(await response.text())
        ids.push(((await response.json()) as { data: { id: string } }).data.id)
      }
    }
    const tick = await fetch('/api/v1/demo/tick', {
      method: 'POST',
      headers,
      body: JSON.stringify({ advanceSeconds: 3 }),
    })
    if (!tick.ok) throw new Error(await tick.text())
    return ids
  })
  expect(importIds).toHaveLength(104)
  await expect
    .poll(() =>
      page.evaluate(async (ids) => {
        const completed: string[] = []
        for (let current = 1; ; current++) {
          const response = await fetch('/api/v1/imports?pageSize=100&page=' + current, {
            headers: { 'x-demo-role': 'admin' },
          })
          if (!response.ok) throw new Error(await response.text())
          const result = (await response.json()) as {
            data: { id: string; status: string }[]
            meta: { total: number }
          }
          for (const task of result.data) {
            if (!ids.includes(task.id)) continue
            if (task.status === 'failed') throw new Error('Import failed: ' + task.id)
            if (task.status === 'succeeded') completed.push(task.id)
          }
          if (current * 100 >= result.meta.total) return completed.length
        }
      }, importIds),
    )
    .toBe(importIds.length)
  const expected = await page.evaluate(async () => {
    const layers = ['ODS', 'DWD', 'DWS', 'ADS'] as const
    const headers = { 'x-demo-role': 'admin' }
    const totals = layers.map((layer) => ({ layer, tableCount: 0, rowCount: '0' }))
    const ids = new Set<string>()
    let total: number | undefined
    for (let current = 1; ; current++) {
      const response = await fetch('/api/v1/warehouse/tables?pageSize=100&page=' + current, {
        headers,
      })
      if (!response.ok) throw new Error(await response.text())
      const result = (await response.json()) as {
        data: { id: string; layer: string; rowCount: string }[]
        meta: { total: number }
      }
      total ??= result.meta.total
      if (result.meta.total !== total) throw new Error('Table total changed during pagination')
      for (const table of result.data) {
        if (ids.has(table.id)) throw new Error('Duplicate table across pages: ' + table.id)
        ids.add(table.id)
        const group = totals.find((item) => item.layer === table.layer)!
        group.tableCount++
        group.rowCount = (BigInt(group.rowCount) + BigInt(table.rowCount)).toString()
      }
      if (current * 100 >= total) break
    }
    if (total === undefined || total <= 100) throw new Error('Expected multiple table pages')
    if (ids.size !== total) throw new Error('Paginated tables do not match their total')
    return { totals, total }
  })
  await page.goto('/warehouse/overview')
  for (const layer of expected.totals) {
    const card = page
      .locator('.n-card')
      .filter({ has: page.getByText(layer.layer + ' 表数量', { exact: true }) })
    await expect(card.locator('.n-statistic-value')).toHaveText(String(layer.tableCount))
    await expect(card.locator('p')).toHaveText(layer.rowCount + '行合成数据')
  }
  await page.reload()
  for (const layer of expected.totals) {
    const card = page
      .locator('.n-card')
      .filter({ has: page.getByText(layer.layer + ' 表数量', { exact: true }) })
    await expect(card.locator('.n-statistic-value')).toHaveText(String(layer.tableCount))
  }
  const ods = page.locator('.n-card').filter({ has: page.getByText('ODS 表数量', { exact: true }) })
  await ods.getByRole('button', { name: '查看分层表 →', exact: true }).click()
  await expect(page).toHaveURL('/warehouse/tables?layer=ODS')
  await expect(
    page.getByText('共' + expected.totals[0]!.tableCount + '条', { exact: true }),
  ).toBeVisible()
  await page.goBack()
  await expect(page.locator('h1')).toHaveText('仓库概览')
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    )
    await page.screenshot({
      path: '/tmp/jiuzhang-desktop-1280-warehouse-metrics-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  async function scenario(value: 'normal' | 'error') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'warehouse', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  await scenario('error')
  await page.reload()
  await expect(
    page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await scenario('normal')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  for (const layer of expected.totals) {
    const card = page
      .locator('.n-card')
      .filter({ has: page.getByText(layer.layer + ' 表数量', { exact: true }) })
    await expect(card.locator('.n-statistic-value')).toHaveText(String(layer.tableCount))
  }
})

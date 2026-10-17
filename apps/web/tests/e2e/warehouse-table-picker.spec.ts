import { test, expect } from '@playwright/test'

test('service and SQL table pickers reach later pages and restore a selected table outside the first 100', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/services/7001')
  await expect(page.locator('h1')).toBeVisible()
  const tableTotal = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    for (let batch = 0; batch < 11; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, index) => {
          const name = 'ods_picker_' + String(batch * 10 + index).padStart(3, '0')
          return fetch('/api/v1/imports', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name,
              tableName: name,
              layer: 'ODS',
              csv: 'id,city\n1,杭州',
              mapping: [
                { source: 'id', target: 'id' },
                { source: 'city', target: 'city' },
              ],
            }),
          })
        }),
      )
      for (const response of responses) if (!response.ok) throw new Error(await response.text())
    }
    const tick = await fetch('/api/v1/demo/tick', {
      method: 'POST',
      headers,
      body: JSON.stringify({ advanceSeconds: 3 }),
    })
    if (!tick.ok) throw new Error(await tick.text())
    const response = await fetch('/api/v1/warehouse/tables?pageSize=100', { headers })
    if (!response.ok) throw new Error(await response.text())
    const result = (await response.json()) as { data: { id: string }[]; meta: { total: number } }
    if (result.meta.total <= 100 || result.data.some((table) => table.id === '4001'))
      throw new Error('Expected original table to be outside the first 100')
    return result.meta.total
  })
  await page.goto('/services/7001/edit')
  const source = page.locator('.warehouse-table-select')
  await expect(source.getByText('dwd_retail_1', { exact: true })).toBeVisible()
  await page.getByLabel('输出字段', { exact: true }).click()
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('city', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '保存服务', exact: true }).click()
  await expect(page).toHaveURL('/services/7001')
  await page.goto('/services/new')
  await page.getByLabel('服务名称', { exact: true }).fill('跨分页仓库表服务')
  await source.click()
  await page.getByRole('button', { name: '加载更多仓库表', exact: true }).click()
  await expect(page.getByText('已加载 40 / ' + tableTotal + ' 张表', { exact: true })).toBeVisible()
  await source.click()
  const search = page.getByRole('textbox', { name: '来源仓库表', exact: true })
  await search.fill('ods_picker_000')
  await page
    .locator('.n-base-select-menu:visible')
    .getByText('ods_picker_000', { exact: true })
    .click()
  await page.getByLabel('输出字段', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('city', { exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '保存服务', exact: true }).click()
  await expect(page.getByRole('heading', { name: '跨分页仓库表服务', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '参数调用器', exact: true }).click()
  await page.getByRole('button', { name: '模拟调用', exact: true }).click()
  await expect(page.getByRole('cell', { name: '杭州', exact: true })).toBeVisible()
  await page.goto('/warehouse/query?tableId=4001')
  const table = page.locator('.warehouse-table-select')
  await expect(table.getByText('dwd_retail_1', { exact: true })).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM dwd_retail_1 LIMIT 100')
  await page.reload()
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM dwd_retail_1 LIMIT 100')
  await table.click()
  await page.getByRole('textbox', { name: '选择仓库表', exact: true }).fill('ods_picker_000')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('ods_picker_000', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM ods_picker_000 LIMIT 100')
  await page.getByRole('button', { name: '运行查询', exact: true }).click()
  await expect(page.getByRole('cell', { name: '杭州', exact: true })).toBeVisible()
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
      path: '/tmp/jiuzhang-desktop-1280-warehouse-table-picker-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.goto('/services/new')
  await page.getByLabel('服务名称', { exact: true }).fill('选表失败保留草稿')
  async function scenario(value: 'error' | 'normal') {
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
  await source.click()
  await page.getByRole('textbox', { name: '来源仓库表', exact: true }).fill('ods_picker_001')
  await page.keyboard.press('Escape')
  await expect(
    page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('服务名称', { exact: true })).toHaveValue('选表失败保留草稿')
  await scenario('normal')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await source.click()
  await page
    .locator('.n-base-select-menu:visible')
    .getByText('ods_picker_001', { exact: true })
    .click()
  await page.getByLabel('输出字段', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('city', { exact: true }).click()
  await page.keyboard.press('Escape')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/services')
  await expect(page.getByRole('heading', { name: '数据服务', exact: true })).toBeVisible()
  const services = await page.evaluate(async () => {
    const response = await fetch('/api/v1/services?q=' + encodeURIComponent('选表失败保留草稿'), {
      headers: { 'x-demo-role': 'admin' },
    })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()) as { meta: { total: number } }
  })
  expect(services.meta.total).toBe(0)
  await page.goto('/warehouse/query?tableId=missing-table')
  await expect(page.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '运行查询', exact: true })).toBeDisabled()
  await expect(page).toHaveURL(/tableId=missing-table/)
  expect(errors).toEqual([])
})

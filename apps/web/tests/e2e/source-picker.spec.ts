import { expect, test } from '@playwright/test'

test('dataset source picker reaches later pages, restores off-page selections and preserves drafts through failures', async ({
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
  await page.goto('/datasets/2001/edit')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).not.toHaveValue('')
  const fixture = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    const response = await fetch('/api/v1/sources/1001', { headers })
    if (!response.ok) throw new Error(await response.text())
    const source = (await response.json()).data
    const { id: _id, status: _status, objectCount: _count, updatedAt: _at, ...input } = source
    for (let batch = 0; batch < 11; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          fetch('/api/v1/sources', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ...input,
              name: 'A_picker_' + String(batch * 10 + index).padStart(3, '0'),
            }),
          }),
        ),
      )
      for (const created of responses) if (!created.ok) throw new Error(await created.text())
    }
    const listed = await fetch('/api/v1/sources?sort=name&pageSize=100', { headers })
    if (!listed.ok) throw new Error(await listed.text())
    const result = (await listed.json()) as { data: { id: string }[]; meta: { total: number } }
    if (result.meta.total <= 100 || result.data.some((item) => item.id === '1001'))
      throw new Error('Expected selected source beyond the first 100 sorted records')
    return { name: source.name as string, total: result.meta.total }
  })
  const requests: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v1/sources') requests.push(url)
  })
  await page.reload()
  const picker = page.getByRole('group', { name: '数据源选择', exact: true })
  const search = page.getByRole('textbox', { name: '数据源', exact: true })
  await expect(search).toBeVisible()
  await expect(picker.getByText(fixture.name, { exact: true })).toBeVisible()
  await expect(
    picker.getByText('已加载 20 / ' + fixture.total + ' 个数据源', { exact: true }),
  ).toBeVisible()
  await picker.getByRole('button', { name: '加载更多数据源', exact: true }).click()
  await expect(
    picker.getByText('已加载 40 / ' + fixture.total + ' 个数据源', { exact: true }),
  ).toBeVisible()
  await search.focus()
  await search.fill('A_picker_109')
  const menu = page.locator('.n-base-select-menu:visible')
  await expect(menu.getByText('A_picker_109', { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(picker.getByText('A_picker_109', { exact: true })).toBeVisible()
  await page.getByLabel('源对象', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('orders', { exact: true }).click()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  await page.goto('/datasets/2001/edit')
  await expect(picker.getByText('A_picker_109', { exact: true })).toBeVisible()
  await page.reload()
  await expect(picker.getByText('A_picker_109', { exact: true })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 768, height: 1024 })
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({
      path: 'test-results/source-picker-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.getByRole('textbox', { name: '数据集名称', exact: true }).fill('选源失败保留草稿')
  async function scenario(value: 'error' | 'normal') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'sources', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  await scenario('error')
  await search.fill('A_picker_108')
  await page.keyboard.press('Escape')
  await expect(
    picker.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue(
    '选源失败保留草稿',
  )
  await scenario('normal')
  await picker.getByRole('button', { name: '重试', exact: true }).click()
  await expect(
    picker.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toHaveCount(0)
  await search.click()
  await expect(menu.getByText('A_picker_108', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  await expect(page.getByRole('heading', { name: '订单明细宽表', exact: true })).toBeVisible()
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((url) => url.searchParams.get('pageSize') === '20')).toBe(true)
  expect(requests.some((url) => url.searchParams.get('page') === '2')).toBe(true)
  expect(requests.some((url) => url.searchParams.get('q') === 'A_picker_109')).toBe(true)
  await page.goto('/datasets/new?sourceId=missing-source&objectId=missing-object')
  await expect(picker.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
  await expect(picker.getByText('missing-source', { exact: true })).toHaveCount(0)
  await expect(page).toHaveURL('/datasets/new?sourceId=missing-source&objectId=missing-object')
  expect(errors).toEqual([])
})

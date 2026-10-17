import { test, expect } from '@playwright/test'

test('service audit reaches records beyond 100 and restores pagination, failures and themes', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.addInitScript(() => {
    if (!localStorage.getItem('jiuzhang.preference.session')) {
      localStorage.setItem('jiuzhang.preference.session', 'demo')
      localStorage.setItem('jiuzhang.preference.role', 'admin')
    }
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/services/7001?tab=audit')
  await expect(page.locator('h1')).toBeVisible()
  const expected = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    for (let batch = 0; batch < 11; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch('/api/v1/services/7001/call', {
            method: 'POST',
            headers,
            body: JSON.stringify({ parameters: {} }),
          }),
        ),
      )
      for (const response of responses) if (!response.ok) throw new Error(await response.text())
    }
    const response = await fetch('/api/v1/services/7001/audit?page=2&pageSize=100', { headers })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()) as {
      data: { id: string; at: string; actor: string }[]
      meta: { total: number }
    }
  })
  expect(expected.meta.total).toBeGreaterThan(100)
  const url = '/services/7001?tab=audit&page=2&pageSize=100&trace=keep'
  await page.goto(url)
  const panel = page.getByRole('tabpanel', { name: '审计日志', exact: true })
  const rows = panel.locator('.n-data-table-tbody tr')
  await expect(rows).toHaveCount(expected.data.length)
  await expect(panel.getByText('共 ' + expected.meta.total + ' 条', { exact: true })).toBeVisible()
  await expect(panel.locator('time[datetime]')).toHaveCount(expected.data.length)
  await expect(panel.getByRole('cell', { name: '调用', exact: true })).toHaveCount(
    expected.data.length,
  )
  expect(await panel.locator('time').first().getAttribute('datetime')).toBe(expected.data[0]!.at)
  await panel.locator('.n-pagination').getByText('1', { exact: true }).click()
  await expect(rows).toHaveCount(100)
  await page.goBack()
  await expect(rows).toHaveCount(expected.data.length)
  await page.goForward()
  await expect(rows).toHaveCount(100)
  await page.goBack()
  await page.reload()
  await expect(rows).toHaveCount(expected.data.length)
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  await panel.locator('.n-pagination .n-select').click()
  await page.locator('.n-base-select-menu:visible').getByText('20 / 页', { exact: true }).click()
  await expect(rows).toHaveCount(20)
  await expect(page).not.toHaveURL(/page=2/)
  await page.goto(url)
  await expect(rows).toHaveCount(expected.data.length)
  async function scenario(value: 'error' | 'normal') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'services', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  await scenario('error')
  await panel.locator('.n-pagination').getByText('1', { exact: true }).click()
  await expect(panel.getByRole('button', { name: '重试', exact: true })).toBeVisible()
  await scenario('normal')
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await expect(rows).toHaveCount(100)
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  await page.goBack()
  await expect(rows).toHaveCount(expected.data.length)
  await expect(page).toHaveURL(/tab=audit&page=2&pageSize=100&trace=keep/)
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
      path: '/tmp/jiuzhang-desktop-1280-service-audit-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.goto('/services/7002?tab=audit&page=2&pageSize=100')
  await expect(panel.getByText('暂无数据', { exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/page=2/)
  expect(errors).toEqual([])
})

import { expect, test } from '@playwright/test'

test('compact source summary keeps long owners readable and preserves ID copying', async ({
  page,
  context,
}) => {
  test.setTimeout(60000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    localStorage.setItem('jiuzhang.preference.theme', 'light')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const owner = 'long_owner_'.repeat(40)
  await page.goto('/sources/1001')
  await expect(page.getByRole('heading', { name: '零售订单库', exact: true })).toBeVisible()
  await page.evaluate(async (owner) => {
    const response = await fetch('/api/v1/sources/1001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({ owner }),
    })
    if (!response.ok) throw new Error(await response.text())
  }, owner)
  await page.reload()
  const summary = page.getByRole('region', { name: '基本信息', exact: true })
  await expect(summary.getByText(owner, { exact: true })).toBeVisible()
  expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(40)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(page.viewportSize()?.width)
  await expect(summary.getByText('MySQL', { exact: true })).toBeVisible()
  await expect(summary.getByText(owner, { exact: true })).toHaveText(owner)
  await summary.locator('.source-owner .n-ellipsis').focus()
  await expect(page.getByRole('tooltip')).toHaveText(owner)
  await page.keyboard.press('Escape')
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).press('Enter')
    await page.screenshot({
      path: '/tmp/jiuzhang-detail-summary-' + page.viewportSize()?.width + '-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await summary.getByRole('button', { name: '复制', exact: true }).press('Enter')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('1001')
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.reload()
  await expect(summary.getByText(owner, { exact: true })).toHaveText(owner)
  expect(errors).toEqual([])
})

test('run summary retains readable desktop columns, version navigation and copy actions', async ({
  page,
  context,
}) => {
  test.setTimeout(60000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    localStorage.setItem('jiuzhang.preference.theme', 'light')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/runs/9003')
  const summary = page.locator('.n-descriptions').first()
  await expect(summary.getByText('成功', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      summary
        .locator('.n-descriptions-table-content')
        .evaluateAll((cells) =>
          Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
        ),
    )
    .toBeGreaterThanOrEqual(220)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(page.viewportSize()?.width)
  await expect(summary.getByRole('button', { name: 'v1', exact: true })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).press('Enter')
    await page.screenshot({
      path: '/tmp/jiuzhang-run-summary-' + page.viewportSize()?.width + '-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await summary.getByRole('button', { name: '复制', exact: true }).press('Enter')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('9003')
  await summary.getByRole('button', { name: 'v1', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2003/versions/1')
  await page.goBack()
  await expect(page).toHaveURL('/runs/9003')
  await expect(summary.getByText('成功', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

import { expect, test, type Page } from '@playwright/test'

async function selectOption(page: Page, name: string) {
  const menu = page.locator('.n-base-select-menu:visible')
  const options = menu.locator('.n-base-select-option')
  const target = options.filter({ has: page.getByText(name, { exact: true }) })
  await expect(target).toBeVisible()
  const count = await options.count()
  for (let step = 0; step < count; step++) {
    if ((await target.getAttribute('class'))?.includes('n-base-select-option--pending')) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(target).toHaveClass(/n-base-select-option--pending/)
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
}

test('demo console keyboard controls apply an HTTP failure and recover without changing other domains', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets')
  await expect(page.getByRole('heading', { name: '数据集', exact: true })).toBeVisible()
  const toggle = page.getByRole('button', { name: '演示控制台', exact: true })
  await toggle.press('Enter')
  const panel = page.locator('.demo-panel')
  const domain = panel.getByRole('button', { name: '场景作用域', exact: true })
  const scenario = panel.getByRole('button', { name: '演示场景', exact: true })
  await expect(domain).toHaveAttribute('aria-disabled', 'false')
  await domain.press('Enter')
  await expect(domain).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(domain).toHaveAttribute('aria-expanded', 'false')
  await expect(domain).toBeFocused()
  await expect(domain).toHaveAttribute('aria-disabled', 'false')
  await domain.press('Enter')
  await selectOption(page, 'datasets')
  await expect(scenario).toHaveAttribute('aria-disabled', 'false')
  await scenario.press('Enter')
  await selectOption(page, '接口失败')
  await panel.getByRole('button', { name: '应用场景并刷新', exact: true }).press('Enter')
  await expect(
    page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: '数据源', exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '零售订单库', exact: true })).toBeVisible()
  await toggle.press('Enter')
  await expect(domain).toHaveAttribute('aria-disabled', 'false')
  await domain.press('Enter')
  await selectOption(page, 'datasets')
  await expect(scenario).toHaveAttribute('aria-disabled', 'false')
  await scenario.press('Enter')
  await selectOption(page, '正常')
  await panel.getByRole('button', { name: '应用场景并刷新', exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '零售订单库', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '数据集', exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '订单明细宽表', exact: true })).toBeVisible()
  await expect(
    page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toHaveCount(0)
  expect(errors).toEqual([])
})

test('demo clock advances through the console and reset cancel preserves saved data', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    if (!localStorage.getItem('jiuzhang.preference.theme'))
      localStorage.setItem('jiuzhang.preference.theme', 'light')
    Date.now = () => Date.parse('2026-10-17T00:00:00.000Z')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/sources/1001')
  await expect(page.getByRole('heading', { name: '零售订单库', exact: true })).toBeVisible()
  const customName = '演示控制台重置验收'
  await page.evaluate(async (name) => {
    const response = await fetch('/api/v1/sources/1001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) throw new Error(await response.text())
  }, customName)
  await page.reload()
  await expect(page.getByRole('heading', { name: customName, exact: true })).toBeVisible()
  const toggle = page.getByRole('button', { name: '演示控制台', exact: true })
  await toggle.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.locator('.demo-panel')
  const domain = panel.getByRole('button', { name: '场景作用域', exact: true })
  await expect(domain).toHaveAttribute('aria-disabled', 'false')
  const before = await panel.locator('.clock-value').textContent()
  await panel.getByRole('button', { name: '推进 10 秒', exact: true }).press('Enter')
  await expect(domain).toHaveAttribute('aria-disabled', 'false')
  await expect
    .poll(async () => {
      const after = await panel.locator('.clock-value').textContent()
      return Date.parse(after!) - Date.parse(before!)
    })
    .toBe(10000)
  const reset = panel.getByRole('button', { name: '重置全部演示数据', exact: true })
  let resets = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/demo/reset')
      resets++
  })
  await reset.press('Enter')
  const confirmation = page.locator('.n-popconfirm')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(confirmation).toHaveCount(0)
  expect(resets).toBe(0)
  await expect(page.getByRole('heading', { name: customName, exact: true })).toBeVisible()
  const selectionColors: string[] = []
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).press('Enter')
    await expect(panel).toBeVisible()
    const selection = panel.locator('.n-base-selection').first()
    await expect(selection).toHaveCSS('color-scheme', theme)
    selectionColors.push(
      await selection.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--n-color').trim(),
      ),
    )
    await reset.press('Enter')
    await expect(confirmation).toBeVisible()
    await expect(confirmation.getByRole('button', { name: '确认', exact: true })).toBeVisible()
    await confirmation.getByRole('button', { name: '取消', exact: true }).press('Enter')
    await expect(confirmation).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-console-desktop-' + page.viewportSize()?.width + '-' + theme + '.png',
      animations: 'disabled',
    })
  }
  expect(selectionColors[0]).not.toBe(selectionColors[1])
  expect(resets).toBe(0)
  await reset.press('Enter')
  await confirmation.getByRole('button', { name: '确认', exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: '零售订单库', exact: true })).toBeVisible()
  expect(resets).toBe(1)
  await expect(panel).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: '零售订单库', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

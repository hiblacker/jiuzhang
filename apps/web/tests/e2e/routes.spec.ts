import { test, expect } from '@playwright/test'
import { routeManifest } from '../../src/app/route-manifest'

const resourceIds: Record<string, string> = {
  sources: '1001',
  datasets: '2001',
  tasks: '3001',
  runs: '9003',
  tables: '4001',
  quality: '5001',
  masking: '6001',
  services: '7001',
}

test('all planned routes load directly and survive refresh', async ({ page }) => {
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
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 500) {
      errors.push(`${response.status()} ${response.url()}`)
    }
  })
  expect(routeManifest).toHaveLength(38)
  for (const route of routeManifest) {
    await test.step(`${route.id} ${route.path}`, async () => {
      const domain = Object.keys(resourceIds).find((key) => route.path.split('/').includes(key))
      const path = route.path
        .replace(':id', resourceIds[domain ?? ''] ?? '0')
        .replace(':version', '1')
      await page.goto(path)
      if (path === '/403' || path === '/404') {
        await expect(page.getByRole('button', { name: '回到工作台' })).toBeVisible()
      } else if (path === '/login') {
        await expect(page.getByRole('button', { name: '进入演示工作区' })).toBeVisible()
      } else {
        await expect(page.locator('h1').first()).toBeVisible()
        await expect(page).toHaveURL(new RegExp(`${path}$`))
      }
      await expect(page.getByText('本地演示数据处理失败', { exact: true })).toHaveCount(0)
      await page.reload()
      if (path === '/403' || path === '/404') {
        await expect(page.getByRole('button', { name: '回到工作台' })).toBeVisible()
      } else await expect(page.locator('h1').first()).toBeVisible()
      expect(errors, route.path).toEqual([])
    })
  }
  await page.goto('/overview')
  await expect(page.getByText('每一份数据，都有清晰的去向。')).toBeVisible()
  await expect(page.getByRole('button', { name: '查看全部' }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true })
})

test('narrow task headers keep titles readable and actions usable in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    localStorage.setItem('jiuzhang.preference.theme', 'dark')
  })
  await page.goto('/tasks/3001')
  for (const theme of ['dark', 'light']) {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    const heading = page.getByRole('heading', { name: '订单明细宽表调度', exact: true })
    await expect(heading).toBeVisible()
    const box = await heading.boundingBox()
    expect(box!.width).toBeGreaterThan(240)
    expect(box!.height).toBeLessThan(100)
    await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({ path: 'test-results/task-header-' + theme + '.png' })
    if (theme === 'dark')
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  }
})

test('forbidden routes preserve destination for role switching and missing routes can return', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    if (!localStorage.getItem('jiuzhang.preference.role'))
      localStorage.setItem('jiuzhang.preference.role', 'viewer')
  })
  await page.goto('/system/users')
  await expect(page).toHaveURL(/403.*redirect=/)
  await expect(page.getByText('当前角色无权访问', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换演示角色', exact: true }).click()
  await expect(page).toHaveURL(/login.*redirect=/)
  await page.getByLabel('演示角色', { exact: true }).click()
  await page.getByText('平台管理员', { exact: true }).click()
  await page.getByRole('button', { name: '进入演示工作区', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5174/system/users')
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '数据源', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5174/sources')
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = '/not-a-real-page'
    document.body.appendChild(link)
    link.click()
  })
  await expect(page).toHaveURL('http://localhost:5174/404')
  await page.getByRole('button', { name: '返回上页', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5174/sources')
  await expect(page.getByRole('heading', { name: '数据源', exact: true })).toBeVisible()
})

test('login loads its domain dictionary without downloading dataset editors', async ({ page }) => {
  const requests: string[] = []
  const warnings: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) warnings.push(message.text())
  })
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '进入演示工作区', exact: true })).toBeVisible()
  expect(requests.some((url) => url.includes('/modules/identity/locales/zh-CN.ts'))).toBe(true)
  expect(
    requests.filter((url) =>
      /DatasetGraph|DatasetEditorPage|codemirror|\/modules\/datasets\/locales\//.test(url),
    ),
  ).toEqual([])
  expect(warnings).toEqual([])
})

test('asset catalog keeps readable columns, internal scrolling and accessible favorites on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    localStorage.setItem('jiuzhang.preference.theme', 'dark')
  })
  await page.goto('/governance/catalog')
  for (const theme of ['dark', 'light']) {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    const row = page.getByRole('row').filter({ hasText: '零售订单库' })
    await expect(row.getByRole('button', { name: '零售订单库', exact: true })).toBeVisible()
    const nameCell = row.getByRole('cell').first()
    expect((await nameCell.boundingBox())!.width).toBeGreaterThanOrEqual(220)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await row.getByRole('button', { name: '收藏', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(row.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible()
    await row.getByRole('button', { name: '取消收藏', exact: true }).click()
    await expect(row.getByRole('button', { name: '收藏', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/catalog-' + theme + '.png' })
    if (theme === 'dark')
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  }
})

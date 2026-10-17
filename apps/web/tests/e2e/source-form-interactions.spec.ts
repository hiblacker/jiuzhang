import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('database connection controls have keyboard names and preserve TLS false after save and refresh', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/sources/new')
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('键盘数据库')
  const type = page.getByRole('button', { name: '类型', exact: true })
  await type.press('Enter')
  await expect(type).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(type).toContainText('PostgreSQL')
  await expect(type).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('textbox', { name: '负责人', exact: true }).fill('虚构平台组')
  await page.getByRole('textbox', { name: '说明', exact: true }).fill('虚构键盘验收配置')
  await page.getByRole('textbox', { name: '示例主机', exact: true }).fill('keyboard.invalid')
  await expect(page.getByRole('textbox', { name: '端口', exact: true })).toHaveValue('5432')
  await page.getByRole('textbox', { name: '数据库', exact: true }).fill('synthetic')
  await page.getByRole('textbox', { name: 'Schema', exact: true }).fill('keyboard_schema')
  await page.getByRole('textbox', { name: '增量字段', exact: true }).fill('keyboard_updated_at')
  const tls = page.getByRole('switch', { name: '启用 TLS', exact: true })
  await expect(tls).toBeChecked()
  await tls.press('Space')
  await expect(tls).not.toBeChecked()
  await page.getByRole('button', { name: '保存', exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: '键盘数据库', exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp('/sources/[0-9]+$'))
  await page.reload()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(type).toContainText('PostgreSQL')
  await expect(tls).not.toBeChecked()
  await expect(page.getByRole('textbox', { name: '名称', exact: true })).toHaveValue('键盘数据库')
  await expect(page.getByRole('textbox', { name: '说明', exact: true })).toHaveValue(
    '虚构键盘验收配置',
  )
  await expect(page.getByRole('textbox', { name: 'Schema', exact: true })).toHaveValue(
    'keyboard_schema',
  )
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1' + location.pathname.slice(0, -5))
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data
  })
  expect(saved.type).toBe('PostgreSQL')
  expect(saved.settings).toMatchObject({
    port: 5432,
    database: 'synthetic',
    schema: 'keyboard_schema',
    tls: false,
    incrementalField: 'keyboard_updated_at',
  })
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
      path: '/tmp/jiuzhang-desktop-1280-source-database-form-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  expect(errors).toEqual([])
})

test('API selectors support keyboard changes, Escape, save and refresh', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/sources/1007/edit')
  await expect(page.getByRole('textbox', { name: '名称', exact: true })).not.toHaveValue('')
  for (const label of ['类型', '请求方式', '认证类型', '分页方式']) {
    const trigger = page.getByRole('button', { name: label, exact: true })
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
    await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  }
  for (const label of ['请求方式', '认证类型', '分页方式']) {
    await page.getByRole('button', { name: label, exact: true }).press('Enter')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
  }
  await expect(page.getByRole('button', { name: '请求方式', exact: true })).toContainText('POST')
  await expect(page.getByRole('button', { name: '认证类型', exact: true })).toContainText(
    'Bearer (dummy)',
  )
  await expect(page.getByRole('button', { name: '分页方式', exact: true })).toContainText('游标')
  await page.getByRole('textbox', { name: '请求路径', exact: true }).fill('/keyboard-orders')
  await page.getByRole('textbox', { name: '结果数据路径', exact: true }).fill('data.orders')
  await page.getByRole('textbox', { name: '增量字段', exact: true }).fill('updated_at')
  await page.getByRole('textbox', { name: 'Query JSON', exact: true }).fill('{"page":0}')
  await page.getByRole('button', { name: '保存', exact: true }).press('Enter')
  await expect(page).toHaveURL('/sources/1007')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '请求方式', exact: true })).toContainText('POST')
  await expect(page.getByRole('button', { name: '认证类型', exact: true })).toContainText(
    'Bearer (dummy)',
  )
  await expect(page.getByRole('button', { name: '分页方式', exact: true })).toContainText('游标')
  await expect(page.getByRole('textbox', { name: '请求路径', exact: true })).toHaveValue(
    '/keyboard-orders',
  )
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/sources/1007')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data
  })
  expect(saved.settings).toMatchObject({
    method: 'POST',
    authType: 'bearer',
    pagination: 'cursor',
    path: '/keyboard-orders',
    dataPath: 'data.orders',
    incrementalField: 'updated_at',
  })
  expect(JSON.parse(saved.settings.query)).toEqual({ page: 0 })
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
      path: '/tmp/jiuzhang-desktop-1280-source-api-form-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  expect(errors).toEqual([])
})

for (const resource of [
  { edit: '/sources/1001/edit', cancel: '/sources/1001' },
  { edit: '/sources/new', cancel: '/sources' },
]) {
  test(
    resource.edit + ' cancel has a stable destination and protects dirty input',
    async ({ page }) => {
      const writes: string[] = []
      page.on('request', (request) => {
        if (
          ['POST', 'PATCH'].includes(request.method()) &&
          new URL(request.url()).pathname.startsWith('/api/v1/sources')
        )
          writes.push(request.method() + ' ' + new URL(request.url()).pathname)
      })
      await page.goto('/overview')
      await expect(page.locator('h1')).toBeVisible()
      await page.goto(resource.edit)
      const name = page.getByPlaceholder('名称', { exact: true })
      if (resource.edit !== '/sources/new') await expect(name).not.toHaveValue('')
      const before = await name.inputValue()
      await name.fill('应被放弃的虚构配置')
      page.once('dialog', (dialog) => dialog.dismiss())
      await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
      await expect(page).toHaveURL(resource.edit)
      await expect(name).toHaveValue('应被放弃的虚构配置')
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
      await expect(page).toHaveURL(resource.cancel)
      await page.goto(resource.edit)
      await expect(name).toHaveValue(before)
      await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
      await expect(page).toHaveURL(resource.cancel)
      expect(writes).toEqual([])
    },
  )
}

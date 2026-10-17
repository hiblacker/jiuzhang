import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('service parameters keep focus and typed values through keyboard addition, deletion, save and refresh', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/services/7001/edit')
  await expect(page.getByRole('textbox', { name: '服务名称', exact: true })).not.toHaveValue('')
  const before = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    const response = await fetch('/api/v1/services/7001', { headers })
    if (!response.ok) throw new Error(await response.text())
    const service = (await response.json()).data
    const input = {
      name: service.name,
      description: service.description,
      owner: service.owner,
      tags: service.tags,
      tableId: service.tableId,
      fields: ['id', 'city', 'amount'],
      pageSize: service.pageSize,
      sortField: service.sortField,
      allowedRoles: service.allowedRoles,
      parameters: [
        { name: 'id', type: 'string', required: false },
        { name: 'city', type: 'string', required: true },
        { name: 'amount', type: 'number', required: false },
      ],
    }
    const update = await fetch('/api/v1/services/7001', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(input),
    })
    if (!update.ok) throw new Error(await update.text())
    return input
  })
  await page.reload()
  const add = page.getByRole('button', { name: '添加参数', exact: true })
  await add.press('Enter')
  const fourth = page.getByRole('textbox', { name: '参数 4 名称', exact: true })
  await expect(fourth).toBeFocused()
  await fourth.fill('customer')
  await page.getByRole('button', { name: '删除参数 2', exact: true }).press('Enter')
  const second = page.getByRole('textbox', { name: '参数 2 名称', exact: true })
  await expect(second).toBeFocused()
  await expect(second).toHaveValue('amount')
  await expect(page.getByRole('switch', { name: '参数 2 必填', exact: true })).not.toBeChecked()
  await expect(page.getByRole('textbox', { name: '参数 3 名称', exact: true })).toHaveValue(
    'customer',
  )
  await page.getByRole('button', { name: '删除参数 3', exact: true }).press('Enter')
  await expect(second).toBeFocused()
  await page.getByRole('button', { name: '参数 2 类型', exact: true }).press('Enter')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('数值', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.getByRole('switch', { name: '参数 2 必填', exact: true }).check()
  await page.getByRole('button', { name: '保存服务', exact: true }).click()
  await expect(page).toHaveURL('/services/7001')
  await page.goto('/services/7001/edit')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '参数 2 名称', exact: true })).toHaveValue(
    'amount',
  )
  await expect(page.getByRole('switch', { name: '参数 2 必填', exact: true })).toBeChecked()
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/services/7001')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data
  })
  expect(saved.parameters).toEqual([
    before.parameters[0],
    { name: 'amount', type: 'string', required: true },
  ])
  await page.getByRole('button', { name: '删除参数 2', exact: true }).press('Enter')
  await expect(page.getByRole('textbox', { name: '参数 1 名称', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '删除参数 1', exact: true }).press('Enter')
  await expect(add).toBeFocused()
  await add.press('Enter')
  await expect(page.getByRole('textbox', { name: '参数 1 名称', exact: true })).toBeFocused()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/services/7001')
  await page.getByRole('button', { name: '编辑服务', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '参数 2 名称', exact: true })).toHaveValue(
    'amount',
  )
  await expect(page.getByRole('button', { name: '保存服务', exact: true })).toBeEnabled()
  await expect(page.getByText('dwd_retail_1', { exact: true })).toBeVisible()
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
      path: '/tmp/jiuzhang-desktop-1280-service-form-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  expect(errors).toEqual([])
})

test('service select controls expose their actual keyboard triggers', async ({ page }) => {
  await page.goto('/services/7001/edit')
  await expect(page.getByRole('textbox', { name: '服务名称', exact: true })).not.toHaveValue('')
  await page.getByRole('button', { name: '添加参数', exact: true }).click()
  for (const label of ['输出字段', '参数 1 类型', '排序字段', '访问角色']) {
    const trigger = page.getByRole('button', { name: label, exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.n-base-select-menu:visible')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  }
})

for (const resource of [
  { editor: '/services/7001/edit', destination: '/services/7001' },
  { editor: '/services/new', destination: '/services' },
]) {
  test(
    resource.editor + ' cancel protects input and returns to its owning resource',
    async ({ page }) => {
      const writes: string[] = []
      page.on('request', (request) => {
        if (
          ['POST', 'PATCH'].includes(request.method()) &&
          new URL(request.url()).pathname.startsWith('/api/v1/services')
        )
          writes.push(request.method() + ' ' + new URL(request.url()).pathname)
      })
      await page.goto('/overview')
      await expect(page.locator('h1')).toBeVisible()
      await page.goto(resource.editor)
      const name = page.getByRole('textbox', { name: '服务名称', exact: true })
      if (resource.editor !== '/services/new') await expect(name).not.toHaveValue('')
      const before = await name.inputValue()
      await name.fill('应被放弃的虚构服务')
      page.once('dialog', (dialog) => dialog.dismiss())
      await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
      await expect(page).toHaveURL(resource.editor)
      await expect(name).toHaveValue('应被放弃的虚构服务')
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
      await expect(page).toHaveURL(resource.destination)
      await page.goto(resource.editor)
      await expect(name).toHaveValue(before)
      await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
      await expect(page).toHaveURL(resource.destination)
      expect(writes).toEqual([])
    },
  )
}

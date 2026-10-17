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
  await page.setViewportSize({ width: 768, height: 1024 })
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({
      path: 'test-results/service-form-' + theme + '.png',
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

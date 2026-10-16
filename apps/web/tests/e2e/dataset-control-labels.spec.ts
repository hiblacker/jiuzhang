import { expect, test } from '@playwright/test'

test('dataset selectors and both SQL editors have names and support keyboard selection', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  const errors: string[] = []
  const writes: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (
      ['POST', 'PATCH'].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith('/api/v1/datasets')
    )
      writes.push(request.method() + ' ' + new URL(request.url()).pathname)
  })
  await page.goto('/datasets/2001/edit?tab=input')
  for (const label of ['已发布上游数据集', '数据源', '源对象', '建模模式'])
    await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  const mode = page.getByLabel('建模模式', { exact: true })
  await expect(mode).toHaveAttribute('role', 'button')
  await mode.focus()
  await page.keyboard.press('Enter')
  await expect(mode).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(mode).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('textbox', { name: '数据集 SQL 编辑器', exact: true })).toBeVisible()
  const preset = page.getByLabel('数据集预设 SQL', { exact: true })
  await preset.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: '数据集 SQL 编辑器', exact: true })).toHaveText(
    'SELECT id, customer, amount FROM orders LIMIT 12',
  )
  await page.getByRole('tab', { name: '质量与脱敏', exact: true }).click()
  for (const label of ['质量规则', '脱敏策略引用']) {
    await page.getByLabel(label, { exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.n-base-select-menu:visible')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  }
  await page.getByRole('tab', { name: '输出与入仓', exact: true }).click()
  const layer = page.getByLabel('目标层', { exact: true })
  await layer.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(layer).toContainText('DWS')
  await page.getByRole('textbox', { name: '目标表', exact: true }).fill('dws_keyboard_orders')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001/edit?tab=output')
  await expect(page.getByRole('textbox', { name: '目标表', exact: true })).toHaveValue(
    'dws_keyboard_orders',
  )
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  await page.goto('/datasets/2001/edit?tab=input')
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  await page.getByRole('tab', { name: '输出与入仓', exact: true }).click()
  await expect(page.getByLabel('目标层', { exact: true })).toContainText('DWD')
  await expect(page.getByRole('textbox', { name: '目标表', exact: true })).not.toHaveValue(
    'dws_keyboard_orders',
  )
  await page.goto('/datasets/new')
  await page.getByRole('textbox', { name: '数据集名称', exact: true }).fill('取消的新数据集')
  await page.getByRole('tab', { name: '输出与入仓', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets')
  expect(writes).toEqual([])
  await page.goto('/warehouse/query?tableId=4001')
  const query = page.getByRole('textbox', { name: '仓库 SQL 编辑器', exact: true })
  await expect(query).toHaveAttribute('aria-multiline', 'true')
  await expect(query).toHaveText('SELECT * FROM dwd_retail_1 LIMIT 100')
  await query.focus()
  await query.press('End')
  await query.press('Space')
  await query.press('Control+z')
  await expect(query).toHaveText('SELECT * FROM dwd_retail_1 LIMIT 100')
  expect(errors).toEqual([])
})

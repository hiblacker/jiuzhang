import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('import layer and outcome keyboard selection produces the selected failure and resets canceled drafts', async ({
  page,
}) => {
  await page.goto('/warehouse/imports')
  await page.getByRole('button', { name: '新建导入', exact: true }).press('Enter')
  const dialog = page.getByRole('dialog', { name: 'CSV 导入向导', exact: true })
  const layer = dialog.getByRole('button', { name: '目标层', exact: true })
  const outcome = dialog.getByRole('button', { name: '模拟执行结果', exact: true })
  for (const control of [layer, outcome]) {
    await control.press('Enter')
    await expect(control).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(control).toHaveAttribute('aria-expanded', 'false')
    await expect(control).toBeFocused()
    await control.press('Enter')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
  }
  await expect(layer).toContainText('DWD')
  await expect(outcome).toContainText('导入失败')
  await dialog.getByRole('textbox', { name: '任务名称', exact: true }).fill('键盘选择失败导入')
  await dialog.getByRole('textbox', { name: '目标表名', exact: true }).fill('dwd_keyboard_failure')
  await dialog.getByRole('checkbox', { name: '我确认这是虚构演示数据', exact: true }).check()
  const submission = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/imports',
  )
  await dialog.getByRole('button', { name: '导入示例数据', exact: true }).press('Enter')
  expect((await submission).postDataJSON()).toMatchObject({ layer: 'DWD', outcome: 'failed' })
  const row = page.getByRole('row').filter({ hasText: '键盘选择失败导入' })
  await expect(row.getByRole('cell', { name: '失败', exact: true })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const headers = { 'x-demo-role': 'admin' }
    const imports = await fetch('/api/v1/imports?q=' + encodeURIComponent('键盘选择失败导入'), {
      headers,
    })
    const tables = await fetch('/api/v1/warehouse/tables?q=dwd_keyboard_failure', { headers })
    if (!imports.ok || !tables.ok) throw new Error('Unable to read Mock import result')
    return { imports: await imports.json(), tables: await tables.json() }
  })
  expect(saved.imports.data).toHaveLength(1)
  expect(saved.imports.data[0]).toMatchObject({
    status: 'failed',
    tableId: '',
  })
  expect(saved.tables.meta.total).toBe(0)
  await page.reload()
  await expect(row.getByRole('cell', { name: '失败', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建导入', exact: true }).press('Enter')
  await expect(layer).toContainText('ODS')
  await expect(outcome).toContainText('导入成功')
  await layer.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  page.once('dialog', (dialog) => dialog.accept())
  await dialog.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await page.getByRole('button', { name: '新建导入', exact: true }).press('Enter')
  await expect(layer).toContainText('ODS')
  await expect(outcome).toContainText('导入成功')
  await dialog.getByRole('button', { name: '取消', exact: true }).press('Enter')
})

test('export outcome keyboard failure cannot download and a new success produces the query file', async ({
  page,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/warehouse/query?tableId=4001')
  await page.getByRole('button', { name: '运行查询', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出 JSON', exact: true })).toBeEnabled()
  const outcome = page.getByRole('button', { name: '模拟执行结果', exact: true })
  await outcome.press('Enter')
  await expect(outcome).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(outcome).toHaveAttribute('aria-expanded', 'false')
  await expect(outcome).toBeFocused()
  await outcome.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(outcome).toContainText('文件生成失败')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).press('Enter')
  await expect(page).toHaveURL('/warehouse/exports')
  await expect(
    page.getByText('导出失败或列权限已变化，请重新查询后导出。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeDisabled()
  await page.goto('/warehouse/query?tableId=4001')
  await expect(outcome).toContainText('文件生成成功')
  await page.getByRole('button', { name: '运行查询', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出 CSV', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '导出 CSV', exact: true }).press('Enter')
  await expect(page).toHaveURL('/warehouse/exports')
  const ready = page.getByRole('row').filter({ hasText: '可下载' })
  await expect(ready).toHaveCount(1)
  const download = page.waitForEvent('download')
  await ready.getByRole('button', { name: '下载', exact: true }).press('Enter')
  expect((await download).suggestedFilename()).toMatch(/[.]csv$/)
  expect(errors).toEqual([])
})

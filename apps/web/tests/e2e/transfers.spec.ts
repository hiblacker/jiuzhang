import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
})
test('imports preserve progress across reload and only successful tasks publish tables', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/warehouse/imports')
  await page.getByRole('button', { name: '新建导入', exact: true }).click()
  const drawer = page.locator('.n-drawer')
  await drawer.getByRole('textbox').nth(0).fill('成功导入验收')
  await drawer.getByRole('textbox').nth(1).fill('ods_transfer_ok')
  await drawer.getByRole('textbox', { name: '主题域', exact: true }).fill('库存验收')
  await drawer.getByRole('checkbox').check()
  await drawer.getByRole('button', { name: '导入示例数据', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: '成功导入验收' })).toBeVisible()
  await page.reload()
  const success = page.getByRole('row').filter({ hasText: '成功导入验收' })
  await expect(success.getByRole('cell', { name: '成功', exact: true })).toBeVisible()
  await success.getByRole('button').click()
  await expect(page.getByRole('heading', { name: 'ods_transfer_ok' })).toBeVisible()
  await page.getByText('来源与版本', { exact: true }).click()
  await expect(page.getByText('库存验收', { exact: true })).toBeVisible()
  await page.goto('/warehouse/imports')
  await page.getByRole('button', { name: '新建导入', exact: true }).click()
  await drawer.getByRole('textbox').nth(0).fill('失败导入验收')
  await drawer.getByRole('textbox').nth(1).fill('ods_transfer_failed')
  await drawer.locator('.n-select').last().click()
  await page
    .locator('.n-base-select-option')
    .getByText('导入失败（不写入目标表）', { exact: true })
    .click()
  await drawer.getByRole('checkbox').check()
  await drawer.getByRole('button', { name: '导入示例数据', exact: true }).click()
  const failed = page.getByRole('row').filter({ hasText: '失败导入验收' })
  await expect(failed.getByRole('cell', { name: '失败', exact: true })).toBeVisible()
  await expect(failed.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(failed.getByRole('cell', { name: '失败', exact: true })).toBeVisible()
  await page.goto('/warehouse/tables?q=ods_transfer_failed')
  await expect(page.getByRole('row').filter({ hasText: 'ods_transfer_failed' })).toHaveCount(0)
  expect(errors).toEqual([])
})
test('failed export persists and cannot be downloaded', async ({ page }) => {
  await page.goto('/warehouse/query?tableId=4001')
  await page.getByRole('button', { name: '运行查询', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出 CSV', exact: true })).toBeEnabled()
  await page.getByLabel('模拟执行结果').click()
  await page.locator('.n-base-select-option').getByText('文件生成失败', { exact: true }).click()
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click()
  await expect(page).toHaveURL(/\/warehouse\/exports$/)
  await expect(
    page.getByText('导出失败或列权限已变化，请重新查询后导出。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeDisabled()
  await page.reload()
  await expect(
    page.getByText('导出失败或列权限已变化，请重新查询后导出。', { exact: true }),
  ).toBeVisible()
})

test('CSV imports preserve failed drafts, discard canceled changes and parse local quoted files', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/warehouse/imports')
  await page.getByRole('button', { name: '新建导入', exact: true }).click()
  const drawer = page.locator('.n-drawer')
  const csv = drawer.getByRole('textbox', { name: 'CSV 内容', exact: true })
  await drawer.getByRole('textbox', { name: '任务名称', exact: true }).fill('导入取消草稿')
  await csv.fill('id,name\n1,"unfinished')
  await drawer.getByRole('button', { name: '解析字段映射', exact: true }).click()
  await expect(drawer.getByText('CSV 引号未闭合', { exact: true })).toBeVisible()

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(csv).toHaveValue('id,name\n1,"unfinished')
  page.once('dialog', (dialog) => dialog.accept())
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await page.getByRole('button', { name: '新建导入', exact: true }).click()
  await expect(drawer.getByRole('textbox', { name: '任务名称', exact: true })).toHaveValue(
    '库存示例导入',
  )
  await expect(drawer.locator('.n-alert')).toHaveCount(1)
  await expect(drawer.getByRole('checkbox')).not.toBeChecked()

  await page.locator('input[type=file]').setInputFiles({
    name: 'too-large.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(1000001, 97),
  })
  await expect(drawer.getByText('文件不能超过 1 MB', { exact: true })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFFid,name,note\r\n1,"虚构,商品","line 1\nline ""2"""'),
  })
  await expect(drawer.getByRole('textbox', { name: 'note 的输出字段', exact: true })).toBeVisible()
  await drawer.getByRole('textbox', { name: '任务名称', exact: true }).fill('带引号的虚构文件')
  await drawer.getByRole('textbox', { name: '目标表名', exact: true }).fill('ods_quoted_csv')
  await drawer.getByRole('textbox', { name: 'name 的输出字段', exact: true }).fill('id')
  await drawer.getByRole('checkbox').check()
  await drawer.getByRole('button', { name: '导入示例数据', exact: true }).click()
  await expect(drawer.getByText('请为每列提供唯一且非空的输出名', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('textbox', { name: '任务名称', exact: true })).toHaveValue(
    '带引号的虚构文件',
  )
  await drawer.getByRole('textbox', { name: 'name 的输出字段', exact: true }).fill('product')
  await drawer.getByRole('button', { name: '导入示例数据', exact: true }).click()
  const imported = page.getByRole('row').filter({ hasText: '带引号的虚构文件' })
  await expect(imported.getByRole('cell', { name: '成功', exact: true })).toBeVisible()
  await imported.getByRole('button').click()
  await page.getByText('样本数据', { exact: true }).click()
  await expect(page.getByRole('cell', { name: '虚构,商品', exact: true })).toBeVisible()
  const fullValue = page.getByRole('button', {
    name: '查看第 1 行 note 的完整值',
    exact: true,
  })
  await fullValue.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog').locator('pre')).toHaveText('line 1\nline "2"')
  await page.keyboard.press('Escape')
  await expect(fullValue).toBeFocused()
  await page.reload()
  await page.getByText('样本数据', { exact: true }).click()
  await expect(page.getByRole('cell', { name: '虚构,商品', exact: true })).toBeVisible()
})

for (const scenario of ['expired', 'restricted'] as const) {
  test('download revalidates a ready export after it becomes ' + scenario, async ({ page }) => {
    await page.goto('/warehouse/query?tableId=4001')
    await page.getByRole('button', { name: '运行查询', exact: true }).click()
    await expect(page.getByRole('button', { name: '导出 CSV', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click()
    const download = page.getByRole('button', { name: '下载', exact: true })
    await expect(download).toBeEnabled()
    const downloads: string[] = []
    page.on('download', (file) => downloads.push(file.suggestedFilename()))
    const changed = await page.evaluate(async (scenario) => {
      const response =
        scenario === 'expired'
          ? await fetch('/api/v1/demo/tick', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ advanceSeconds: 86400 }),
            })
          : await fetch('/api/v1/system/roles/developer', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
              body: JSON.stringify({ permissions: ['read', 'write'] }),
            })
      return response.status
    }, scenario)
    expect(changed).toBe(200)
    await download.click()
    await expect(download).toBeDisabled()
    await expect(
      page
        .locator('.n-alert')
        .getByText(
          scenario === 'expired' ? '已过期' : '导出失败或列权限已变化，请重新查询后导出。',
          { exact: true },
        ),
    ).toBeVisible()
    expect(downloads).toEqual([])
    await page.reload()
    await expect(download).toBeDisabled()
  })
}

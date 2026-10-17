import { expect, test } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('CSV table provenance never presents a nonexistent dataset version', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/warehouse/imports')
  await expect(page.getByRole('heading', { name: '导入任务', exact: true })).toBeVisible()
  const taskId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/imports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({
        name: 'CSV 来源桌面验收',
        tableName: 'ods_provenance_csv',
        layer: 'ODS',
        csv: 'id,city\n1,杭州\n2,宁波',
        mapping: [
          { source: 'id', target: 'id' },
          { source: 'city', target: 'city' },
        ],
      }),
    })
    if (!response.ok) throw new Error(await response.text())
    const tick = await fetch('/api/v1/demo/tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advanceSeconds: 3 }),
    })
    if (!tick.ok) throw new Error(await tick.text())
    return ((await response.json()).data as Model<'Import'>).id
  })
  await page.reload()
  const row = page.getByRole('row').filter({ hasText: 'CSV 来源桌面验收' })
  await expect(row.getByRole('cell', { name: '成功', exact: true })).toBeVisible()
  await row.getByRole('button').press('Enter')
  await expect(page.getByRole('heading', { name: 'ods_provenance_csv', exact: true })).toBeVisible()
  await expect(page.getByText('不适用（CSV 导入）', { exact: true })).toBeVisible()
  await expect(page.getByText('v0', { exact: true })).toHaveCount(0)
  const tableId = new URL(page.url()).pathname.split('/').at(-1)!
  const result = await page.evaluate(
    async ({ tableId, taskId }) => {
      const request = async (path: string) => {
        const response = await fetch('/api/v1' + path)
        if (!response.ok) throw new Error(await response.text())
        return (await response.json()).data
      }
      return {
        table: (await request('/warehouse/tables/' + tableId)) as Model<'Table'>,
        imports: (await request('/imports?q=CSV%20来源桌面验收')) as Model<'Import'>[],
        taskId,
      }
    },
    { tableId, taskId },
  )
  expect(result.table).toMatchObject({
    datasetId: '',
    datasetVersion: 0,
    sourceId: '',
    rowCount: '2',
    version: 1,
  })
  expect(result.imports.find((item) => item.id === result.taskId)).toMatchObject({
    tableId,
    status: 'succeeded',
  })
  await page.getByRole('tab', { name: '来源与版本', exact: true }).press('Enter')
  await expect(page.getByText('CSV 示例导入', { exact: true })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).press('Enter')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-table-provenance-' + page.viewportSize()?.width + '-' + theme + '.png',
      animations: 'disabled',
    })
  }
  await page.reload()
  await expect(page.getByText('不适用（CSV 导入）', { exact: true })).toBeVisible()
  await expect(page.getByText('CSV 示例导入', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('published table provenance opens its immutable version and source connection', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/warehouse/tables/4001')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const table = await page.evaluate(async () => {
    const response = await fetch('/api/v1/warehouse/tables/4001')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data as Model<'Table'>
  })
  expect(table.datasetVersion).toBeGreaterThan(0)
  expect(table.datasetId).not.toBe('')
  expect(table.sourceId).not.toBe('')
  await page.getByRole('button', { name: 'v' + table.datasetVersion, exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/' + table.datasetId + '/versions/' + table.datasetVersion)
  await expect(
    page.getByText('只读发布定义；恢复只生成草稿，不修改历史版本', { exact: true }),
  ).toBeVisible()
  await page.goBack()
  await page.getByRole('tab', { name: '来源与版本', exact: true }).press('Enter')
  await page.getByRole('button', { name: table.sourceId, exact: true }).press('Enter')
  await expect(page).toHaveURL('/sources/' + table.sourceId)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('tab', { name: '来源与版本', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page
    .getByRole('button', { name: table.datasetId + ' · v' + table.datasetVersion, exact: true })
    .press('Enter')
  await expect(page).toHaveURL('/datasets/' + table.datasetId + '/versions/' + table.datasetVersion)
  expect(errors).toEqual([])
})

import { test, expect, type Page } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'

async function request<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch('/api/v1' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'developer' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    },
    { path, method, body },
  )
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
    Date.now = () => Date.parse('2026-10-16T00:00:00.000Z')
  })
})

for (const [writeMode, label, expectedCount] of [
  ['append', '追加', 16],
  ['replace', '替换', 4],
  ['upsert', '主键更新', 12],
] as const) {
  test(
    'output ' + writeMode + ' saves, publishes and changes the actual warehouse rows',
    async ({ page }) => {
      test.setTimeout(90000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/datasets/2001')
      await expect(page.getByRole('heading', { name: '订单明细宽表', exact: true })).toBeVisible()
      const dataset = await request<Model<'Dataset'>>(page, '/datasets/2001')
      const before = await request<Model<'Table'>>(page, '/warehouse/tables/4001')
      await request(page, '/datasets/2001', 'PATCH', {
        definition: {
          ...dataset.definition,
          fields: dataset.definition.fields.map((field) =>
            field.name === 'amount' ? { ...field, name: 'id' } : field,
          ),
          nodes: [
            { id: 'input', type: 'input', label: '读取源表', x: 0, y: 0, config: '' },
            { id: 'filter', type: 'filter', label: '杭州样本', x: 300, y: 0, config: 'city=杭州' },
          ],
          edges: [{ id: 'input-filter', source: 'input', target: 'filter' }],
          schedule: { ...dataset.definition.schedule, mode: 'manual', retries: 0 },
        },
      })
      await page.goto('/datasets/2001/edit?tab=output')
      await page.getByLabel('写入方式', { exact: true }).click()
      await page.locator('.n-base-select-option').getByText(label, { exact: true }).click()
      const summary = page.getByRole('region', { name: '输出写入配置', exact: true })
      await expect(summary).toContainText(writeMode === 'upsert' ? '按主键更新' : label)
      await page.getByRole('button', { name: '保存草稿', exact: true }).click()
      await expect(page).toHaveURL('/datasets/2001')
      await expect(summary).toBeVisible()
      await page.getByRole('button', { name: '发布版本', exact: true }).click()
      await page.getByRole('button', { name: '确认发布', exact: true }).click()
      await expect(page.locator('.n-modal')).toHaveCount(0)
      await page.getByRole('button', { name: '运行', exact: true }).click()
      await expect(page).toHaveURL(new RegExp('/runs/[0-9]+$'))
      const runId = page.url().split('/').at(-1)!
      await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
      await expect(page.getByText('成功', { exact: true })).toBeVisible()
      const run = await request<Model<'Run'>>(page, '/runs/' + runId)
      expect(run).toMatchObject({ datasetVersion: 2, outputTableId: '4001', rowCount: '4' })
      const table = await request<Model<'Table'>>(page, '/warehouse/tables/4001')
      expect(table.rowCount).toBe(String(expectedCount))
      expect(table.sample).toHaveLength(expectedCount)
      expect(table.datasetVersion).toBe(2)
      if (writeMode === 'append') expect(table.sample.slice(0, 12)).toEqual(before.sample)
      const id100 = table.sample.filter((row) => row.id === '100')
      expect(id100).toHaveLength(writeMode === 'append' ? 2 : 1)
      expect(id100.at(-1)?.amount).toBe('100.00')
      if (writeMode === 'upsert')
        expect(table.sample.find((row) => row.id === '101')).toEqual(
          before.sample.find((row) => row.id === '101'),
        )
      await page.getByRole('button', { name: '4001', exact: true }).click()
      await expect(page).toHaveURL('/warehouse/tables/4001')
      await page.getByRole('tab', { name: '样本数据', exact: true }).click()
      await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(expectedCount)
      await page.reload()
      await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(expectedCount)
      await page.getByRole('tab', { name: '来源与版本', exact: true }).click()
      await page.getByRole('button', { name: '2001 · v2', exact: true }).click()
      await expect(page).toHaveURL('/datasets/2001/versions/2')
      await expect(summary).toContainText(writeMode === 'upsert' ? '按主键更新' : label)
      if (writeMode === 'append') {
        for (const theme of ['light', 'dark']) {
          if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBe(page.viewportSize()?.width)
          await page.screenshot({
            path: '/tmp/jiuzhang-desktop-1280-output-summary-' + theme + '.png',
            fullPage: true,
            animations: 'disabled',
          })
        }
      }
      expect(errors).toEqual([])
    },
  )
}

test('historical additional input opens by field URL and invalid source references stay explicit', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/datasets/2001')
  await expect(page.getByRole('heading', { name: '订单明细宽表', exact: true })).toBeVisible()
  const dataset = await request<Model<'Dataset'>>(page, '/datasets/2001')
  const definition = structuredClone(dataset.definition)
  definition.nodes.push(
    { id: 'right', type: 'input', label: '额外输入', x: 0, y: 200, config: '11003' },
    { id: 'join', type: 'join', label: '关联', x: 600, y: 0, config: 'left:id=id' },
  )
  definition.edges.push(
    { id: 'left-join', source: 'fields', target: 'join' },
    { id: 'right-join', source: 'right', target: 'join' },
  )
  await request(page, '/datasets/2001', 'PATCH', { definition })
  const version = await request<Model<'DatasetVersion'>>(page, '/datasets/2001/publish', 'POST')
  expect(version.sourceSnapshots.map((snapshot) => snapshot.object.id)).toEqual(['11001', '11003'])
  await request(page, '/datasets/2001', 'PATCH', { definition: dataset.definition })
  const additional = version.sourceSnapshots.find((snapshot) => snapshot.object.id === '11003')!
  await page.goto('/datasets/2001/versions/2?sourceObjectId=11003&field=amount&trace=keep')
  const snapshots = page.locator('.n-card').filter({ hasText: '输入源结构快照' })
  await expect(snapshots.getByRole('row').filter({ hasText: 'amount' })).toHaveCount(1)
  await expect(snapshots.getByRole('row').filter({ hasText: '业务主键' })).toHaveCount(0)
  await page.reload()
  await expect(snapshots.getByRole('row').filter({ hasText: 'amount' })).toHaveCount(1)
  await snapshots.getByRole('button', { name: '查看当前数据源', exact: true }).click()
  await expect(page).toHaveURL('/sources/1002?objectId=11003')
  await page.goBack()
  await snapshots.getByRole('button', { name: '查看全部字段', exact: true }).click()
  await expect(page).not.toHaveURL(/field=amount/)
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  await expect(snapshots.getByRole('row').filter({ hasText: '业务主键' })).toHaveCount(1)
  expect(await request(page, '/datasets/2001/versions/2')).toEqual(version)
  expect(additional.object.fields.some((field) => field.name === 'amount')).toBe(true)
  await page.goto('/datasets/2001/versions/2?sourceObjectId=999999')
  await expect(snapshots.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
})

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

test('diamond dependencies recover through a branch retry and keep historical run inputs', async ({
  page,
}) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/tasks/3004')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  for (const [id, dependencies] of [
    ['3001', []],
    ['3002', ['3001']],
    ['3003', ['3001']],
    ['3004', ['3002', '3003']],
  ] as const) {
    const task = await request<Model<'Task'>>(page, '/tasks/' + id)
    await request(page, '/tasks/' + id, 'PATCH', {
      schedule: {
        ...task.schedule,
        mode: 'manual',
        retries: 0,
        timeoutSeconds: 600,
        concurrency: 1,
        dependencies,
      },
    })
  }
  const runs: Model<'Run'>[] = []
  for (const id of ['3001', '3002', '3003', '3004'])
    runs.push(
      await request<Model<'Run'>>(page, '/tasks/' + id + '/runs', 'POST', {
        outcome: id === '3003' ? 'failed' : 'succeeded',
      }),
    )
  for (let step = 0; step < 2; step++)
    await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  const leaf = runs[3]!
  const historicalVersion = await request<Model<'DatasetVersion'>>(
    page,
    '/datasets/2004/versions/1',
  )
  const dataset = await request<Model<'Dataset'>>(page, '/datasets/2004')
  await request(page, '/datasets/2004', 'PATCH', {
    definition: {
      ...dataset.definition,
      schedule: {
        ...dataset.definition.schedule,
        mode: 'manual',
        dependencies: [],
        concurrency: 2,
      },
      output: { ...dataset.definition.output, table: 'dependency_leaf_v2' },
    },
  })
  await request(page, '/datasets/2004/publish', 'POST')
  await page.goto('/runs/' + leaf.id)
  await expect(
    page.getByText('等待上游成功；补数要求相同业务日期的上游运行成功。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('并发 1 · 超时 600s · 重试 0 次', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '任务 3003', exact: true }).click()
  await expect(page).toHaveURL('/tasks/3003')
  await page.goBack()
  await expect(page.getByRole('button', { name: '任务 3002', exact: true })).toBeVisible()

  await page.goto('/runs/' + runs[2]!.id)
  await expect(page.getByText('失败', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重试运行 ' + runs[2]!.id, exact: true }).click()
  await expect(page).not.toHaveURL('/runs/' + runs[2]!.id)
  const retryId = page.url().split('/').at(-1)!
  expect(await request<Model<'Run'>>(page, '/runs/' + retryId)).toMatchObject({
    retryOf: runs[2]!.id,
    datasetVersion: 1,
    scheduleSnapshot: runs[2]!.scheduleSnapshot,
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  expect(await request<Model<'Run'>>(page, '/runs/' + leaf.id)).toMatchObject({
    executionStartedAt: '2026-10-16T00:00:24.000Z',
    datasetVersion: 1,
    scheduleSnapshot: leaf.scheduleSnapshot,
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  await page.goto('/runs/' + leaf.id)
  await expect(page.getByText('成功', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'v1', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '任务 3003', exact: true })).toBeVisible()
  const finished = await request<Model<'Run'>>(page, '/runs/' + leaf.id)
  const table = await request<Model<'Table'>>(page, '/warehouse/tables/' + finished.outputTableId)
  expect(table).toMatchObject({
    name: historicalVersion.definition.output.table,
    datasetVersion: 1,
  })
  expect(await request(page, '/datasets/2004/versions/1')).toEqual(historicalVersion)
  expect(await request<Model<'Task'>>(page, '/tasks/3004')).toMatchObject({
    lastSuccessRunId: leaf.id,
    schedule: { dependencies: [], concurrency: 2 },
  })
  await page.setViewportSize({ width: 768, height: 1024 })
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({
      path: 'test-results/dependency-snapshot-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.getByRole('button', { name: 'v1', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2004/versions/1')
  expect(errors).toEqual([])
})

test('same-day backfill retry releases the dependent while another date stays isolated', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/tasks/3002')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  for (const id of ['3001', '3002']) {
    const task = await request<Model<'Task'>>(page, '/tasks/' + id)
    await request(page, '/tasks/' + id, 'PATCH', {
      schedule: {
        ...task.schedule,
        mode: 'manual',
        timeoutSeconds: 600,
        retries: 0,
        dependencies: id === '3002' ? ['3001'] : [],
      },
    })
  }
  await request(page, '/tasks/3001/backfills', 'POST', {
    from: '2026-10-13',
    to: '2026-10-13',
    outcome: 'succeeded',
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  const [failed] = await request<Model<'Run'>[]>(page, '/tasks/3001/backfills', 'POST', {
    from: '2026-10-14',
    to: '2026-10-14',
    outcome: 'failed',
  })
  const [waiting] = await request<Model<'Run'>[]>(page, '/tasks/3002/backfills', 'POST', {
    from: '2026-10-14',
    to: '2026-10-14',
    outcome: 'succeeded',
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  await page.goto('/runs/' + waiting!.id)
  await expect(
    page.getByText('等待上游成功；补数要求相同业务日期的上游运行成功。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('2026-10-14 · Asia/Shanghai', { exact: true })).toBeVisible()
  await page.goto('/runs/' + failed!.id)
  await expect(page.getByText('失败', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重试运行 ' + failed!.id, exact: true }).click()
  await expect(page).not.toHaveURL('/runs/' + failed!.id)
  await expect(page.getByText('2026-10-14 · Asia/Shanghai', { exact: true })).toBeVisible()
  const retryId = page.url().split('/').at(-1)!
  expect(await request<Model<'Run'>>(page, '/runs/' + retryId)).toMatchObject({
    retryOf: failed!.id,
    businessDate: '2026-10-14',
    datasetVersion: 1,
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  expect(await request<Model<'Run'>>(page, '/runs/' + waiting!.id)).toMatchObject({
    waitReason: '',
    businessDate: '2026-10-14',
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  await page.goto('/runs/' + waiting!.id)
  await page.reload()
  await expect(page.getByText('成功', { exact: true })).toBeVisible()
  await expect(page.getByText('2026-10-14 · Asia/Shanghai', { exact: true })).toBeVisible()
  const finished = await request<Model<'Run'>>(page, '/runs/' + waiting!.id)
  const table = await request<Model<'Table'>>(page, '/warehouse/tables/' + finished.outputTableId)
  expect(table.partitions).toContain('2026-10-14')
  expect(await request<Model<'Run'>>(page, '/runs/' + failed!.id)).toMatchObject({
    status: 'failed',
    retryRunId: retryId,
  })
})

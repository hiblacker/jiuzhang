import { test, expect } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    if (!localStorage.getItem('jiuzhang.preference.role'))
      localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
})

test('browser demo clock dispatches due schedules and refreshes the task clock', async ({
  page,
}) => {
  await page.goto('/tasks/3001/edit')
  await page.getByRole('textbox', { name: 'Cron', exact: true }).fill('* * * * *')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/tasks/3001$'))

  const scheduledCount = async () =>
    page.evaluate(async () => {
      const response = await fetch('/api/v1/runs?trigger=schedule&taskId=3001&pageSize=100')
      const result = await response.json()
      return result.meta.total as number
    })
  const before = await scheduledCount()
  await page.getByRole('button', { name: '演示控制台' }).click()
  await page.getByRole('button', { name: '推进 60 秒', exact: true }).click()
  await expect.poll(scheduledCount).toBeGreaterThan(before)
  await expect(page.locator('.clock-value')).not.toHaveText('读取中…')
})

test('automatic retry waits while the task is paused and keeps its run lineage', async ({
  page,
}) => {
  await page.goto('/tasks/3001')
  await expect(page.getByRole('heading', { name: '订单明细宽表调度' })).toBeVisible()
  const runId = await page.evaluate(async () => {
    const taskResponse = await fetch('/api/v1/tasks/3001')
    const task = (await taskResponse.json()).data
    await fetch('/api/v1/tasks/3001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedule: { ...task.schedule, mode: 'manual', retries: 1, timeoutSeconds: 60 },
      }),
    })
    const runResponse = await fetch('/api/v1/tasks/3001/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'failed' }),
    })
    return ((await runResponse.json()).data as { id: string }).id
  })
  await page.goto('/runs/' + runId)
  await expect(page.getByRole('heading', { name: '运行 ' + runId, exact: true })).toBeVisible()
  const advanceDemoTime = (seconds: number) =>
    page.evaluate(async (advanceSeconds) => {
      const response = await fetch('/api/v1/demo/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advanceSeconds }),
      })
      return response.status
    }, seconds)
  expect(await advanceDemoTime(6)).toBe(200)
  await expect(page.getByText(/自动重试等待中：/)).toBeVisible()

  await page.evaluate(() => fetch('/api/v1/tasks/3001/pause', { method: 'POST' }))
  expect(await advanceDemoTime(6)).toBe(200)
  await expect(page.getByText('自动重试已暂停：请恢复任务后继续', { exact: true })).toBeVisible()

  const paused = await page.evaluate(async (id) => {
    const response = await fetch('/api/v1/runs/' + id)
    return (await response.json()).data as { retryRunId: string }
  }, runId)
  expect(paused.retryRunId).toBe('')
  await page.evaluate(() => fetch('/api/v1/tasks/3001/resume', { method: 'POST' }))

  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const response = await fetch('/api/v1/runs/' + id)
        return ((await response.json()).data as { retryRunId: string }).retryRunId
      }, runId),
    )
    .not.toBe('')
  const retryId = await page.evaluate(async (id) => {
    const response = await fetch('/api/v1/runs/' + id)
    return ((await response.json()).data as { retryRunId: string }).retryRunId
  }, runId)
  const retry = await page.evaluate(async (id) => {
    const response = await fetch('/api/v1/runs/' + id)
    return (await response.json()).data as {
      retryOf: string
      retryMode: string
      retryAttempt: number
      datasetVersion: number
    }
  }, retryId)
  expect(retry).toMatchObject({
    retryOf: runId,
    retryMode: 'automatic',
    retryAttempt: 1,
    datasetVersion: 1,
  })
})

test('schedule validation prevents saving invalid cron and a short SLA fails without publication', async ({
  page,
}) => {
  await page.goto('/tasks/3001/edit')
  const cron = page.getByRole('textbox', { name: 'Cron', exact: true })
  await cron.fill('99 9 * * *')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(
    page.getByText('请输入合法的五字段数字 Cron（分 时 日 月 周），不支持 Quartz 扩展。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page).toHaveURL(new RegExp('/tasks/3001/edit$'))
  await cron.fill('30 9 * * *')
  await page.getByRole('textbox', { name: '超时（秒）', exact: true }).fill('2')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/tasks/3001$'))
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/runs/[0-9]+$'))
  await expect(page.getByText('失败', { exact: true })).toBeVisible()
  await expect(page.getByText(/SLA_TIMEOUT/)).toBeVisible()
  await expect(page.getByText('尚未发布', { exact: true })).toBeVisible()
  await expect(page.getByText('质量检查尚未执行，暂无检查结果。', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('失败', { exact: true })).toBeVisible()
})

test('dated backfills preserve the selected day, queue concurrency and retain identity on retry', async ({
  page,
}) => {
  test.setTimeout(45000)
  await page.goto('/tasks/3001')
  await page.getByRole('button', { name: '补数', exact: true }).click()
  await page.getByPlaceholder('补数开始日期').fill('2026-10-13')
  await page.getByPlaceholder('补数开始日期').press('Tab')
  await page.getByPlaceholder('补数结束日期').fill('2026-10-15')
  await page.getByPlaceholder('补数结束日期').press('Tab')
  await page.getByRole('button', { name: '创建补数运行', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/runs[?]trigger=backfill&taskId=3001$'))
  await expect(page.getByRole('cell', { name: '2026-10-15', exact: true })).toBeVisible()
  await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(3)
  const row = page
    .locator('.n-data-table-tbody tr')
    .filter({ has: page.getByRole('cell', { name: '2026-10-15', exact: true }) })
  await row.getByRole('button').first().click()
  const originalUrl = page.url()
  await expect(page.getByText('等待当前任务的并发名额。', { exact: true })).toBeVisible()
  await expect(page.getByText('2026-10-15 · Asia/Shanghai', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^取消运行 [0-9]+$/ }).click()
  await expect(page.getByText('已取消', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^重试运行 [0-9]+$/ }).click()
  await expect(page).not.toHaveURL(originalUrl)
  await expect(page.getByText('2026-10-15 · Asia/Shanghai', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('2026-10-15 · Asia/Shanghai', { exact: true })).toBeVisible()
  await page.goto(originalUrl)
  await expect(page.getByText('已取消', { exact: true })).toBeVisible()
})
test('task edits validate names, protect unsaved navigation and load the selected dependency', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  await page.goto('/tasks/3001/edit')
  const name = page.getByLabel('任务名称', { exact: true })
  await expect(name).toHaveValue('订单明细宽表调度')
  await name.fill('')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByText('请填写此项', { exact: true })).toBeVisible()
  await name.fill('未保存任务配置')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/tasks/3001/edit$'))
  await expect(name).toHaveValue('未保存任务配置')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/tasks$'))
  await page.goto('/tasks/3001/edit')
  await expect(name).toHaveValue('订单明细宽表调度')
  await name.fill('已保存任务配置')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/tasks/3001$'))
  await page.reload()
  await expect(page.getByRole('heading', { name: '已保存任务配置' })).toBeVisible()
  await page.goto('/tasks/3002/edit')
  await expect(name).toHaveValue('客户价值分层调度')
})

test('dependency cycles are rejected and queued historical runs keep their version after a new publish', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/tasks/3002')
  await expect(page.getByRole('heading', { name: '客户价值分层调度', exact: true })).toBeVisible()
  const fixture = await page.evaluate(async () => {
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    }
    for (const id of ['3001', '3002']) {
      const task = await request('/tasks/' + id)
      await request('/tasks/' + id, 'PATCH', {
        schedule: {
          ...task.schedule,
          mode: 'manual',
          retries: 0,
          timeoutSeconds: 600,
          dependencies: id === '3002' ? ['3001'] : [],
        },
      })
    }
    const upstream = await request('/tasks/3001/runs', 'POST', { outcome: 'failed' })
    await request('/demo/tick', 'POST', { advanceSeconds: 6 })
    const waiting = await request('/tasks/3002/runs', 'POST', { outcome: 'succeeded' })
    const version = await request('/datasets/2002/versions/1')
    return { upstream: upstream.id as string, waiting: waiting.id as string, version }
  })
  await page.goto('/runs/' + fixture.waiting)
  await expect(
    page.getByText('等待上游成功；补数要求相同业务日期的上游运行成功。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'v1', exact: true })).toBeVisible()

  await page.goto('/tasks/3001/edit')
  await page.getByLabel('上游任务依赖', { exact: true }).click()
  await page.locator('.n-base-select-option').getByText('客户价值分层调度', { exact: true }).click()
  await page.getByRole('heading', { name: '订单明细宽表调度', exact: true }).click()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByText('任务依赖存在循环或依赖自身', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/tasks\/3001\/edit$/)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '任务中心', exact: true }).click()

  await page.evaluate(async () => {
    const dataset = (await (await fetch('/api/v1/datasets/2002')).json()).data
    const update = await fetch('/api/v1/datasets/2002', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition: {
          ...dataset.definition,
          output: { ...dataset.definition.output, table: 'dws_customer_value_v2' },
        },
      }),
    })
    if (!update.ok) throw new Error(await update.text())
    const publish = await fetch('/api/v1/datasets/2002/publish', { method: 'POST' })
    if (!publish.ok) throw new Error(await publish.text())
  })
  await page.goto('/runs/' + fixture.waiting)
  await expect(page.getByRole('button', { name: 'v1', exact: true })).toBeVisible()
  await expect(
    page.getByText('等待上游成功；补数要求相同业务日期的上游运行成功。', { exact: true }),
  ).toBeVisible()
  await page.evaluate(async () => {
    await fetch('/api/v1/tasks/3001/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'succeeded' }),
    })
    for (let step = 0; step < 2; step++) {
      const tick = await fetch('/api/v1/demo/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advanceSeconds: 8 }),
      })
      if (!tick.ok) throw new Error(await tick.text())
    }
  })
  await page.reload()
  await expect(page.getByText('成功', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'v1', exact: true })).toBeVisible()
  const versionAfter = await page.evaluate(
    async () => (await (await fetch('/api/v1/datasets/2002/versions/1')).json()).data,
  )
  expect(versionAfter).toEqual(fixture.version)
  await page.getByRole('button', { name: 'v1', exact: true }).click()
  await expect(page).toHaveURL(/datasets\/2002\/versions\/1$/)
})

test('run list cancels a queued run, retries into a new run and keeps the original terminal', async ({
  page,
}) => {
  test.setTimeout(45000)
  await page.goto('/runs')
  await expect(page.getByRole('heading', { name: '运行记录', exact: true })).toBeVisible()
  const runId = await page.evaluate(async () => {
    for (const id of ['3001', '3002']) {
      const task = (await (await fetch('/api/v1/tasks/' + id)).json()).data
      const response = await fetch('/api/v1/tasks/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: {
            ...task.schedule,
            mode: 'manual',
            retries: 0,
            timeoutSeconds: 600,
            dependencies: id === '3002' ? ['3001'] : [],
          },
        }),
      })
      if (!response.ok) throw new Error('Cannot configure queued list scenario')
    }
    const response = await fetch('/api/v1/tasks/3002/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'succeeded' }),
    })
    if (!response.ok) throw new Error('Cannot create queued list run')
    return (await response.json()).data.id as string
  })
  await page.goto('/runs?q=' + runId)
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: runId, exact: true }) })
  await expect(row.getByText('排队中', { exact: true })).toBeVisible()
  const cancel = row.getByRole('button', { name: '取消运行 ' + runId, exact: true })
  await cancel.click()
  await expect(row.getByText('已取消', { exact: true })).toBeVisible()
  await expect(cancel).toBeDisabled()
  await page.reload()
  await expect(row.getByText('已取消', { exact: true })).toBeVisible()
  await row.getByRole('button', { name: '重试运行 ' + runId, exact: true }).click()
  await expect(page).toHaveURL(/\/runs\/[0-9]+$/)
  const retryId = page.url().split('/').at(-1)!
  expect(retryId).not.toBe(runId)
  const retry = await page.evaluate(
    async (id) => (await (await fetch('/api/v1/runs/' + id)).json()).data,
    retryId,
  )
  expect(retry).toMatchObject({ retryOf: runId, datasetVersion: 1 })
  await page.goto('/runs?q=' + runId)
  await expect(row.getByText('已取消', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: '重试运行 ' + runId, exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    localStorage.setItem('jiuzhang.preference.role', 'viewer')
  })
  await page.reload()
  await expect(row.getByRole('button', { name: '取消运行 ' + runId, exact: true })).toBeDisabled()
})

test('run start date range filters HTTP data and survives refresh and browser history', async ({
  page,
}) => {
  await page.goto('/runs?from=2026-10-14&to=2026-10-14')
  const rows = page.locator('.n-data-table-tbody tr')
  await expect(rows).not.toHaveCount(0)
  const dateInputs = page.locator('.n-date-picker input')
  await expect(dateInputs.nth(0)).toHaveValue('2026-10-14')
  await expect(dateInputs.nth(1)).toHaveValue('2026-10-14')
  const data = await page.evaluate(
    async () =>
      (await (await fetch('/api/v1/runs?from=2026-10-14&to=2026-10-14&pageSize=100')).json()).data,
  )
  expect(data.length).toBeGreaterThan(0)
  expect(data.every((run: { startedAt: string }) => run.startedAt.startsWith('2026-10-14'))).toBe(
    true,
  )
  await page.reload()
  await expect(dateInputs.nth(0)).toHaveValue('2026-10-14')
  await page.getByPlaceholder('搜索运行、数据集或触发方式', { exact: true }).fill('no-such-run')
  await expect(page.getByText('暂无数据', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/from=2026-10-14.*to=2026-10-14.*q=no-such-run/)
  await page.goBack()
  await expect(page.getByPlaceholder('搜索运行、数据集或触发方式', { exact: true })).toHaveValue('')
  await expect(rows).not.toHaveCount(0)
  await expect(dateInputs.nth(0)).toHaveValue('2026-10-14')
})

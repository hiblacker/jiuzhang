import { expect, test } from '@playwright/test'

test('overview shows real attention counts and latest failures with filtered navigation and recovery', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/overview')
  const failures = page.getByRole('region', { name: '最近失败与阻断', exact: true })
  const pending = page.getByRole('region', { name: '待处理事项', exact: true })
  await expect(pending.getByRole('button', { name: /^待发布草稿：/ })).toBeVisible()
  const snapshot = await page.evaluate(async () => {
    const headers = { 'x-demo-role': 'admin' }
    const endpoints = ['/overview', '/runs?pageSize=100', '/datasets?status=draft&pageSize=100']
    const results = await Promise.all(
      endpoints.map(async (endpoint) => {
        const response = await fetch('/api/v1' + endpoint, { headers })
        if (!response.ok) throw new Error(await response.text())
        return response.json()
      }),
    )
    const runs = results[1].data as { id: string; status: string; startedAt: string }[]
    return {
      attention: results[0].data.attentionCounts as {
        draftDatasets: number
        warningSources: number
        offlineSources: number
      },
      failures: runs
        .filter((run) => run.status === 'failed' || run.status === 'blocked')
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 5)
        .map((run) => run.id),
      drafts: results[2].meta.total as number,
    }
  })
  expect(snapshot.attention.draftDatasets).toBe(snapshot.drafts)
  expect(snapshot.failures).toHaveLength(5)
  await expect(failures.getByRole('row').filter({ has: page.getByRole('button') })).toHaveCount(5)
  for (const id of snapshot.failures)
    await expect(failures.getByRole('button', { name: id, exact: true })).toBeVisible()
  const draft = pending.getByRole('button', {
    name: '待发布草稿：' + snapshot.attention.draftDatasets + ' 项',
    exact: true,
  })
  await expect(draft).toBeEnabled()
  await expect(
    pending.getByRole('button', {
      name: '连接警告：' + snapshot.attention.warningSources + ' 项',
      exact: true,
    }),
  ).toBeEnabled()
  await expect(
    pending.getByRole('button', { name: '离线数据源：0 项', exact: true }),
  ).toBeDisabled()
  await draft.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/datasets?status=draft')
  await expect(page.getByText('共 ' + snapshot.drafts + ' 条', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL('/datasets?status=draft')
  await expect(page.getByText('共 ' + snapshot.drafts + ' 条', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL('/overview')
  await pending.getByRole('button', { name: /^连接警告：/ }).click()
  await expect(page).toHaveURL('/sources?status=warning')
  await page.goBack()
  await failures.getByRole('button', { name: '失败记录', exact: true }).click()
  await expect(page).toHaveURL('/runs?status=failed')
  await page.goBack()
  await failures.getByRole('button', { name: '阻断记录', exact: true }).click()
  await expect(page).toHaveURL('/runs?status=blocked')
  await page.goBack()
  await failures.getByRole('button', { name: snapshot.failures[0], exact: true }).click()
  await expect(page).toHaveURL('/runs/' + snapshot.failures[0])
  await page.goBack()
  await page.reload()
  await expect(draft).toBeEnabled()
  await page.setViewportSize({ width: 768, height: 1024 })
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await draft.scrollIntoViewIfNeeded()
    await expect(draft).toBeInViewport()
    await page.screenshot({
      path: 'test-results/overview-attention-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  async function scenario(value: 'normal' | 'error' | 'forbidden') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'overview', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  for (const state of ['error', 'forbidden'] as const) {
    await scenario(state)
    await page.reload()
    await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
    await expect(pending).toHaveCount(0)
    await scenario('normal')
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await expect(draft).toBeEnabled()
    await expect(
      failures.getByRole('button', { name: snapshot.failures[0], exact: true }),
    ).toBeVisible()
  }
  expect(errors).toEqual([])
})

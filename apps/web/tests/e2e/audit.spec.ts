import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

test('audit filters expose worker events and mutation context, preserve URLs and export raw values', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/system/audit')
  await expect(page.getByRole('heading', { name: '审计日志', exact: true })).toBeVisible()
  const ids = await page.evaluate(async () => {
    async function request(
      path: string,
      method: string,
      body?: unknown,
      role = 'admin',
      user = '8001',
      key?: string,
    ) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-demo-role': role,
          'x-demo-user': user,
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()) as { data: { id: string } }
    }
    await request('/tasks/3001/pause', 'POST', undefined, 'developer', '8005', 'audit-pause')
    await request('/tasks/3001/pause', 'POST', undefined, 'developer', '8005', 'audit-pause')
    const copy = await request('/datasets/2001/copy', 'POST', undefined, 'developer', '8005')
    const tablesResponse = await fetch('/api/v1/warehouse/tables', {
      headers: { 'x-demo-role': 'viewer', 'x-demo-user': '8003' },
    })
    if (!tablesResponse.ok) throw new Error(await tablesResponse.text())
    const tables = (await tablesResponse.json()) as { data: { name: string }[] }
    const table = tables.data[0]
    if (!table) throw new Error('Expected an existing warehouse table')
    const query = await request(
      '/queries',
      'POST',
      { sql: 'SELECT * FROM ' + table.name + ' LIMIT 100' },
      'viewer',
      '8003',
    )
    await request('/demo/tick', 'POST', { advanceSeconds: 3 })
    const output = await request(
      '/exports',
      'POST',
      { queryId: query.data.id, format: 'csv' },
      'viewer',
      '8003',
    )
    await request('/demo/tick', 'POST', { advanceSeconds: 2 })
    await request('/demo/tick', 'POST', { advanceSeconds: 86400 })
    return { copyId: copy.data.id, exportId: output.data.id }
  })
  await page.goto('/system/audit?action=expired&actor=worker-demo&resource=exports&trace=keep')
  const body = page.locator('.n-data-table-tbody')
  await expect(body.getByRole('row')).toHaveCount(1)
  await expect(body.getByRole('cell', { name: '文件过期', exact: true })).toBeVisible()
  await expect(body.getByRole('cell', { name: 'worker-demo', exact: true })).toBeVisible()
  await expect(body.getByRole('button', { name: /^查看审计记录/ })).toHaveText(ids.exportId)
  await expect(body.locator('time[datetime]')).toHaveCount(1)
  await expect(body.getByRole('cell', { name: /^20[0-9]{2}-.*T.*Z$/ })).toHaveCount(0)
  await page.getByLabel('行为', { exact: true }).click()
  for (const label of [
    '文件就绪',
    '文件过期',
    '自动重试',
    '计划派发',
    '排队',
    '执行中',
    '质量校验中',
    '发布中',
    '初始化',
  ])
    await expect(
      page.locator('.n-base-select-option').getByText(label, { exact: true }),
    ).toBeAttached()
  await page.locator('.n-base-select-option').getByText('文件就绪', { exact: true }).click()
  await expect(page).toHaveURL(/action=ready/)
  await expect(body.getByRole('cell', { name: '文件就绪', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/action=expired/)
  await expect(body.getByRole('cell', { name: '文件过期', exact: true })).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(/action=ready/)
  await page.reload()
  await expect(body.getByRole('cell', { name: '文件就绪', exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前页', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('jiuzhang-audit.csv')
  const csv = await readFile((await download.path())!, 'utf8')
  expect(csv).toContain('"worker-demo","ready","exports","' + ids.exportId + '"')
  expect(csv).toMatch(/20[0-9]{2}-[0-9]{2}-[0-9]{2}T[^,]+Z/)
  expect(csv).not.toContain('文件就绪')
  const trigger = body.getByRole('button', { name: /^查看审计记录/ })
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await trigger.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: '审计详情', exact: true })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('ready', { exact: true })).toBeVisible()
    await expect(drawer.getByText(/ · 20[0-9]{2}-.*Z$/)).toBeVisible()
    await expect
      .poll(() => drawer.evaluate((root) => root.contains(document.activeElement)))
      .toBe(true)
    await page.keyboard.press('Tab')
    await expect
      .poll(() => drawer.evaluate((root) => root.contains(document.activeElement)))
      .toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await expect
      .poll(() => drawer.evaluate((root) => Math.round(root.getBoundingClientRect().right)))
      .toBe(768)
    await page.screenshot({
      path: 'test-results/audit-detail-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(trigger).toBeFocused()
  }
  await page.goto('/system/audit?actor=8005&action=post&resource=datasets')
  await expect(body.getByRole('row')).toHaveCount(1)
  await expect(
    body.getByRole('cell', {
      name: 'POST /api/v1/datasets/2001/copy → ' + ids.copyId,
      exact: true,
    }),
  ).toBeVisible()
  await page.goto('/system/audit?actor=8005&action=post&resource=tasks')
  await expect(body.getByRole('row')).toHaveCount(1)
  await expect(
    body.getByRole('cell', { name: 'POST /api/v1/tasks/3001/pause → 3001', exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

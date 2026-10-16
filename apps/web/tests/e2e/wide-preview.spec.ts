import { test, expect, type Page } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'

async function request<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch('/api/v1' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    },
    { path, method, body },
  )
}

async function createWideTable(page: Page) {
  const columns = Array.from({ length: 16 }, (_, index) => 'field_' + index)
  columns[5] = 'nested.value'
  const longValue = '<img src=x onerror=alert(1)>_' + '长数据'.repeat(100)
  const rows = Array.from({ length: 121 }, (_, row) =>
    columns.map((_column, column) => (row === 0 && column === 3 ? longValue : row + '_' + column)),
  )
  rows[0]![4] = '0'
  rows[0]![5] = 'false'
  rows[0]![6] = ''
  rows[0]![7] = '90071992547409931234567890'
  rows[0]![8] = '1234567890123456.78'
  await request(page, '/imports', 'POST', {
    name: '宽表浏览器验收',
    tableName: 'ods_wide_acceptance',
    layer: 'ODS',
    csv: [columns, ...rows].map((row) => row.join(',')).join('\n'),
    mapping: columns.map((name) => ({ source: name, target: name })),
    outcome: 'succeeded',
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/v1/warehouse/tables?q=ods_wide_acceptance')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data[0] as Model<'Table'>
  })
  expect(result.rowCount).toBe('121')
  return { table: result, columns, longValue }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    if (!localStorage.getItem('jiuzhang.preference.theme'))
      localStorage.setItem('jiuzhang.preference.theme', 'dark')
  })
})

test('wide imported samples paginate and expose long values with keyboard, copy and focus recovery', async ({
  page,
  context,
}) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/warehouse/imports')
  await expect(page.locator('h1')).toBeVisible()
  const { table, longValue } = await createWideTable(page)
  for (const theme of ['dark', 'light']) {
    await page.goto('/warehouse/tables/' + table.id + '?tab=sample')
    const preview = page.getByRole('region', { name: '数据结果', exact: true })
    await expect(preview.getByRole('columnheader')).toHaveCount(16)
    await expect(preview.locator('tbody tr')).toHaveCount(50)
    const firstRow = preview.locator('tbody tr').first()
    await expect(firstRow.getByRole('cell').nth(4)).toHaveText('0')
    await expect(firstRow.getByRole('cell').nth(5)).toHaveText('false')
    await expect(firstRow.getByRole('cell').nth(6)).toHaveText('')
    await expect(firstRow.getByRole('cell').nth(7)).toHaveText('90071992547409931234567890')
    await expect(firstRow.getByRole('cell').nth(8)).toHaveText('1234567890123456.78')
    expect(
      (await preview.getByRole('columnheader').first().boundingBox())!.width,
    ).toBeGreaterThanOrEqual(170)
    expect((await preview.locator('tbody tr').first().boundingBox())!.height).toBeLessThan(100)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    const value = preview.getByRole('button', { name: '查看第 1 行 field_3 的完整值', exact: true })
    await value.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'field_3 · 完整值', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('pre')).toHaveText(longValue)
    await expect(dialog.locator('img')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    if (theme === 'dark') {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error('Permission denied')
            },
          },
        })
      })
      await dialog.getByRole('button', { name: '复制', exact: true }).click()
      await expect(page.getByText('复制失败，请手动选择文本', { exact: true })).toBeVisible()
    } else {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await dialog.getByRole('button', { name: '复制', exact: true }).click()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(longValue)
      await expect(page.getByText('已复制', { exact: true })).toBeVisible()
    }
    await page.screenshot({
      path: 'test-results/wide-value-' + theme + '.png',
      animations: 'disabled',
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(value).toBeFocused()
    await preview.locator('.n-pagination-item').filter({ hasText: /^3$/ }).click()
    await expect(preview.locator('tbody tr')).toHaveCount(21)
    await expect(preview.getByRole('cell', { name: '120_0', exact: true })).toBeVisible()
    const scroll = preview.locator('.n-scrollbar-container').first()
    await scroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await expect(
      preview.getByRole('columnheader', { name: 'field_15', exact: true }),
    ).toBeInViewport()
    await page.screenshot({
      path: 'test-results/wide-sample-' + theme + '.png',
      animations: 'disabled',
    })
    await page.reload()
    await expect(preview.locator('tbody tr')).toHaveCount(50)
    await preview.locator('.n-pagination .n-select').click()
    await page.locator('.n-base-select-option').getByText('20 / 页', { exact: true }).click()
    await expect(preview.locator('tbody tr')).toHaveCount(20)
    await preview.locator('.n-pagination .n-select').click()
    await page.locator('.n-base-select-option').getByText('100 / 页', { exact: true }).click()
    await expect(preview.locator('tbody tr')).toHaveCount(100)
    if (theme === 'dark') {
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      await page.reload()
    }
  }
  expect(errors).toEqual([])
})

test('wide query and service results reuse readable cells without changing returned values', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/warehouse/imports')
  await expect(page.locator('h1')).toBeVisible()
  const { table, columns, longValue } = await createWideTable(page)
  await page.goto('/warehouse/query?tableId=' + table.id)
  await page.getByRole('button', { name: '运行查询', exact: true }).click()
  const preview = page.getByRole('region', { name: '数据结果', exact: true })
  await expect(preview.getByRole('columnheader')).toHaveCount(16)
  await expect(preview.locator('tbody tr')).toHaveCount(50)
  expect((await preview.locator('tbody tr').first().boundingBox())!.height).toBeLessThan(100)
  await page.reload()
  await expect(
    preview.getByRole('button', { name: '查看第 1 行 field_3 的完整值', exact: true }),
  ).toBeVisible()
  const service = await request<Model<'Service'>>(page, '/services', 'POST', {
    name: '宽表服务验收',
    description: '合成宽表',
    owner: '演示组',
    tags: [],
    tableId: table.id,
    fields: columns,
    parameters: [],
    pageSize: 100,
    sortField: '',
    allowedRoles: ['admin'],
  })
  await page.goto('/services/' + service.id + '?tab=caller')
  await page.getByRole('button', { name: '模拟调用', exact: true }).click()
  await expect(preview.getByRole('columnheader')).toHaveCount(16)
  await expect(preview.locator('tbody tr')).toHaveCount(50)
  await preview.getByRole('button', { name: '查看第 1 行 field_3 的完整值', exact: true }).click()
  await expect(page.getByRole('dialog').locator('pre')).toHaveText(longValue)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
})

import { test, expect, type Page, type Locator } from '@playwright/test'
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

async function expectReadable(table: Locator) {
  await expect(table.locator('tbody tr').first()).toBeVisible()
  expect((await table.locator('tbody tr').first().boundingBox())!.height).toBeLessThan(100)
  const widths = await table
    .getByRole('columnheader')
    .evaluateAll((headers) => headers.map((header) => header.getBoundingClientRect().width))
  for (const width of widths) expect(width).toBeGreaterThanOrEqual(170)
}

test('long schema values remain readable across dataset, warehouse and immutable version views', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    if (!localStorage.getItem('jiuzhang.preference.theme'))
      localStorage.setItem('jiuzhang.preference.theme', 'dark')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2001')
  await expect(page.locator('h1')).toHaveText('订单明细宽表')
  const dataset = await request<Model<'Dataset'>>(page, '/datasets/2001')
  const original = await request<Model<'DatasetVersion'>>(page, '/datasets/2001/versions/1')
  const description = '<img src=x onerror=alert(1)>_' + '完整字段说明'.repeat(100)
  const target = 'descriptive_customer_' + 'long_'.repeat(30)
  await request(page, '/datasets/2001', 'PATCH', {
    definition: {
      ...dataset.definition,
      fields: dataset.definition.fields.map((field) => ({
        ...field,
        target: field.name === 'customer' ? target : field.target,
        description,
      })),
      schedule: { ...dataset.definition.schedule, mode: 'manual', retries: 0 },
    },
  })
  await request(page, '/datasets/2001/publish', 'POST')
  const run = await request<Model<'Run'>>(page, '/datasets/2001/runs', 'POST', {
    outcome: 'succeeded',
  })
  await request(page, '/demo/tick', 'POST', { advanceSeconds: 8 })
  const finished = await request<Model<'Run'>>(page, '/runs/' + run.id)
  expect(finished.status).toBe('succeeded')
  expect(finished.outputTableId).toBeTruthy()
  for (const theme of ['dark', 'light']) {
    for (const [name, path] of [
      ['dataset', '/datasets/2001?tab=fields'],
      ['warehouse', '/warehouse/tables/' + finished.outputTableId + '?tab=schema'],
    ]) {
      await page.goto(path!)
      const table = page.locator('.n-data-table').last()
      await expectReadable(table)
      const value = table.getByRole('button', { name: /^查看第 1 行 说明\s*的完整值$/ })
      await expect(value).toHaveCount(1)
      await value.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: /^说明\s*· 完整值$/ })
      await expect(dialog.locator('pre')).toHaveText(description)
      await expect(dialog.locator('img')).toHaveCount(0)
      await page.screenshot({
        path: '/tmp/jiuzhang-desktop-1280-schema-' + name + '-' + theme + '.png',
        animations: 'disabled',
      })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(value).toBeFocused()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(page.viewportSize()?.width)
    }
    await page.goto('/datasets/2001/versions/1?sourceObjectId=11001&field=id')
    const snapshot = page.locator('.n-card').filter({ hasText: '输入源结构快照' })
    await expectReadable(snapshot.locator('.n-data-table'))
    await expect(snapshot.locator('.n-data-table tbody tr')).toHaveCount(1)
    await snapshot.getByRole('button', { name: '查看全部字段', exact: true }).click()
    await expect(snapshot.locator('.n-data-table tbody tr')).toHaveCount(
      original.sourceSnapshots[0]!.object.fields.length,
    )
    const diff = page.locator('.n-data-table').last()
    await expectReadable(diff)
    const changed = diff.getByRole('button', { name: /^查看第 2 行 当前草稿\s*的完整值$/ })
    await expect(changed).toHaveCount(1)
    await changed.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').locator('pre')).toHaveText(target + ' · string')
    await page.keyboard.press('Escape')
    await expect(changed).toBeFocused()
    await expect(page.locator('.n-modal-mask')).toBeHidden()
    await page.screenshot({
      path: '/tmp/jiuzhang-desktop-1280-schema-version-' + theme + '.png',
      animations: 'disabled',
    })
    await page.reload()
    await expectReadable(page.locator('.n-data-table').last())
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    if (theme === 'dark') {
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      await page.reload()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
        .toBe('light')
    }
  }
  expect(await request(page, '/datasets/2001/versions/1')).toEqual(original)
  expect(errors).toEqual([])
})

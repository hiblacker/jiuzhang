import { expect, test } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'

test('long output names and keys stay readable in drafts, editor and immutable version summaries', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    localStorage.setItem('jiuzhang.preference.theme', 'light')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2001')
  await expect(page.getByRole('heading', { name: '订单明细宽表', exact: true })).toBeVisible()
  const table = 'dwd_' + 'sales_'.repeat(45)
  const key = 'business_key_' + 'part_'.repeat(30)
  const { original, published } = await page.evaluate(
    async ({ table, key }) => {
      const request = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch('/api/v1' + path, {
          method,
          headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) throw new Error(await response.text())
        return (await response.json()).data
      }
      const dataset: Model<'Dataset'> = await request('/datasets/2001')
      const original: Model<'DatasetVersion'> = await request('/datasets/2001/versions/1')
      await request('/datasets/2001', 'PATCH', {
        definition: {
          ...dataset.definition,
          fields: dataset.definition.fields.map((field) =>
            field.target === 'id' ? { ...field, target: key } : field,
          ),
          output: { ...dataset.definition.output, table, keys: [key] },
          schedule: { ...dataset.definition.schedule, mode: 'manual' },
        },
      })
      const published: Model<'DatasetVersion'> = await request('/datasets/2001/publish', 'POST')
      return { original, published }
    },
    { table, key },
  )
  expect(published.version).toBe(2)
  for (const [name, path] of [
    ['detail', '/datasets/2001'],
    ['editor', '/datasets/2001/edit?tab=output'],
    ['version', '/datasets/2001/versions/2'],
  ]) {
    await page.goto(path!)
    const output = page.getByRole('region', { name: '输出写入配置', exact: true })
    await expect(output).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('.n-descriptions-table-content:visible')
          .evaluateAll((cells) =>
            Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
          ),
      )
      .toBeGreaterThanOrEqual(220)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)
    await expect(output.getByText(key, { exact: true })).toHaveText(key)
    if (name !== 'editor')
      await expect(page.locator('.n-descriptions').getByText(table, { exact: true })).toHaveText(
        table,
      )
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
        await page.getByRole('button', { name: '切换明暗主题', exact: true }).press('Enter')
      await page.screenshot({
        path: '/tmp/jiuzhang-dataset-summary-' + name + '-' + '1440-' + theme + '.png',
        fullPage: true,
        animations: 'disabled',
      })
    }
    await page.reload()
    await expect(output.getByText(key, { exact: true })).toHaveText(key)
  }
  await page.goto('/datasets/2001?tab=schedule&trace=keep')
  await expect(page.getByRole('tab', { name: '调度', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('.n-descriptions').getByText('manual', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.n-descriptions-table-content:visible')
        .evaluateAll((cells) =>
          Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
        ),
    )
    .toBeGreaterThanOrEqual(220)
  await page.reload()
  await expect(page).toHaveURL('/datasets/2001?tab=schedule&trace=keep')
  await expect(page.locator('.n-descriptions').getByText('manual', { exact: true })).toBeVisible()
  const versions = await page.evaluate(async () => {
    const request = async (version: number) => {
      const response = await fetch('/api/v1/datasets/2001/versions/' + version)
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    }
    return { original: await request(1), published: await request(2) }
  })
  expect(versions).toEqual({ original, published })
  expect(errors).toEqual([])
})

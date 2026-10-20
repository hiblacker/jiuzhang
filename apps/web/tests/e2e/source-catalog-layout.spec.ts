import { expect, test } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'

test('source explorer fills the desktop with resizable independently scrolling panels', async ({
  page,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const description = '合成字段说明'.repeat(40)
  await page.addInitScript((description) => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    localStorage.setItem('jiuzhang.preference.theme', 'light')
    const original = window.fetch
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      if (url.pathname !== '/api/v1/sources/1001/objects' || !response.ok) return response
      const payload = (await response.json()) as { data: Model<'SourceObject'>[] }
      const object = payload.data[0]!
      payload.data = Array.from({ length: 80 }, (_, index) => ({
        ...object,
        id: String(71000 + index),
        name: 'synthetic_table_' + String(index).padStart(3, '0'),
        fields: Array.from({ length: 75 }, (_, field) => ({
          ...object.fields[0]!,
          name: 'field_' + field,
          description: field === 0 ? description : 'Synthetic field ' + field,
        })),
      }))
      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }, description)
  await page.goto('/sources/1001')
  const catalog = page.getByRole('complementary', { name: '对象目录', exact: true })
  const schema = page.getByRole('region', { name: '字段结构', exact: true })
  const preview = schema.getByRole('region', { name: '数据结果', exact: true })
  const separator = page.getByRole('separator', { name: '调整表目录宽度', exact: true })
  const sourceHeading = page.getByRole('heading', { name: '零售订单库', exact: true })
  const sourceSummary = page.getByRole('region', { name: '基本信息', exact: true })
  await expect(catalog.getByText('80 张表', { exact: true })).toBeVisible()
  await expect(
    page.locator('.page-title-row').getByRole('region', { name: '基本信息' }),
  ).toBeVisible()
  expect(
    Math.abs((await sourceHeading.boundingBox())!.y - (await sourceSummary.boundingBox())!.y),
  ).toBeLessThan(12)
  const status = page.locator('[data-source-status]')
  const actions = page.locator('.page-header .page-actions')
  await expect(status).toContainText('retail_demo')
  await expect(status).toContainText('已连接')
  await expect(catalog.locator('[data-object-node="root"]')).toHaveCount(0)
  await expect(catalog.locator('[data-object-node^="object:"]')).toHaveCount(80)
  await expect(actions.getByRole('button', { name: '返回', exact: true })).toBeVisible()
  await expect(actions.getByRole('button', { name: '编辑', exact: true })).toBeVisible()
  expect((await status.boundingBox())!.y).toBe(
    (await actions.boundingBox())!.y +
      ((await actions.boundingBox())!.height - (await status.boundingBox())!.height) / 2,
  )
  await expect(
    page
      .getByRole('region', { name: '基本信息', exact: true })
      .getByText('已连接', { exact: true }),
  ).toHaveCount(0)
  await expect(catalog.getByText('retail_demo', { exact: true })).toHaveCount(0)
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark')
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect(page.locator('.catalog-card')).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(24, 37, 56)' : 'rgb(255, 255, 255)',
    )
    await expect(catalog.getByText('80 张表', { exact: true })).toBeVisible()
    await expect(schema.locator('.schema-heading p')).toContainText('75 个字段')
    await expect(preview.locator('tbody tr')).toHaveCount(50)
    const catalogBounds = (await catalog.boundingBox())!
    const schemaBounds = (await schema.boundingBox())!
    expect(catalogBounds.height).toBeGreaterThan(650)
    expect(catalogBounds.width).toBeGreaterThan(280)
    expect(schemaBounds.height).toBe(catalogBounds.height)
    expect(schemaBounds.width).toBeGreaterThan(650)
    expect(schemaBounds.y + schemaBounds.height).toBeLessThanOrEqual(980)
    const geometry = await page.locator('.main-content').evaluate((element) => ({
      overflow: element.scrollHeight - element.clientHeight,
      pageWidth: document.documentElement.scrollWidth,
    }))
    expect(geometry.overflow).toBeLessThanOrEqual(2)
    expect(geometry.pageWidth).toBe(1280)
    const fieldScroll = preview.locator('.n-scrollbar-container').first()
    await fieldScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(preview.getByRole('cell', { name: 'field_49', exact: true })).toBeInViewport()
    await preview.locator('.n-pagination-item').filter({ hasText: /^2$/ }).click()
    await expect(preview.locator('tbody tr')).toHaveCount(25)
    await fieldScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(preview.getByRole('cell', { name: 'field_74', exact: true })).toBeInViewport()
    await preview.locator('.n-pagination-item').filter({ hasText: /^1$/ }).click()
    await expect(preview.locator('tbody tr')).toHaveCount(50)
    await fieldScroll.evaluate((element) => {
      element.scrollTop = 0
    })
    const fullValue = preview.getByRole('button', {
      name: '查看第 1 行 说明 的完整值',
      exact: true,
    })
    await fullValue.press('Enter')
    await expect(page.getByRole('dialog').locator('pre')).toHaveText(description)
    await page.keyboard.press('Escape')
    await expect(fullValue).toBeFocused()
    await separator.focus()
    await separator.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '32')
    expect((await catalog.boundingBox())!.width).toBeGreaterThan(catalogBounds.width)
    await separator.press('ArrowLeft')
    const handle = (await separator.boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
    await page.mouse.down()
    await page.mouse.move(handle.x + 75, handle.y + 100, { steps: 5 })
    await page.mouse.up()
    expect((await catalog.boundingBox())!.width).toBeGreaterThan(catalogBounds.width + 50)
    await separator.press('Home')
    await separator.press('ArrowRight')
    await separator.press('ArrowRight')
    await separator.press('ArrowRight')
    const tree = catalog.locator('.n-tree')
    await tree.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(catalog.getByText('synthetic_table_079', { exact: true })).toBeInViewport()
    await expect(catalog.getByRole('textbox', { name: '搜索表名', exact: true })).toBeInViewport()
    await tree.evaluate((element) => {
      element.scrollTop = 0
    })
    await separator.blur()
    expect(
      await page
        .locator('.main-content > .n-layout-scroll-container')
        .evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(2)
    await expect(page.getByRole('heading', { name: '零售订单库', exact: true })).toBeInViewport()
    await page.screenshot({
      path: '/tmp/jiuzhang-source-explorer-' + theme + '.png',
      animations: 'disabled',
    })
  }
  const search = catalog.getByRole('textbox', { name: '搜索表名', exact: true })
  await search.fill('synthetic_table_079')
  await expect(catalog.locator('[data-object-node^="object:"]')).toHaveCount(1)
  await catalog.getByText('synthetic_table_079', { exact: true }).click()
  await expect(page).toHaveURL(/objectId=71079/)
  await expect(
    schema.getByRole('heading', { name: 'synthetic_table_079', exact: true }),
  ).toBeVisible()
  await search.fill('no_such_synthetic_table')
  await expect(catalog.locator('[data-object-node^="object:"]')).toHaveCount(0)
  await expect(
    schema.getByRole('heading', { name: 'synthetic_table_079', exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('schema-based sources retain schema grouping without a database tree level', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    const original = window.fetch
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      if (url.pathname !== '/api/v1/sources/1001' || !response.ok) return response
      const payload = (await response.json()) as { data: Model<'Source'> }
      payload.data.type = 'PostgreSQL'
      payload.data.settings.schema = 'sales'
      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })
  await page.goto('/sources/1001')
  const catalog = page.getByRole('complementary', { name: '对象目录', exact: true })
  const schemaNode = catalog.locator('[data-object-node="schema"]')
  const schemaLabel = catalog.getByText('sales', { exact: true })
  const tableLabel = catalog.getByText('orders', { exact: true })
  await expect(catalog.locator('[data-object-node="root"]')).toHaveCount(0)
  await expect(schemaNode).toBeVisible()
  await expect(tableLabel).toBeVisible()
  expect((await tableLabel.boundingBox())!.x).toBeGreaterThan((await schemaLabel.boundingBox())!.x)
  await expect(catalog.getByText('retail_demo', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-source-status]')).toContainText('retail_demo')
})

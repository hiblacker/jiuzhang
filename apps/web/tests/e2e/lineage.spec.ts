import { test, expect } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'
test('resource and version-bound field lineage preserve direction, URL and navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/governance/lineage?resource=dataset-2001&direction=upstream')
  await expect(page.locator('.vue-flow__node')).toHaveCount(2)
  await page.getByLabel('追踪方向', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('仅下游', { exact: true }).click()
  await expect(page).toHaveURL(/direction=downstream/)
  await expect(page.locator('.vue-flow__node')).toHaveCount(3)
  await page.goBack()
  await expect(page.locator('.vue-flow__node')).toHaveCount(2)
  await page.goto('/governance/lineage?scope=field&resource=table-4001&field=id&direction=upstream')
  await expect(page.locator('.vue-flow__node')).toHaveCount(3)
  await expect(
    page.locator('.vue-flow__node').filter({ hasText: '订单明细宽表 v1 · id' }),
  ).toBeVisible()
  await page.reload()
  await expect(page.locator('.vue-flow__node')).toHaveCount(3)
  await page.locator('.vue-flow__node').filter({ hasText: '订单明细宽表 v1 · id' }).click()
  await page.getByRole('button', { name: '打开资源', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001/versions/1$'))
  expect(errors).toEqual([])
})

test('large multi-level lineage stays navigable by search and keyboard in both themes', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/governance/lineage')
  await expect(page.getByRole('heading', { name: '数据血缘', exact: true })).toBeVisible()
  const chain = await page.evaluate(async () => {
    async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      const response = await fetch('/api/v1' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'developer' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data as T
    }
    const template = await request<Model<'Dataset'>>('/datasets/2001')
    const ids = ['2001']
    for (let index = 1; index <= 5; index++) {
      const created = await request<Model<'Dataset'>>('/datasets', 'POST', {
        name: '多级血缘-' + index,
        description: '合成链路',
        owner: '演示组',
        tags: [],
        definition: {
          ...template.definition,
          sourceId: '',
          objectId: '',
          upstreamDatasetId: ids.at(-1),
          schedule: { ...template.definition.schedule, mode: 'manual', dependencies: [] },
          output: { ...template.definition.output, table: 'lineage_chain_' + index },
        },
      })
      await request('/datasets/' + created.id + '/publish', 'POST')
      ids.push(created.id)
    }
    const graph = await request<Model<'Lineage'>>('/governance/lineage?scope=field')
    return { ids, fieldCount: graph.nodes.length }
  })
  await page.goto('/governance/lineage?scope=field')
  const graph = page.getByRole('region', { name: '数据血缘图', exact: true })
  await expect(graph.locator('.vue-flow__node')).toHaveCount(chain.fieldCount)
  expect(chain.fieldCount).toBeGreaterThan(100)
  await page.getByRole('textbox', { name: '定位血缘节点', exact: true }).fill('多级血缘-5 v1 · id')
  await page
    .locator('.n-base-select-option')
    .getByText('多级血缘-5 v1 · id', { exact: true })
    .click()
  await expect(page.getByRole('button', { name: '打开资源', exact: true })).toBeVisible()
  const last = graph.getByRole('group', { name: '多级血缘-5 v1 · id', exact: true })
  await expect(last).toBeInViewport()
  await last.focus()
  await page.keyboard.press('Enter')
  await expect(last).toBeFocused()
  await expect(page.getByRole('button', { name: '打开资源', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '打开资源', exact: true })).toHaveCount(0)
  await last.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '打开资源', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开资源', exact: true }).click()
  await expect(page).toHaveURL('/datasets/' + chain.ids.at(-1) + '/versions/1')
  await page.goto(
    '/governance/lineage?scope=field&resource=dataset-' +
      chain.ids.at(-1) +
      '&field=id&direction=upstream&trace=keep',
  )
  await expect(graph.locator('.vue-flow__node')).toHaveCount(chain.ids.length + 1)
  const positions = await graph.locator('.vue-flow__node').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute('data-id'),
      x: node.getBoundingClientRect().x,
    })),
  )
  for (let index = 1; index < chain.ids.length; index++) {
    const previous = positions.find(
      (node) => node.id === 'dataset-field-' + chain.ids[index - 1] + ':1:id',
    )!
    const next = positions.find(
      (node) => node.id === 'dataset-field-' + chain.ids[index] + ':1:id',
    )!
    expect(next.x).toBeGreaterThan(previous.x)
  }
  await page.reload()
  await expect(graph.locator('.vue-flow__node')).toHaveCount(chain.ids.length + 1)
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keep')
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-desktop-1280-lineage-chain-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  expect(errors).toEqual([])
})

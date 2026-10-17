import { expect, test, type Page } from '@playwright/test'
import type { Model } from '../../src/shared/api/types'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
})

async function choose(page: Page, label: string, text: string | RegExp, searchable = false) {
  const trigger = page.getByRole('button', {
    name: searchable ? '打开' + label + '选项' : label,
    exact: true,
  })
  await trigger.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  if (searchable) {
    expect(typeof text).toBe('string')
    await page.getByRole('textbox', { name: label, exact: true }).fill(String(text))
  } else await trigger.press('Enter')
  const pending = page.locator('.n-base-select-menu:visible .n-base-select-option--pending')
  if ((await pending.count()) === 0) await page.keyboard.press('ArrowDown')
  await expect(pending).toBeVisible()
  const visited = new Set<string>()
  function matches(value: string) {
    return typeof text === 'string' ? value === text : text.test(value)
  }
  while (!matches((await pending.innerText()).trim())) {
    const current = (await pending.innerText()).trim()
    expect(visited.has(current), 'Keyboard navigation must reach ' + String(text)).toBe(false)
    visited.add(current)
    await page.keyboard.press('ArrowDown')
    await expect(pending).not.toHaveText(current)
  }
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
}

test('graph controls support keyboard node editing and cycle rejection with persistent edges', async ({
  page,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2001/edit')
  await expect(page.getByPlaceholder('数据集名称', { exact: true })).toHaveValue('订单明细宽表')
  await choose(page, '新增节点类型', '过滤')
  await page.getByRole('button', { name: '添加节点', exact: true }).press('Enter')
  await expect(page.getByRole('textbox', { name: '节点配置', exact: true })).toHaveValue(
    'city=杭州',
  )
  await page.getByRole('button', { name: '删除连线', exact: true }).press('Enter')
  await choose(page, '连线起点', /^读取源表 ·/)
  await choose(page, '连线终点', /^过滤 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).press('Enter')
  await choose(page, '连线起点', /^过滤 ·/)
  await choose(page, '连线终点', /^字段映射 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).press('Enter')
  await choose(page, '连线起点', /^字段映射 ·/)
  await choose(page, '连线终点', /^过滤 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).press('Enter')
  await expect(page.getByText('连线将形成循环依赖，请调整方向', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '删除连线', exact: true })).toHaveCount(2)
  await choose(page, '选中节点', /^过滤 ·/)
  await page.getByRole('textbox', { name: '节点配置', exact: true }).fill('city=上海')
  await page.getByRole('button', { name: '保存草稿', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2001')
  await expect(page.getByRole('heading', { name: '订单明细宽表', exact: true })).toBeVisible()
  await page.goto('/datasets/2001/edit')
  await choose(page, '选中节点', /^过滤 ·/)
  await expect(page.getByRole('textbox', { name: '节点配置', exact: true })).toHaveValue(
    'city=上海',
  )
  const dataset = await page.evaluate(async () => {
    const response = await fetch('/api/v1/datasets/2001', {
      headers: { 'x-demo-role': 'developer' },
    })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data as Model<'Dataset'>
  })
  const filter = dataset.definition.nodes.find((node) => node.type === 'filter')
  expect(filter?.config).toBe('city=上海')
  expect(dataset.definition.edges).toHaveLength(2)
  expect(dataset.definition.edges.filter((edge) => edge.target === filter?.id)).toHaveLength(1)
  expect(dataset.definition.edges.filter((edge) => edge.source === filter?.id)).toHaveLength(1)
  expect(errors).toEqual([])
})

test('lineage filters and search keyboard controls preserve URLs and open the selected version', async ({
  page,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/governance/lineage?trace=keyboard')
  await expect(page.getByRole('region', { name: '数据血缘图', exact: true })).toBeVisible()
  await choose(page, '血缘范围', '字段级')
  await expect(page).toHaveURL(/scope=field/)
  await choose(page, '选择血缘资源', 'dwd_retail_1', true)
  await expect.poll(() => new URL(page.url()).searchParams.get('resource')).toBe('table-4001')
  await choose(page, '追踪方向', '仅上游')
  const beforeFieldUrl = page.url()
  await choose(page, '选择字段', 'id')
  const graph = page.getByRole('region', { name: '数据血缘图', exact: true })
  await expect(graph.locator('.vue-flow__node')).toHaveCount(3)
  const url = page.url()
  await page.goBack()
  await expect(page).toHaveURL(beforeFieldUrl)
  await page.goForward()
  await expect(page).toHaveURL(url)
  await page.reload()
  await expect(graph.locator('.vue-flow__node')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '选择字段', exact: true })).toContainText('id')
  expect(new URL(page.url()).searchParams.get('trace')).toBe('keyboard')
  await choose(page, '定位血缘节点', '订单明细宽表 v1 · id', true)
  await expect(
    graph.getByRole('group', { name: '订单明细宽表 v1 · id', exact: true }),
  ).toBeInViewport()
  await page.getByRole('button', { name: '打开资源', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2001/versions/1')
  expect(errors).toEqual([])
})

import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

async function selectByKeyboard(page: Page, label: string) {
  const menu = page.locator('.n-base-select-menu:visible')
  const options = menu.locator('.n-base-select-option')
  const target = options.filter({ has: page.getByText(label, { exact: true }) })
  await expect(target).toBeVisible()
  const limit = await options.count()
  for (let step = 0; step < limit; step++) {
    if ((await target.getAttribute('class'))?.includes('n-base-select-option--pending')) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(target).toHaveClass(/n-base-select-option--pending/)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
}

test('dependency selection paginates, restores multiple off-page names and isolates dataset drafts from live tasks', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/tasks/3001/edit')
  await expect(page.getByRole('textbox', { name: '任务名称', exact: true })).not.toHaveValue('')
  const fixture = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return await response.json()
    }
    const {
      id: _id,
      updatedAt: _at,
      status: _status,
      publishedVersion: _version,
      ...input
    } = (await request('/datasets/2001')).data
    const datasetIds: string[] = []
    for (let batch = 0; batch < 6; batch++) {
      const datasets = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          request('/datasets', 'POST', {
            ...input,
            name: 'A_dependency_' + String(batch * 20 + index).padStart(3, '0'),
            definition: {
              ...input.definition,
              schedule: { ...input.definition.schedule, mode: 'manual', dependencies: [] },
            },
          }),
        ),
      )
      datasetIds.push(...datasets.map((result) => result.data.id))
      await Promise.all(
        datasets.map((result) => request('/datasets/' + result.data.id + '/publish', 'POST')),
      )
    }
    const first = await request('/tasks?pageSize=100')
    const second = await request('/tasks?pageSize=100&page=2')
    const all = [...first.data, ...second.data] as { id: string; datasetId: string }[]
    const ids = datasetIds.map((id) => {
      const task = all.find((task) => task.datasetId === id)
      if (!task) throw new Error('Missing published task')
      return task.id
    })
    if (first.data.some((task: { id: string }) => task.id === ids[0] || task.id === ids[1]))
      throw new Error('Expected two selected tasks beyond the original first 100')
    await request('/tasks/' + ids[0] + '/pause', 'POST')
    const task = (await request('/tasks/3001')).data
    const dependencies = [ids[0], ids[1]]
    await request('/tasks/3001', 'PATCH', {
      schedule: { ...task.schedule, mode: 'manual', dependencies },
    })
    const dataset = (await request('/datasets/2001')).data
    await request('/datasets/2001', 'PATCH', {
      definition: {
        ...dataset.definition,
        schedule: { ...dataset.definition.schedule, mode: 'manual', dependencies },
      },
    })
    return { ids, total: first.meta.total - 1 }
  })
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/tasks') requests.push(url.search)
  })
  await page.reload()
  const picker = page.getByRole('group', { name: '任务依赖选择', exact: true })
  const search = page.getByRole('textbox', { name: '上游任务依赖', exact: true })
  for (const name of ['A_dependency_000调度', 'A_dependency_001调度'])
    await expect(picker.getByText(name, { exact: true })).toBeVisible()
  await expect(
    picker.getByText('已加载 20 / ' + fixture.total + ' 个可依赖任务', { exact: true }),
  ).toBeVisible()
  await picker.getByRole('button', { name: '加载更多依赖任务', exact: true }).click()
  await expect(
    picker.getByText('已加载 40 / ' + fixture.total + ' 个可依赖任务', { exact: true }),
  ).toBeVisible()
  await picker.getByRole('button', { name: '打开任务依赖选择', exact: true }).press('Enter')
  await search.fill('订单明细宽表调度')
  await expect(picker.getByText('已加载 0 / 0 个可依赖任务', { exact: true })).toBeVisible()
  await search.fill('A_dependency_119')
  await selectByKeyboard(page, 'A_dependency_119调度')
  await expect(picker.getByText('A_dependency_119调度', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page).toHaveURL('/tasks/3001')
  await page.goto('/tasks/3001/edit')
  await page.reload()
  for (const index of ['000', '001', '119'])
    await expect(picker.getByText('A_dependency_' + index + '调度', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('依赖失败保留草稿')
  async function scenario(value: 'error' | 'normal') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'tasks', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  await scenario('error')
  await picker.getByRole('button', { name: '打开任务依赖选择', exact: true }).press('Enter')
  await search.fill('A_dependency_118')
  await page.keyboard.press('Escape')
  await expect(
    picker.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: '任务名称', exact: true })).toHaveValue(
    '依赖失败保留草稿',
  )
  await expect(picker.getByText('A_dependency_000调度', { exact: true })).toBeVisible()
  await scenario('normal')
  await picker.getByRole('button', { name: '重试', exact: true }).click()
  await expect(picker.getByRole('alert')).toHaveCount(0)
  await picker.getByRole('button', { name: '打开任务依赖选择', exact: true }).press('Enter')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_dependency_118调度', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-desktop-1280-dependency-picker-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.goto('/tasks/3001/edit')
  await expect(page.getByRole('textbox', { name: '任务名称', exact: true })).toHaveValue(
    '订单明细宽表调度',
  )
  await page.goto('/datasets/2001/edit?tab=schedule')
  for (const index of ['000', '001'])
    await expect(picker.getByText('A_dependency_' + index + '调度', { exact: true })).toBeVisible()
  await picker.getByRole('button', { name: '打开任务依赖选择', exact: true }).press('Enter')
  await search.fill('订单明细宽表调度')
  await expect(picker.getByText('已加载 0 / 0 个可依赖任务', { exact: true })).toBeVisible()
  await search.fill('A_dependency_118')
  await selectByKeyboard(page, 'A_dependency_118调度')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  await page.goto('/datasets/2001/edit?tab=schedule')
  await page.reload()
  for (const index of ['000', '001', '118'])
    await expect(picker.getByText('A_dependency_' + index + '调度', { exact: true })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const task = await fetch('/api/v1/tasks/3001')
    const dataset = await fetch('/api/v1/datasets/2001')
    if (!task.ok || !dataset.ok) throw new Error('Cannot read saved configurations')
    return {
      task: (await task.json()).data.schedule.dependencies,
      dataset: (await dataset.json()).data.definition.schedule.dependencies,
    }
  })
  expect(saved.task).toEqual([fixture.ids[0], fixture.ids[1], fixture.ids[119]])
  expect(saved.dataset).toEqual([fixture.ids[0], fixture.ids[1], fixture.ids[118]])
  expect(requests.length).toBeGreaterThan(5)
  expect(requests.every((query) => new URLSearchParams(query).get('pageSize') === '20')).toBe(true)
  expect(errors).toEqual([])
})

test('missing selected dependencies report an error without exposing raw identifiers or mutating the draft', async ({
  page,
}) => {
  await page.goto('/datasets/2001/edit?tab=schedule')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).not.toHaveValue('')
  await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    const response = await fetch('/api/v1/datasets/2001', { headers })
    if (!response.ok) throw new Error(await response.text())
    const dataset = (await response.json()).data
    const update = await fetch('/api/v1/datasets/2001', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        definition: {
          ...dataset.definition,
          schedule: { ...dataset.definition.schedule, dependencies: ['999999999'] },
        },
      }),
    })
    if (!update.ok) throw new Error(await update.text())
  })
  await page.reload()
  const picker = page.getByRole('group', { name: '任务依赖选择', exact: true })
  await expect(picker.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
  await expect(picker.getByText('999999999', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue(
    '订单明细宽表',
  )
  const before = await page.evaluate(
    async () =>
      (await (await fetch('/api/v1/datasets/2001')).json()).data.definition.schedule.dependencies,
  )
  expect(before).toEqual(['999999999'])
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
})

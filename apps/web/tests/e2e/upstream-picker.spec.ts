import { expect, test } from '@playwright/test'

test('upstream datasets paginate after publication filtering and load the selected published schema beyond 100', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/datasets/2002/edit')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).not.toHaveValue('')
  const fixture = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    }
    const {
      id: _id,
      updatedAt: _at,
      status: _status,
      publishedVersion: _version,
      ...input
    } = await request('/datasets/2001')
    let selectedId = ''
    for (let batch = 0; batch < 6; batch++) {
      const created = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          request('/datasets', 'POST', {
            ...input,
            name: 'A_upstream_' + String(batch * 20 + index).padStart(3, '0'),
          }),
        ),
      )
      if (batch === 0) selectedId = created[0].id
      const published = batch === 0 ? created : created.slice(0, 5)
      await Promise.all(
        published.map((dataset) => request('/datasets/' + dataset.id + '/publish', 'POST')),
      )
    }
    const original = await request('/datasets/' + selectedId + '/versions/1')
    const upstream = await request('/datasets/' + selectedId)
    upstream.definition.fields[0].target = 'published_id'
    upstream.definition.output.keys = ['published_id']
    await request('/datasets/' + selectedId, 'PATCH', { definition: upstream.definition })
    const version = await request('/datasets/' + selectedId + '/publish', 'POST')
    upstream.definition.fields[0].target = 'unpublished_id'
    upstream.definition.output.keys = ['unpublished_id']
    await request('/datasets/' + selectedId, 'PATCH', { definition: upstream.definition })
    const target = await request('/datasets/2002')
    await request('/datasets/2002', 'PATCH', {
      definition: {
        ...target.definition,
        sourceId: '',
        objectId: '',
        upstreamDatasetId: selectedId,
        fields: version.definition.fields.map((field: { target: string }) => ({
          ...field,
          name: field.target,
        })),
        output: { ...target.definition.output, keys: ['published_id'] },
      },
    })
    const listResponse = await fetch('/api/v1/datasets?pageSize=100', { headers })
    if (!listResponse.ok) throw new Error(await listResponse.text())
    const list = (await listResponse.json()) as { data: { id: string }[] }
    if (list.data.some((dataset) => dataset.id === selectedId))
      throw new Error('Expected selected upstream outside the original first 100')
    const optionsResponse = await fetch(
      '/api/v1/datasets?publishedOnly=true&excludeId=2002&pageSize=20',
      { headers },
    )
    if (!optionsResponse.ok) throw new Error(await optionsResponse.text())
    return { selectedId, total: (await optionsResponse.json()).meta.total, original }
  })
  await page.reload()
  const picker = page.getByRole('group', { name: '上游数据集选择', exact: true })
  const search = page.getByRole('textbox', { name: '已发布上游数据集', exact: true })
  await expect(picker.getByText('A_upstream_000 · v2', { exact: true })).toBeVisible()
  await expect(
    picker.getByText('已加载 20 / ' + fixture.total + ' 个已发布数据集', { exact: true }),
  ).toBeVisible()
  await picker.getByRole('button', { name: '加载更多上游数据集', exact: true }).click()
  await expect(
    picker.getByText('已加载 40 / ' + fixture.total + ' 个已发布数据集', { exact: true }),
  ).toBeVisible()
  await search.fill('A_upstream_119')
  await expect(picker.getByText('已加载 0 / 0 个已发布数据集', { exact: true })).toBeVisible()
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_upstream_119 · v0', { exact: true }),
  ).toHaveCount(0)
  await search.fill('A_upstream_100')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_upstream_100 · v1', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '输出名 id', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '输入与建模', exact: true }).click()
  await search.fill('A_upstream_000')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_upstream_000 · v2', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '输出名 published_id', exact: true })).toHaveValue(
    'published_id',
  )
  await expect(
    page.getByRole('textbox', { name: '输出名 unpublished_id', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2002')
  await page.goto('/datasets/2002/edit')
  await expect(picker.getByText('A_upstream_000 · v2', { exact: true })).toBeVisible()
  await page.reload()
  await expect(picker.getByText('A_upstream_000 · v2', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '数据集名称', exact: true }).fill('上游失败保留草稿')
  async function scenario(value: 'error' | 'normal') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'datasets', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  await scenario('error')
  await search.fill('A_upstream_020')
  await page.keyboard.press('Escape')
  await expect(
    picker.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue(
    '上游失败保留草稿',
  )
  await scenario('normal')
  await picker.getByRole('button', { name: '重试', exact: true }).click()
  await expect(picker.getByRole('alert')).toHaveCount(0)
  await search.click()
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_upstream_020 · v1', { exact: true }),
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
      path: '/tmp/jiuzhang-desktop-1280-upstream-picker-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2002')
  await expect(page.getByRole('heading', { name: '客户价值分层', exact: true })).toBeVisible()
  const oldVersion = await page.evaluate(async (id) => {
    const response = await fetch('/api/v1/datasets/' + id + '/versions/1')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data
  }, fixture.selectedId)
  expect(oldVersion).toEqual(fixture.original)
  expect(errors).toEqual([])
})

test('a failed upstream version read blocks saving and retries without applying a stale schema', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    const original = window.fetch
    const control = window as Window & { failUpstreamVersion?: boolean }
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      if (control.failUpstreamVersion && url.pathname === '/api/v1/datasets/2001/versions/1')
        return new Response(
          JSON.stringify({
            error: {
              code: 'DEMO_ERROR',
              requestId: 'version-read-failure',
              message: 'Synthetic version read failure',
              details: [],
            },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      return original(input, init)
    }
  })
  await page.goto('/datasets/2002/edit')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).not.toHaveValue('')
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/v1/datasets/2002')
      writes.push(request.url())
  })
  await page.evaluate(() => {
    ;(window as Window & { failUpstreamVersion?: boolean }).failUpstreamVersion = true
  })
  const picker = page.getByRole('group', { name: '上游数据集选择', exact: true })
  const search = page.getByRole('textbox', { name: '已发布上游数据集', exact: true })
  await search.fill('订单明细宽表')
  await page
    .locator('.n-base-select-menu:visible')
    .getByText('订单明细宽表 · v1', { exact: true })
    .click()
  const pending = page.getByRole('alert').filter({ hasText: '正在读取上游发布版本的字段结构' })
  await expect(
    pending.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: '数据集名称', exact: true }).fill('版本读取失败草稿')
  await page.evaluate(() => {
    ;(window as Window & { failUpstreamVersion?: boolean }).failUpstreamVersion = false
  })
  await pending.getByRole('button', { name: '重试', exact: true }).click()
  await expect(pending).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '输出名 id', exact: true })).toHaveValue('id')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue(
    '版本读取失败草稿',
  )
  expect(writes).toEqual([])
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2002')
  await expect(page.getByRole('heading', { name: '客户价值分层', exact: true })).toBeVisible()
  await page.goto('/datasets/new')
  await expect(page.getByRole('heading', { name: '新建数据集', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue('')
  const missing = await page.evaluate(async () => {
    const response = await fetch('/api/v1/datasets/2001')
    if (!response.ok) throw new Error(await response.text())
    const upstream = (await response.json()).data
    const created = await fetch('/api/v1/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({
        name: '错误上游引用演示',
        description: '',
        owner: upstream.owner,
        tags: [],
        folderId: null,
        definition: { ...upstream.definition, upstreamDatasetId: '999999999' },
      }),
    })
    if (!created.ok) throw new Error(await created.text())
    return (await created.json()).data.id as string
  })
  await page.goto('/datasets/' + missing + '/edit')
  await expect(picker.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
  await expect(picker.getByText('999999999', { exact: true })).toHaveCount(0)
})

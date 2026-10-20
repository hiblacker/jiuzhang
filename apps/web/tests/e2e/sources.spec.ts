import { test, expect } from '@playwright/test'

for (const connector of [
  { type: 'MySQL', port: '3306', schema: false },
  { type: 'PostgreSQL', port: '5432', schema: true },
  { type: 'SQL Server', port: '1433', schema: true },
  { type: 'Oracle', port: '1521', schema: true },
  { type: 'Doris', port: '9030', schema: false },
  { type: 'ClickHouse', port: '8123', schema: false },
  { type: 'REST API', port: '', schema: false },
  { type: 'CSV', port: '', schema: false },
]) {
  test(
    connector.type + ' connector validates visible inputs and recovers after a failed demo test',
    async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'developer')
      })
      await page.goto('/sources/new')
      await page.getByLabel('类型', { exact: true }).click()
      await page.locator('.n-base-select-option').getByText(connector.type, { exact: true }).click()
      await page.getByPlaceholder('名称', { exact: true }).fill('失败-' + connector.type)
      const simulate = page.getByRole('button', { name: '模拟测试连接', exact: true })
      if (connector.port) {
        const host = page.getByRole('textbox', { name: '示例主机', exact: true })
        const port = page.getByRole('textbox', { name: '端口', exact: true })
        await expect(port).toHaveValue(connector.port)
        await expect(page.getByRole('textbox', { name: 'Schema', exact: true })).toHaveCount(
          connector.schema ? 1 : 0,
        )
        await host.fill('   ')
        await simulate.click()
        await expect(page.getByText('请填写此项', { exact: true })).toBeVisible()
        await host.fill('synthetic-db.invalid')
        await port.fill('')
        await simulate.click()
        await expect(page.getByText('端口须为 1–65535 的整数', { exact: true })).toBeVisible()
        await port.fill(connector.port)
      } else if (connector.type === 'REST API') {
        const url = page.getByRole('textbox', { name: '示例 API 地址', exact: true })
        await url.fill('http://synthetic-api.invalid')
        await simulate.click()
        await expect(
          page.getByText('请输入不含用户名和密码的有效 HTTPS 地址。', { exact: true }),
        ).toBeVisible()
        await url.fill('https://synthetic-api.invalid')
        const limit = page.getByRole('textbox', { name: '每分钟请求上限', exact: true })
        await limit.fill('')
        await simulate.click()
        await expect(
          page.getByText('每分钟请求上限须为 1–10000 的整数', { exact: true }),
        ).toBeVisible()
        await limit.fill('60')
      } else {
        await expect(page.getByRole('textbox', { name: '示例主机', exact: true })).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: '示例 API 地址', exact: true })).toHaveCount(
          0,
        )
      }
      await simulate.click()
      await expect(
        page
          .locator('.n-message')
          .getByText('模拟连接失败；名称含“失败”可触发此场景', { exact: true }),
      ).toBeVisible()
      await page.getByPlaceholder('名称', { exact: true }).fill('连接器验收-' + connector.type)
      await simulate.click()
      await expect(
        page.locator('.n-message').getByText('模拟检查通过，未访问真实服务', { exact: true }),
      ).toBeVisible()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: '连接器验收-' + connector.type, exact: true }),
      ).toBeVisible()
      await page.reload()
      await page.getByRole('button', { name: '编辑', exact: true }).click()
      if (connector.port)
        await expect(page.getByRole('textbox', { name: '端口', exact: true })).toHaveValue(
          connector.port,
        )
      await expect(page.getByPlaceholder('名称', { exact: true })).toHaveValue(
        '连接器验收-' + connector.type,
      )
    },
  )
}

test('API parameters validate, persist after reload and redact credentials without dropping other values', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  await page.goto('/sources/1007/edit')
  const headers = page.getByRole('textbox', { name: 'Headers JSON', exact: true })
  const query = page.getByRole('textbox', { name: 'Query JSON', exact: true })
  const body = page.getByRole('textbox', { name: 'Body JSON', exact: true })
  await query.fill('[]')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(
    page.getByText('请输入 JSON 对象，不能为数组、null 或普通文本。', { exact: true }),
  ).toBeVisible()
  await headers.fill(
    JSON.stringify({ Accept: 'application/json', Authorization: 'Bearer synthetic-demo-token' }),
  )
  await query.fill(JSON.stringify({ page: 0, enabled: false }))
  await body.fill(JSON.stringify({ city: '杭州', ids: ['100', '101'] }))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/sources/1007$'))
  await page.reload()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(headers).toHaveValue(
    JSON.stringify({ Accept: 'application/json', Authorization: '[REDACTED]' }, null, 2),
  )
  await expect(query).toHaveValue(JSON.stringify({ page: 0, enabled: false }, null, 2))
  await expect(body).toHaveValue(JSON.stringify({ city: '杭州', ids: ['100', '101'] }, null, 2))
})
test('source directory selects tables and shows their fields without row samples', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  await page.goto('/sources/1001')
  const tree = page.getByRole('complementary', { name: '对象目录', exact: true })
  await expect(tree.getByText('orders', { exact: true })).toBeVisible()
  await expect(tree.locator('[data-object-node^="field:"]')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByText('样本预览', { exact: true })).toHaveCount(0)
  await tree.getByText('customers', { exact: true }).click()
  await expect(page).toHaveURL(/objectId=11002/)
  await expect(page.getByRole('cell', { name: 'phone', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'id', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('cell', { name: 'phone', exact: true })).toBeVisible()
  await expect(page.getByText('138****0000', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '从此对象新建数据集' }).click()
  await expect(page).toHaveURL(/datasets[/]new[?]sourceId=1001&objectId=11002$/)
  await page.getByText('字段与清洗', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '输出 phone', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: '输出 id', exact: true })).toBeChecked()
})

test('workspace navigation stays at viewport height while page content scrolls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  await page.goto('/overview')
  const sidebar = page.locator('.n-layout-sider')
  const header = page.locator('.topbar')
  const content = page.locator('.main-content')
  const initialSidebar = await sidebar.boundingBox()
  const initialHeader = await header.boundingBox()
  expect(initialSidebar?.y).toBe(0)
  expect(initialSidebar?.height).toBe(1000)
  expect(initialHeader?.y).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1000)
  await content.evaluate((element) => {
    const spacer = document.createElement('div')
    spacer.style.height = '1200px'
    element.append(spacer)
  })
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await sidebar.boundingBox()).toEqual(initialSidebar)
  expect(await header.boundingBox()).toEqual(initialHeader)
})
test('source create, test, persist, edit cancel and dependency delete', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '进入演示工作区' })).toBeVisible()
  await page.getByRole('button', { name: '进入演示工作区' }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
  await expect(page.getByText('每一份数据，都有清晰的去向。')).toBeVisible()
  await page.getByRole('link', { name: '数据源', exact: true }).click()
  await expect(page.getByRole('button', { name: '零售订单库', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建数据源', exact: true }).click()
  await page.getByPlaceholder('名称', { exact: true }).fill('验收数据源')
  await page.getByRole('button', { name: '模拟测试连接', exact: true }).click()
  await expect(
    page.locator('.n-message').getByText('模拟检查通过，未访问真实服务', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '验收数据源', exact: true })).toBeVisible()
  const url = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { name: '验收数据源', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByPlaceholder('名称', { exact: true }).fill('未保存名称')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('heading', { name: '验收数据源', exact: true })).toBeVisible()
  await page.goto('/sources')
  await page
    .getByRole('row')
    .filter({ hasText: '零售订单库' })
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByText('资源被数据集或历史版本引用，请先处理依赖')).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page
    .getByRole('row')
    .filter({ hasText: '验收数据源' })
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: '验收数据源' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/sources.png', fullPage: true })
  expect(errors).toEqual([])
  expect(url).toContain('/sources/')
})

test('storage quota failure preserves the source draft and retry saves exactly once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  await page.goto('/sources/new')
  await page.getByPlaceholder('名称', { exact: true }).fill('存储恢复演示源')
  await page
    .getByRole('textbox', { name: '示例主机', exact: true })
    .fill('synthetic-storage.invalid')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        key === 'current' &&
        value.sources?.some((source: { name: string }) => source.name === '存储恢复演示源')
      ) {
        IDBObjectStore.prototype.put = original
        this.transaction.abort()
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
      }
      return original.call(this, value, key)
    }
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(
    page.getByText('浏览器演示存储空间不足，本次操作未保存。请释放空间后重试；表单输入仍保留。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByPlaceholder('名称', { exact: true })).toHaveValue('存储恢复演示源')
  await expect(page.getByRole('textbox', { name: '示例主机', exact: true })).toHaveValue(
    'synthetic-storage.invalid',
  )
  const unsaved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/sources?q=' + encodeURIComponent('存储恢复演示源'), {
      headers: { 'x-demo-role': 'developer' },
    })
    return response.json()
  })
  expect(unsaved.meta.total).toBe(0)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '存储恢复演示源', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '存储恢复演示源', exact: true })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/sources?q=' + encodeURIComponent('存储恢复演示源'), {
      headers: { 'x-demo-role': 'developer' },
    })
    return response.json()
  })
  expect(saved.meta.total).toBe(1)
})

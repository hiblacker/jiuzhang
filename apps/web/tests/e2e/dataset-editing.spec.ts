import { test, expect, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
})

async function choose(page: Page, label: string, option: RegExp) {
  await page.getByLabel(label, { exact: true }).click()
  await page
    .locator('.n-base-select-menu:visible .n-base-select-option')
    .filter({ hasText: option })
    .click()
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
}
test('historical source schemas stay inspectable through field deep links and show legacy migration provenance', async ({
  page,
}) => {
  await page.goto('/datasets/2001/versions/1?sourceObjectId=11001&field=id')
  await expect(page.getByText('输入源结构快照', { exact: true })).toBeVisible()
  await expect(page.getByText('发布时采集', { exact: true })).toBeVisible()
  const schemas = page.locator('.n-card').filter({ hasText: '输入源结构快照' })
  await expect(schemas.getByRole('row').filter({ hasText: '业务主键' })).toHaveCount(1)
  await expect(schemas.getByRole('row').filter({ hasText: '虚构客户' })).toHaveCount(0)
  await schemas.getByRole('button', { name: '查看全部字段', exact: true }).click()
  await expect(schemas.getByRole('row').filter({ hasText: '虚构客户' })).toHaveCount(1)
  await page.reload()
  await expect(schemas.getByRole('row').filter({ hasText: '业务主键' })).toBeVisible()
  await schemas.getByRole('button', { name: '查看当前数据源', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5174/sources/1001?objectId=11001')
  await page.goBack()
  await expect(page.getByText('发布时采集', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('jiuzhang-demo')
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const transaction = db.transaction('state', 'readwrite')
        const store = transaction.objectStore('state')
        const read = store.get('current')
        read.onsuccess = () => {
          const state = read.result
          const version = state.versions.find(
            (item: { datasetId: string; version: number }) =>
              item.datasetId === '2001' && item.version === 1,
          )
          delete version.sourceSnapshots
          delete version.sourceSnapshotOrigin
          delete version.sourceSnapshotCapturedAt
          store.put(state, 'current')
        }
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error)
        }
      }
    })
  })
  await page.reload()
  await expect(page.getByText('旧演示数据迁移补录', { exact: true })).toBeVisible()
  await expect(page.getByText('此版本创建于快照功能启用前', { exact: false })).toBeVisible()
  await page.screenshot({
    path: '/tmp/jiuzhang-desktop-1280-version-source-snapshot.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  await expect(page.getByText('旧演示数据迁移补录', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: '/tmp/jiuzhang-desktop-1280-version-source-snapshot-desktop-dark.png',
    fullPage: true,
  })
})
async function scenario(page: Page, value: 'normal' | 'error' | 'slow') {
  await page.evaluate(async (scenario) => {
    const response = await fetch('/api/v1/demo/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'developer' },
      body: JSON.stringify({ domain: 'datasets', scenario }),
    })
    if (!response.ok) throw new Error('Could not set test scenario')
  }, value)
}

test('version diff includes new, removed and changed fields; restore confirms and preserves history', async ({
  page,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2001/edit')
  await expect(page.getByPlaceholder('数据集名称', { exact: true })).toHaveValue('订单明细宽表')
  const history = await page.evaluate(
    async () => (await (await fetch('/api/v1/datasets/2001/versions/1')).json()).data,
  )
  await page.getByText('字段与清洗', { exact: true }).click()
  await page.getByLabel('输出名 phone', { exact: true }).fill('masked_phone')
  await page.getByLabel('删除字段 customer', { exact: true }).click()
  await page.getByRole('button', { name: '添加输出字段', exact: true }).click()
  await page.getByLabel('源字段名（支持 right_ 前缀）', { exact: true }).last().fill('extra_field')
  await page.getByLabel('输出名 extra_field', { exact: true }).fill('extra_field')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001$'))
  await page.goto('/datasets/2001/versions/1')
  await expect(page.getByRole('row').filter({ hasText: 'extra_field' })).toContainText('新增')
  await expect(page.getByRole('row').filter({ hasText: 'customer' })).toContainText('已移除')
  await expect(page.getByRole('row').filter({ hasText: 'masked_phone' })).toContainText('目标字段')
  await page.getByRole('button', { name: '恢复为草稿', exact: true }).click()
  const modal = page.locator('.n-modal')
  await expect(modal).toContainText('已有发布版本和历史运行保持不变')
  await modal.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: 'extra_field' })).toContainText('新增')
  await page.getByRole('button', { name: '恢复为草稿', exact: true }).click()
  await scenario(page, 'error')
  await modal.getByRole('button', { name: '确认恢复草稿', exact: true }).click()
  await expect(modal.getByText('当前已启用接口失败演示，可从演示控制台恢复')).toBeVisible()
  await expect(page).toHaveURL(new RegExp('/datasets/2001/versions/1$'))
  await scenario(page, 'normal')
  await modal.getByRole('button', { name: '确认恢复草稿', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001/edit$'))
  await page.getByText('字段与清洗', { exact: true }).click()
  await expect(page.getByLabel('输出名 phone', { exact: true })).toHaveValue('phone')
  await expect(page.getByLabel('输出名 customer', { exact: true })).toBeVisible()
  await expect(page.getByLabel('输出名 extra_field', { exact: true })).toHaveCount(0)
  const after = await page.evaluate(
    async () => (await (await fetch('/api/v1/datasets/2001/versions/1')).json()).data,
  )
  expect(after).toEqual(history)
  expect(errors).toEqual([])
})

test('graph changes affect preview, reject cycles and persist node and edge removals', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/datasets/2001/edit')
  await expect(page.getByPlaceholder('数据集名称', { exact: true })).toHaveValue('订单明细宽表')
  await page.getByRole('button', { name: '删除连线', exact: true }).click()
  await page.getByRole('button', { name: '添加节点', exact: true }).click()
  await expect(page.getByLabel('节点配置', { exact: true })).toHaveValue('city=杭州')
  await choose(page, '连线起点', /^读取源表 ·/)
  await choose(page, '连线终点', /^过滤 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).click()
  await choose(page, '连线起点', /^过滤 ·/)
  await choose(page, '连线终点', /^字段映射 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).click()
  await expect(page.getByRole('button', { name: '删除连线', exact: true })).toHaveCount(2)
  await choose(page, '连线起点', /^字段映射 ·/)
  await choose(page, '连线终点', /^过滤 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).click()
  await expect(page.getByText('连线将形成循环依赖，请调整方向')).toBeVisible()
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  await expect(page.getByRole('cell', { name: '杭州', exact: true })).toHaveCount(4)
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001$'))
  await page.goto('/datasets/2001/edit')
  await expect(page.getByRole('button', { name: '删除连线', exact: true })).toHaveCount(2)
  await choose(page, '选中节点', /^过滤 ·/)
  await page.getByRole('button', { name: '删除选中节点', exact: true }).click()
  await expect(page.getByRole('button', { name: '删除连线', exact: true })).toHaveCount(0)
  await choose(page, '连线起点', /^读取源表 ·/)
  await choose(page, '连线终点', /^字段映射 ·/)
  await page.getByRole('button', { name: '添加连线', exact: true }).click()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001$'))
  await page.goto('/datasets/2001/edit')
  await expect(page.getByRole('button', { name: '删除连线', exact: true })).toHaveCount(1)
  await expect(page.locator('.vue-flow__node')).toHaveCount(2)
})

test('unsaved dataset cancellation keeps the draft or leaves without overwriting saved data', async ({
  page,
}) => {
  await page.goto('/datasets/2001/edit')
  const name = page.getByPlaceholder('数据集名称', { exact: true })
  await expect(name).toHaveValue('订单明细宽表')
  await name.fill('未保存的加工草稿')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001/edit$'))
  await expect(name).toHaveValue('未保存的加工草稿')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/overview$'))
  await page.goto('/datasets/2001/edit')
  await expect(name).toHaveValue('订单明细宽表')
})

async function addNode(page: Page, label: RegExp, config?: string) {
  await choose(page, '新增节点类型', label)
  await page.getByRole('button', { name: '添加节点', exact: true }).click()
  if (config !== undefined) await page.getByLabel('节点配置', { exact: true }).fill(config)
}
async function connectNodes(page: Page, from: RegExp, to: RegExp) {
  await choose(page, '连线起点', from)
  await choose(page, '连线终点', to)
  await page.getByRole('button', { name: '添加连线', exact: true }).click()
}
test('Join editing preserves left-right order, nullable lookup fields and saved sample results', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/datasets/2001/edit')
  await expect(page.getByPlaceholder('数据集名称', { exact: true })).toHaveValue('订单明细宽表')
  await addNode(page, /^输入$/, '11003')
  await addNode(page, /^过滤$/, 'city=杭州')
  await addNode(page, /^关联$/)
  await connectNodes(page, /^字段映射 ·/, /^关联 ·/)
  await connectNodes(page, /^输入 ·/, /^过滤 ·/)
  await connectNodes(page, /^过滤 ·/, /^关联 ·/)
  await expect(page.getByText('左侧输入: 字段映射', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '交换左右输入', exact: true }).click()
  await expect(page.getByText('左侧输入: 过滤', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '交换左右输入', exact: true }).click()
  await page.getByText('字段与清洗', { exact: true }).click()
  await page.getByRole('button', { name: '添加输出字段', exact: true }).click()
  await page
    .getByLabel('源字段名（支持 right_ 前缀）', { exact: true })
    .last()
    .fill('right_customer')
  await page.getByLabel('输出名 right_customer', { exact: true }).fill('lookup_customer')
  await page.getByRole('checkbox', { name: '允许空值 right_customer', exact: true }).uncheck()
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  await expect(page.getByText('请检查输入内容', { exact: true })).toBeVisible()
  await page.getByText('字段与清洗', { exact: true }).click()
  await page.getByRole('checkbox', { name: '允许空值 right_customer', exact: true }).check()
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '101', exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByRole('cell').last()).toHaveText('NULL')
  const matched = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '100', exact: true }) })
  await expect(matched.getByRole('cell').last()).toHaveText('演示客户 1')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL(/\/datasets\/2001$/)
  await page.goto('/datasets/2001/edit')
  await choose(page, '选中节点', /^关联 ·/)
  await expect(page.getByText('左侧输入: 字段映射', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  await expect(matched.getByRole('cell').last()).toHaveText('演示客户 1')
})
test('Union all and distinct change row counts and aggregate edits produce grouped decimals', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/datasets/2001/edit')
  await expect(page.getByPlaceholder('数据集名称', { exact: true })).toHaveValue('订单明细宽表')
  await addNode(page, /^输入$/, '11003')
  await addNode(page, /^合并$/, 'all')
  await connectNodes(page, /^字段映射 ·/, /^合并 ·/)
  await connectNodes(page, /^输入 ·/, /^合并 ·/)
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  await expect(page.getByRole('cell', { name: '138****0000', exact: true })).toHaveCount(2)
  await page.getByText('输入与建模', { exact: true }).click()
  await choose(page, '选中节点', /^合并 ·/)
  await page.getByLabel('节点配置', { exact: true }).fill('distinct')
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  await expect(page.getByRole('cell', { name: '138****0000', exact: true })).toHaveCount(1)
  await page.getByText('输入与建模', { exact: true }).click()
  await addNode(page, /^聚合$/, 'sum:amount by city')
  await connectNodes(page, /^合并 ·/, /^聚合 ·/)
  await page.getByText('字段与清洗', { exact: true }).click()
  for (const name of ['id', 'customer', 'phone'])
    await page.getByLabel('删除字段 ' + name, { exact: true }).click()
  await page.getByText('输出与入仓', { exact: true }).click()
  await choose(page, '写入方式', /^替换$/)
  const keys = page.getByLabel('业务主键', { exact: true })
  await keys.getByRole('button', { name: 'close', exact: true }).click()
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  for (const amount of ['1112.00', '1252.00', '1392.00'])
    await expect(page.getByRole('cell', { name: amount, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL(/\/datasets\/2001$/)
  await page.goto('/datasets/2001/edit')
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  await expect(page.getByRole('cell', { name: '1112.00', exact: true })).toBeVisible()
})

test('publication confirmation keeps focus, retains failures and blocks closing or duplicate writes while pending', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2001')
  const trigger = page.getByRole('button', { name: '发布版本', exact: true })
  await expect(trigger).toBeEnabled()
  const historical = await page.evaluate(
    async () => (await (await fetch('/api/v1/datasets/2001/versions/1')).json()).data,
  )
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/datasets/2001/publish'))
      requests.push(request.url())
  })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const modal = page.locator('.n-modal')
  const cancel = modal.getByRole('button', { name: '取消', exact: true })
  const submit = modal.getByRole('button', { name: /确认发布/ })
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(requests).toHaveLength(0)

  await trigger.click()
  await scenario(page, 'error')
  await submit.click()
  await expect(
    modal.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(cancel).toBeEnabled()
  await page.keyboard.press('Escape')
  await trigger.click()
  await expect(
    modal.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toHaveCount(0)
  await scenario(page, 'slow')
  const started = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/datasets/2001/publish'),
  )
  await submit.click()
  await started
  await expect(cancel).toBeDisabled()
  await expect(submit).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(modal).toHaveCount(0)
  expect(requests).toHaveLength(2)
  await expect(trigger).toBeFocused()
  await scenario(page, 'normal')
  const after = await page.evaluate(async () => ({
    history: (await (await fetch('/api/v1/datasets/2001/versions/1')).json()).data,
    versions: (await (await fetch('/api/v1/datasets/2001/versions')).json()).data,
  }))
  expect(after.history).toEqual(historical)
  expect(after.versions.map((version: { version: number }) => version.version).sort()).toEqual([
    1, 2,
  ])
  expect(errors).toEqual([])
})

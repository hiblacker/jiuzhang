import { expect, test, type Page } from '@playwright/test'

async function selectByKeyboard(page: Page, label: string) {
  const options = page.locator('.n-base-select-menu:visible .n-base-select-option')
  const target = options.filter({ has: page.getByText(label, { exact: true }) })
  await expect(target).toBeVisible()
  const limit = await options.count()
  for (let step = 0; step < limit; step++) {
    if ((await target.getAttribute('class'))?.includes('n-base-select-option--pending')) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(target).toHaveClass(/n-base-select-option--pending/)
  await page.keyboard.press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('dataset source and upstream triggers support keyboard selection and recover focus without losing saved inputs', async ({
  page,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2002/edit')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue(
    '客户价值分层',
  )
  const source = page.getByRole('button', { name: '打开数据源选项', exact: true })
  const sourceSearch = page.getByRole('textbox', { name: '数据源', exact: true })
  await source.press('Enter')
  await expect(sourceSearch).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(source).toBeFocused()
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  await source.press('Enter')
  await sourceSearch.fill('零售订单库')
  await selectByKeyboard(page, '零售订单库')
  await expect(source).toContainText('零售订单库')
  const object = page.getByRole('button', { name: '源对象', exact: true })
  await object.press('Enter')
  await selectByKeyboard(page, 'orders')
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  await page.getByRole('button', { name: '保存草稿', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2002')
  await page.goto('/datasets/2002/edit')
  await expect(source).toContainText('零售订单库')
  const upstream = page.getByRole('button', { name: '打开已发布上游数据集选项', exact: true })
  const upstreamSearch = page.getByRole('textbox', { name: '已发布上游数据集', exact: true })
  await upstream.press('Enter')
  await expect(upstreamSearch).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(upstream).toBeFocused()
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0)
  await upstream.press('Enter')
  await upstreamSearch.fill('订单明细宽表')
  await selectByKeyboard(page, '订单明细宽表 · v1')
  const save = page.getByRole('button', { name: '保存草稿', exact: true })
  await expect(save).toBeEnabled()
  await save.press('Enter')
  await expect(page).toHaveURL('/datasets/2002')
  const definition = await page.evaluate(async () => {
    const response = await fetch('/api/v1/datasets/2002', {
      headers: { 'x-demo-role': 'admin' },
    })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data.definition
  })
  expect(definition.upstreamDatasetId).toBe('2001')
  expect(definition.sourceId).toBe('')
  expect(definition.objectId).toBe('')
  expect(definition.fields.length).toBeGreaterThan(0)
  await page.goto('/datasets/2002/edit')
  await page.reload()
  await expect(upstream).toContainText('订单明细宽表 · v1')
  await upstream.press('Enter')
  await upstreamSearch.fill('门店库存快照')
  await selectByKeyboard(page, '门店库存快照 · v1')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2002')
  await page.goto('/datasets/2002/edit')
  await expect(upstream).toContainText('订单明细宽表 · v1')
  expect(errors).toEqual([])
})

test('folder search inputs support keyboard parent selection, dataset move and saved editor selection', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/datasets')
  await expect(page.getByRole('heading', { name: '数据集', exact: true })).toBeVisible()
  const parents = await page.evaluate(async () => {
    const ids: string[] = []
    for (const name of ['键盘父目录A', '键盘父目录B']) {
      const response = await fetch('/api/v1/dataset-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ name, parentId: null }),
      })
      if (!response.ok) throw new Error('Unable to create demo parent folder')
      ids.push((await response.json()).data.id)
    }
    return ids
  })
  await page.reload()
  const sidebar = page.locator('aside').filter({ hasText: '数据集目录' })
  await sidebar.getByRole('button', { name: '新建目录', exact: true }).press('Enter')
  const dialog = page.getByRole('dialog', { name: '新建目录', exact: true })
  await dialog.getByRole('textbox', { name: '目录名称', exact: true }).fill('键盘子目录')
  const parent = dialog.getByRole('textbox', { name: '父目录', exact: true })
  const parentTrigger = dialog.getByRole('button', { name: '打开父目录选项', exact: true })
  await parentTrigger.press('Enter')
  await expect(parent).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(parentTrigger).toBeFocused()
  await parentTrigger.press('Enter')
  await parent.fill('键盘父目录A')
  await expect(page.locator('.n-base-select-option:visible')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await dialog.getByRole('button', { name: '保存', exact: true }).press('Enter')
  await expect(page).toHaveURL(/folderId=[0-9]+/)
  const childId = new URL(page.url()).searchParams.get('folderId')!
  const savedParent = await page.evaluate(async (id) => {
    const response = await fetch('/api/v1/dataset-folders', { headers: { 'x-demo-role': 'admin' } })
    if (!response.ok) throw new Error('Unable to read demo folders')
    return (await response.json()).data.find((folder: { id: string }) => folder.id === id).parentId
  }, childId)
  expect(savedParent).toBe(parents[0])
  await sidebar.getByRole('button', { name: '全部数据集', exact: true }).press('Enter')
  const row = page.getByRole('row').filter({ hasText: '订单明细宽表' })
  await row.getByRole('button', { name: '移动到目录', exact: true }).press('Enter')
  const move = page.getByRole('dialog', { name: '移动到目录', exact: true })
  const target = move.getByRole('textbox', { name: '目标目录', exact: true })
  await target.fill('键盘子目录')
  await expect(page.locator('.n-base-select-option:visible')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await move.getByRole('button', { name: '确认移动', exact: true }).press('Enter')
  await expect(
    row.getByRole('cell', { name: '键盘父目录A / 键盘子目录', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    row.getByRole('cell', { name: '键盘父目录A / 键盘子目录', exact: true }),
  ).toBeVisible()
  await page.goto('/datasets/2001/edit')
  const folder = page.getByRole('textbox', { name: '所属目录', exact: true })
  await expect(page.locator('.folder-select')).toContainText('键盘父目录A / 键盘子目录')
  await folder.fill('键盘父目录B')
  await expect(page.locator('.n-base-select-option:visible')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '保存草稿', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2001')
  const selected = await page.evaluate(async () => {
    const response = await fetch('/api/v1/datasets/2001', { headers: { 'x-demo-role': 'admin' } })
    if (!response.ok) throw new Error('Unable to read demo dataset')
    return (await response.json()).data.folderId
  })
  expect(selected).toBe(parents[1])
  await page.goto('/datasets/2001/edit')
  await expect(page.locator('.folder-select')).toContainText('键盘父目录B')
  await folder.fill('键盘父目录A')
  await expect(page.locator('.n-base-select-option:visible')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  page.once('dialog', (confirmation) => confirmation.accept())
  await page.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(page).toHaveURL('/datasets/2001')
  await page.goto('/datasets/2001/edit')
  await expect(page.locator('.folder-select')).toContainText('键盘父目录B')
})

test('warehouse table search inputs select with the keyboard and drive query results and service definitions', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto('/warehouse/query?tableId=4001')
  const table = page.getByRole('textbox', { name: '选择仓库表', exact: true })
  await expect(page.locator('.warehouse-table-select')).toContainText('dwd_retail_1')
  const tableTrigger = page.getByRole('button', { name: '打开选择仓库表选项', exact: true })
  await tableTrigger.press('Enter')
  await expect(table).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tableTrigger).toBeFocused()
  await tableTrigger.press('Enter')
  await table.fill('dws_retail_2')
  await selectByKeyboard(page, 'dws_retail_2')
  await expect(page).toHaveURL(/tableId=4002/)
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM dws_retail_2 LIMIT 100')
  await page.getByRole('button', { name: '运行查询', exact: true }).press('Enter')
  await expect(page.getByRole('columnheader', { name: 'id', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.warehouse-table-select')).toContainText('dws_retail_2')
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM dws_retail_2 LIMIT 100')
  await page.goto('/services/new')
  await page.getByRole('textbox', { name: '服务名称', exact: true }).fill('键盘选表服务')
  const source = page.getByRole('textbox', { name: '来源仓库表', exact: true })
  await source.fill('dws_retail_2')
  await selectByKeyboard(page, 'dws_retail_2')
  const output = page.getByRole('button', { name: '输出字段', exact: true })
  await output.press('Enter')
  await selectByKeyboard(page, 'id')
  await page.keyboard.press('Escape')
  await expect(output).toContainText('id')
  await page.getByRole('button', { name: '保存服务', exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: '键盘选表服务', exact: true })).toBeVisible()
  const serviceId = new URL(page.url()).pathname.split('/').at(-1)!
  const savedTable = await page.evaluate(async (id) => {
    const response = await fetch('/api/v1/services/' + id, { headers: { 'x-demo-role': 'admin' } })
    if (!response.ok) throw new Error('Unable to read demo service')
    return (await response.json()).data.tableId
  }, serviceId)
  expect(savedTable).toBe('4002')
  await page.goto('/services/' + serviceId + '/edit')
  await expect(page.locator('.warehouse-table-select')).toContainText('dws_retail_2')
})

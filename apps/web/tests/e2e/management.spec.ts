import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('masking edits reject invalid parameters and preview follows saved and disabled policy', async ({
  page,
}) => {
  await page.goto('/governance/masking/6001')
  await expect(page.getByRole('cell', { name: '138****0001', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑策略' }).click()
  const drawer = page.locator('.n-drawer')
  await drawer.getByPlaceholder('掩码保留前后位数，例如 3,4').fill('-1,4')
  await drawer.getByRole('button', { name: '保存策略' }).click()
  await expect(drawer.getByText('请输入两项非负整数，例如 3,4', { exact: true })).toBeVisible()
  await drawer.getByPlaceholder('掩码保留前后位数，例如 3,4').fill('1,1')
  await drawer.getByRole('button', { name: '保存策略' }).click()
  await expect(page.getByRole('cell', { name: '1*********1', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('cell', { name: '1*********1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑策略' }).click()
  await drawer.getByRole('switch').uncheck()
  await drawer.getByRole('button', { name: '保存策略' }).click()
  await expect(page.getByText('策略已停用，显示未处理的合成样本。')).toBeVisible()
  await expect(page.getByRole('cell', { name: '13800000001', exact: true })).toHaveCount(2)
})

test('governance edits persist, favorites survive refresh and service calls reflect disable', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/governance/masking/6001')
  await expect(page.getByRole('heading', { name: '手机号掩码' })).toBeVisible()
  await page.getByRole('button', { name: '编辑策略' }).click()
  const drawer = page.locator('.n-drawer')
  await drawer.getByRole('textbox').first().fill('验收手机号掩码')
  await drawer.getByRole('button', { name: '保存策略' }).click()
  await expect(page.getByRole('heading', { name: '验收手机号掩码' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '验收手机号掩码' })).toBeVisible()
  await page.goto('/governance/catalog')
  const row = page.getByRole('row').filter({ hasText: '零售订单库' })
  await row.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(row.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible()
  await page.reload()
  await expect(row.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible()
  await page.goto('/services/7001')
  await page.getByText('参数调用器', { exact: true }).click()
  await page.getByPlaceholder('JSON 参数').fill(JSON.stringify({ city: '杭州' }))
  await page.getByRole('button', { name: '模拟调用' }).click()
  await expect(page.getByRole('cell', { name: '杭州', exact: true })).toHaveCount(4)
  await page.getByText('审计日志', { exact: true }).click()
  await expect(page.getByRole('cell', { name: '模拟查询调用', exact: true })).toBeVisible()
  await page.goto('/services')
  await page
    .getByRole('row')
    .filter({ hasText: '订单明细宽表查询服务' })
    .getByRole('button', { name: '停用', exact: true })
    .click()
  await page.goto('/services/7001')
  await expect(page.getByText('已停用', { exact: true })).toBeVisible()
  await page.getByText('参数调用器', { exact: true }).click()
  await page.getByRole('button', { name: '模拟调用' }).click()
  await expect(page.getByText('服务已停用，启用后才能调用。', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('user edits, settings and role matrix persist and drive write access', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/system/settings')
  await page.locator('.main-content .n-select').click()
  await page.locator('.n-base-select-option').getByText('UTC', { exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByText('偏好已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(
    page.locator('.main-content .n-select').getByText('UTC', { exact: true }),
  ).toBeVisible()
  await page.goto('/overview')
  await expect(page.getByRole('row').filter({ hasText: '9001' })).toContainText('10/15 01:00')
  await page.goto('/system/users')
  await page.getByRole('button', { name: '新建演示用户' }).click()
  await page.getByPlaceholder('虚构姓名').fill('验收演示用户')
  await page.getByRole('button', { name: '保存用户' }).click()
  await expect(page.getByRole('row').filter({ hasText: '验收演示用户' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: '验收演示用户' })).toBeVisible()
  await page.goto('/system/roles')
  const developer = page.locator('.n-card').filter({ hasText: '数据开发者' }).last()
  await developer.getByRole('checkbox', { name: '修改资源与运行' }).uncheck()
  await developer.getByRole('button', { name: '保存权限' }).click()
  await expect(page.getByText('权限已保存，切换角色后验证模拟访问结果。')).toBeVisible()
  await page.getByLabel('演示角色').click()
  await page.locator('.n-base-select-option').getByText('数据开发者', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/overview$'))
  await page.getByRole('link', { name: '数据源', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建数据源', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('settings preserve dirty values across refetch and failed saves and guard leaving', async ({
  page,
}) => {
  await page.goto('/system/settings')
  const timezone = page.getByLabel('工作区时区', { exact: true })
  await timezone.click()
  await page.locator('.n-base-select-menu:visible').getByText('UTC', { exact: true }).click()
  await page.getByRole('switch', { name: '演示通知', exact: true }).check()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/system/settings$'))
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/system/settings'),
  )
  await page.evaluate(() =>
    fetch('/api/v1/system/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({ timezone: 'Asia/Shanghai', notifications: false }),
    }),
  )
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await refreshed
  await expect(timezone.getByText('UTC', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '演示通知', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByText('偏好已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(timezone.getByText('UTC', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '演示通知', exact: true })).toBeChecked()
  await page.getByRole('switch', { name: '演示通知', exact: true }).uncheck()
  await page.evaluate(() =>
    fetch('/api/v1/demo/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'system', scenario: 'error' }),
    }),
  )
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByText('保存失败，请重试', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '演示通知', exact: true })).not.toBeChecked()
  await page.evaluate(() =>
    fetch('/api/v1/demo/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'system', scenario: 'normal' }),
    }),
  )
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByText('偏好已保存', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/overview$'))
})
test('quality samples expose actual rates and source history links to runs', async ({ page }) => {
  await page.goto('/governance/quality/5001')
  await page.getByRole('button', { name: 'PASS', exact: true }).click()
  await expect(page.getByText('100.0%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'BLOCK', exact: true }).click()
  await expect(page.getByText('66.7%', { exact: true })).toBeVisible()
  await expect(page.getByText('3 条合成样本，1 条不符合规则')).toBeVisible()
  await page.getByRole('button', { name: '编辑规则', exact: true }).click()
  const drawer = page.locator('.n-drawer')
  await drawer.getByRole('textbox').first().fill('未保存质量规则')
  page.once('dialog', (dialog) => dialog.accept())
  await drawer.locator('.n-base-close').click()
  await expect(page.getByRole('heading', { name: '主键不能为空', exact: true })).toBeVisible()
  await page.goto('/sources/1001?tab=sync')
  await expect(page.getByRole('button', { name: '9001', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '9001', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/runs/9001$'))
})
test('quality parameter edits validate ranges, recover after failure and invalidate stale sample results', async ({
  page,
}) => {
  await page.goto('/governance/quality/5003')
  await page.getByRole('button', { name: 'PASS', exact: true }).click()
  await expect(page.getByText('100.0%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑规则', exact: true }).click()
  const drawer = page.locator('.n-drawer')
  await drawer.getByLabel('参数', { exact: true }).fill('100,0')
  await drawer.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(drawer.getByText('请检查输入内容', { exact: true })).toBeVisible()
  await expect(drawer.getByLabel('参数', { exact: true })).toHaveValue('100,0')
  await drawer.getByLabel('参数', { exact: true }).fill('0,250')
  await drawer.getByLabel('严重级别', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('WARN 警告', { exact: true }).click()
  await drawer.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(drawer).toHaveCount(0)
  await expect(page.getByText('100.0%', { exact: true })).toHaveCount(0)
  await expect(page.getByText('v2', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('0,250', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'WARN', exact: true }).click()
  await expect(page.getByText('66.7%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑规则', exact: true }).click()
  await expect(drawer.getByLabel('参数', { exact: true })).toHaveValue('0,250')
  await expect(drawer.getByText('WARN 警告', { exact: true })).toBeVisible()
})

test('query cancellation remains visible after refresh', async ({ page }) => {
  await page.goto('/warehouse/query?tableId=4001')
  const run = page.getByRole('button', { name: '运行查询', exact: true })
  await expect(run).toBeEnabled()
  await run.click()
  await page.getByRole('button', { name: '取消查询', exact: true }).click()
  await expect(page.getByText('已取消', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('已取消', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 CSV' })).toBeDisabled()
})
test('role editing preserves other dirty cards and guards leaving before saving', async ({
  page,
}) => {
  await page.goto('/system/roles')
  const developer = page
    .locator('.n-card')
    .filter({ has: page.locator('.n-card-header__main').getByText('数据开发者', { exact: true }) })
  const viewer = page
    .locator('.n-card')
    .filter({ has: page.locator('.n-card-header__main').getByText('只读分析师', { exact: true }) })
  await developer
    .getByRole('checkbox', { name: '查看敏感列（仍展示脱敏样本）', exact: true })
    .uncheck()
  await viewer.getByRole('checkbox', { name: '查看敏感列（仍展示脱敏样本）', exact: true }).check()
  await developer.getByRole('button', { name: '保存权限', exact: true }).click()
  await expect(
    page.getByText('权限已保存，切换角色后验证模拟访问结果。', { exact: true }),
  ).toBeVisible()
  await expect(
    viewer.getByRole('checkbox', { name: '查看敏感列（仍展示脱敏样本）', exact: true }),
  ).toBeChecked()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/system/roles$'))
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/overview$'))
  await page.goto('/system/roles')
  await expect(
    developer.getByRole('checkbox', { name: '查看敏感列（仍展示脱敏样本）', exact: true }),
  ).not.toBeChecked()
  await expect(
    viewer.getByRole('checkbox', { name: '查看敏感列（仍展示脱敏样本）', exact: true }),
  ).not.toBeChecked()
})

test('disabled user remains visible but cannot be selected for demo login', async ({ page }) => {
  await page.goto('/system/users')
  await page
    .getByRole('row')
    .filter({ hasText: '演示用户 2' })
    .getByRole('button', { name: '编辑' })
    .click()
  const drawer = page.locator('.n-drawer')
  await drawer.getByRole('switch').uncheck()
  await drawer.getByRole('button', { name: '保存用户' }).click()
  await expect(page.getByRole('row').filter({ hasText: '演示用户 2' })).toContainText('停用')
  await page.goto('/login')
  await page.getByLabel('演示角色', { exact: true }).click()
  await page.locator('.n-base-select-option').getByText('数据开发者', { exact: true }).click()
  await page.getByLabel('演示用户', { exact: true }).click()
  await expect(
    page.locator('.n-base-select-option--disabled').filter({ hasText: '演示用户 2' }),
  ).toBeVisible()
})

test('audit details open with Enter, close with Escape and restore focus to the resource button', async ({
  page,
}) => {
  await page.goto('/system/audit')
  const trigger = page.getByRole('button', { name: /^查看审计记录 .+ 详情$/ }).first()
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('审计详情', { exact: true })).toBeVisible()
  await expect
    .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toBeFocused()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前页', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('jiuzhang-audit.csv')
})

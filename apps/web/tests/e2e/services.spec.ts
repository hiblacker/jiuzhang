import { test, expect, type Page } from '@playwright/test'

async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText(option, { exact: true }).click()
}
async function scenario(page: Page, value: 'normal' | 'error') {
  await page.evaluate(async (scenario) => {
    const response = await fetch('/api/v1/demo/control', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
      body: JSON.stringify({ domain: 'services', scenario }),
    })
    if (!response.ok) throw new Error('Cannot set scenario')
  }, value)
}
test('service creation, validation, failure recovery, caller and cancel preserve the saved contract', async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
  await page.goto('/services/new')
  const save = page.getByRole('button', { name: '保存服务', exact: true })
  await save.click()
  await expect(page.getByText('请填写此项', { exact: true }).first()).toBeVisible()
  await page.getByLabel('服务名称', { exact: true }).fill('城市查询验收')
  await choose(page, '来源仓库表', 'dwd_retail_1')
  await choose(page, '输出字段', 'id')
  await page.locator('.n-base-select-menu:visible').getByText('city', { exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '添加参数', exact: true }).click()
  await page.getByLabel('参数 1 名称', { exact: true }).fill('city')
  await page.getByRole('switch', { name: '参数 1 必填', exact: true }).check()
  await page.getByLabel('每页上限', { exact: true }).fill('2')
  await choose(page, '排序字段', 'id')
  await scenario(page, 'error')
  await save.click()
  await expect(
    page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('服务名称', { exact: true })).toHaveValue('城市查询验收')
  await scenario(page, 'normal')
  await save.click()
  await expect(page.getByRole('heading', { name: '城市查询验收', exact: true })).toBeVisible()
  const detailUrl = page.url()
  await page.getByText('参数调用器', { exact: true }).click()
  const input = page.getByLabel('调用参数 JSON', { exact: true })
  const call = page.getByRole('button', { name: '模拟调用', exact: true })
  await input.fill('{')
  await call.click()
  await expect(
    page.getByText('请输入 JSON 对象，参数值使用字符串。', { exact: true }),
  ).toBeVisible()
  await input.fill('{}')
  await call.click()
  await expect(
    page.getByText('参数未定义、缺少必填值或数值格式不正确，请对照契约检查。', { exact: true }),
  ).toBeVisible()
  await input.fill(JSON.stringify({ city: '杭州' }))
  await call.click()
  await expect(page.getByRole('cell', { name: '杭州', exact: true })).toHaveCount(2)
  await page.reload()
  await expect(input).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(detailUrl)
  await page.getByRole('button', { name: '编辑服务', exact: true }).click()
  await expect(page.getByLabel('参数 1 名称', { exact: true })).toHaveValue('city')
  await expect(page.getByRole('switch', { name: '参数 1 必填', exact: true })).toBeChecked()
  await page.setViewportSize({ width: 768, height: 1024 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/service-editor-narrow.png', fullPage: true })
  await page.getByLabel('服务名称', { exact: true }).fill('取消的改名')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('heading', { name: '城市查询验收', exact: true })).toBeVisible()
})

test('restricted editors can update metadata without removing hidden fields', async ({ page }) => {
  test.setTimeout(60000)
  await page.addInitScript(() => {
    if (!localStorage.getItem('jiuzhang.preference.session')) {
      localStorage.setItem('jiuzhang.preference.session', 'demo')
      localStorage.setItem('jiuzhang.preference.role', 'admin')
    }
  })
  await page.goto('/services/7001/edit')
  await expect(page.getByLabel('服务名称', { exact: true })).toHaveValue('订单明细宽表查询服务')
  await choose(page, '输出字段', 'phone')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '保存服务', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:5174/services/7001')
  await page.goto('/system/roles')
  const developer = page
    .locator('.n-card')
    .filter({ has: page.locator('.n-card-header__main').getByText('数据开发者', { exact: true }) })
  await developer
    .getByRole('checkbox', { name: '查看敏感列（仍展示脱敏样本）', exact: true })
    .uncheck()
  await developer.getByRole('button', { name: '保存权限', exact: true }).click()
  await expect(page.getByText('权限已保存，切换角色后验证模拟访问结果。')).toBeVisible()
  await choose(page, '演示角色', '数据开发者')
  await expect(page).toHaveURL('http://localhost:5174/overview')
  await page.goto('/services/7001/edit')
  await expect(page.getByText('当前角色只能查看部分字段。', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加参数', exact: true })).toBeDisabled()
  await page.getByLabel('服务名称', { exact: true }).fill('保持完整字段的服务')
  await page.getByRole('button', { name: '保存服务', exact: true }).click()
  await expect(page.getByRole('heading', { name: '保持完整字段的服务', exact: true })).toBeVisible()
  await choose(page, '演示角色', '平台管理员')
  await expect(page).toHaveURL('http://localhost:5174/overview')
  await page.goto('/services/7001')
  await page.getByText('参数调用器', { exact: true }).click()
  await page.getByRole('button', { name: '模拟调用', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: 'phone', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '138****0000', exact: true })).toBeVisible()
})

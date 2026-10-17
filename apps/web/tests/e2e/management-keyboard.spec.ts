import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

async function selectOption(page: Page, name: string) {
  const menu = page.locator('.n-base-select-menu:visible')
  const options = menu.locator('.n-base-select-option')
  const target = options.filter({ has: page.getByText(name, { exact: true }) })
  await expect(target).toBeVisible()
  const count = await options.count()
  for (let step = 0; step < count; step++) {
    if ((await target.getAttribute('class'))?.includes('n-base-select-option--pending')) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(target).toHaveClass(/n-base-select-option--pending/)
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
}

test('quality selectors support keyboard edits without changing published rule snapshots', async ({
  page,
}) => {
  await page.goto('/governance/quality/5001')
  const edit = page.getByRole('button', { name: '编辑规则', exact: true })
  await expect(edit).toBeEnabled()
  await edit.press('Enter')
  const drawer = page.getByRole('dialog', { name: '质量规则', exact: true })
  const kind = drawer.getByRole('button', { name: '类型', exact: true })
  await kind.press('Enter')
  await expect(kind).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(kind).toHaveAttribute('aria-expanded', 'false')
  await expect(kind).toBeFocused()
  await kind.press('Enter')
  await selectOption(page, '唯一')
  const severity = drawer.getByRole('button', { name: '严重级别', exact: true })
  await severity.press('Enter')
  await selectOption(page, 'WARN 警告')
  await drawer.getByRole('switch', { name: '启用', exact: true }).press('Space')
  await drawer.getByRole('button', { name: '保存规则', exact: true }).press('Enter')
  await expect(drawer).not.toBeVisible()
  await page.reload()
  await expect(page.getByText('v2', { exact: true })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const read = async (path: string) => {
      const response = await fetch('/api/v1' + path)
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    }
    const [rule, version] = await Promise.all([
      read('/governance/quality/5001'),
      read('/datasets/2001/versions/1'),
    ])
    return {
      rule,
      history: version.qualitySnapshot.find((item: { id: string }) => item.id === '5001'),
    }
  })
  expect(saved.rule).toMatchObject({ kind: 'unique', severity: 'WARN', enabled: false, version: 2 })
  expect(saved.history).toMatchObject({
    kind: 'required',
    severity: 'BLOCK',
    enabled: true,
    version: 1,
  })
  await edit.press('Enter')
  await expect(kind).toContainText('唯一')
  await expect(severity).toContainText('WARN 警告')
  await expect(drawer.getByRole('switch', { name: '启用', exact: true })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(edit).toBeFocused()
})

test('masking keyboard controls change the saved policy and synthetic samples while keeping history immutable', async ({
  page,
}) => {
  await page.goto('/governance/masking/6001')
  const sample = page.getByRole('button', { name: '合成样本类型', exact: true })
  await sample.press('Enter')
  await selectOption(page, '邮箱样本')
  await expect(page.getByRole('cell', { name: 'demo@example.invalid', exact: true })).toBeVisible()
  const edit = page.getByRole('button', { name: '编辑策略', exact: true })
  await edit.press('Enter')
  const drawer = page.getByRole('dialog', { name: '脱敏策略', exact: true })
  const kind = drawer.getByRole('button', { name: '方式', exact: true })
  await kind.press('Enter')
  await page.keyboard.press('Escape')
  await expect(kind).toHaveAttribute('aria-expanded', 'false')
  await expect(kind).toBeFocused()
  await kind.press('Enter')
  await selectOption(page, '移除字段')
  await expect(drawer.getByRole('textbox', { name: '参数', exact: true })).toBeDisabled()
  await kind.press('Enter')
  await selectOption(page, '泛化')
  await drawer.getByRole('textbox', { name: '参数', exact: true }).fill('虚构区域')
  await drawer.getByRole('button', { name: '保存策略', exact: true }).press('Enter')
  await expect(drawer).not.toBeVisible()
  await expect(page.getByRole('cell', { name: '虚构区域', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('cell', { name: '虚构区域', exact: true })).toBeVisible()
  await expect(sample).toContainText('手机号样本')
  const saved = await page.evaluate(async () => {
    const read = async (path: string) => {
      const response = await fetch('/api/v1' + path)
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).data
    }
    const [policy, version] = await Promise.all([
      read('/governance/masking/6001'),
      read('/datasets/2001/versions/1'),
    ])
    return {
      policy,
      history: version.maskingSnapshot.find((item: { id: string }) => item.id === '6001'),
    }
  })
  expect(saved.policy).toMatchObject({ kind: 'generalize', parameter: '虚构区域', version: 2 })
  expect(saved.history).toMatchObject({ kind: 'mask', parameter: '3,4', version: 1 })
  await edit.press('Enter')
  await expect(kind).toContainText('泛化')
  await kind.press('Enter')
  await selectOption(page, '移除字段')
  page.once('dialog', (dialog) => dialog.dismiss())
  await drawer.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(kind).toContainText('移除字段')
  page.once('dialog', (dialog) => dialog.accept())
  await drawer.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(edit).toBeFocused()
  await edit.press('Enter')
  await expect(kind).toContainText('泛化')
})

test('user role keyboard editing persists false and cancel retains the saved identity', async ({
  page,
}) => {
  await page.goto('/system/users')
  const row = page.getByRole('row').filter({ hasText: '演示用户 2' })
  const edit = row.getByRole('button', { name: '编辑', exact: true })
  await edit.press('Enter')
  const drawer = page.getByRole('dialog', { name: '演示用户', exact: true })
  const role = drawer.getByRole('button', { name: '角色', exact: true })
  await role.press('Enter')
  await page.keyboard.press('Escape')
  await expect(role).toHaveAttribute('aria-expanded', 'false')
  await expect(role).toBeFocused()
  await role.press('Enter')
  await selectOption(page, '只读分析师')
  await drawer.getByRole('switch', { name: '启用', exact: true }).press('Space')
  await drawer.getByRole('button', { name: '保存用户', exact: true }).press('Enter')
  await expect(drawer).not.toBeVisible()
  await expect(row).toContainText('只读分析师')
  await expect(row).toContainText('停用')
  await page.reload()
  await edit.press('Enter')
  await expect(role).toContainText('只读分析师')
  await expect(drawer.getByRole('switch', { name: '启用', exact: true })).not.toBeChecked()
  await role.press('Enter')
  await selectOption(page, '平台管理员')
  page.once('dialog', (dialog) => dialog.accept())
  await drawer.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(edit).toBeFocused()
  await edit.press('Enter')
  await expect(role).toContainText('只读分析师')
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/system/users?pageSize=100', {
      headers: { 'x-demo-role': 'admin' },
    })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data.find((item: { id: string }) => item.id === '8002')
  })
  expect(saved).toMatchObject({ role: 'viewer', enabled: false })
})

test('settings timezone keyboard changes keep dirty values on canceled navigation and persist notification false', async ({
  page,
}) => {
  await page.goto('/system/settings')
  const timezone = page.getByRole('button', { name: '工作区时区', exact: true })
  await timezone.press('Enter')
  await page.keyboard.press('Escape')
  await expect(timezone).toHaveAttribute('aria-expanded', 'false')
  await expect(timezone).toBeFocused()
  await timezone.press('Enter')
  await selectOption(page, 'UTC')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('link', { name: '工作台', exact: true }).press('Enter')
  await expect(page).toHaveURL('/system/settings')
  await expect(timezone).toContainText('UTC')
  await page.getByRole('switch', { name: '演示通知', exact: true }).uncheck()
  await page.getByRole('button', { name: '保存设置', exact: true }).press('Enter')
  await expect(page.getByText('偏好已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(timezone).toContainText('UTC')
  await expect(page.getByRole('switch', { name: '演示通知', exact: true })).not.toBeChecked()
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/system/settings')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data
  })
  expect(saved).toEqual({ timezone: 'UTC', notifications: false })
})

import { expect, test } from '@playwright/test'

test('keyboard demo login selects a user, preserves the original destination and restores identity after reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  const destination = '/sources/1001?tab=preview&objectId=11001'
  await page.goto(destination)
  await expect(page).toHaveURL(/\/login\?redirect=/)
  const login = page.getByRole('button', { name: '进入演示工作区', exact: true })
  await expect(login).toBeEnabled()
  const role = page.getByRole('button', { name: '演示角色', exact: true })
  await role.press('Enter')
  await expect(role).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(role).toHaveAttribute('aria-expanded', 'false')
  await expect(role).toBeFocused()
  await role.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(role).toContainText('只读分析师')
  const user = page.getByRole('button', { name: '演示用户', exact: true })
  await expect(user).toContainText('演示用户 3')
  await user.press('Enter')
  await page.keyboard.press('Escape')
  await expect(user).toHaveAttribute('aria-expanded', 'false')
  await expect(user).toBeFocused()
  await user.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(user).toContainText('演示用户 6')
  const session = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/v1/session',
  )
  await login.press('Enter')
  expect((await session).headers()).toMatchObject({
    'x-demo-role': 'viewer',
    'x-demo-user': '8006',
  })
  await expect(page).toHaveURL(destination)
  await expect(page.getByRole('columnheader', { name: 'id', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'phone', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(destination)
  await expect(page.getByRole('columnheader', { name: 'id', exact: true })).toBeVisible()
  const preferences = await page.evaluate(() => ({
    role: localStorage.getItem('jiuzhang.preference.role'),
    user: localStorage.getItem('jiuzhang.preference.user'),
    session: localStorage.getItem('jiuzhang.preference.session'),
  }))
  expect(preferences).toEqual({ role: 'viewer', user: '8006', session: 'demo' })
  expect(errors).toEqual([])
})

test('keyboard role switching clears the selected user and refreshes column permissions and write access', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('jiuzhang.preference.session')) {
      localStorage.setItem('jiuzhang.preference.session', 'demo')
      localStorage.setItem('jiuzhang.preference.role', 'viewer')
      localStorage.setItem('jiuzhang.preference.user', '8006')
    }
  })
  await page.goto('/sources/1001?tab=preview&objectId=11001')
  await expect(page.getByRole('columnheader', { name: 'id', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'phone', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeDisabled()
  const role = page.getByRole('button', { name: '演示角色', exact: true })
  await role.press('Enter')
  await page.keyboard.press('Escape')
  await expect(role).toHaveAttribute('aria-expanded', 'false')
  await expect(role).toBeFocused()
  await role.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/overview')
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
  await expect(role).toContainText('数据开发者')
  const preferences = await page.evaluate(() => ({
    role: localStorage.getItem('jiuzhang.preference.role'),
    user: localStorage.getItem('jiuzhang.preference.user'),
  }))
  expect(preferences).toEqual({ role: 'developer', user: '' })
  await page.goto('/sources/1001?tab=preview&objectId=11001')
  await expect(page.getByRole('columnheader', { name: 'phone', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeEnabled()
  await page.reload()
  await expect(role).toContainText('数据开发者')
  await expect(page.getByRole('columnheader', { name: 'phone', exact: true })).toBeVisible()
  await role.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/overview')
  await expect(role).toContainText('只读分析师')
  await page.goto('/sources/1001?tab=preview&objectId=11001')
  await expect(page.getByRole('columnheader', { name: 'id', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'phone', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeDisabled()
})

test('login keeps disabled demo users visible and cannot enter a role without an enabled user', async ({
  page,
}) => {
  await page.goto('/login')
  const login = page.getByRole('button', { name: '进入演示工作区', exact: true })
  await expect(login).toBeEnabled()
  const changed = await page.evaluate(async () => {
    const response = await fetch('/api/v1/system/users?role=developer&pageSize=100', {
      headers: { 'x-demo-role': 'admin' },
    })
    if (!response.ok) throw new Error('Unable to read demo developers')
    const result = await response.json()
    const developers = result.data.filter((user: { role: string }) => user.role === 'developer')
    for (const user of developers) {
      const saved = await fetch('/api/v1/system/users/' + user.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ enabled: false }),
      })
      if (!saved.ok) throw new Error('Unable to disable demo developer')
    }
    return developers.length
  })
  expect(changed).toBeGreaterThan(1)
  await page.reload()
  const user = page.getByRole('button', { name: '演示用户', exact: true })
  await expect(login).toBeDisabled()
  await expect(
    page.getByText('当前角色没有可用演示用户，请选择其他角色', { exact: true }),
  ).toBeVisible()
  await user.press('Enter')
  await expect(page.locator('.n-base-select-option--disabled')).toHaveCount(changed)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(login).toBeDisabled()
  await expect(page).toHaveURL('/login')
  const role = page.getByRole('button', { name: '演示角色', exact: true })
  await role.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(role).toContainText('只读分析师')
  await expect(user).toContainText('演示用户 3')
  await expect(login).toBeEnabled()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('jiuzhang.preference.theme', value), theme)
    await page.reload()
    await expect(login).toBeDisabled()
    await expect(
      page.getByText('当前角色没有可用演示用户，请选择其他角色', { exact: true }),
    ).toBeVisible()
    await expect(user).not.toHaveAttribute('aria-disabled', 'true')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-login-' + theme + '-20261017.png',
      animations: 'disabled',
    })
  }
})

test('a failed demo user request keeps login disabled and retries without losing the destination', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch
    const state = window as Window & { failDemoUsers?: boolean }
    state.failDemoUsers = true
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      if (state.failDemoUsers && url.pathname === '/api/v1/session/users')
        return new Response(
          JSON.stringify({
            error: { code: 'DEMO_ERROR', requestId: 'demo-users-failure', details: [] },
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        )
      return original(input, init)
    }
  })
  await page.goto('/warehouse/tables/4001?tab=sample')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  const login = page.getByRole('button', { name: '进入演示工作区', exact: true })
  await expect(login).toBeDisabled()
  await expect(
    page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '演示用户', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    ;(window as Window & { failDemoUsers?: boolean }).failDemoUsers = false
  })
  await page.getByRole('button', { name: '重试', exact: true }).press('Enter')
  await expect(login).toBeEnabled()
  await expect(page.getByRole('button', { name: '演示用户', exact: true })).toContainText(
    '演示用户 2',
  )
  await expect(page.getByRole('button', { name: '重试', exact: true })).toHaveCount(0)
  await login.press('Enter')
  await expect(page).toHaveURL('/warehouse/tables/4001?tab=sample')
  await expect(page.getByRole('columnheader', { name: 'id', exact: true })).toBeVisible()
})

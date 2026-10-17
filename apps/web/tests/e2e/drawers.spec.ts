import { test, expect } from '@playwright/test'

const entries = [
  {
    name: 'quality',
    path: '/governance/quality',
    trigger: '新建规则',
    title: '质量规则',
    field: '规则名称',
    save: '保存规则',
    domain: 'governance',
    api: '/governance/quality',
  },
  {
    name: 'masking',
    path: '/governance/masking',
    trigger: '新建策略',
    title: '脱敏策略',
    field: '策略名称',
    save: '保存策略',
    domain: 'governance',
    api: '/governance/masking',
  },
  {
    name: 'users',
    path: '/system/users',
    trigger: '新建演示用户',
    title: '演示用户',
    field: '用户名称',
    save: '保存用户',
    domain: 'system',
    api: '/system/users',
  },
]

for (const entry of entries) {
  test(
    entry.name +
      ' drawer preserves canceled and failed drafts, traps focus and blocks pending duplicates',
    async ({ page }) => {
      test.setTimeout(90000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.text().includes('[intlify]')) errors.push(message.text())
      })
      await page.goto(entry.path)
      const trigger = page.getByRole('button', { name: entry.trigger, exact: true })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const drawer = page.getByRole('dialog', { name: entry.title, exact: true })
      await expect(drawer).toBeVisible()
      const field = drawer.getByRole('textbox', { name: entry.field, exact: true })
      const cancel = drawer.getByRole('button', { name: '取消', exact: true })
      const save = drawer.getByRole('button', { name: entry.save, exact: true })
      await save.focus()
      await page.keyboard.press('Tab')
      await expect
        .poll(() => drawer.evaluate((root) => root.contains(document.activeElement)))
        .toBe(true)
      await page.keyboard.press('Escape')
      await expect(drawer).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await page.keyboard.press('Enter')
      await save.click()
      await expect(drawer.getByText('请填写此项', { exact: true })).toBeVisible()
      const name = '抽屉验收 ' + entry.name
      await field.fill(name)
      for (const action of ['escape', 'cancel', 'mask'] as const) {
        page.once('dialog', (dialog) => dialog.dismiss())
        if (action === 'escape') await page.keyboard.press('Escape')
        else if (action === 'cancel') await cancel.click()
        else await page.locator('.n-drawer-mask').click({ position: { x: 8, y: 300 } })
        await expect(drawer).toBeVisible()
        await expect(field).toHaveValue(name)
      }
      const control = (scenario: string) =>
        page.evaluate(
          async ({ domain, scenario }) => {
            const response = await fetch('/api/v1/demo/control', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain, scenario }),
            })
            if (!response.ok) throw new Error(await response.text())
          },
          { domain: entry.domain, scenario },
        )
      await control('error')
      await save.click()
      await expect(
        drawer.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
      ).toHaveCount(1)
      await expect(field).toHaveValue(name)
      page.once('dialog', (dialog) => dialog.accept())
      await cancel.click()
      await expect(drawer).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await control('normal')
      await trigger.click()
      await expect(field).toHaveValue('')
      await expect(
        drawer.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
      ).toHaveCount(0)
      await field.fill(name)
      for (const theme of ['light', 'dark']) {
        if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme) {
          // The modal owns focus while open; switch through the persisted preference after closing.
          page.once('dialog', (dialog) => dialog.accept())
          await cancel.click()
          await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
          await trigger.click()
          await field.fill(name)
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
          .toBe(theme)
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(page.viewportSize()?.width)
        await page.screenshot({
          path:
            '/tmp/jiuzhang-drawer-' +
            entry.name +
            '-' +
            page.viewportSize()?.width +
            '-' +
            theme +
            '.png',
          fullPage: true,
          animations: 'disabled',
        })
      }
      await control('slow')
      let writes = 0
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/v1' + entry.api
        )
          writes++
      })
      await save.click()
      await expect(field).toBeDisabled()
      await expect(cancel).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(drawer).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(drawer).not.toBeVisible()
      expect(writes).toBe(1)
      await control('normal')
      const found = await page.evaluate(
        async ({ api, name }) => {
          const response = await fetch('/api/v1' + api + '?q=' + encodeURIComponent(name), {
            headers: { 'x-demo-role': 'admin' },
          })
          if (!response.ok) throw new Error(await response.text())
          return (await response.json()).data as { name: string }[]
        },
        { api: entry.api, name },
      )
      expect(found.filter((record) => record.name === name)).toHaveLength(1)
      await page.reload()
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible()
      expect(errors).toEqual([])
    },
  )
}

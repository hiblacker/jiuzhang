import { test, expect } from '@playwright/test'

const cases = [
  {
    name: 'source',
    path: '/sources/1001?objectId=11001&field=id',
    defaultTab: 'catalog',
    preserved: ['objectId', 'field'],
  },
  {
    name: 'dataset',
    path: '/datasets/2001?trace=keep',
    defaultTab: 'overview',
    preserved: ['trace'],
  },
  {
    name: 'dataset editor',
    path: '/datasets/2001/edit?trace=keep',
    defaultTab: 'input',
    preserved: ['trace'],
  },
  {
    name: 'warehouse table',
    path: '/warehouse/tables/4001?trace=keep',
    defaultTab: 'schema',
    preserved: ['trace'],
  },
  {
    name: 'query',
    path: '/warehouse/query?tableId=4001',
    defaultTab: 'result',
    preserved: ['tableId'],
  },
  {
    name: 'service',
    path: '/services/7001?trace=keep',
    defaultTab: 'contract',
    preserved: ['trace'],
  },
]

for (const entry of cases) {
  test(
    entry.name + ' tabs support keyboard, URL history, invalid links and both desktop themes',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
        if (!localStorage.getItem('jiuzhang.preference.theme'))
          localStorage.setItem('jiuzhang.preference.theme', 'dark')
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.text().includes('[intlify]')) errors.push(message.text())
      })
      await page.goto(entry.path + '&tab=unknown')
      const list = page.getByRole('tablist')
      await expect(list).toHaveCount(1)
      const tabs = list.getByRole('tab')
      const names = await tabs.evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-name')!),
      )
      expect(names[0]).toBe(entry.defaultTab)
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
      for (const theme of ['dark', 'light']) {
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
          .toBe(theme)
        for (let index = 0; index < names.length; index++) {
          const tab = tabs.nth(index)
          await tab.focus()
          await page.keyboard.press(index % 2 ? ' ' : 'Enter')
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          await expect(tab).toBeFocused()
          const params = new URL(page.url()).searchParams
          if (index) expect(params.get('tab')).toBe(names[index])
          for (const key of entry.preserved)
            expect(params.get(key)).toBe(
              new URL('http://localhost' + entry.path).searchParams.get(key),
            )
          const panel = page.getByRole('tabpanel')
          await expect(panel).toHaveCount(1)
          await expect(panel).toHaveAttribute(
            'aria-labelledby',
            (await tab.getAttribute('id')) ?? '',
          )
          await expect(panel).toHaveAttribute('id', (await tab.getAttribute('aria-controls')) ?? '')
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBe(page.viewportSize()?.width)
        }
        await tabs.last().focus()
        await page.keyboard.press('Home')
        await expect(tabs.first()).toBeFocused()
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('Enter')
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
        expect(new URL(page.url()).searchParams.has('tab')).toBe(false)
        await page.keyboard.press('ArrowLeft')
        await expect(tabs.last()).toBeFocused()
        await page.keyboard.press('ArrowRight')
        await expect(tabs.first()).toBeFocused()
        await page.keyboard.press('End')
        await expect(tabs.last()).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
        await page.goBack()
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
        await page.goForward()
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
        await page.reload()
        await expect(page.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
        await expect
          .poll(() =>
            page
              .getByRole('tab')
              .last()
              .evaluate((tab) => {
                const bounds = tab.closest('.v-x-scroll')!.getBoundingClientRect()
                const rect = tab.getBoundingClientRect()
                return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
              }),
          )
          .toBe(true)
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
          .toBe(theme)
        await page.screenshot({
          path:
            '/tmp/jiuzhang-tabs-' +
            entry.name.replaceAll(' ', '-') +
            '-' +
            page.viewportSize()?.width +
            '-' +
            theme +
            '.png',
          fullPage: true,
          animations: 'disabled',
        })
        if (theme === 'dark')
          await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      }
      expect(errors).toEqual([])
    },
  )
}

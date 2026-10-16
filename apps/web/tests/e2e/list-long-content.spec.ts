import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    if (!localStorage.getItem('jiuzhang.preference.theme'))
      localStorage.setItem('jiuzhang.preference.theme', 'dark')
  })
})

for (const kind of ['source', 'dataset', 'catalog'] as const) {
  test(
    kind + ' long names remain bounded and keyboard navigation preserves list filters',
    async ({ page }) => {
      test.setTimeout(60000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/sources')
      await expect(page.getByRole('heading', { name: '数据源', exact: true })).toBeVisible()
      const name = 'LongResource_' + 'x'.repeat(180)
      const id = await page.evaluate(
        async ({ kind, name }) => {
          const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
          if (kind === 'dataset') {
            const response = await fetch('/api/v1/datasets/2001', {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ name }),
            })
            if (!response.ok) throw new Error(await response.text())
            return (await response.json()).data.id as string
          }
          const {
            id: _id,
            status: _status,
            updatedAt: _updatedAt,
            objectCount: _count,
            ...input
          } = (await (await fetch('/api/v1/sources/1001')).json()).data
          const response = await fetch('/api/v1/sources', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...input, name }),
          })
          if (!response.ok) throw new Error(await response.text())
          return (await response.json()).data.id as string
        },
        { kind, name },
      )
      const path = {
        source: '/sources',
        dataset: '/datasets',
        catalog: '/governance/catalog',
      }[kind]
      const filters = {
        source: '?q=LongResource&type=MySQL&status=connected&sort=name&pageSize=50',
        dataset: '?q=LongResource&status=published&sort=name&folderId=12001',
        catalog: '?q=LongResource&kind=source&owner=数据平台组&sort=name',
      }[kind]
      await page.goto(path + filters)
      const button = page.getByRole('button', { name, exact: true })
      for (const theme of ['dark', 'light']) {
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
          .toBe(theme)
        await expect(page.locator('.n-card').first()).toHaveCSS(
          'background-color',
          theme === 'dark' ? 'rgb(24, 37, 56)' : 'rgb(255, 255, 255)',
        )
        await expect(button).toBeVisible()
        const bounds = await button.evaluate((element) => ({
          button: element.getBoundingClientRect().width,
          cell: element.closest('td')!.getBoundingClientRect().width,
          text: element.textContent,
        }))
        expect(bounds.cell).toBeGreaterThanOrEqual(220)
        expect(bounds.cell).toBeLessThanOrEqual(400)
        expect(bounds.button).toBeLessThan(bounds.cell)
        expect(bounds.text).toBe(name)
        await expect(button).toHaveAttribute('title', name)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
        await page.screenshot({
          path: 'test-results/long-list-' + kind + '-' + theme + '.png',
          animations: 'disabled',
        })
        const listUrl = page.url()
        await button.focus()
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(
          new RegExp('/' + (kind === 'dataset' ? 'datasets' : 'sources') + '/' + id + '$'),
        )
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
        await page.goBack()
        await expect(page).toHaveURL(listUrl)
        await expect(button).toBeVisible()
        await page.reload()
        await expect(button).toBeVisible()
        await expect(page).toHaveURL(listUrl)
        if (theme === 'dark') {
          await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
          await page.reload()
        }
      }
      expect(errors).toEqual([])
    },
  )
}

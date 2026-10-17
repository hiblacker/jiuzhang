import { expect, test } from '@playwright/test'

const forms = [
  { id: 'dataset', path: '/datasets/2001/edit', label: '数据集名称', original: '订单明细宽表' },
  { id: 'database', path: '/sources/1001/edit', label: '名称', original: '零售订单库' },
  { id: 'api', path: '/sources/1007/edit', label: '名称', original: '营销开放接口' },
]

for (const form of forms) {
  test(
    form.id + ' form keeps readable desktop fields and preserves the editable draft',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
        localStorage.setItem('jiuzhang.preference.theme', 'light')
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.text().includes('[intlify]')) errors.push(message.text())
      })
      await page.goto(form.path)
      const name = page.getByRole('textbox', { name: form.label, exact: true })
      await expect(name).toHaveValue(form.original)
      await name.fill(form.original + '响应布局')
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(page.viewportSize()?.width)
      await expect
        .poll(() =>
          page
            .locator('.n-form-item')
            .evaluateAll((items) =>
              Math.min(
                ...items
                  .map((item) => item.getBoundingClientRect().width)
                  .filter((value) => value > 0),
              ),
            ),
        )
        .toBeGreaterThanOrEqual(280)
      await expect(name).toHaveValue(form.original + '响应布局')
      for (const theme of ['light', 'dark']) {
        if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
          await page.getByRole('button', { name: '切换明暗主题', exact: true }).press('Enter')
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
          .toBe(theme)
        await name.scrollIntoViewIfNeeded()
        await page.screenshot({
          path:
            '/tmp/jiuzhang-form-' +
            form.id +
            '-' +
            page.viewportSize()?.width +
            '-' +
            theme +
            '.png',
          fullPage: true,
          animations: 'disabled',
        })
      }
      await page
        .getByRole('button', { name: form.id === 'dataset' ? '保存草稿' : '保存', exact: true })
        .press('Enter')
      const detail = form.path.replace('/edit', '')
      await expect(page).toHaveURL(detail)
      await expect(
        page.getByRole('heading', { name: form.original + '响应布局', exact: true }),
      ).toBeVisible()
      await page.goto(form.path)
      await expect(name).toHaveValue(form.original + '响应布局')
      await page.reload()
      await expect(name).toHaveValue(form.original + '响应布局')
      expect(errors).toEqual([])
    },
  )
}

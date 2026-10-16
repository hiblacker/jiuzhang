import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
})

async function inspectTheme(page: Page, theme: 'light' | 'dark', consumer: string) {
  if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
    await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe(theme)
  const colors = await page.locator('.cm-editor').evaluate((editor) => {
    function rgb(value: string) {
      return (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    }
    function luminance(channels: number[]) {
      const values = channels.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return values.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
    }
    const background = getComputedStyle(editor).backgroundColor
    const backgroundLuminance = luminance(rgb(background))
    const spans = [...editor.querySelectorAll('.cm-content .cm-line span')]
    const tokens = spans.map((span) => {
      const color = getComputedStyle(span).color
      const foreground = luminance(rgb(color))
      return {
        text: span.textContent,
        contrast:
          (Math.max(foreground, backgroundLuminance) + 0.05) /
          (Math.min(foreground, backgroundLuminance) + 0.05),
      }
    })
    const gutters = editor.querySelector('.cm-gutters')!
    return {
      background,
      expectedBackground: getComputedStyle(document.documentElement)
        .getPropertyValue('--surfaceRaised')
        .trim(),
      expectedGutter: getComputedStyle(document.documentElement)
        .getPropertyValue('--surface')
        .trim(),
      gutterBackground: getComputedStyle(gutters).backgroundColor,
      tokens,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }
  })
  const asRgb = (hex: string) =>
    'rgb(' +
    hex
      .slice(1)
      .match(/.{2}/g)!
      .map((part) => parseInt(part, 16))
      .join(', ') +
    ')'
  expect(colors.background).toBe(asRgb(colors.expectedBackground))
  expect(colors.gutterBackground).toBe(asRgb(colors.expectedGutter))
  expect(colors.tokens.some((token) => token.text === 'SELECT')).toBe(true)
  expect(colors.tokens.some((token) => token.text === "'杭州'")).toBe(true)
  expect(colors.tokens.some((token) => token.text === '42')).toBe(true)
  expect(colors.tokens.some((token) => token.text?.includes('订单备注'))).toBe(true)
  for (const token of colors.tokens)
    expect(token.contrast, `${theme} ${token.text}`).toBeGreaterThanOrEqual(4.5)
  expect(colors.scrollWidth).toBeLessThanOrEqual(colors.viewport)
  await page.locator('h1').click()
  await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.scrollLeft = 0
  })
  await page.screenshot({
    path: `test-results/sql-editor-${consumer}-${theme}.png`,
    fullPage: true,
    animations: 'disabled',
  })
}

test('SQL workbench and dataset editor preserve editing while switching accessible syntax themes', async ({
  page,
}) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/warehouse/query?tableId=4001')
  const editor = page.locator('.cm-content')
  await expect(editor).toHaveText('SELECT * FROM dwd_retail_1 LIMIT 100')
  const sql = "SELECT '杭州', 42, TRUE, NULL FROM dwd_retail_1 LIMIT 12 -- 订单备注"
  await editor.fill(sql)
  for (const theme of ['dark', 'light', 'dark'] as const) {
    await inspectTheme(page, theme, 'query')
    await expect(editor).toHaveText(sql)
  }
  await editor.press('End')
  await editor.press('Space')
  await expect(editor).toHaveText(sql + ' ')
  await editor.press('Control+z')
  await expect(editor).toHaveText(sql)
  await editor.fill('SELECT * FROM dwd_retail_1 LIMIT 100')
  await page.getByRole('button', { name: '运行查询', exact: true }).click()
  await expect(page.getByRole('cell', { name: '杭州', exact: true }).first()).toBeVisible()
  await page.goto('/datasets/2001/edit?tab=input')
  await page.getByLabel('建模模式', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('SQL 示例', { exact: true }).click()
  await expect(editor).toBeVisible()
  const datasetSql = "SELECT '杭州', 42, TRUE, NULL FROM orders LIMIT 12 -- 订单备注"
  await editor.fill(datasetSql)
  for (const theme of ['light', 'dark'] as const) {
    await inspectTheme(page, theme, 'dataset')
    await expect(editor).toHaveText(datasetSql)
  }
  const savedSql = 'SELECT * FROM orders LIMIT 12'
  await editor.fill(savedSql)
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  await page.goto('/datasets/2001/edit?tab=input')
  await expect(editor).toHaveText(savedSql)
  await page.reload()
  await expect(editor).toHaveText(savedSql)
  await editor.fill(datasetSql)
  await inspectTheme(page, 'dark', 'dataset-reload')
  expect(errors).toEqual([])
})

import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('database differences clear when restored and cancel does not write a changed draft', async ({
  page,
}) => {
  await page.goto('/sources/1001/edit')
  const name = page.getByRole('textbox', { name: '名称', exact: true })
  await expect(name).not.toHaveValue('')
  const original = await name.inputValue()
  const diff = page.getByRole('region', { name: '配置差异', exact: true })
  await expect(diff.getByText('配置未变更', { exact: true })).toBeVisible()
  await name.fill('应被取消的虚构名称')
  const tls = page.getByRole('switch', { name: '启用 TLS', exact: true })
  await expect(tls).toBeChecked()
  await tls.press('Space')
  await expect(diff.getByRole('row').filter({ hasText: '名称' })).toContainText(
    JSON.stringify(original),
  )
  const tlsChange = diff.getByRole('row').filter({ hasText: '启用 TLS' })
  await expect(tlsChange.getByRole('cell')).toHaveText(['启用 TLS', 'true', 'false'])
  await name.fill(original)
  await tls.press('Space')
  await expect(diff.getByText('配置未变更', { exact: true })).toBeVisible()
  await name.fill('应被取消的虚构名称')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(diff.getByRole('cell', { name: '"应被取消的虚构名称"', exact: true })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/sources/1001')
  await expect(page.getByRole('heading', { name: original, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(diff.getByText('配置未变更', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '类型', exact: true }).press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(diff.getByRole('row').filter({ hasText: '类型' })).toContainText('PostgreSQL')
  await expect(diff.getByRole('row').filter({ hasText: '端口' }).getByRole('cell')).toHaveText([
    '端口',
    '3306',
    '5432',
  ])
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL('/sources/1001')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '类型', exact: true })).toContainText('PostgreSQL')
  await expect(diff.getByText('配置未变更', { exact: true })).toBeVisible()
})

test('API differences retain JSON zero, false and empty strings after failure and reset after save', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/sources/1007/edit')
  await expect(page.getByRole('textbox', { name: '名称', exact: true })).not.toHaveValue('')
  const diff = page.getByRole('region', { name: '配置差异', exact: true })
  await expect(diff.getByText('配置未变更', { exact: true })).toBeVisible()
  const queryInput = page.getByRole('textbox', { name: 'Query JSON', exact: true })
  const before = await queryInput.inputValue()
  const query = JSON.stringify({ page: 0, enabled: false })
  await queryInput.fill(query)
  await page.getByRole('textbox', { name: '请求路径', exact: true }).fill('')
  const queryRow = diff.getByRole('row').filter({ hasText: 'Query JSON' })
  await expect(queryRow.getByRole('cell')).toHaveText([
    'Query JSON',
    JSON.stringify(before),
    JSON.stringify(query),
  ])
  await expect(
    diff.getByRole('row').filter({ hasText: '请求路径' }).getByRole('cell').last(),
  ).toHaveText('""')
  const headers = JSON.stringify({ 'X-Synthetic-Note': '虚构样本'.repeat(30) })
  await page.getByRole('textbox', { name: 'Headers JSON', exact: true }).fill(headers)
  await diff.getByRole('button', { name: /查看第.*当前草稿值.*完整值/ }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toContainText(JSON.stringify(headers))
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        key === 'current' &&
        value.sources?.some(
          (source: { id: string; settings: { path: string } }) =>
            source.id === '1007' && source.settings.path === '',
        )
      ) {
        IDBObjectStore.prototype.put = original
        this.transaction.abort()
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
      }
      return original.call(this, value, key)
    }
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(
    page.getByText('浏览器演示存储空间不足，本次操作未保存。请释放空间后重试；表单输入仍保留。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(queryInput).toHaveValue(query)
  await expect(queryRow.getByRole('cell').last()).toHaveText(JSON.stringify(query))
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 768, height: 1024 })
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect(diff.locator('p')).toHaveCSS(
      'color',
      theme === 'light' ? 'rgb(107, 126, 148)' : 'rgb(146, 166, 190)',
    )
    await diff.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({
      path: 'test-results/source-configuration-diff-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL('/sources/1007')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.reload()
  await expect(queryInput).toHaveValue(JSON.stringify({ page: 0, enabled: false }, null, 2))
  await expect(page.getByRole('textbox', { name: '请求路径', exact: true })).toHaveValue('')
  await expect(diff.getByText('配置未变更', { exact: true })).toBeVisible()
  await page.goto('/sources/new')
  await expect(diff).toHaveCount(0)
  expect(errors).toEqual([])
})

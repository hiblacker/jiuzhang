import { test, expect, type Page, type Locator } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
})

async function scenario(page: Page, domain: string, scenario: string) {
  await page.evaluate(
    async ({ domain, scenario }) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    },
    { domain, scenario },
  )
}
async function openByKeyboard(page: Page, trigger: Locator, title: string) {
  await expect(trigger).toBeEnabled()
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function trap(page: Page, dialog: Locator, last: Locator) {
  await last.focus()
  await page.keyboard.press('Tab')
  await expect
    .poll(() => dialog.evaluate((root) => root.contains(document.activeElement)))
    .toBe(true)
}
async function themes(page: Page, dialog: Locator, name: string) {
  for (const theme of ['light', 'dark']) {
    // This fixture changes theme for visual review while the dialog retains focus.
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.left >= 0 && bounds.right <= window.innerWidth
        }),
      )
      .toBe(true)
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>(
          'button[aria-label="切换明暗主题"]',
        )
        if (!button) throw new Error('Theme switch is missing')
        button.click()
      })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(page.viewportSize()?.width)
    await page.screenshot({
      path: '/tmp/jiuzhang-desktop-1280-workflow-' + name + '-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
}

test('folder and move dialogs preserve drafts on Escape, recover errors and restore trigger focus', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/datasets')
  const sidebar = page.locator('aside').filter({ hasText: '数据集目录' })
  const trigger = sidebar.getByRole('button', { name: '新建目录', exact: true })
  let dialog = await openByKeyboard(page, trigger, '新建目录')
  const field = dialog.getByRole('textbox', { name: '目录名称', exact: true })
  await expect(field).toBeFocused()
  await trap(page, dialog, dialog.getByRole('button', { name: '保存', exact: true }))
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  dialog = await openByKeyboard(page, trigger, '新建目录')
  await field.fill('键盘目录验收')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(field).toHaveValue('键盘目录验收')
  await scenario(page, 'all', 'error')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(
    dialog.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(field).toHaveValue('键盘目录验收')
  await scenario(page, 'all', 'normal')
  await themes(page, dialog, 'folder')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(sidebar.getByText('键盘目录验收', { exact: true })).toBeVisible()
  await sidebar.getByRole('button', { name: '全部数据集', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: '订单明细宽表' })
  const move = row.getByRole('button', { name: '移动到目录', exact: true })
  dialog = await openByKeyboard(page, move, '移动到目录')
  const save = dialog.getByRole('button', { name: '确认移动', exact: true })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(move).toBeFocused()
  dialog = await openByKeyboard(page, move, '移动到目录')
  await dialog.getByLabel('目标目录', { exact: true }).click()
  await page.locator('.n-base-select-option').getByText('键盘目录验收', { exact: true }).click()
  await trap(page, dialog, save)
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toContainText('键盘目录验收')
  await scenario(page, 'datasets', 'error')
  await save.click()
  await expect(
    dialog.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await scenario(page, 'datasets', 'normal')
  await themes(page, dialog, 'move')
  await save.click()
  await expect(dialog).not.toBeVisible()
  await expect(row.getByRole('cell', { name: '键盘目录验收', exact: true })).toBeVisible()
  await page.reload()
  await expect(row.getByRole('cell', { name: '键盘目录验收', exact: true })).toBeVisible()
})

test('backfill dialog discards only on confirmation and prevents pending close and duplicate writes', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/tasks/3001')
  const trigger = page.getByRole('button', { name: '补数', exact: true })
  const dialog = await openByKeyboard(page, trigger, '模拟补数')
  const cancel = dialog.getByRole('button', { name: '取消', exact: true })
  const save = dialog.getByRole('button', { name: '创建补数运行', exact: true })
  await expect(save).toBeDisabled()
  await trap(page, dialog, cancel)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await openByKeyboard(page, trigger, '模拟补数')
  await dialog.getByPlaceholder('补数开始日期').fill('2026-10-13')
  await dialog.getByPlaceholder('补数开始日期').press('Tab')
  await dialog.getByPlaceholder('补数结束日期').fill('2026-10-14')
  await dialog.getByPlaceholder('补数结束日期').press('Tab')
  await cancel.focus()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('补数开始日期')).toHaveValue('2026-10-13')
  await scenario(page, 'tasks', 'error')
  await save.click()
  await expect(dialog.getByText('补数失败，请检查日期范围。', { exact: true })).toBeVisible()
  await scenario(page, 'tasks', 'normal')
  await themes(page, dialog, 'backfill')
  page.once('dialog', (dialog) => dialog.accept())
  await cancel.click()
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await openByKeyboard(page, trigger, '模拟补数')
  await expect(dialog.getByPlaceholder('补数开始日期')).toHaveValue('')
  await expect(dialog.getByText('补数失败，请检查日期范围。', { exact: true })).toHaveCount(0)
  await dialog.getByPlaceholder('补数开始日期').fill('2026-10-13')
  await dialog.getByPlaceholder('补数开始日期').press('Tab')
  await dialog.getByPlaceholder('补数结束日期').fill('2026-10-14')
  await dialog.getByPlaceholder('补数结束日期').press('Tab')
  await scenario(page, 'tasks', 'slow')
  let writes = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/tasks/3001/backfills'
    )
      writes++
  })
  await save.click()
  await expect(cancel).toBeDisabled()
  await expect(dialog.getByPlaceholder('补数开始日期')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/runs?trigger=backfill&taskId=3001')
  expect(writes).toBe(1)
  await scenario(page, 'tasks', 'normal')
  await expect(page.locator('.n-data-table-tbody tr')).toHaveCount(2)
})

test('CSV import drawer names its dialog, guards cancellation and saves once after a failure', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/warehouse/imports')
  const trigger = page.getByRole('button', { name: '新建导入', exact: true })
  const dialog = await openByKeyboard(page, trigger, 'CSV 导入向导')
  const cancel = dialog.getByRole('button', { name: '取消', exact: true })
  const save = dialog.getByRole('button', { name: '导入示例数据', exact: true })
  await trap(page, dialog, save)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await openByKeyboard(page, trigger, 'CSV 导入向导')
  await dialog.getByLabel('任务名称', { exact: true }).fill('键盘导入验收')
  await dialog.getByLabel('目标表名', { exact: true }).fill('ods_keyboard_import')
  page.once('dialog', (dialog) => dialog.dismiss())
  await cancel.click()
  await expect(dialog.getByLabel('任务名称', { exact: true })).toHaveValue('键盘导入验收')
  await dialog.getByRole('checkbox', { name: '我确认这是虚构演示数据', exact: true }).check()
  await scenario(page, 'warehouse', 'error')
  await save.click()
  await expect(
    dialog.getByText('导入失败：请检查表名、字段映射和 CSV 内容', { exact: true }),
  ).toBeVisible()
  await scenario(page, 'warehouse', 'normal')
  await themes(page, dialog, 'import')
  await scenario(page, 'warehouse', 'slow')
  let writes = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/imports')
      writes++
  })
  await save.click()
  await expect(cancel).toBeDisabled()
  await expect(dialog.getByLabel('任务名称', { exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).not.toBeVisible()
  expect(writes).toBe(1)
  await scenario(page, 'warehouse', 'normal')
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: '键盘导入验收' })).toBeVisible()
})

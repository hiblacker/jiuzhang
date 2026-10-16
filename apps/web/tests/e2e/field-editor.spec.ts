import { test, expect } from '@playwright/test'

test('field reordering keeps focus on the same field and typed masking controls save without rewriting history', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
    if (!localStorage.getItem('jiuzhang.preference.theme'))
      localStorage.setItem('jiuzhang.preference.theme', 'dark')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/datasets/2001/edit?tab=fields')
  const up = page.getByRole('button', { name: '上移字段 customer', exact: true })
  const down = page.getByRole('button', { name: '下移字段 customer', exact: true })
  await expect(down).toBeVisible()
  const version = await page.evaluate(
    async () => (await (await fetch('/api/v1/datasets/2001/versions/1')).json()).data,
  )
  await down.focus()
  await page.keyboard.press('Enter')
  await expect(down).toBeFocused()
  let row = page
    .getByRole('row')
    .filter({ has: page.getByLabel('输出名 customer', { exact: true }) })
  expect(await row.evaluate((element) => (element as HTMLTableRowElement).rowIndex)).toBe(3)
  await up.focus()
  await page.keyboard.press('Enter')
  await expect(up).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(up).toBeDisabled()
  await expect(down).toBeFocused()
  expect(await row.evaluate((element) => (element as HTMLTableRowElement).rowIndex)).toBe(1)

  const policy = page.getByRole('textbox', { name: '脱敏策略 phone', exact: true })
  await policy.fill('手机号')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: '添加输出字段', exact: true }).click()
  await page.getByLabel('源字段名（支持 right_ 前缀）', { exact: true }).last().fill('id')
  await page.getByLabel('输出名 id', { exact: true }).last().fill('numeric_id')
  const idRows = page
    .getByRole('row')
    .filter({ has: page.getByLabel('输出名 id', { exact: true }) })
  await expect(idRows).toHaveCount(2)
  row = idRows.last()
  const type = row.getByLabel('字段类型 id', { exact: true })
  await type.fill('integer')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  const saved = await page.evaluate(
    async () => (await (await fetch('/api/v1/datasets/2001')).json()).data,
  )
  expect(saved.definition.fields[0].name).toBe('customer')
  expect(saved.definition.fields.at(-1)).toMatchObject({
    name: 'id',
    target: 'numeric_id',
    type: 'integer',
  })
  expect(
    saved.definition.fields.find((field: { name: string }) => field.name === 'phone').maskPolicyId,
  ).toBe('6001')
  expect(
    await page.evaluate(
      async () => (await (await fetch('/api/v1/datasets/2001/versions/1')).json()).data,
    ),
  ).toEqual(version)
  await page.goto('/datasets/2001/edit?tab=fields')
  for (const theme of ['dark', 'light']) {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByLabel('输出名 id', { exact: true }) })
        .last(),
    ).toContainText('integer')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({
      path: 'test-results/field-editor-' + theme + '.png',
      animations: 'disabled',
    })
    if (theme === 'dark') {
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      await page.reload()
    }
  }
  expect(errors).toEqual([])
})

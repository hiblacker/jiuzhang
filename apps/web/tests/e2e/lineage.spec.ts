import { test, expect } from '@playwright/test'
test('resource and version-bound field lineage preserve direction, URL and navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'developer')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/governance/lineage?resource=dataset-2001&direction=upstream')
  await expect(page.locator('.vue-flow__node')).toHaveCount(2)
  await page.getByLabel('追踪方向', { exact: true }).click()
  await page.locator('.n-base-select-menu:visible').getByText('仅下游', { exact: true }).click()
  await expect(page).toHaveURL(/direction=downstream/)
  await expect(page.locator('.vue-flow__node')).toHaveCount(3)
  await page.goBack()
  await expect(page.locator('.vue-flow__node')).toHaveCount(2)
  await page.goto('/governance/lineage?scope=field&resource=table-4001&field=id&direction=upstream')
  await expect(page.locator('.vue-flow__node')).toHaveCount(3)
  await expect(
    page.locator('.vue-flow__node').filter({ hasText: '订单明细宽表 v1 · id' }),
  ).toBeVisible()
  await page.reload()
  await expect(page.locator('.vue-flow__node')).toHaveCount(3)
  await page.locator('.vue-flow__node').filter({ hasText: '订单明细宽表 v1 · id' }).click()
  await page.getByRole('button', { name: '打开资源', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/datasets/2001/versions/1$'))
  expect(errors).toEqual([])
})

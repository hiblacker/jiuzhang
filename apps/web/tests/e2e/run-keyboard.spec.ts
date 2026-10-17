import { expect, test } from '@playwright/test'

for (const path of ['/datasets/2001', '/tasks/3001']) {
  test(
    path + ' keyboard outcomes create the selected run and a version-bound retry',
    async ({ page }) => {
      test.setTimeout(60000)
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
        Date.now = () => Date.parse('2026-10-17T00:00:00.000Z')
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.text().includes('[intlify]')) errors.push(message.text())
      })
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.evaluate(async () => {
        const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
        const response = await fetch('/api/v1/tasks/3001', { headers })
        if (!response.ok) throw new Error(await response.text())
        const task = (await response.json()).data
        const update = await fetch('/api/v1/tasks/3001', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            schedule: {
              ...task.schedule,
              mode: 'manual',
              dependencies: [],
              retries: 0,
              timeoutSeconds: 600,
            },
          }),
        })
        if (!update.ok) throw new Error(await update.text())
      })
      const outcome = page.getByRole('button', { name: '数据集 2001 的演示运行结果', exact: true })
      await outcome.press('Enter')
      await expect(outcome).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('Escape')
      await expect(outcome).toBeFocused()
      await expect(outcome).toHaveAttribute('aria-expanded', 'false')
      await outcome.press('Enter')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(outcome).toContainText('失败场景')
      await page.getByRole('button', { name: '运行', exact: true }).press('Enter')
      await expect(page).toHaveURL(/[/]runs[/][0-9]+$/)
      const originalId = new URL(page.url()).pathname.split('/').at(-1)!
      const advance = async () => {
        const status = await page.evaluate(async () => {
          const response = await fetch('/api/v1/demo/tick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
            body: JSON.stringify({ advanceSeconds: 6 }),
          })
          return response.status
        })
        expect(status).toBe(200)
      }
      await advance()
      await expect(page.getByText('失败', { exact: true })).toBeVisible()
      const retryOutcome = page.getByRole('button', {
        name: '运行 ' + originalId + ' 的演示重试结果',
        exact: true,
      })
      await retryOutcome.press('Enter')
      await expect(retryOutcome).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(retryOutcome).toContainText('质量阻断')
      await page.getByRole('button', { name: '重试运行 ' + originalId, exact: true }).press('Enter')
      await expect(page).not.toHaveURL('/runs/' + originalId)
      await expect(page).toHaveURL(/[/]runs[/][0-9]+$/)
      const retryId = new URL(page.url()).pathname.split('/').at(-1)!
      await advance()
      await expect(page.getByText('质量阻断', { exact: true }).first()).toBeVisible()
      const runs = await page.evaluate(
        async (ids) => {
          return Promise.all(
            ids.map(async (id) => {
              const response = await fetch('/api/v1/runs/' + id, {
                headers: { 'x-demo-role': 'admin' },
              })
              if (!response.ok) throw new Error(await response.text())
              return (await response.json()).data
            }),
          )
        },
        [originalId, retryId],
      )
      expect(runs[0]).toMatchObject({ status: 'failed', outcome: 'failed', retryRunId: retryId })
      expect(runs[1]).toMatchObject({
        status: 'blocked',
        outcome: 'blocked',
        retryOf: originalId,
        trigger: 'retry',
        datasetVersion: runs[0].datasetVersion,
      })
      await page.reload()
      await expect(page.getByText('质量阻断', { exact: true }).first()).toBeVisible()
      await page.goto('/runs/' + originalId)
      await expect(
        page.getByRole('button', { name: '重试运行 ' + originalId, exact: true }),
      ).toHaveCount(0)
      await expect(page.getByRole('button', { name: retryId, exact: true })).toBeVisible()
      expect(errors).toEqual([])
    },
  )
}

test('viewer run and retry outcome controls remain unavailable without writes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'viewer')
  })
  const writes: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && /[/](runs|retry|cancel)([/]|$)/.test(path)) writes.push(path)
  })
  await page.goto('/datasets/2001')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const outcome = page.getByRole('button', { name: '数据集 2001 的演示运行结果', exact: true })
  await expect(outcome).toBeDisabled()
  await expect(outcome).toHaveJSProperty('tabIndex', -1)
  await expect(page.getByRole('button', { name: '运行', exact: true })).toBeDisabled()
  await page.goto('/runs/9001')
  const retryOutcome = page.getByRole('button', { name: '运行 9001 的演示重试结果', exact: true })
  await expect(retryOutcome).toBeDisabled()
  await expect(retryOutcome).toHaveJSProperty('tabIndex', -1)
  await expect(page.getByRole('button', { name: '重试运行 9001', exact: true })).toBeDisabled()
  expect(writes).toEqual([])
})

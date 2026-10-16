import { test, expect } from '@playwright/test'

const entries = [
  { kind: 'required', label: '必填', field: 'id', parameter: '', invalid: [] },
  { kind: 'unique', label: '唯一', field: 'id', parameter: '', invalid: [] },
  {
    kind: 'range',
    label: '范围',
    field: 'amount',
    parameter: '-0.10,9999999999999999.99',
    invalid: ['100,0', 'x,10', '1,2,3'],
  },
  {
    kind: 'enum',
    label: '枚举',
    field: 'city',
    parameter: '杭州, 上海,成都',
    invalid: ['', '杭州,,上海'],
  },
  {
    kind: 'freshness',
    label: '新鲜度',
    field: 'updated_at',
    parameter: '24',
    invalid: ['0', '1.5', '87601'],
  },
]

for (const entry of entries) {
  test(
    entry.kind +
      ' rule validates parameters, preserves both severities and explains sample overrides',
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
      await page.goto('/governance/quality')
      await page.getByRole('button', { name: '新建规则', exact: true }).click()
      const drawer = page.getByRole('dialog', { name: '质量规则', exact: true })
      const name = '参数验收-' + entry.kind
      await drawer.getByLabel('规则名称', { exact: true }).fill(name)
      await drawer.getByLabel('类型', { exact: true }).click()
      await page.locator('.n-base-select-option').getByText(entry.label, { exact: true }).click()
      await drawer.getByLabel('字段', { exact: true }).fill(entry.field)
      const parameter = drawer.getByLabel('参数', { exact: true })
      if (entry.invalid.length) {
        for (const invalid of entry.invalid) {
          await parameter.fill(invalid)
          await drawer.getByRole('button', { name: '保存规则', exact: true }).click()
          await expect(drawer.getByText('请检查输入内容', { exact: true })).toBeVisible()
          await expect(parameter).toHaveValue(invalid)
        }
        await parameter.fill(entry.parameter)
      } else {
        await expect(parameter).toHaveCount(0)
        await expect(
          drawer.getByText('必填与唯一规则无需参数，已有参数不参与检查。', { exact: true }),
        ).toBeVisible()
      }
      await drawer.getByLabel('严重级别', { exact: true }).click()
      await page.locator('.n-base-select-option').getByText('WARN 警告', { exact: true }).click()
      const createdEvent = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/governance/quality') &&
          response.request().method() === 'POST' &&
          response.status() === 201,
      )
      await drawer.getByRole('button', { name: '保存规则', exact: true }).click()
      const created = (await (await createdEvent).json()) as {
        data: { id: string; kind: string; parameter: string; severity: string; version: number }
      }
      expect(created.data).toMatchObject({
        kind: entry.kind,
        parameter: entry.parameter,
        severity: 'WARN',
        version: 1,
      })
      await expect(drawer).not.toBeVisible()
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page).toHaveURL('/governance/quality/' + created.data.id)
      await expect(
        page.getByText(
          '下方按钮分别模拟 PASS、WARN、BLOCK 样本结果，不修改已保存的严重级别；任务运行使用发布版本绑定的规则。',
          { exact: true },
        ),
      ).toBeVisible()
      for (const scenario of ['PASS', 'WARN', 'BLOCK']) {
        await page.getByRole('button', { name: scenario, exact: true }).click()
        let expectedRate = entry.kind === 'unique' ? '33.3%' : '66.7%'
        if (scenario === 'PASS') expectedRate = '100.0%'
        await expect(page.getByText(expectedRate, { exact: true })).toBeVisible()
        await expect(
          page.locator('.n-alert-body').filter({ hasText: scenario + ' ·' }),
        ).toBeVisible()
      }
      await page.getByRole('button', { name: '编辑规则', exact: true }).click()
      await expect(drawer.getByText('WARN 警告', { exact: true })).toBeVisible()
      if (entry.invalid.length) await expect(parameter).toHaveValue(entry.parameter)
      await drawer.getByLabel('严重级别', { exact: true }).click()
      await page.locator('.n-base-select-option').getByText('BLOCK 阻断', { exact: true }).click()
      await drawer.getByRole('button', { name: '保存规则', exact: true }).click()
      await expect(drawer).not.toBeVisible()
      await expect(page.getByText('v2', { exact: true })).toBeVisible()
      await expect(page.getByText('66.7%', { exact: true })).toHaveCount(0)
      await expect(page.getByText('33.3%', { exact: true })).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await page.getByRole('button', { name: '编辑规则', exact: true }).click()
      await expect(drawer.getByText('BLOCK 阻断', { exact: true })).toBeVisible()
      if (entry.invalid.length) await expect(parameter).toHaveValue(entry.parameter)
      await drawer.getByRole('button', { name: '取消', exact: true }).click()
      expect(errors).toEqual([])
    },
  )
}

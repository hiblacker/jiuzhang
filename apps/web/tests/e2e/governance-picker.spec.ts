import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jiuzhang.preference.session', 'demo')
    localStorage.setItem('jiuzhang.preference.role', 'admin')
  })
})

test('governance bindings reach remote pages, restore off-page selections and compose field masking without changing history', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('[intlify]')) errors.push(message.text())
  })
  await page.goto('/datasets/2001/edit?tab=governance')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).not.toHaveValue('')
  const fixture = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    async function request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch('/api/v1' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return await response.json()
    }
    const qualityIds: string[] = []
    const maskIds: string[] = []
    for (let batch = 0; batch < 6; batch++) {
      const entries = await Promise.all(
        Array.from({ length: 20 }, async (_, offset) => {
          const index = batch * 20 + offset
          const suffix = String(index).padStart(3, '0')
          const common = {
            description: '虚构分页样本',
            owner: 'demo',
            tags: [],
            enabled: index !== 1,
          }
          const quality = await request('/governance/quality', 'POST', {
            ...common,
            name: 'A_quality_' + suffix,
            kind: 'required',
            field: 'id',
            parameter: '',
            severity: 'WARN',
          })
          const masking = await request('/governance/masking', 'POST', {
            ...common,
            name: 'A_masking_' + suffix,
            kind: 'generalize',
            parameter: '合成脱敏_' + suffix,
          })
          return { quality: quality.data.id, masking: masking.data.id }
        }),
      )
      qualityIds.push(...entries.map((item) => item.quality))
      maskIds.push(...entries.map((item) => item.masking))
    }
    const quality = await request('/governance/quality?pageSize=100')
    const masking = await request('/governance/masking?pageSize=100')
    for (const [list, id] of [
      [quality.data, qualityIds[0]],
      [masking.data, maskIds[0]],
    ] as const)
      if (list.some((item: { id: string }) => item.id === id))
        throw new Error('Expected selected binding beyond the first 100')
    const dataset = (await request('/datasets/2001')).data
    await request('/datasets/2001', 'PATCH', {
      definition: {
        ...dataset.definition,
        qualityRuleIds: qualityIds.slice(0, 2),
        maskPolicyIds: maskIds.slice(0, 2),
        fields: dataset.definition.fields.map((field: { name: string; maskPolicyId: string }) =>
          field.name === 'phone' ? { ...field, maskPolicyId: maskIds[0] } : field,
        ),
      },
    })
    return {
      qualityIds,
      maskIds,
      qualityTotal: quality.meta.total,
      maskTotal: masking.meta.total,
      original: (await request('/datasets/2001/versions/1')).data,
    }
  })
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      request.method() === 'GET' &&
      ['/api/v1/governance/quality', '/api/v1/governance/masking'].includes(url.pathname)
    )
      requests.push(url.search)
  })
  await page.reload()
  for (const [label, prefix, total] of [
    ['质量规则', 'A_quality_', fixture.qualityTotal],
    ['脱敏策略引用', 'A_masking_', fixture.maskTotal],
  ] as const) {
    const group = page.getByRole('group', { name: label, exact: true })
    for (const index of ['000', '001'])
      await expect(group.getByText(prefix + index, { exact: true })).toBeVisible()
    await expect(group.getByText('已加载 20 / ' + total + ' 项', { exact: true })).toBeVisible()
    await group.getByRole('button', { name: '加载更多选项', exact: true }).click()
    await expect(group.getByText('已加载 40 / ' + total + ' 项', { exact: true })).toBeVisible()
    await group.getByRole('button', { name: label, exact: true }).press('Enter')
    const search = page.getByRole('textbox', { name: '搜索' + label, exact: true })
    await search.fill(prefix + '119')
    await expect(
      page.locator('.n-base-select-menu:visible').getByText(prefix + '119', { exact: true }),
    ).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(group.locator('.n-tag__content').filter({ hasText: prefix + '119' })).toBeVisible()
  }
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  const field = page.getByRole('group', { name: '脱敏策略 phone', exact: true })
  await expect(field.getByText('A_masking_000', { exact: true })).toBeVisible()
  const fieldSearch = page.getByRole('textbox', { name: '脱敏策略 phone', exact: true })
  await fieldSearch.fill('A_masking_118')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_masking_118', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(field.getByText('A_masking_118', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  await page.goto('/datasets/2001/edit?tab=fields')
  await page.reload()
  await expect(field.getByText('A_masking_118', { exact: true })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/v1/datasets/2001')
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).data
  })
  expect(saved.definition.qualityRuleIds).toEqual([
    fixture.qualityIds[0],
    fixture.qualityIds[1],
    fixture.qualityIds[119],
  ])
  expect(saved.definition.maskPolicyIds).toEqual([
    fixture.maskIds[0],
    fixture.maskIds[1],
    fixture.maskIds[119],
  ])
  expect(
    saved.definition.fields.find((item: { name: string }) => item.name === 'phone').maskPolicyId,
  ).toBe(fixture.maskIds[118])
  await page.getByRole('tab', { name: '质量与脱敏', exact: true }).click()
  await page.getByRole('textbox', { name: '数据集名称', exact: true }).fill('治理失败保留草稿')
  async function scenario(value: 'normal' | 'error') {
    await page.evaluate(async (scenario) => {
      const response = await fetch('/api/v1/demo/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
        body: JSON.stringify({ domain: 'governance', scenario }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, value)
  }
  const quality = page.getByRole('group', { name: '质量规则', exact: true })
  await scenario('error')
  await quality.getByRole('button', { name: '质量规则', exact: true }).press('Enter')
  await page.getByRole('textbox', { name: '搜索质量规则', exact: true }).fill('A_quality_118')
  await page.keyboard.press('Escape')
  await expect(
    quality.getByText('当前已启用接口失败演示，可从演示控制台恢复', { exact: true }),
  ).toBeVisible()
  await expect(quality.getByText('A_quality_000', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).toHaveValue(
    '治理失败保留草稿',
  )
  await scenario('normal')
  await quality.getByRole('button', { name: '重试', exact: true }).click()
  await expect(quality.getByRole('alert')).toHaveCount(0)
  await quality.getByRole('button', { name: '质量规则', exact: true }).press('Enter')
  await expect(
    page.locator('.n-base-select-menu:visible').getByText('A_quality_118', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 768, height: 1024 })
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe(theme)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
    await page.screenshot({
      path: 'test-results/governance-picker-' + theme + '.png',
      fullPage: true,
      animations: 'disabled',
    })
  }
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
  const result = await page.evaluate(async () => {
    const current = await fetch('/api/v1/datasets/2001')
    const historical = await fetch('/api/v1/datasets/2001/versions/1')
    const preview = await fetch('/api/v1/datasets/2001/preview', {
      method: 'POST',
      headers: { 'x-demo-role': 'admin' },
    })
    if (!current.ok || !historical.ok || !preview.ok)
      throw new Error('Cannot inspect retained data')
    return {
      current: (await current.json()).data,
      historical: (await historical.json()).data,
      preview: (await preview.json()).data,
    }
  })
  expect(result.current.name).toBe('订单明细宽表')
  expect(result.historical).toEqual(fixture.original)
  expect(result.preview.rows[0].phone).toBe('合成脱敏_118')
  expect(
    result.preview.qualityResults.map((item: { ruleId: string }) => item.ruleId).sort(),
  ).toEqual([fixture.qualityIds[0], fixture.qualityIds[119]].sort())
  expect(requests.length).toBeGreaterThan(5)
  expect(requests.every((query) => new URLSearchParams(query).get('pageSize') === '20')).toBe(true)
  expect(errors).toEqual([])
})

test('missing governance selections report detail errors without raw identifier labels or draft mutation', async ({
  page,
}) => {
  await page.goto('/datasets/2001/edit?tab=governance')
  await expect(page.getByRole('textbox', { name: '数据集名称', exact: true })).not.toHaveValue('')
  await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'x-demo-role': 'admin' }
    const response = await fetch('/api/v1/datasets/2001', { headers })
    if (!response.ok) throw new Error(await response.text())
    const dataset = (await response.json()).data
    const update = await fetch('/api/v1/datasets/2001', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        definition: {
          ...dataset.definition,
          qualityRuleIds: ['999999997'],
          maskPolicyIds: ['999999998'],
          fields: dataset.definition.fields.map((field: { name: string }) =>
            field.name === 'phone' ? { ...field, maskPolicyId: '999999999' } : field,
          ),
        },
      }),
    })
    if (!update.ok) throw new Error(await update.text())
  })
  await page.reload()
  for (const [label, id] of [
    ['质量规则', '999999997'],
    ['脱敏策略引用', '999999998'],
  ]) {
    const group = page.getByRole('group', { name: label, exact: true })
    await expect(group.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
    await expect(group.getByText(id!, { exact: true })).toHaveCount(0)
  }
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  const field = page.getByRole('group', { name: '脱敏策略 phone', exact: true })
  await expect(field.getByText('资源不存在或已被删除', { exact: true })).toBeVisible()
  await expect(field.getByText('999999999', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page).toHaveURL('/datasets/2001')
})

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const at = line.indexOf('=')
    return [line.slice(0, at), line.slice(at + 1)]
  }))
const source = JSON.parse(readFileSync(new URL('../.local/source-test.json', import.meta.url), 'utf8'))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
const writes = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  if (/\/api\/v1\/datasets(?:\/\d+)?$/.test(new URL(request.url()).pathname) &&
      ['POST', 'PATCH'].includes(request.method())) writes.push(request)
})
const editor = () => page.getByLabel('数据集 SQL 编辑器', { exact: true })
const settings = () => page.locator('.editor-settings')
const saveButton = () => page.getByRole('button', { name: '保存草稿', exact: true })
const target = 'inline_append_target_with_long_name_20261106'
const query = "SELECT CAST(9007199254740993 AS SIGNED) AS id, CAST('12345.6700' AS DECIMAL(20,4)) AS amount"

async function ok(response) {
  if (!response.ok()) throw new Error('Synthetic acceptance request failed: HTTP ' + response.status())
  return (await response.json()).data
}
async function save() {
  const before = writes.length
  const response = page.waitForResponse((r) => /\/api\/v1\/datasets(?:\/\d+)?$/.test(new URL(r.url()).pathname) && ['POST', 'PATCH'].includes(r.request().method()))
  await saveButton().evaluate((button) => { button.click(); button.click() })
  const result = await ok(await response)
  await page.waitForURL('**/datasets/' + result.id)
  expect(writes.length - before).toBe(1)
  return result
}
async function publish() {
  await page.getByRole('button', { name: '发布版本', exact: true }).click()
  const confirmation = page.getByRole('dialog')
  await expect(confirmation).toContainText('发布本身不修改数据')
  const response = page.waitForResponse((r) => /\/datasets\/\d+\/publish$/.test(new URL(r.url()).pathname))
  await confirmation.getByRole('button', { name: '确认发布', exact: true }).click()
  await ok(await response)
  await expect(confirmation).toHaveCount(0)
}
async function capture(name) {
  await expect(saveButton()).toBeEnabled()
  const scheme = await page.evaluate(() => document.documentElement.style.colorScheme)
  await expect(page.locator('.n-form-item-label').first()).toHaveCSS('color', scheme === 'dark' ? 'rgb(226, 234, 245)' : 'rgb(21, 38, 61)')
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))))
  await page.screenshot({ path: new URL('../.local/dataset-inline-' + name + '-1280.png', import.meta.url).pathname })
}

try {
  await page.goto('http://localhost:5175/login')
  await page.getByLabel('账号', { exact: true }).fill(env.JIUZHANG_BOOTSTRAP_USER)
  await page.getByLabel('密码', { exact: true }).fill(env.JIUZHANG_BOOTSTRAP_PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/overview')
  await page.goto('http://localhost:5175/datasets/new?sourceId=' + source.id)
  await page.getByRole('button', { name: '定义方式', exact: true }).click()
  await page.getByText('自定义 SQL', { exact: true }).click()
  await settings().getByLabel('数据集名称', { exact: true }).fill('页内追加写入验收 ' + Date.now())
  await settings().getByLabel('目标表', { exact: true }).fill(target + '_' + Date.now().toString().slice(-7))
  await settings().getByText('追加写入', { exact: true }).click()
  await expect(settings()).toContainText('重复记录也会写入')
  await settings().getByRole('button', { name: '更多信息', exact: true }).click()
  await settings().getByLabel('负责人', { exact: true }).fill('inline-verification')
  await settings().getByLabel('说明', { exact: true }).fill('页内信息折叠后仍保留')
  await settings().getByLabel('主题域', { exact: true }).fill('测试主题')
  await settings().getByRole('button', { name: '收起更多信息', exact: true }).click()
  await editor().fill(query)
  const preview = page.waitForResponse((r) => r.url().endsWith('/datasets/preview'))
  await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
  await ok(await preview)
  await expect(page.getByText('12345.6700', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const dimensions = await editor().boundingBox()
  expect(dimensions.height).toBeGreaterThan(150)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await capture('append-light')
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')
  await capture('append-dark')
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()

  // A transport failure must retain all inputs without creating a server-side dataset.
  await page.route('**/api/v1/datasets', (route) => route.request().method() === 'POST' ? route.abort('failed') : route.continue())
  await saveButton().click()
  await expect(page.locator('.n-message')).toBeVisible()
  await expect(saveButton()).toBeEnabled()
  await expect(editor()).toHaveText(query)
  await expect(settings().getByRole('radio', { name: '追加写入', exact: true })).toBeChecked()
  await page.unroute('**/api/v1/datasets')
  const dataset = await save()
  expect(dataset.owner).toBe('inline-verification')
  expect(dataset.description).toBe('页内信息折叠后仍保留')
  expect(dataset.definition.output.subjectDomain).toBe('测试主题')
  expect(dataset.definition.output.writeMode).toBe('append')
  await publish()
  await expect(page.getByLabel('允许本次空结果覆盖', { exact: true })).toHaveCount(0)
  const runResponse = page.waitForResponse((r) => r.url().endsWith('/datasets/' + dataset.id + '/runs'))
  await page.getByRole('button', { name: '运行', exact: true }).click()
  const run = await ok(await runResponse)
  await page.waitForURL('**/runs/' + run.id)
  await expect(page.getByText('本次追加行数', { exact: true })).toBeVisible()
  await page.goto('http://localhost:5175/tasks/' + dataset.id + '/edit')
  await expect(page.getByRole('alert').filter({ hasText: '当前生效：追加写入 · 数据集 v1。' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '追加写入', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '去数据集修改', exact: true }).click()
  await expect(settings().getByLabel('目标表', { exact: true })).toBeDisabled()
  await expect(settings().getByRole('button', { name: '提供方式', exact: true })).toBeDisabled()
  await expect(settings().getByRole('radio', { name: '全量替换', exact: true })).toBeEnabled()
  await settings().getByText('全量替换', { exact: true }).click()
  await expect(settings()).toContainText('草稿修改，发布后生效')
  await expect(settings()).toContainText('替换目标表全部已有数据')
  await capture('replace-pending')
  await save()
  await expect(page.getByText('当前生效的入库设置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '发布版本', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('追加写入 → 全量替换')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  const unchanged = await ok(await page.request.get('http://localhost:5175/api/v1/datasets/' + dataset.id))
  expect(unchanged.publishedWriteMode).toBe('append')
  await publish()
  const historical = await ok(await page.request.get('http://localhost:5175/api/v1/runs/' + run.id))
  expect(historical.writeMode).toBe('append')
  const task = await ok(await page.request.get('http://localhost:5175/api/v1/tasks/' + dataset.id))
  expect(task.writeMode).toBe('replace')
  const evidence = JSON.parse(readFileSync(new URL('../.local/append-test.json', import.meta.url), 'utf8'))
  await page.goto('http://localhost:5175/runs/' + evidence.emptyRunId)
  await expect(page.getByText('执行成功，无新增数据，已有数据保留。', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  writeFileSync(new URL('../.local/append-ui-test.json', import.meta.url), JSON.stringify({ datasetId: dataset.id, runId: run.id }))
  console.log('PASS inline append browser 1280x1000: page-only configuration, metadata preservation, light/dark, save failure/retry/single-write, append publication/run, task read-only mode, switch warning/cancel/confirm, historical mode and empty-append feedback')
} catch (error) {
  await page.screenshot({ path: new URL('../.local/dataset-inline-failure-1280.png', import.meta.url).pathname })
  throw error
} finally {
  await browser.close()
}

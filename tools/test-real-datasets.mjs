import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }),
)
const source = JSON.parse(
  readFileSync(new URL('../.local/source-test.json', import.meta.url), 'utf8'),
)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function setName(name) {
  const input = page.getByLabel('数据集名称', { exact: true })
  if (!(await input.isVisible())) await page.getByText('基本信息', { exact: true }).click()
  await input.fill(name)
  await page.getByText('基本信息 · ' + name, { exact: true }).click()
}

async function login() {
  await page.goto('http://localhost:5175/login')
  await page.getByLabel('账号', { exact: true }).fill(env.JIUZHANG_BOOTSTRAP_USER)
  await page.getByLabel('密码', { exact: true }).fill(env.JIUZHANG_BOOTSTRAP_PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/overview')
}

async function publish() {
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.waitForURL(/\/datasets\/\d+$/)
  await page.getByRole('button', { name: '发布版本', exact: true }).click()
  await page.getByRole('button', { name: '确认发布', exact: true }).click()
  await page.getByText('v1', { exact: true }).first().waitFor()
}

async function preview() {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/datasets/preview') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '预览样本', exact: true }).click()
  const result = await response
  if (!result.ok()) {
    const body = await result.json()
    throw new Error('Dataset preview failed: ' + result.status() + ' ' + body.error?.code)
  }
}
async function runSql(sql) {
  await page.getByLabel('数据集 SQL 编辑器', { exact: true }).fill(sql)
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/datasets/preview') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '运行 SQL', exact: true }).click()
  return response
}

try {
  await login()
  const stamp = Date.now()

  await page.goto(
    'http://localhost:5175/datasets/new?sourceId=' + source.id + '&objectId=' + source.objectId,
  )
  await setName('browser_visual_' + stamp)
  await preview()
  await page.getByText('9007199254740993', { exact: true }).waitFor()
  await page.getByText('12345.6700', { exact: true }).waitFor()
  await page.getByRole('tab', { name: '输出与入仓', exact: true }).click()
  await page.getByLabel('目标表', { exact: true }).fill('browser_visual_' + stamp)
  await publish()

  await page.goto('http://localhost:5175/datasets/new?sourceId=' + source.id)
  await page.getByRole('button', { name: '定义方式', exact: true }).click()
  await page.getByText('自定义 SQL', { exact: true }).click()
  let sqlResponse = await runSql('SELECT id, amount FROM orders LIMIT 10')
  if (!(await sqlResponse).ok()) {
    const body = await (await sqlResponse).json()
    throw new Error('SQL preview failed: ' + body.error?.code)
  }
  await page.getByText('查询结果', { exact: true }).first().waitFor()
  await page.getByText('9007199254740993', { exact: true }).waitFor()
  await page.getByText('12345.6700', { exact: true }).waitFor()
  await expect(page.getByRole('tab', { name: '输入与建模', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const catalog = page.getByRole('complementary', { name: '对象目录', exact: true })
  await catalog.getByLabel('搜索表名', { exact: true }).fill('orders')
  await expect(catalog.getByRole('listitem')).toHaveCount(1)
  await catalog.getByRole('button', { name: 'orders', exact: true }).click()
  await expect(page.getByLabel('数据集 SQL 编辑器', { exact: true })).toHaveText(
    'SELECT id, amount FROM orders LIMIT 10',
  )
  const separator = page.getByRole('separator', {
    name: '调整 SQL 编辑器与查询结果高度',
    exact: true,
  })
  await separator.focus()
  await separator.press('ArrowDown')
  await expect(separator).toHaveAttribute('aria-valuenow', '47')
  await separator.press('ArrowUp')
  const resultsBox = await page.getByRole('region', { name: '查询结果', exact: true }).boundingBox()
  if (!resultsBox || resultsBox.height < 180 || resultsBox.y + resultsBox.height > 1000)
    throw new Error('SQL result panel does not fit the desktop viewport')
  await page.screenshot({ path: '/tmp/jiuzhang-sql-workspace-light-1280.png' })
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('dark')
  await expect(page.locator('.dataset-editor-card')).toHaveCSS(
    'background-color',
    'rgb(24, 37, 56)',
  )
  await expect(page.locator('.main-content')).toHaveCSS('background-color', 'rgb(16, 26, 40)')
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  )
  await expect(page.getByText('12345.6700', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/jiuzhang-sql-workspace-dark-1280.png' })
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('light')
  await expect(page.locator('.dataset-editor-card')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  )
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  await page.getByLabel('输出名 id', { exact: true }).fill('order_id')
  await page.getByLabel('输出名 amount', { exact: true }).fill('revenue')
  await page.getByRole('tab', { name: '输入与建模', exact: true }).click()
  await expect(page.getByText('9007199254740993', { exact: true })).toHaveCount(0)
  sqlResponse = await runSql('SELECT id, amount FROM orders LIMIT 10')
  if (!sqlResponse.ok()) throw new Error('Mapped SQL preview failed')
  await page.getByRole('columnheader', { name: 'revenue', exact: true }).waitFor()
  await page.getByText('12345.6700', { exact: true }).waitFor()

  const failedSql = await runSql('SELECT missing_field FROM orders')
  if ((await failedSql).ok()) throw new Error('Invalid SQL unexpectedly succeeded')
  await expect(
    page.locator('.n-message').filter({ hasText: 'SQL 执行失败，请检查语法、表名和字段名' }),
  ).toHaveCount(1)
  await page.getByText('查询结果', { exact: true }).first().waitFor()
  await expect(page.getByRole('tab', { name: '输入与建模', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  await expect(page.getByLabel('输出名 amount', { exact: true })).toHaveValue('revenue')
  await page.getByRole('tab', { name: '输入与建模', exact: true }).click()

  const malformedSql = await runSql('SELECT FROM orders')
  if (malformedSql.ok()) throw new Error('Malformed SQL unexpectedly succeeded')
  await expect(
    page.locator('.n-message').filter({ hasText: '仅支持单条只读 SELECT 查询，请检查 SQL' }),
  ).toHaveCount(1)

  sqlResponse = await runSql('SELECT id, amount AS total_amount FROM orders LIMIT 10')
  if (!(await sqlResponse).ok()) {
    const body = await (await sqlResponse).json()
    throw new Error('SQL preview retry failed: ' + body.error?.code)
  }
  await page.getByText('9007199254740993', { exact: true }).waitFor()
  await page.getByRole('columnheader', { name: 'total_amount', exact: true }).waitFor()
  await page.getByRole('columnheader', { name: 'order_id', exact: true }).waitFor()
  await page
    .getByText('已移除不再返回的字段：amount。其余字段配置已保留，请检查“字段与清洗”及输出主键。', {
      exact: true,
    })
    .waitFor()
  await page.getByRole('tab', { name: '字段与清洗', exact: true }).click()
  await expect(page.getByLabel('输出名 id', { exact: true })).toHaveValue('order_id')
  await expect(page.getByLabel('输出名 total_amount', { exact: true })).toHaveValue('total_amount')
  await expect(page.getByLabel('输出名 amount', { exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: '输入与建模', exact: true }).click()
  await page.getByRole('button', { name: '提供方式', exact: true }).click()
  await page.getByText('直连数据源', { exact: true }).click()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByText('请填写数据集名称', { exact: true }).waitFor()
  await setName('browser_sql_direct_' + stamp)
  await publish()

  await page.getByRole('tab', { name: '样本预览', exact: true }).click()
  await page.getByText('9007199254740993', { exact: true }).waitFor()
  await page.getByText('12345.6700', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/jiuzhang-real-dataset-1280.png' })
  if (errors.length) throw new Error('Browser runtime errors: ' + errors.join('; '))
  console.log(
    'PASS real dataset browser 1280x1000: visual preview, unnamed SQL run, inline results, desktop layout/themes, parse/database failure recovery, preserved mappings/schema refresh, direct publish and query',
  )
} catch (error) {
  console.log((await page.locator('body').innerText()).slice(0, 7000))
  throw error
} finally {
  await browser.close()
}

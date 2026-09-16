import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/console/package.json', import.meta.url));
assert.equal(require('playwright/package.json').version, '1.62.1');
export const { chromium } = require('playwright');
export const { expect } = require('@playwright/test');
export async function connect(page, ui, api, token, mode = '平台管理') {
  for (const target of [ui, api]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(target).hostname), 'Live acceptance is restricted to local test services');
  await page.goto(ui);
  await page.getByLabel('控制 API 地址', { exact: true }).fill(api);
  await page.getByLabel('访问令牌', { exact: true }).fill(token);
  if (mode !== '平台管理') await choose(page, '访问视图', mode);
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.locator('.connection-modal')).toHaveCount(0);
  await expect(page.locator('.sidebar-bottom')).toContainText('控制 API 已连接');
}
export async function choose(page, label, option) {
  await page.getByLabel(label, { exact: true }).click();
  await page.locator('.n-base-select-menu:visible').getByText(option, { exact: true }).click();
}
export async function navigate(page, name) {
  if (await page.getByRole('button', { name: '打开导航' }).isVisible()) await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
export async function confirm(page) { await page.getByRole('button', { name: '确认', exact: true }).click(); }
export async function submit(page) {
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await expect(page.locator('.action-modal')).toBeHidden();
}
export function launchOptions() { return { headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }; }

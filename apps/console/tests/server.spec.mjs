import { test, expect } from '@playwright/test';
import http from 'node:http';
import { once } from 'node:events';
import { createConsoleServer } from '../server.mjs';
import { select } from './fixture.mjs';

test('built UI connects through its real same-origin proxy with memory-only credentials', async ({ page }) => {
  const calls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const upstream = http.createServer((request, response) => {
    calls.push({ path: request.url, token: request.headers.authorization, cookie: request.headers.cookie });
    response.writeHead(request.url === '/api/v1/warehouse/projects' ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end('[]');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const server = createConsoleServer({ origin: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await page.goto(base);
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect(page.getByLabel('控制 API 地址', { exact: true })).toHaveValue(base);
    await page.getByLabel('访问令牌', { exact: true }).fill('synthetic-proxy-test-only');
    await select(page, '访问视图', '项目成员');
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.getByText('暂无可访问的项目', { exact: true })).toBeVisible();
    expect(calls).toEqual([{ path: '/api/v1/warehouse/projects', token: 'Bearer synthetic-proxy-test-only', cookie: undefined }]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await page.content()).not.toContain('synthetic-proxy-test-only');
    const notices = await page.request.get(base + '/third-party-notices.txt');
    expect(notices.status()).toBe(200);
    expect(await notices.text()).toContain('node_modules/naive-ui @ 2.45.3');
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});

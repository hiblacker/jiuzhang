import { expect, test } from '@playwright/test'

const editors = [
  {
    path: '/sources/1001',
    domain: 'sources',
    field: '名称',
    placeholder: true,
    action: '保存',
    endpoint: '/sources/1001',
  },
  {
    path: '/sources/1001',
    domain: 'sources',
    field: '名称',
    placeholder: true,
    action: '模拟测试连接',
    endpoint: '/sources/test',
  },
  {
    path: '/datasets/2001',
    domain: 'datasets',
    field: '数据集名称',
    placeholder: true,
    action: '保存草稿',
    endpoint: '/datasets/2001',
  },
  {
    path: '/tasks/3001',
    domain: 'tasks',
    field: '任务名称',
    placeholder: false,
    action: '保存配置',
    endpoint: '/tasks/3001',
  },
  {
    path: '/services/7001',
    domain: 'services',
    field: '服务名称',
    placeholder: false,
    action: '保存服务',
    endpoint: '/services/7001',
  },
]

for (const editor of editors) {
  test(
    editor.path + ' ' + editor.action + ' sends one request when clicks overlap validation',
    async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('jiuzhang.preference.session', 'demo')
        localStorage.setItem('jiuzhang.preference.role', 'admin')
      })
      await page.goto(editor.path + '/edit')
      const field = editor.placeholder
        ? page.getByPlaceholder(editor.field, { exact: true })
        : page.getByRole('textbox', { name: editor.field, exact: true })
      await expect(field).not.toHaveValue('')
      const name = '提交重入验收 ' + editor.domain
      await field.fill(name)
      const action = page.getByRole('button', { name: editor.action, exact: true })
      await expect(action).toBeEnabled()
      await page.evaluate(async (domain) => {
        const response = await fetch('/api/v1/demo/control', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-demo-role': 'admin' },
          body: JSON.stringify({ domain, scenario: 'slow' }),
        })
        if (!response.ok) throw new Error(await response.text())
      }, editor.domain)
      const writes: string[] = []
      const replies: number[] = []
      page.on('request', (request) => {
        if (
          request.method() !== 'GET' &&
          new URL(request.url()).pathname === '/api/v1' + editor.endpoint
        )
          writes.push(request.method())
      })
      page.on('response', (response) => {
        if (
          response.request().method() !== 'GET' &&
          new URL(response.url()).pathname === '/api/v1' + editor.endpoint
        )
          replies.push(response.status())
      })
      await action.evaluate((element) => {
        const button = element as HTMLButtonElement
        button.click()
        button.click()
        button.click()
      })
      if (editor.action === '模拟测试连接') {
        await expect(page.getByText('模拟检查通过，未访问真实服务', { exact: true })).toBeVisible()
        await expect(action).toBeEnabled()
        await expect(field).toHaveValue(name)
      } else {
        await expect(page).toHaveURL(editor.path)
        await expect(page.locator('h1')).toHaveText(name)
      }
      await expect.poll(() => replies.length).toBe(writes.length)
      expect(replies.every((status) => status >= 200 && status < 300)).toBe(true)
      expect(writes).toHaveLength(1)
    },
  )
}

import { expect, test } from '@playwright/test'

for (const resource of [
  { path: '/sources/1001', save: '保存' },
  { path: '/datasets/2001', save: '保存草稿' },
]) {
  test(
    resource.path + ' tags support keyboard editing, save, refresh and cancel',
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
      await page.goto(resource.path)
      await expect(page.locator('h1')).toBeVisible()
      const before = await page.evaluate(async (path) => {
        const response = await fetch('/api/v1' + path)
        if (!response.ok) throw new Error(await response.text())
        return ((await response.json()).data as { tags: string[] }).tags
      }, resource.path)
      await page.goto(resource.path + '/edit')
      const group = page.getByRole('group', { name: '标签', exact: true })
      const add = group.getByRole('button', { name: '添加标签', exact: true })
      await add.press('Enter')
      const input = group.getByRole('textbox', { name: '新标签', exact: true })
      await expect(input).toBeFocused()
      await input.fill('不要保存的标签')
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(add).toBeFocused()
      await expect(group.getByText('不要保存的标签', { exact: true })).toHaveCount(0)
      await add.press('Enter')
      await input.fill('键盘标签')
      await input.press('Enter')
      await expect(add).toBeFocused()
      await expect(group.getByText('键盘标签', { exact: true })).toBeVisible()
      if (before.length) {
        await group
          .getByRole('button', { name: '删除标签 ' + before[0], exact: true })
          .first()
          .press('Enter')
        await expect(
          group
            .getByRole('button', { name: '删除标签 ' + (before[1] ?? '键盘标签'), exact: true })
            .first(),
        ).toBeFocused()
      }
      await add.press('Enter')
      await input.fill('Tab标签')
      await input.press('Tab')
      await expect(input).toHaveCount(0)
      expect(await group.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      )
      await expect(group.getByText('Tab标签', { exact: true })).toBeVisible()
      await group.getByRole('button', { name: '删除标签 Tab标签', exact: true }).press('Enter')
      await add.press('Enter')
      await input.fill('键盘标签')
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
      await expect(input).toBeFocused()
      await input.press('Enter')
      await expect(group.getByText('键盘标签', { exact: true })).toHaveCount(2)
      await group
        .getByRole('button', { name: '删除标签 键盘标签', exact: true })
        .last()
        .press('Enter')
      await expect(group.getByText('键盘标签', { exact: true })).toHaveCount(1)
      const longTag = '长标签'.repeat(40)
      await add.press('Enter')
      await input.fill(longTag)
      await input.press('Enter')
      await expect(group.getByTitle(longTag, { exact: true })).toBeVisible()
      await page.setViewportSize({ width: 768, height: 1024 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
      await group.getByRole('button', { name: '删除标签 ' + longTag, exact: true }).press('Enter')
      const expected = [...before.slice(before.length ? 1 : 0), '键盘标签']
      await page.getByRole('button', { name: resource.save, exact: true }).click()
      await expect(page).toHaveURL(resource.path)
      await page.reload()
      await expect(page.locator('h1')).toBeVisible()
      const saved = await page.evaluate(async (path) => {
        const response = await fetch('/api/v1' + path)
        if (!response.ok) throw new Error(await response.text())
        return ((await response.json()).data as { tags: string[] }).tags
      }, resource.path)
      expect(saved).toEqual(expected)
      await page.goto(resource.path + '/edit')
      for (const tag of expected) await expect(group.getByText(tag, { exact: true })).toBeVisible()
      for (const tag of expected)
        await group
          .getByRole('button', { name: '删除标签 ' + tag, exact: true })
          .first()
          .press('Enter')
      await expect(add).toBeFocused()
      await add.press('Enter')
      await input.press('Enter')
      await expect(add).toBeFocused()
      await expect(group.getByRole('button', { name: /^删除标签 / })).toHaveCount(0)
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(page).toHaveURL(resource.path)
      await page.goto(resource.path + '/edit')
      for (const tag of expected) await expect(group.getByText(tag, { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: resource.save, exact: true })).toBeEnabled()
      await page.setViewportSize({ width: 768, height: 1024 })
      for (const theme of ['light', 'dark']) {
        if ((await page.evaluate(() => document.documentElement.style.colorScheme)) !== theme)
          await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
          .toBe(theme)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(768)
        await page.screenshot({
          path: 'test-results/tags-' + resource.path.split('/')[1] + '-' + theme + '.png',
          fullPage: true,
          animations: 'disabled',
        })
      }
      expect(errors).toEqual([])
    },
  )
}

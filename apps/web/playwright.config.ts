import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  workers: 1,
  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:5174',
        reuseExistingServer: false,
        timeout: 30000,
      }
    : undefined,
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../../work/console-test-results',
  use: {
    baseURL: process.env.CONSOLE_URL || 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'off',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: process.env.CONSOLE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
      },
})

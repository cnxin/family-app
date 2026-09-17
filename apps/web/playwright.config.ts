import { defineConfig, devices } from '@playwright/test';

// 新客户端的浏览器回归。默认打本机 dev server（5180，/api 代理到 8088 那套）；
// CI 和 `corepack pnpm test:web:next` 走 apps/api/scripts/run-web-tests.mjs --client web，
// 由它起隔离库 + 隔离 API，并把 FAMILY_WEB_URL / FAMILY_API_ORIGIN 指过来。
const baseURL = process.env.FAMILY_WEB_URL ?? 'http://localhost:5180';
const webPort = new URL(baseURL).port || '5180';
const authState = {
  mobile: 'e2e/.auth/mobile.json',
  desktop: 'e2e/.auth/desktop.json',
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL,
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      timeout: 60_000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        storageState: authState.mobile,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'desktop-chrome',
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authState.desktop,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `corepack pnpm exec vite --host localhost --port ${webPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

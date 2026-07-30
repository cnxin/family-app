import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.FAMILY_WEB_URL ?? 'http://localhost:8081';
const webPort = new URL(baseURL).port || '8081';
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
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command:
      `corepack pnpm exec expo start --web --host localhost --port ${webPort}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

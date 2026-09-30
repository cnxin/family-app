import { defineConfig, devices } from '@playwright/test';

// Web 客户端的浏览器回归。默认打本机 dev server（5180，/api 代理到 8088 那套）；
// CI 和 `corepack pnpm test:web` 走 apps/api/scripts/run-web-tests.mjs，
// 由它起隔离库 + 隔离 API，并把 FAMILY_WEB_URL / FAMILY_API_ORIGIN 指过来。
const baseURL = process.env.FAMILY_WEB_URL ?? 'http://localhost:5180';
const webPort = new URL(baseURL).port || '5180';
// 不安全上下文（教训 49）：家里人用局域网 IP 打开时，浏览器不给 crypto.randomUUID、navigator.clipboard。
// insecure.test 不在浏览器的可信名单里（只有 localhost / 127.0.0.1 / HTTPS 算安全），把它解析到本机，
// 就能在 CI 上复现「http://192.168.x.x」那种访问方式。
export const insecureURL = `http://insecure.test:${webPort}`;
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
      testIgnore: /insecure-context\.spec\.ts/,
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
      testIgnore: /insecure-context\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authState.desktop,
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'insecure-context',
      testMatch: /insecure-context\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: insecureURL,
        viewport: { width: 1280, height: 800 },
        // 直连：本机若开着系统代理（TUN），Chrome 会把 insecure.test 交给代理、拿回错误页
        launchOptions: { args: ['--host-resolver-rules=MAP insecure.test localhost', '--proxy-server=direct://', '--proxy-bypass-list=*'] },
      },
    },
  ],
  webServer: {
    command: `corepack pnpm exec vite --host localhost --port ${webPort} --strictPort`,
    url: baseURL,
    // 隔离跑（run-web-tests --client web）必须自己起 dev server：复用一个「恰好在这个端口上」
    // 的服务器会把 /api 代理到别的后端，表现出来是登录 401，很难查。本机手动跑时才允许复用。
    reuseExistingServer: !process.env.E2E_ISOLATED,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

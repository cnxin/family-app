import {
  expect,
  test as setup,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const authFiles = {
  mobile: resolve(process.cwd(), 'e2e/.auth/mobile.json'),
  desktop: resolve(process.cwd(), 'e2e/.auth/desktop.json'),
};
const apiURL = process.env.FAMILY_API_URL ?? 'http://127.0.0.1:3100';
const e2eLoginName = process.env.E2E_LOGIN_NAME ?? '爸爸';
const configuredPassword = process.env.E2E_ACCOUNT_PASSWORD;
const passwordCandidates =
  configuredPassword === undefined
    ? ['family1234', '']
    : [configuredPassword];

async function loginWithMouse(
  page: Page,
  request: APIRequestContext,
  authFile: string,
) {
  const apiHealth = await request.get(`${apiURL}/health/ready`);
  expect(apiHealth.ok(), `API 未就绪：${apiURL}`).toBeTruthy();

  await page.goto('/login');
  await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();

  const loginName = page.getByPlaceholder('输入账号');
  await expect(loginName).toBeVisible();
  await loginName.fill(e2eLoginName);

  const password = page.getByPlaceholder('输入密码');
  await expect(password).toBeVisible();

  const loginButton = page.getByRole('button', { name: '登录', exact: true });
  await expect(loginButton).toBeEnabled();

  let authenticated = false;
  for (const [index, candidate] of passwordCandidates.entries()) {
    await password.fill(candidate);
    await loginButton.click();
    try {
      await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname), {
        timeout: 5_000,
      });
      authenticated = true;
      break;
    } catch {
      if (index < passwordCandidates.length - 1) {
        await expect(loginButton).toBeEnabled();
      }
    }
  }
  expect(
    authenticated,
    '测试账号登录失败；已补设密码时请配置 E2E_ACCOUNT_PASSWORD',
  ).toBeTruthy();

  await expect(page).not.toHaveURL(/\/login$/);
  await expect(
    page.getByText('家庭今日概览', { exact: true }),
  ).toBeVisible();

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
}

setup('为移动视口使用鼠标登录', async ({ page, request }) => {
  await loginWithMouse(page, request, authFiles.mobile);
});

setup('为桌面视口使用鼠标登录', async ({ page, request }) => {
  await loginWithMouse(page, request, authFiles.desktop);
});

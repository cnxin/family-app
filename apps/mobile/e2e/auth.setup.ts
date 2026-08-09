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
  memberMobile: resolve(process.cwd(), 'e2e/.auth/member-mobile.json'),
  recoveryMobile: resolve(process.cwd(), 'e2e/.auth/recovery-mobile.json'),
};
const apiURL = process.env.FAMILY_API_URL ?? 'http://127.0.0.1:3100';
const managerLoginName = process.env.E2E_LOGIN_NAME ?? '爸爸';
const configuredPassword = process.env.E2E_ACCOUNT_PASSWORD;
const passwordCandidates =
  configuredPassword === undefined
    ? ['', 'family1234']
    : [configuredPassword];
const successfulPasswordByLoginName = new Map<string, string>();

async function loginWithMouse(
  page: Page,
  request: APIRequestContext,
  authFile: string,
  loginNameValue: string,
  expectedHomeText: string,
) {
  const apiHealth = await request.get(`${apiURL}/health/ready`);
  expect(apiHealth.ok(), `API 未就绪：${apiURL}`).toBeTruthy();

  await page.goto('/login');
  await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();

  const loginName = page.getByPlaceholder('输入账号');
  await expect(loginName).toBeVisible();
  await loginName.fill(loginNameValue);

  const password = page.getByPlaceholder('输入密码');
  await expect(password).toBeVisible();

  const loginButton = page.getByRole('button', { name: '登录', exact: true });
  await expect(loginButton).toBeEnabled();

  let authenticated = false;
  const failures: { status: number; body: string }[] = [];
  const cachedPassword = successfulPasswordByLoginName.get(loginNameValue);
  const candidates =
    cachedPassword === undefined
      ? passwordCandidates
      : [
          cachedPassword,
          ...passwordCandidates.filter((candidate) => candidate !== cachedPassword),
        ];
  for (const [index, candidate] of candidates.entries()) {
    await password.fill(candidate);
    const loginResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/auth/login',
    );
    await loginButton.click();
    const loginResponse = await loginResponsePromise;
    if (!loginResponse.ok()) {
      failures.push({
        status: loginResponse.status(),
        body: await loginResponse.text(),
      });
    }
    try {
      await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname), {
        timeout: 5_000,
      });
      authenticated = true;
      successfulPasswordByLoginName.set(loginNameValue, candidate);
      break;
    } catch {
      if (index < candidates.length - 1) {
        await expect(loginButton).toBeEnabled();
      }
    }
  }
  expect(
    authenticated,
    `测试账号登录失败；已补设密码时请配置 E2E_ACCOUNT_PASSWORD；失败响应=${JSON.stringify(failures)}`,
  ).toBeTruthy();

  await expect(page).not.toHaveURL(/\/login$/);
  await expect(
    page.getByText(expectedHomeText, { exact: true }),
  ).toBeVisible();

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
}

setup('为移动视口使用鼠标登录', async ({ page, request }) => {
  await loginWithMouse(
    page,
    request,
    authFiles.mobile,
    managerLoginName,
    '家庭工作台',
  );
});

setup('为桌面视口使用鼠标登录', async ({ page, request }) => {
  await loginWithMouse(
    page,
    request,
    authFiles.desktop,
    managerLoginName,
    '家庭工作台',
  );
});

setup('为普通成员移动视口使用鼠标登录', async ({ page, request }) => {
  await loginWithMouse(
    page,
    request,
    authFiles.memberMobile,
    '妈妈',
    '今日家庭工作台',
  );
});

setup('为鉴权恢复回归创建隔离登录状态', async ({ page, request }) => {
  await loginWithMouse(
    page,
    request,
    authFiles.recoveryMobile,
    managerLoginName,
    '家庭工作台',
  );
});

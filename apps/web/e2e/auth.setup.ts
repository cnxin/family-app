import { expect, test as setup, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { apiURL, authFiles, loginName, password, type Session } from './helpers';

/**
 * 登录接口有限流（本机 5 次/分钟），所以整套只在这里登录：
 * 爸爸走两次 UI 登录（手机 / 桌面各存一份 storageState），妈妈只走一次 API 登录。
 * 用例里再也不登录，直接读 sessions.json 里的令牌。
 */

async function loginWithMouse(page: Page, authFile: string) {
  const health = await page.request.get(`${apiURL}/health/ready`);
  expect(health.ok(), `API 未就绪：${apiURL}`).toBeTruthy();

  await page.goto('/login');
  await page.getByPlaceholder('输入账号').fill(loginName);
  await page.getByPlaceholder('输入密码').fill(password);

  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/auth/login'),
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const response = await loginResponse;
  expect(response.ok(), `登录响应 ${response.status()}：${await response.text()}`).toBeTruthy();

  // 登录后落到「今天」：标题是问候语 + 名字
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.locator('main h1')).toContainText(loginName);

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
  return ((await response.json()) as { data: Session }).data;
}

setup('手机视口登录', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await loginWithMouse(await context.newPage(), authFiles.mobile);
  await context.close();
});

setup('桌面视口登录，并给用例留好两个账号的 API 令牌', async ({ page, request }) => {
  const manager = await loginWithMouse(page, authFiles.desktop);
  const memberLogin = await request.post(`${apiURL}/auth/login`, {
    data: { loginName: '妈妈', password },
  });
  expect(memberLogin.ok(), `妈妈登录失败：${memberLogin.status()} ${await memberLogin.text()}`).toBeTruthy();
  const member = ((await memberLogin.json()) as { data: Session }).data;
  writeFileSync(
    authFiles.sessions,
    JSON.stringify({ [loginName]: manager, 妈妈: member }, null, 2),
  );
});

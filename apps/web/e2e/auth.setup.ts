import { expect, test as setup, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { apiURL, authFiles, loginName, password, type Session } from './helpers';

/**
 * 登录接口有限流（本机 5 次/分钟），所以整套只在这里登录：
 * 爸爸走两次 UI 登录（手机 / 桌面各存一份 storageState），妈妈只走一次 API 登录。
 * 用例里再也不登录，直接读 sessions.json 里的令牌。
 */

/** storageState 里的令牌还好使就别再走一遍登录页——本机限流 5 次/分钟，反复跑必撞 429。
 *  隔离跑每次都是新库，旧令牌必然失效，所以 CI 里照样会真的走一次登录页。 */
async function storedSession(request: APIRequestContext, authFile: string) {
  try {
    const state = JSON.parse(readFileSync(authFile, 'utf8')) as {
      origins: { localStorage: { name: string; value: string }[] }[];
    };
    for (const origin of state.origins) {
      const entry = origin.localStorage.find((item) => item.name === 'family-app.session');
      if (!entry) continue;
      const session = JSON.parse(entry.value) as Session;
      const probe = await request.get(`${apiURL}/members`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (probe.ok()) return session;
    }
  } catch {
    /* 没有产物或格式变了，重新登录就是 */
  }
  return null;
}

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

setup('手机视口登录', async ({ browser, request }) => {
  if (await storedSession(request, authFiles.mobile)) return;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await loginWithMouse(await context.newPage(), authFiles.mobile);
  await context.close();
});

/** 上一轮存下的令牌还能用就别再登一次——本机登录接口 5 次/分钟，反复跑很容易撞 429。 */
async function reusableSession(request: APIRequestContext, as: string) {
  try {
    const stored = JSON.parse(readFileSync(authFiles.sessions, 'utf8')) as Record<string, Session>;
    const session = stored[as];
    if (!session) return null;
    const probe = await request.get(`${apiURL}/members`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    return probe.ok() ? session : null;
  } catch {
    return null;
  }
}

setup('桌面视口登录，并给用例留好两个账号的 API 令牌', async ({ page, request }) => {
  const manager =
    (await storedSession(request, authFiles.desktop)) ?? (await loginWithMouse(page, authFiles.desktop));
  let member = await reusableSession(request, '妈妈');
  if (!member) {
    const memberLogin = await request.post(`${apiURL}/auth/login`, {
      data: { loginName: '妈妈', password },
    });
    expect(memberLogin.ok(), `妈妈登录失败：${memberLogin.status()} ${await memberLogin.text()}`).toBeTruthy();
    member = ((await memberLogin.json()) as { data: Session }).data;
  }
  writeFileSync(
    authFiles.sessions,
    JSON.stringify({ [loginName]: manager, 妈妈: member }, null, 2),
  );
});

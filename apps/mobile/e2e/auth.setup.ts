import { expect, test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const authFile = resolve(process.cwd(), 'e2e/.auth/member.json');
const apiURL = process.env.FAMILY_API_URL ?? 'http://127.0.0.1:3100';

setup('使用鼠标选择家庭成员并登录', async ({ page, request }) => {
  const apiHealth = await request.get(`${apiURL}/members`);
  expect(apiHealth.ok(), `API 未就绪：${apiURL}`).toBeTruthy();

  await page.goto('/login');
  await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();

  const memberButton = page
    .getByRole('button')
    .filter({ hasText: /爸爸|妈妈/ })
    .first();
  await expect(memberButton).toBeVisible();
  await memberButton.click();

  const enterButton = page.getByRole('button', {
    name: /以.+身份进入/,
  });
  await expect(enterButton).toBeEnabled();
  await enterButton.click();

  await expect(page).not.toHaveURL(/\/login$/);
  await expect(
    page.getByText('家庭今日概览', { exact: true }),
  ).toBeVisible();

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});

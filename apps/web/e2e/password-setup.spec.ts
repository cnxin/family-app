import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { watchPageErrors } from './helpers';

// C2 批 2：首次登录强制设密码。迁移来的老账号（没有 passwordHash）用登录名 + 空密码登录后只能看到「设个密码」，
// 换地址也进不去别的页；设好后进首页，之后用新密码登录。要往库里直接插账号：只在隔离库跑。
test.skip(
  process.env.E2E_ISOLATED !== '1' || !/^family_app_web_test_[a-f0-9]+$/.test(process.env.DB_NAME ?? ''),
  '要直接插账号，只在隔离浏览器测试库跑',
);
test.use({ storageState: { cookies: [], origins: [] } });

async function legacyAccount() {
  const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
  const { Client } = requireApi('pg');
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'family',
    password: process.env.DB_PASSWORD || 'family123',
    database: process.env.DB_NAME,
  });
  const household = randomUUID();
  const account = randomUUID();
  const loginName = `first-${account.slice(0, 8)}`;
  await db.connect();
  try {
    await db.query('INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)', [household, '设密码家庭', `first-${household}`]);
    await db.query('INSERT INTO accounts (id, "loginName", "loginNameNormalized") VALUES ($1, $2, $3)', [account, loginName, loginName]);
    await db.query(
      'INSERT INTO members (id, "householdId", "accountId", name, "avatarEmoji", role) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), household, account, '外婆', '外', 'owner'],
    );
  } finally {
    await db.end();
  }
  return loginName;
}

test('首次登录：空密码进来先设密码，别的页进不去；设好后进首页，之后用新密码登录', async ({ page }) => {
  const errors = watchPageErrors(page);
  const loginName = await legacyAccount();
  const password = 'grandma-password-2468';

  await page.goto('/');
  await page.getByPlaceholder('输入账号').fill(loginName);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设个密码' })).toBeVisible();
  await expect(page.getByText('外婆，这是你第一次登录')).toBeVisible();

  // 换地址也只看到设密码页
  await page.goto('/house/finance');
  await expect(page.getByRole('heading', { name: '设个密码' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await page.getByLabel('新密码', { exact: true }).fill('short');
  await page.getByLabel('再输一次新密码').fill('short');
  await page.getByRole('button', { name: '设好了' }).click();
  await expect(page.getByRole('alert')).toHaveText('至少 8 位');

  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByLabel('再输一次新密码').fill(password);
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/accounts/me/password');
  await page.getByRole('button', { name: '设好了' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '设个密码' })).toHaveCount(0);
  await expect(page.locator('main')).toBeVisible();

  // 退出后：空密码不行，新密码直接进首页
  await page.evaluate(() => localStorage.removeItem('family-app.session'));
  await page.goto('/');
  await page.getByPlaceholder('输入账号').fill(loginName);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('账号或密码不对');
  await page.getByPlaceholder('输入密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: '设个密码' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

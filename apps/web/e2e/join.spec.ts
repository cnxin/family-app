import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { apiClient, authFiles, stamp } from './helpers';

interface CreatedInvitation {
  id: string;
  invitationToken: string;
  memberName: string;
}

/** setup 阶段存下的完整会话（含 refreshToken 等），给 mock 的初始化响应用。 */
function storedSession(): unknown {
  const state = JSON.parse(readFileSync(authFiles.desktop, 'utf8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  for (const origin of state.origins) {
    const entry = origin.localStorage.find((item) => item.name === 'family-app.session');
    if (entry) return JSON.parse(entry.value);
  }
  throw new Error('storageState 里没有 family-app.session');
}

test.describe('还没有账号的人', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('打开 /join 邀请链接：看到是谁邀请、设登录名密码，加入后直接登录', async ({ page, request }) => {
    const admin = apiClient(request);
    const memberName = stamp('新家人');
    const invitation = await admin.post<CreatedInvitation>('/household/invitations', {
      memberName,
      avatarEmoji: '🧓',
      role: 'member',
      expiresInHours: 2,
    });
    let memberId: string | null = null;
    try {
      await page.goto(`/join?code=${encodeURIComponent(invitation.invitationToken)}`);
      const preview = page.locator('[data-invitation-preview]');
      await expect(preview).toContainText(memberName);
      // 邀请码读完就从地址栏抹掉
      await expect(page).toHaveURL(/\/join$/);

      const loginName = `join-${randomUUID().slice(0, 8)}`;
      await page.getByLabel('登录名（以后用它登录）').fill(loginName);
      await page.getByLabel('密码', { exact: true }).fill('short');
      await page.getByLabel('再输一次密码').fill('short');
      await page.getByRole('button', { name: '加入并登录' }).click();
      await expect(page.getByRole('alert')).toHaveText('密码至少 8 位');

      await page.getByLabel('密码', { exact: true }).fill('join-pass-1234');
      await page.getByLabel('再输一次密码').fill('join-pass-1234');
      const redeemed = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/auth/invitations/redeem'),
      );
      await page.getByRole('button', { name: '加入并登录' }).click();
      const response = await redeemed;
      expect(response.status()).toBe(201);
      memberId = ((await response.json()) as { data: { member: { id: string; name: string } } }).data.member.id;

      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('nav[aria-label="主导航"]:visible, nav[aria-label="功能导航"]:visible').first()).toBeVisible();
      const stored = await page.evaluate(() => localStorage.getItem('family-app.session'));
      expect(stored).toContain(memberName);
    } finally {
      if (memberId) await admin.patch(`/household/members/${memberId}/status`, { enabled: false });
      else await admin.delete(`/household/invitations/${invitation.id}`).catch(() => undefined);
    }
  });

  test('邀请码不对时说清楚用不了，不让往下填', async ({ page }) => {
    await page.goto(`/join?code=${'x'.repeat(48)}`);
    await expect(page.getByRole('alert')).toContainText('这个邀请码用不了');
    await expect(page.getByLabel('登录名（以后用它登录）')).toHaveCount(0);
  });

  test('登录页有加入入口；已有家庭时 /setup 只指路、不给初始化表单', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '用邀请码加入' }).click();
    await expect(page).toHaveURL(/\/join$/);
    await page.goto('/setup');
    await expect(page.locator('[data-setup-done]')).toContainText('已经建好了');
    await expect(page.getByLabel('初始化密钥')).toHaveCount(0);
  });

  test('服务器上还没有家庭：登录页引导到 /setup，建好后直接登录', async ({ page }) => {
    // 隔离库里已经有家庭，没法真的初始化；状态与初始化两个接口用 mock，响应借 setup 存下的真实会话。
    await page.route('**/api/auth/setup/status', (route) =>
      route.fulfill({ json: { data: { initialized: false } } }));
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/auth/setup/bootstrap', async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, json: { data: storedSession() } });
    });

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await page.getByLabel('初始化密钥').fill('bootstrap-secret-for-e2e');
    await page.getByLabel('家庭名').fill('测试之家');
    await page.getByLabel('家里怎么称呼你').fill('爸爸');
    await page.getByLabel('登录名').fill('dad-e2e');
    await page.getByLabel('密码').fill('setup-pass-1234');
    await page.getByRole('button', { name: '建立家庭并登录' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('nav[aria-label="主导航"]:visible, nav[aria-label="功能导航"]:visible').first()).toBeVisible();
    expect(body).toMatchObject({
      bootstrapSecret: 'bootstrap-secret-for-e2e',
      householdName: '测试之家',
      ownerName: '爸爸',
      loginName: 'dad-e2e',
      password: 'setup-pass-1234',
    });
    expect(typeof (body as unknown as { timezone?: unknown }).timezone).toBe('string');
  });
});

test('成员页生成邀请：给出可复制的 /join 链接和二维码', async ({ page, request }) => {
  const admin = apiClient(request);
  const memberName = stamp('待邀请');
  await page.goto('/house/members');
  await page.getByRole('button', { name: '+ 邀请成员' }).click();
  await page.getByLabel('邀请谁').fill(memberName);
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/household/invitations'),
  );
  await page.getByRole('button', { name: '生成邀请码' }).click();
  const invitation = ((await (await created).json()) as { data: CreatedInvitation }).data;
  try {
    const link = page.getByLabel('邀请链接');
    await expect(link).toContainText(`/join?code=${encodeURIComponent(invitation.invitationToken)}`);
    await expect(page.locator('[data-join-qr] svg')).toBeVisible();
    await expect(page.getByRole('button', { name: '复制邀请链接' })).toBeVisible();
  } finally {
    await admin.delete(`/household/invitations/${invitation.id}`);
  }
});

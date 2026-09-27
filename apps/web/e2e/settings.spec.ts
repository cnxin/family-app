import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, authFiles } from './helpers';

test.skip(process.env.E2E_ISOLATED !== '1', '家庭设置只在隔离库验收');

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), fullPage: false });
}

test('改成洛杉矶后，冻结时钟下今天按洛杉矶算', async ({ page, request }) => {
  const api = apiClient(request);
  await page.clock.install({ time: new Date('2026-09-27T06:00:00.000Z') });
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: /家庭时区/ }).click();
    const search = page.getByRole('dialog', { name: '家庭时区' }).getByLabel('搜索时区');
    await search.fill('Los_Angeles');
    const saved = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/households/me',
    );
    await page.locator('[id="tz-America/Los_Angeles"]').click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: /家庭时区/ })).toContainText(/洛杉矶|Los Angeles|Los_Angeles/);
    await page.goto('/');
    await expect(page.locator('main')).toContainText('9月26日');
  } finally {
    await api.patch('/households/me', { timezone: 'Asia/Shanghai' });
  }
});

test('普通成员能到达个人三处，设置页会跳走', async ({ page }) => {
  const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'] as unknown;
  await page.addInitScript((value) => {
    localStorage.setItem('family-app.session', JSON.stringify(value));
  }, session);
  await page.goto('/');
  await page.getByRole('link', { name: '个人设置', exact: true }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
  await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();

  await page.getByRole('link', { name: '消息接收偏好' }).click();
  await expect(page).toHaveURL(/\/schedule\/notifications$/);
  await expect(page.getByRole('tab', { name: '外部渠道' })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/me/profile');
  await page.getByRole('link', { name: '小管家渠道配对' }).click();
  const dialog = page.getByRole('dialog', { name: '小管家设置' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '消息渠道' })).toBeVisible();

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/me\/profile$/);
});

for (const theme of ['light', 'dark'] as const) {
  test(`家庭设置：${theme}`, async ({ page, isMobile }) => {
    await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: /家庭时区/ })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await shot(page, `f7-${isMobile ? '390x844' : '1280x800'}-${theme}.png`);
  });
}

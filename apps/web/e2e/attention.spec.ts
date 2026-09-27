import { expect, test, type Page } from '@playwright/test';
import { addDays, householdToday } from '@family/shared';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectNoHorizontalOverflow, stamp, watchPageErrors } from './helpers';
import { attentionHousehold, insertOfflineBackup } from './attention-household';

const today = () => householdToday('Asia/Shanghai');

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

test('造一件 3 天后要维护的资产，做完后卡片消失', async ({ page, request }) => {
  const household = await attentionHousehold(page, request);
  const due = addDays(today(), 3);
  const name = stamp('留意资产');
  const asset = await household.api.post<{ id: string }>('/assets', { name, category: 'appliance' });
  const plan = await household.api.post<{ id: string }>(`/assets/${asset.id}/maintenance-plans`, {
    title: '更换滤芯', frequencyDays: 30, nextDueDate: due,
  });
  await page.goto('/');
  const section = page.locator('[data-today-attention]');
  await expect(section).toContainText('3 天后该换了');
  await expect(section.getByRole('link', { name: '看这件资产' })).toHaveAttribute('href', `/house/assets/${asset.id}`);
  await section.getByRole('link', { name: '看这件资产' }).click();
  await expect(page).toHaveURL(new RegExp(`/house/assets/${asset.id}$`));
  await page.getByRole('button', { name: '完成维护' }).click();
  const completion = page.getByRole('dialog', { name: '确认完成维护' });
  await expect(completion.getByLabel('实际完成日期')).toHaveValue(today());
  const completed = page.waitForResponse((response) => response.url().includes(`/maintenance-plans/${plan.id}/complete`));
  await completion.getByRole('button', { name: '确认完成并推进日期' }).click();
  expect((await completed).status()).toBe(201);
  await page.goto('/');
  await expect(page.locator('[data-today-attention]')).toHaveCount(0);
});

test('稍后只藏当前成员，换成员刷新后仍看得到', async ({ page, request }) => {
  const household = await attentionHousehold(page, request);
  const name = stamp('稍后资产');
  const asset = await household.api.post<{ id: string }>('/assets', { name, category: 'appliance' });
  await household.api.post(`/assets/${asset.id}/maintenance-plans`, {
    title: '稍后维护', frequencyDays: 30, nextDueDate: addDays(today(), 2),
  });
  await page.goto('/');
  const section = page.locator('[data-today-attention]');
  await expect(section).toContainText(name);
  await section.getByRole('button', { name: '稍后' }).click();
  await page.reload();
  await expect(page.locator('[data-today-attention]')).toHaveCount(0);
  await household.asMember();
  await expect(page.locator('[data-today-attention]')).toContainText(name);
});

test('普通成员看不到备份和兑换审批', async ({ page, request }) => {
  const household = await attentionHousehold(page, request);
  const reward = await household.api.post<{ id: string }>('/rewards', { name: stamp('审批奖励'), cost: 1 });
  await household.api.post('/points/adjustments', {
    memberId: household.owner.memberId, delta: 5, note: 'e2e', idempotencyKey: `e2e-points-${Date.now()}`,
  });
  await household.api.post(`/rewards/${reward.id}/redemptions`, { idempotencyKey: `e2e-redeem-${Date.now()}` });
  await insertOfflineBackup(household.owner.householdId);
  await page.goto('/');
  const section = page.locator('[data-today-attention]');
  await expect(section.getByRole('link', { name: '去审批' })).toBeVisible();
  await expect(section.getByRole('link', { name: '看备份' })).toBeVisible();
  await household.asMember();
  await expect(page.locator('[data-today-attention]').getByRole('link', { name: '去审批' })).toHaveCount(0);
  await expect(page.locator('[data-today-attention]').getByRole('link', { name: '看备份' })).toHaveCount(0);
});

test('收起资产后留意卡消失', async ({ page, request }) => {
  const household = await attentionHousehold(page, request);
  const name = stamp('收起资产');
  const asset = await household.api.post<{ id: string }>('/assets', { name, category: 'appliance' });
  await household.api.post(`/assets/${asset.id}/maintenance-plans`, {
    title: '收起维护', frequencyDays: 30, nextDueDate: today(),
  });
  await page.goto('/');
  await expect(page.locator('[data-today-attention]')).toContainText(name);
  await household.api.patch('/system/modules/assets', { override: 'off' });
  await page.reload();
  await expect(page.locator('[data-today-attention]')).toHaveCount(0);
});

test('来访当天没有菜品就出卡，加上一道菜并点进那一顿', async ({ page, request }) => {
  const household = await attentionHousehold(page, request);
  const due = addDays(today(), 3);
  const title = stamp('来访');
  const guest = await household.api.post<{ id: string }>('/guests', { name: stamp('客人') });
  await household.api.post('/visits', { title, startsAt: `${due}T02:00:00.000Z`, guestIds: [guest.id] });
  await page.goto('/');
  const section = page.locator('[data-today-attention]');
  await expect(section).toContainText(title);
  await section.getByRole('link', { name: '去点菜' }).click();
  await expect(page).toHaveURL(/\/eat\/order$/);
  await expect(page.getByLabel('选择日期')).toHaveValue(due);
  await expect(page.getByRole('button', { name: '晚餐', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const menu = await household.api.get<{ id: string }>(`/menus?date=${due}&mealType=dinner`);
  const dish = await household.api.post<{ id: string }>('/dishes', { name: stamp('来访菜'), category: '荤菜' });
  await household.api.post(`/menus/${menu.id}/items`, { items: [{ dishId: dish.id }] });
  await page.goto('/');
  await expect(page.locator('[data-today-attention]')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`今天页至少两张留意卡：${theme}`, async ({ page, isMobile }) => {
    test.setTimeout(60_000);
    await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
    const errors = watchPageErrors(page);
    await page.goto('/');
    const cards = page.locator('[data-attention-card]');
    await expect(cards.nth(1)).toBeVisible();
    await cards.first().scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    await shot(page, `f5-${isMobile ? '390x844' : '1280x800'}-${theme}.png`);
    expect(errors).toEqual([]);
  });
}

test('桌面没有留意卡时右栏不存在，左栏和主区一样宽', async ({ page, isMobile, request }) => {
  test.skip(isMobile, '只看桌面');
  await attentionHousehold(page, request);
  await page.goto('/');
  await expect(page.locator('[data-today-attention]')).toHaveCount(0);
  const widths = await page.evaluate(() => {
    const layout = document.querySelector('[data-today-layout]')?.getBoundingClientRect().width ?? 0;
    const main = document.querySelector('[data-today-main]')?.getBoundingClientRect().width ?? -1;
    return { layout, main };
  });
  expect(widths.main).toBeGreaterThan(0);
  expect(Math.abs(widths.layout - widths.main)).toBeLessThanOrEqual(1);
  await shot(page, 'f5-1280x800-no-attention.png');
});

import { expect, test } from '@playwright/test';
import { addDays, householdToday } from '@family/shared';
import { apiClient, stamp } from './helpers';

/** 和后端 addMonths 同一个口径：月底日期落到目标月的最后一天。 */
function addMonths(value: string, months: number) {
  const source = new Date(`${value}T00:00:00.000Z`);
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );
}

test('订阅资产：列表显示下次续费，详情里标记已续费后顺延一个月', async ({ page, request }) => {
  const api = apiClient(request);
  const name = stamp('订阅');
  // 「几天后」按家庭日期算；CI 机器是 UTC，按机器日期会在上海凌晨差一天
  const renewsOn = addDays(householdToday('Asia/Shanghai'), 7);
  const next = addMonths(renewsOn, 1);
  const asset = await api.post<{ id: string }>('/assets', {
    name,
    category: 'subscription',
    renewsOn,
    renewalIntervalMonths: 1,
  });

  try {
    await page.goto('/house/assets');
    // 资产卡片说「下次续费 · 7 天后」；14 天内要续的订阅同时进「临近事项」
    const card = page.getByRole('link', { name: new RegExp(`${name} 订阅 下次续费`) });
    await expect(card).toContainText('下次续费 · 7 天后');
    await expect(page.getByRole('link', { name: `${name} 续费 7 天后` })).toBeVisible();

    await card.click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText(`下次续费：${dateLabel(renewsOn)} · 每月`)).toBeVisible();

    await page.getByRole('button', { name: '标记已续费' }).click();
    const dialog = page.getByRole('dialog', { name: '确认已经续费' });
    await expect(dialog).toContainText(`「${name}」已经续过费了？`);
    const renewed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/assets/${asset.id}/renew`),
    );
    await dialog.getByRole('button', { name: '标记已续费' }).click();
    const response = await renewed;
    expect(response.status(), await response.text()).toBe(201);
    expect(((await response.json()) as { data: { renewsOn: string } }).data.renewsOn).toBe(next);

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: `已记下这次续费，下次是 ${dateLabel(next)}` })).toBeVisible();
    await expect(page.getByText(`下次续费：${dateLabel(next)} · 每月`)).toBeVisible();
    expect((await api.get<{ renewsOn: string }>(`/assets/${asset.id}`)).renewsOn).toBe(next);
  } finally {
    await api.patch(`/assets/${asset.id}`, { status: 'retired' });
  }
});

test('订阅资产：填「每次续费金额」后，财务概览的固定支出按它折算', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '桌面验一次');
  const api = apiClient(request);
  const name = stamp('季付会员');
  const asset = await api.post<{ id: string }>('/assets', {
    name,
    category: 'subscription',
    purchaseDate: householdToday('Asia/Shanghai'),
    purchasePrice: 90,
    renewsOn: addDays(householdToday('Asia/Shanghai'), 30),
    renewalIntervalMonths: 3,
  });
  const assetsMonthly = async () =>
    (await api.get<{ fixedCosts: { assets: number } }>('/finance/summary')).fixedCosts.assets;
  const yuan = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  try {
    const byPurchase = await assetsMonthly();
    await page.goto(`/house/assets/${asset.id}`);
    await page.getByRole('button', { name: '编辑' }).click();
    const form = page.getByRole('dialog', { name: `编辑「${name}」` });
    await expect(form.getByLabel('每次续费金额')).toHaveAttribute('placeholder', '不填就按购买价 90');
    await form.getByLabel('每次续费金额').fill('120');
    const saved = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/assets/${asset.id}`),
    );
    await form.getByRole('button', { name: '保存资产' }).click();
    expect((await saved).status(), await (await saved).text()).toBe(200);
    await expect(form).toBeHidden();
    await expect(page.getByText('每次续费')).toBeVisible();
    await expect(page.getByText('¥120')).toBeVisible();

    // 季付 120 折每月 40，比按购买价 90（每月 30）多 10
    const expected = Math.round((byPurchase + 10) * 100) / 100;
    expect(await assetsMonthly()).toBe(expected);
    await page.goto('/house/finance');
    await expect(page.getByText(`资产续费 ${yuan(expected)}`)).toBeVisible();
  } finally {
    await api.patch(`/assets/${asset.id}`, { status: 'retired' });
  }
});

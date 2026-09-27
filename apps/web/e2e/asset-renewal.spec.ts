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

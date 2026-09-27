import { expect, test, type Page } from '@playwright/test';

function waitForDelivery(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/agent/routines/nightly_digest/delivery'),
  );
}

test('个人：管理员切换「主动提醒」（夜间汇总推送），再切回来', async ({ page }) => {
  await page.goto('/me/profile');
  const toggle = page.getByRole('checkbox', { name: '主动提醒' });
  // 设置和例行任务两个版本号都读到之后才可点；读不到就是隔离库里缺例行任务，这里直接失败
  await expect(toggle).toBeEnabled();
  await expect(page.getByText(/^每天 \d{2}:\d{2} 汇总临期订阅、药品和家里的待办$/)).toBeVisible();
  const before = await toggle.getAttribute('aria-checked');
  const flipped = before === 'true' ? 'false' : 'true';

  const first = waitForDelivery(page);
  await toggle.click();
  const firstResponse = await first;
  expect(firstResponse.status(), await firstResponse.text()).toBe(200);
  expect(firstResponse.request().postDataJSON()).toMatchObject({ enabled: flipped === 'true' });
  await expect(toggle).toHaveAttribute('aria-checked', flipped);
  await expect(toggle).toBeEnabled();

  // 刷新之后仍是新状态：不是只改了本地显示
  await page.reload();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', flipped);

  const back = waitForDelivery(page);
  await toggle.click();
  const backResponse = await back;
  expect(backResponse.status(), await backResponse.text()).toBe(200);
  await expect(toggle).toHaveAttribute('aria-checked', before ?? 'false');
});

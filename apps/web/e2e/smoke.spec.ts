import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, watchPageErrors } from './helpers';

/**
 * 已搬到新客户端的页面。每搬一页在这里加一行——这是全套回归里最便宜、也最先发现
 * 「改了共享组件把别的页弄坏了」的那一层。
 */
export const READY_PAGES: { path: string; title: RegExp | string }[] = [
  { path: '/', title: /好，/ },
  { path: '/eat/order', title: '点菜' },
  { path: '/eat/kitchen', title: '菜单安排' },
  { path: '/eat/recipes', title: '菜谱' },
  { path: '/eat/shopping', title: '购物清单' },
  { path: '/eat/inventory', title: '家庭库存' },
  { path: '/schedule/calendar', title: '家庭日历' },
  { path: '/schedule/tasks', title: '家庭任务' },
  { path: '/schedule/reminders', title: '提醒中心' },
  { path: '/schedule/notifications', title: '消息' },
  { path: '/schedule/polls', title: '家庭投票' },
  { path: '/house/points', title: '积分奖励' },
  { path: '/house/members', title: '家庭成员' },
  { path: '/house/guests', title: '访客' },
  { path: '/house/assets', title: '家庭资产' },
  { path: '/me/profile', title: '我的' },
  { path: '/me/assistant', title: '问问小管家' },
  { path: '/me/assistant/memories', title: '小管家的记忆' },
];

for (const target of READY_PAGES) {
  test(`${target.path} 能渲染、无运行期错误、不横向溢出`, async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto(target.path);
    await expect(page.locator('main h1')).toHaveText(target.title);
    // 等首屏数据回来再量尺寸，骨架屏和真实内容宽度可能不一样
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
    expect(errors, '页面抛了运行期错误').toEqual([]);
  });
}

test('没搬的分段落到桥接页，并给出旧版入口', async ({ page }) => {
  await page.goto('/house/knowledge');
  const legacy = page.locator('main').getByRole('link', { name: /旧版/ });
  await expect(legacy).toBeVisible();
  await expect(legacy).toHaveAttribute('href', /\/knowledge$/);
});

test('旧的一层路径会跳到新位置', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/schedule\/tasks$/);
});

test('切换深色模式后页面仍可读', async ({ page }) => {
  await page.goto('/schedule/tasks');
  await page.getByRole('button', { name: '切换到深色' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const colors = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { bg: body.backgroundColor, fg: body.color };
  });
  expect(colors.bg).not.toBe(colors.fg);
  await page.getByRole('button', { name: '切换到浅色' }).first().click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
});

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
  { path: '/house/shopping', title: '购物清单' },
  { path: '/house/inventory', title: '家庭库存' },
  { path: '/schedule/calendar', title: '家庭日历' },
  { path: '/schedule/tasks', title: '家庭任务' },
  { path: '/schedule/reminders', title: '提醒中心' },
  { path: '/schedule/notifications', title: '消息' },
  { path: '/schedule/polls', title: '家庭投票' },
  { path: '/house/points', title: '积分奖励' },
  { path: '/house/members', title: '家庭成员' },
  { path: '/house/guests', title: '访客' },
  { path: '/house/assets', title: '家庭资产' },
  { path: '/house/finance', title: '家庭财务' },
  { path: '/life/knowledge', title: '家庭知识库' },
  { path: '/life/memories', title: '家庭回忆' },
  { path: '/life/travel', title: '家庭出行' },
  { path: '/house/backups', title: '系统备份' },
  { path: '/life/activity', title: '家庭动态' },
  { path: '/life/media', title: '家庭观影' },
  { path: '/life/media/library', title: '我的媒体库' },
  { path: '/life/media/history', title: '观看记录' },
  { path: '/life/media/watchlist', title: '家庭片单' },
  { path: '/life/media/settings', title: '观影设置' },
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

/**
 * 页面整体不横向滚动，不等于卡片里的东西没撑破卡片——首页三餐卡里那排菜品小图
 * 就这么溢出过 11px（四个固定 48px 的方块比卡片能用的宽度还宽），而整页并不溢出。
 * 所以这里逐个卡片量一遍。
 */
test('首页：卡片里没有元素撑破自己的边框', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('main a, main article, main section > div').forEach((card) => {
      const box = card.getBoundingClientRect();
      if (!box.width) return;
      card.querySelectorAll('*').forEach((child) => {
        const inner = child.getBoundingClientRect();
        if (inner.width && (inner.right > box.right + 0.5 || inner.left < box.left - 0.5)) {
          out.push(
            `${card.textContent?.slice(0, 12)} 里的 ${child.tagName} 超出 ${Math.round(inner.right - box.right)}px`,
          );
        }
      });
    });
    return out;
  });
  expect(bad, '有元素画到了卡片外面').toEqual([]);
});

// 分段已经全部搬完，桥接页只剩「认不出来的分段」这一个分支了
test('认不出来的分段给一句人话，不是白屏', async ({ page }) => {
  await page.goto('/house/nope');
  await expect(page.getByRole('heading', { name: '没有这一页' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: '回今天' })).toBeVisible();
});

test('旧的一层路径会跳到新位置', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/schedule\/tasks$/);
});

test('切换深色模式后页面仍可读', async ({ page, isMobile }) => {
  await page.goto('/schedule/tasks');
  // 手机上主题开关收进了头像菜单（「我的」不再占一个底部标签）
  if (isMobile) await page.getByRole('button', { name: '账号与设置' }).click();
  await page.getByRole('button', { name: '切换到深色' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const colors = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { bg: body.backgroundColor, fg: body.color };
  });
  expect(colors.bg).not.toBe(colors.fg);
  if (isMobile) await page.getByRole('button', { name: '账号与设置' }).click();
  await page.getByRole('button', { name: '切换到浅色' }).first().click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
});

import { expect, test } from '@playwright/test';

/**
 * 导航壳：桌面侧栏、手机底部 tab 的气泡菜单、⌘K。
 * 这些是所有页面共用的，坏了等于全站坏了，所以单独盯着。
 */

test('桌面侧栏：展开场景并跳到分段', async ({ page, isMobile }) => {
  test.skip(isMobile, '侧栏只在桌面宽度出现');
  await page.goto('/');
  const sidebar = page.getByRole('navigation', { name: '功能导航' });
  await sidebar.getByRole('button', { name: /日程/ }).click();
  await expect(page).toHaveURL(/\/schedule\/calendar$/);
  await sidebar.getByRole('link', { name: '提醒', exact: true }).click();
  await expect(page).toHaveURL(/\/schedule\/reminders$/);
  await expect(page.locator('main h1')).toHaveText('提醒中心');
});

test('手机底部 tab：按下弹出气泡，选分段后跳转并收起', async ({ page, isMobile }) => {
  test.skip(!isMobile, '底部 tab 只在手机宽度出现');
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: '主导航' });
  await tabs.getByRole('button', { name: /家里/ }).dispatchEvent('pointerdown');
  const menu = page.getByRole('menu', { name: '家里的功能' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: '库存', exact: true }).click();
  await expect(page).toHaveURL(/\/house\/inventory$/);
  await expect(menu).toBeHidden();
  await expect(page.locator('main h1')).toHaveText('家庭库存');
});

test('手机底部 tab：没有分段的场景直接跳转', async ({ page, isMobile }) => {
  test.skip(!isMobile, '底部 tab 只在手机宽度出现');
  await page.goto('/schedule/tasks');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /今天/ })
    .dispatchEvent('pointerdown');
  await expect(page).toHaveURL(/\/$/);
});

test('⌘K：输入页面名回车跳转', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) {
    await page.getByRole('button', { name: '快速跳转' }).click();
  } else {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  }
  const input = page.getByRole('textbox', { name: '搜索页面或菜品' });
  await expect(input).toBeVisible();
  await input.fill('购物');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/house\/shopping$/);
  await expect(input).toBeHidden();
});

test('场景根路径落到第一个已搬的分段', async ({ page }) => {
  await page.goto('/eat');
  await expect(page).toHaveURL(/\/eat\/order$/);
  await page.goto('/schedule');
  await expect(page).toHaveURL(/\/schedule\/calendar$/);
  await page.goto('/house');
  await expect(page).toHaveURL(/\/house\/inventory$/);
  await page.goto('/life');
  await expect(page).toHaveURL(/\/life\/media$/);
});

test('重分类之前的路径还能打开（家里人存的链接不能废）', async ({ page }) => {
  await page.goto('/eat/inventory');
  await expect(page).toHaveURL(/\/house\/inventory$/);
  await page.goto('/eat/media/watchlist');
  await expect(page).toHaveURL(/\/life\/media\/watchlist$/);
  await page.goto('/me/activity');
  await expect(page).toHaveURL(/\/life\/activity$/);
});

test('中间那个大按钮就是「今天」，左右各两个', async ({ page, isMobile }) => {
  test.skip(!isMobile, '底部 tab 只在手机宽度出现');
  await page.goto('/schedule/tasks');
  const tabs = page.getByRole('navigation', { name: '主导航' }).getByRole('button');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.nth(0)).toContainText('吃饭');
  await expect(tabs.nth(1)).toContainText('日程');
  await expect(tabs.nth(2)).toContainText('今天');
  await expect(tabs.nth(3)).toContainText('家里');
  await expect(tabs.nth(4)).toContainText('生活');
});

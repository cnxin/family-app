import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { authFiles, expectNoHorizontalOverflow } from './helpers';

const coreLabels = ['今天', '点菜', '厨房', '购物', '日历', '任务', '消息'];
const shelf = [
  ['菜谱', '/eat/recipes'], ['库存', '/house/inventory'], ['提醒', '/schedule/reminders'],
  ['投票', '/schedule/polls'], ['积分', '/house/points'], ['观影', '/life/media'],
  ['资产', '/house/assets'], ['财务', '/house/finance'], ['访客', '/house/guests'],
  ['出行', '/life/travel'], ['知识库', '/life/knowledge'], ['回忆', '/life/memories'],
  ['家庭动态', '/life/activity'], ['问问小管家', '/me/assistant'],
];

async function search(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: '快速跳转', exact: true }).click();
  else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const input = page.getByRole('textbox', { name: '搜索页面或菜品' });
  await expect(input).toBeVisible();
  return input;
}

test('桌面侧栏：七项平铺，设置和头像在底部', async ({ page, isMobile }) => {
  test.skip(isMobile, '侧栏只在桌面出现');
  await page.goto('/');
  const sidebar = page.getByRole('navigation', { name: '功能导航' });
  await expect(sidebar.getByRole('link')).toHaveCount(coreLabels.length);
  for (const [index, label] of coreLabels.entries()) {
    await expect(sidebar.getByRole('link').nth(index)).toHaveAccessibleName(label);
  }
  await expect(sidebar.getByRole('button')).toHaveCount(0);
  await expect(sidebar.getByText('我钉住的')).toHaveCount(0);
  await sidebar.getByRole('link', { name: '任务', exact: true }).click();
  await expect(page).toHaveURL(/\/schedule\/tasks$/);
  await expect(sidebar.getByRole('link', { name: '任务', exact: true })).toHaveAttribute('aria-current', 'page');
  const footer = page.getByRole('navigation', { name: '家庭与设置' });
  await footer.getByRole('link', { name: '家里（全部功能）', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('main h1')).toHaveText('家里');
  await footer.getByRole('link', { name: '家庭设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('main h1')).toHaveText('家庭设置');
  await page.locator('aside').getByRole('link', { name: '个人设置', exact: true }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
});

test('手机四项等宽；吃饭与日程只留 core，购物仍用原路径', async ({ page, isMobile }) => {
  test.skip(!isMobile, '底部 tab 只在手机出现');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '主导航' });
  const tabs = nav.getByRole('button');
  await expect(tabs).toHaveCount(4);
  for (const [index, label] of ['今天', '吃饭', '日程', '家里'].entries()) {
    await expect(tabs.nth(index)).toHaveAccessibleName(label);
  }
  const boxes = await tabs.evaluateAll((nodes) => nodes.map((node) => {
    const { width, height, top } = node.getBoundingClientRect();
    return { width, height, top };
  }));
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeCloseTo(boxes[0].width, 1);
    expect(box.top).toBe(boxes[0].top);
  }
  await nav.getByRole('button', { name: '吃饭', exact: true }).dispatchEvent('pointerdown');
  const eat = page.getByRole('menu', { name: '吃饭的功能' });
  await expect(eat.getByRole('link')).toHaveText(['点菜', '厨房', '购物']);
  await eat.getByRole('link', { name: '购物', exact: true }).click();
  await expect(page).toHaveURL(/\/house\/shopping$/);
  await expect(eat).toBeHidden();
  await expect(nav.getByRole('button', { name: '吃饭', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: '日程', exact: true }).dispatchEvent('pointerdown');
  const schedule = page.getByRole('menu', { name: '日程的功能' });
  await expect(schedule.getByRole('link')).toHaveText(['日历', '任务', '消息']);
  await schedule.getByRole('link', { name: '消息', exact: true }).click();
  await expect(page).toHaveURL(/\/schedule\/notifications$/);
  await expect(schedule).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('手机今天与家里按下直达，键盘也能导航；今天头像是个人入口', async ({ page, isMobile }) => {
  test.skip(!isMobile, '手机导航');
  await page.goto('/schedule/tasks');
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(page.getByRole('link', { name: '个人设置', exact: true })).toBeHidden();
  await nav.getByRole('button', { name: '家里', exact: true }).dispatchEvent('pointerdown');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await nav.getByRole('button', { name: '今天', exact: true }).dispatchEvent('pointerdown');
  await expect(page).toHaveURL(/\/$/);
  await page.locator('main').getByRole('link', { name: '个人设置', exact: true }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  await nav.getByRole('button', { name: '家里', exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/home$/);
  await nav.getByRole('button', { name: '吃饭', exact: true }).press('Space');
  await expect(page.getByRole('menu', { name: '吃饭的功能' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
});

test('⌘K：所有 shelf 均可搜索到并打开，个人设置也保留', async ({ page, isMobile }) => {
  await page.goto('/');
  for (const [name, path] of [...shelf, ['个人设置', '/me/profile']]) {
    const input = await search(page, isMobile);
    await input.fill(name);
    await expect(page.getByRole('dialog', { name: '快速跳转' }).getByRole('button').first()).toContainText(name);
    await input.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(input).toBeHidden();
  }
});

test('旧场景根路径保留各自落点；叶子路径与旧深链保持兼容', async ({ page }) => {
  const roots = [
    ['/eat', '/eat/order'], ['/schedule', '/schedule/calendar'],
    ['/house', '/home'], ['/me', '/home'], ['/life', '/life/media'],
  ];
  for (const [from, to] of roots) {
    await page.goto(`${from}?from=legacy`);
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(`${to}?from=legacy`);
    await expect(page.locator('main h1')).toBeVisible();
  }
  const aliases = [
    ['/eat/shopping?date=2026-09-20', '/house/shopping?date=2026-09-20'],
    ['/eat/inventory', '/house/inventory'],
    ['/eat/media/watchlist?filter=all', '/life/media/watchlist?filter=all'],
    ['/me/activity', '/life/activity'],
  ];
  for (const [from, to] of aliases) {
    await page.goto(from);
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(to);
  }
});

test('普通成员：保留本人设置与小管家，导航/搜索不暴露管理员入口', async ({ page, isMobile }) => {
  const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'];
  await page.addInitScript((value) => {
    localStorage.setItem('family-app.session', JSON.stringify(value));
  }, session);
  await page.goto('/');
  await expect(page.locator('main h1')).toContainText('妈妈');
  await expect(page.getByRole('navigation', { name: '家庭与设置' }).getByRole('link', { name: '家庭设置', exact: true })).toHaveCount(0);
  const input = await search(page, isMobile);
  for (const name of ['财务', '成员', '备份']) {
    await input.fill(name);
    await expect(page.getByRole('dialog', { name: '快速跳转' }).getByRole('button')).toHaveCount(0);
  }
  await input.fill('问问小管家');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/me\/assistant$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/home$/);
  const profile = await search(page, isMobile);
  await profile.fill('个人设置');
  await profile.press('Enter');
  await expect(page).toHaveURL(/\/me\/profile$/);
});

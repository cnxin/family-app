import { SHELF_MODULE_KEYS } from '@family/contracts';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { authFiles, expectNoHorizontalOverflow, watchPageErrors } from './helpers';

// F2 结构 / 预取回归保持全功能可见；F4 状态变化在 modules.spec.ts 用真实空家庭验收。
test.beforeEach(async ({ page }) => {
  await page.route('**/api/system/modules', (route) => route.fulfill({ json: {
    data: { modules: SHELF_MODULE_KEYS.map((key) => ({ key, hasData: true, override: null })) },
  } }));
});

const homeNavigation = (page: Page, mobile: boolean) => mobile
  ? page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '家里', exact: true })
  : page.getByRole('navigation', { name: '家庭与设置' }).getByRole('link', { name: '家里（全部功能）', exact: true });

async function asMember(page: Page) {
  const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'];
  await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
}


function watchRequests(page: Page) {
  const paths: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) paths.push(url.pathname + url.search);
  });
  return paths;
}

test('家里冷启动：14 个 shelf、无状态伪零，也不逐图块拉列表', async ({ page }) => {
  const paths = watchRequests(page);
  await page.goto('/home');
  await expect(page.locator('main h1')).toHaveText('家里');
  await expect(page.getByRole('heading', { name: '家里在用的' })).toBeVisible();
  await expect(page.locator('[data-home-grid] a')).toHaveCount(14);
  await expect(page.locator('[data-home-status]').first()).toBeVisible();
  for (const text of await page.locator('[data-home-status]').allTextContents()) {
    expect(text.trim()).not.toMatch(/已载入|^\d+$/);
  }
  await expect(page.getByRole('button', { name: '编辑置顶' })).toBeVisible();
  await expect(page.getByText('还可以开启', { exact: true })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  // 外壳还会读未读数；状态行只来自留意，不逐图块拉列表。
  expect([...new Set(paths)].sort()).toEqual(['/api/notifications', '/api/system/modules', '/api/today/attention']);
  await page.locator('main').getByRole('link', { name: '家庭设置', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('家里点资产到规范路径；异步预取成功后也不展示载入计数', async ({ page }) => {
  await page.goto('/home');
  const tile = page.locator('[data-home-grid]').getByRole('link', { name: '资产', exact: true });
  await expect(tile.locator('[data-home-status]')).toBeVisible();
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/assets');
  await tile.hover();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(Array.isArray((await response.json()).data)).toBe(true);
  await expect(tile.locator('[data-home-status]')).not.toHaveText(/已载入|^\d+$/);
  await tile.click();
  await expect(page).toHaveURL(/\/house\/assets$/);
  await expect(page.locator('main h1')).toHaveText('家庭资产');
});

test('家里搜索条复用快速跳转，搜索资产仍可直达', async ({ page }) => {
  await page.goto('/home');
  await page.locator('main').getByRole('button', { name: '搜索功能', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快速跳转' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox');
  await input.fill('资产');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/house\/assets$/);
});

test('从菜谱回家里不展示缓存计数，也不补发菜谱请求', async ({ page, isMobile }) => {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/recipes');
  await page.goto('/eat/recipes');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(Array.isArray((await response.json()).data)).toBe(true);
  await page.waitForLoadState('networkidle');
  const paths = watchRequests(page);
  await homeNavigation(page, isMobile).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('link', { name: '菜谱', exact: true }).locator('[data-home-status]'))
    .toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(paths.some((path) => path.startsWith('/api/recipes'))).toBe(false);
});

for (const ordinary of [false, true]) {
  test(`家里意图预取仅留意源，管理员查询按角色过滤：${ordinary ? '成员' : '管理员'}`, async ({ page, isMobile }) => {
    if (ordinary) await asMember(page);
    // 个人页不会预拉 shelf 查询，避免今天页的请求干扰断言。
    await page.goto('/me/profile');
    await page.waitForLoadState('networkidle');
    const paths = watchRequests(page);
    await homeNavigation(page, isMobile).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.waitForLoadState('networkidle');
    expect(paths).toEqual(['/api/today/attention']);
    const main = page.locator('main');
    await expect(main.locator('[data-home-grid] a')).toHaveCount(ordinary ? 13 : 14);
    await expect(main.getByRole('link', { name: '财务', exact: true })).toHaveCount(ordinary ? 0 : 1);
    if (ordinary) {
      await expect(main.getByRole('link', { name: '家庭设置', exact: true })).toHaveCount(0);
      await main.getByRole('link', { name: '个人', exact: true }).click();
      await expect(page).toHaveURL(/\/me\/profile$/);
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`F2 家里截图与尺寸：${theme}`, async ({ page, isMobile }, testInfo) => {
    const errors = watchPageErrors(page);
    await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
    await page.goto('/home');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('main h1')).toHaveText('家里');
    await page.evaluate(() => document.fonts.ready);
    await expectNoHorizontalOverflow(page);
    const grid = page.locator('[data-home-grid]');
    const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(isMobile ? 3 : 6);
    for (const link of await grid.getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const dir = resolve(process.cwd(), '../../.tmp-shots');
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `f2-${isMobile ? '390x844' : '1280x800'}-${theme}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach(`F2 ${theme}`, { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

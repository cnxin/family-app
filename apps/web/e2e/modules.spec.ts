import { expect, test, type Page } from '@playwright/test';
import { SHELF_MODULE_KEYS } from '@family/contracts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyModuleHousehold } from './modules-fixture';
import { expectNoHorizontalOverflow, watchPageErrors } from './helpers';

test.skip(process.env.E2E_ISOLATED !== '1', '空家庭夹具仅限隔离库，请用 test:web:next');
const active = (page: Page, key: string) => page.locator(`[data-home-grid] [data-home-tile="${key}"]`);
const available = (page: Page, key: string) => page.locator(`[data-home-available="${key}"]`);
async function goHome(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '家里', exact: true }).click();
  else await page.getByRole('navigation', { name: '家庭与设置' }).getByRole('link', { name: '家里（全部功能）' }).click();
}
async function hide(page: Page, key: string, label: string) {
  await active(page, key).getByRole('button', { name: `${label}选项` }).click();
  const response = page.waitForResponse((r) => r.url().endsWith(`/system/modules/${key}`) && r.request().method() === 'PATCH');
  await active(page, key).getByRole('menuitem', { name: '收起来' }).click();
  expect((await response).status()).toBe(200);
}

test('空家庭：资产自动隐身，真实新建后不刷新页面就上移', async ({ page, request, isMobile }) => {
  const fixture = await emptyModuleHousehold(page, request);
  expect((await fixture.states()).find((one) => one.key === 'assets')?.hasData).toBe(false);
  await page.goto('/home');
  await expect(available(page, 'assets')).toBeVisible();
  await expect(active(page, 'assets')).toHaveCount(0);
  await expect(active(page, 'activity')).toBeVisible();
  await page.getByRole('button', { name: '搜索功能', exact: true }).click();
  const search = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
  await search.fill('资产');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/house\/assets$/);
  await page.getByRole('button', { name: '+ 登记资产' }).click();
  const form = page.getByRole('dialog', { name: '登记家庭资产' });
  await form.getByLabel('资产名称').fill('第一台洗衣机');
  const created = page.waitForResponse((r) => r.url().endsWith('/assets') && r.request().method() === 'POST');
  await form.getByRole('button', { name: '保存资产' }).click();
  expect((await created).status()).toBe(201);
  await expect(form).toBeHidden();
  await goHome(page, isMobile);
  await expect(active(page, 'assets')).toBeVisible();
  await expect(available(page, 'assets')).toHaveCount(0);
});

test('管理员开启、收起撤销、重新开启传 null；收起仍能搜索和深链', async ({ page, request }) => {
  const fixture = await emptyModuleHousehold(page, request);
  await page.goto('/home');
  const enabled = page.waitForResponse((r) => r.url().endsWith('/system/modules/media') && r.request().method() === 'PATCH');
  await available(page, 'media').getByRole('button', { name: '开启', exact: true }).click();
  expect((await enabled).request().postDataJSON()).toEqual({ override: 'on' });
  await expect(active(page, 'media')).toBeVisible();
  await hide(page, 'media', '观影');
  await expect(available(page, 'media')).toContainText('已收起');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(active(page, 'media')).toBeVisible();
  expect((await fixture.states()).find((one) => one.key === 'media')?.override).toBe('on');
  await hide(page, 'media', '观影');
  const reopened = page.waitForResponse((r) => r.url().endsWith('/system/modules/media') && r.request().method() === 'PATCH');
  await available(page, 'media').getByRole('button', { name: '重新开启' }).click();
  expect((await reopened).request().postDataJSON()).toEqual({ override: null });
  await expect(available(page, 'media')).not.toContainText('已收起');
  await expect(available(page, 'media').getByRole('button', { name: '开启', exact: true })).toBeVisible();
  await fixture.override('media', 'off');
  await page.goto('/life/media');
  await expect(page.locator('main h1')).toBeVisible();
  await page.goto('/home');
  await page.getByRole('button', { name: '搜索功能', exact: true }).click();
  const search = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
  await search.fill('观影'); await search.press('Enter');
  await expect(page).toHaveURL(/\/life\/media$/);
});

test('普通成员没有收起操作，空域只显示去看看且不 PATCH', async ({ page, request }) => {
  await emptyModuleHousehold(page, request, 'member');
  const patches: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/system/modules')) patches.push(r.url()); });
  await page.goto('/home');
  await expect(available(page, 'assets').getByRole('link', { name: '去看看' })).toBeVisible();
  await expect(page.getByRole('button', { name: /开启|选项/ })).toHaveCount(0);
  await active(page, 'activity').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '收起来' })).toHaveCount(0);
  await available(page, 'assets').getByRole('link', { name: '去看看' }).click();
  await expect(page).toHaveURL(/\/house\/assets$/);
  expect(patches).toEqual([]);
});

test('模块请求 500：全部 shelf 放行，不能把功能藏到还可以开启', async ({ page, request }) => {
  await emptyModuleHousehold(page, request);
  await page.route('**/api/system/modules', (route) => route.fulfill({ status: 500, json: { error: { message: '暂时失败' } } }));
  await page.goto('/home');
  await expect(page.locator('[data-home-grid] a')).toHaveCount(14);
  await expect(page.getByRole('heading', { name: '还可以开启' })).toHaveCount(0);
});

test('首次等待用骨架；后台刷新保留缓存；失败忽略旧 off 全部放行', async ({ page, request }) => {
  await emptyModuleHousehold(page, request);
  let release!: () => void;
  let barrier = new Promise<void>((resolve) => { release = resolve; });
  let fail = false;
  await page.route('**/api/system/modules', async (route) => {
    await barrier;
    if (fail) await route.fulfill({ status: 500, json: {} });
    else await route.continue();
  });
  await page.goto('/home');
  await expect(page.getByRole('status', { name: '正在加载家里的功能' })).toBeVisible();
  await expect(page.locator('[data-home-available]')).toHaveCount(0);
  release();
  await expect(active(page, 'activity')).toBeVisible();
  // 先存下 off，再让后续后台刷新失败，验证不能继续依旧缓存隐藏它。
  await hide(page, 'activity', '家庭动态');
  await expect(available(page, 'activity')).toContainText('已收起');
  barrier = new Promise<void>((resolve) => { release = resolve; });
  await available(page, 'media').getByRole('button', { name: '开启', exact: true }).click();
  await expect(page.getByRole('status', { name: '正在加载家里的功能' })).toHaveCount(0);
  await expect(available(page, 'activity')).toContainText('已收起');
  fail = true; release();
  await expect(page.locator('[data-home-grid] a')).toHaveCount(14);
});

test('置顶最多四个、本机刷新保留、收起保留记录且重开恢复', async ({ page, request, isMobile }) => {
  const fixture = await emptyModuleHousehold(page, request);
  for (const key of ['media', 'assets', 'inventory', 'recipes'] as const) await fixture.override(key, 'on');
  await page.goto('/home');
  await page.getByRole('button', { name: '编辑置顶' }).click();
  for (const [key, label] of [['media', '观影'], ['assets', '资产'], ['inventory', '库存'], ['activity', '家庭动态']]) {
    const button = active(page, key).getByRole('button', { name: `置顶${label}`, exact: true });
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44); expect(box?.height).toBeGreaterThanOrEqual(44);
    await button.click();
  }
  await expect(active(page, 'recipes').getByRole('button', { name: '置顶菜谱', exact: true })).toBeDisabled();
  await expect(page.getByText('已钉住 4 个，先取消一个置顶，才能钉住其他功能。')).toBeVisible();
  await page.getByRole('button', { name: '完成置顶' }).click();
  await page.reload();
  const pinned = isMobile ? page.locator('[data-home-pins]') : page.getByRole('region', { name: '我钉住的', exact: true });
  await expect(pinned.getByRole('link', { name: '观影', exact: true })).toBeVisible();
  await hide(page, 'activity', '家庭动态');
  await expect(pinned.getByRole('link', { name: '家庭动态', exact: true })).toHaveCount(0);
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`fa.pins.${id}`)!), fixture.session.member.id)).toContain('activity');
  await available(page, 'activity').getByRole('button', { name: '重新开启' }).click();
  await expect(pinned.getByRole('link', { name: '家庭动态', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '置顶今天', exact: true })).toHaveCount(0);
});

test('localStorage 读写失败不崩溃，读不到当空', async ({ page, request }) => {
  await emptyModuleHousehold(page, request);
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key.startsWith('fa.pins.')) throw new Error('blocked'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('fa.pins.')) throw new Error('blocked'); return set.call(this, key, value); };
  });
  const errors = watchPageErrors(page);
  await page.goto('/home');
  await page.getByRole('button', { name: '编辑置顶' }).click();
  await active(page, 'activity').getByRole('button', { name: '置顶家庭动态' }).click();
  await expect(active(page, 'activity').getByRole('button', { name: '取消置顶家庭动态' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: '编辑置顶' }).click();
  await expect(active(page, 'activity').getByRole('button', { name: '置顶家庭动态' })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('置顶按成员隔离，过滤 core / 未知 key 和重复值', async ({ page, request }) => {
  const fixture = await emptyModuleHousehold(page, request);
  await fixture.override('media', 'on');
  await page.addInitScript((id) => {
    localStorage.setItem('fa.pins.someone-else', JSON.stringify(['activity']));
    localStorage.setItem(`fa.pins.${id}`, JSON.stringify(['today', 'settings', 'media', 'media', 'unknown']));
  }, fixture.session.member.id);
  await page.goto('/home');
  await page.getByRole('button', { name: '编辑置顶' }).click();
  await expect(active(page, 'media').getByRole('button', { name: '取消置顶观影' })).toHaveAttribute('aria-pressed', 'true');
  await expect(active(page, 'activity').getByRole('button', { name: '置顶家庭动态' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status')).toContainText('已选 1 个');
});

test('图块右键 / 长按打开收起菜单，Escape 关闭且不误导航', async ({ page, request }) => {
  await emptyModuleHousehold(page, request);
  await page.goto('/home');
  const tile = active(page, 'activity');
  await tile.getByRole('link').click({ button: 'right' });
  await expect(tile.getByRole('menuitem', { name: '收起来' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(tile.getByRole('menu')).toHaveCount(0);
  await tile.getByRole('link').dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await expect(tile.getByRole('menuitem', { name: '收起来' })).toBeVisible();
  await tile.getByRole('link').dispatchEvent('pointerup', { pointerType: 'touch' });
  await tile.getByRole('link').dispatchEvent('click');
  await expect(page).toHaveURL(/\/home$/);
});

for (const theme of ['light', 'dark']) {
  test(`F4 家里分组与置顶四图：${theme}`, async ({ page, request, isMobile }, testInfo) => {
    const fixture = await emptyModuleHousehold(page, request);
    for (const key of SHELF_MODULE_KEYS.filter((key) => !['guests', 'finance', 'knowledge', 'assistant'].includes(key))) await fixture.override(key, 'on');
    await fixture.override('guests', 'off');
    await page.addInitScript(({ id, theme }) => {
      localStorage.setItem('family-app.theme', theme);
      localStorage.setItem(`fa.pins.${id}`, JSON.stringify(['assets', 'media']));
    }, { id: fixture.session.member.id, theme });
    const errors = watchPageErrors(page);
    await page.goto('/home');
    await expect(available(page, 'guests')).toContainText('已收起');
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    const dir = resolve(process.cwd(), '../../.tmp-shots'); mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `f4-${isMobile ? '390x844' : '1280x800'}-${theme}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach(`F4 ${theme}`, { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

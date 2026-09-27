import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyModuleHousehold } from './modules-fixture';
import { authFiles, stamp } from './helpers';

test.skip(process.env.E2E_ISOLATED !== '1', '动作搜索只在隔离库验收');

async function openSearch(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: '快速跳转', exact: true }).click();
  else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const input = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
  await expect(input).toBeVisible();
  return input;
}

test('⌘K 输记一，回车打开记账且地址上没有参数', async ({ page, isMobile }) => {
  await page.goto('/');
  const input = await openSearch(page, isMobile);
  const palette = page.getByRole('dialog', { name: '快速跳转' });
  if (isMobile) {
    const box = await palette.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && viewport.height - (box.y + box.height)).toBeLessThanOrEqual(8);
  }
  await input.fill('记一');
  await expect(palette.getByRole('button').first()).toContainText('记一笔支出');
  await expect(palette.getByRole('button', { name: /交给小管家/ })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/house\/finance$/);
  const form = page.getByRole('dialog', { name: '记一笔' });
  await expect(form).toBeVisible();
  await expect(form.getByRole('tab', { name: '支出' })).toHaveAttribute('aria-selected', 'true');
});

test('空库搜索回忆并记下一条后，家里页出现回忆', async ({ page, request }) => {
  await emptyModuleHousehold(page, request);
  await page.goto('/home');
  await expect(page.locator('[data-home-tile="memories"]')).toHaveCount(0);
  await page.getByRole('button', { name: '搜索功能', exact: true }).click();
  const input = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
  await input.fill('回忆');
  await expect(page.getByRole('button', { name: /记一条回忆/ })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/life\/memories$/);
  const form = page.getByRole('dialog', { name: '记一条回忆' });
  await expect(form).toBeVisible();
  const title = stamp('回忆');
  await form.getByLabel('标题').fill(title);
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/memories'),
  );
  await form.getByRole('button', { name: '保存回忆' }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.goto('/home');
  await expect(page.locator('[data-home-tile="memories"]')).toBeVisible();
  await expect(page.locator('[data-home-available="memories"]')).toHaveCount(0);
});

test('普通成员搜不到管理员动作', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'];
  await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
  await page.goto('/');
  const input = await openSearch(page, isMobile);
  await input.fill('记一笔支出');
  await expect(page.getByRole('dialog', { name: '快速跳转' }).getByRole('button', { name: /记一笔支出/ })).toHaveCount(0);
  await input.fill('财务');
  await expect(page.getByRole('dialog', { name: '快速跳转' }).getByRole('button', { name: /财务/ })).toHaveCount(0);
});

test('小管家未启用时无交给小管家', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  let reads = 0;
  await page.route('**/api/agent/status', (route) => {
    reads += 1;
    return route.fulfill({ json: { data: { enabled: false } } });
  });
  await page.goto('/');
  expect(reads).toBe(0);
  const input = await openSearch(page, isMobile);
  await expect.poll(() => reads).toBeGreaterThan(0);
  await input.fill('问小管家');
  await expect(page.getByRole('dialog', { name: '快速跳转' }).getByRole('button', { name: /交给小管家/ })).toHaveCount(0);
});

test('手机 ⌘K sheet 亮暗截图', async ({ page, isMobile }) => {
  test.skip(!isMobile, '只检查手机 sheet');
  test.setTimeout(90_000);
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
    await page.goto('/');
    const input = await openSearch(page, true);
    await input.fill('记一');
    await expect(page.getByRole('dialog', { name: '快速跳转' })).toBeVisible();
    await page.screenshot({ path: resolve(dir, `f6-sheet-390x844-${theme}.png`), animations: 'disabled' });
  }
});

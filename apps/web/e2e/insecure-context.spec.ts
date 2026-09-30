import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { loginName, password, stamp, watchPageErrors } from './helpers';

// 不安全上下文冒烟（教训 49）：家里人用 http://192.168.x.x:8088 打开小管家，浏览器不给
// crypto.randomUUID、navigator.clipboard。这里用 http://insecure.test（playwright.config.ts 的 insecure-context project，
// 把它解析到本机）复现：登录、今天页、导入地图到第 2 步并手画一个房间、成员页复制邀请链接、智能家居联动页复制 YAML。
// 复制在这种上下文里走 execCommand 兜底，还不行就整段选中让人手动复制——两种结果都算过，只要不报错、有提示。

const sample = resolve(process.cwd(), '../../docs/ui-prototypes/floorplan-robot-sample.png');

async function expectCopied(page: Page) {
  await expect(
    page.getByText(/已复制|已经全选好了/).first(),
    '复制要么成功，要么把文字全选好并提示手动复制',
  ).toBeVisible();
}

test('局域网 IP 那种访问方式：登录、今天页、地图导入手画、复制邀请链接和 HA 配置都能用', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/login');
  // 先确认真的是不安全上下文，不然这组测试等于没测
  const context = await page.evaluate(() => ({
    secure: window.isSecureContext,
    randomUUID: typeof (crypto as Crypto & { randomUUID?: unknown }).randomUUID,
    clipboard: typeof navigator.clipboard,
  }));
  expect(context).toEqual({ secure: false, randomUUID: 'undefined', clipboard: 'undefined' });

  await page.getByPlaceholder('输入账号').fill(loginName);
  await page.getByPlaceholder('输入密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('main h1')).toContainText(loginName);

  // 地图导入：自动识别 → 清空 → 手画一个房间
  await page.goto('/house/map/import');
  await page.getByLabel('选择地图截图').setInputFiles(sample);
  await expect(page.locator('[data-import-crop] img')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('[data-detect-state="done"]')).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('[data-map-room]').count()).toBeGreaterThanOrEqual(10);
  await page.getByRole('button', { name: '清空自己画' }).click();
  const area = (await page.locator('[data-map-canvas]').boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.4, area.y + area.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.55, area.y + area.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-map-room]')).toHaveCount(1);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('[data-import-step="2"]')).toBeVisible();

  // 成员页：生成邀请码 → 复制邀请链接
  await page.goto('/house/members');
  await page.getByRole('button', { name: '+ 邀请成员' }).click();
  const invite = page.getByRole('dialog', { name: '邀请家庭成员' });
  await invite.getByLabel('邀请谁').fill(stamp('局域网'));
  await invite.getByRole('button', { name: '生成邀请码' }).click();
  const created = page.getByRole('dialog', { name: '邀请码生成好了' });
  await created.getByRole('button', { name: '复制邀请链接' }).click();
  await expectCopied(page);
  await created.getByRole('button', { name: '知道了' }).click();

  // 智能家居联动：生成密钥和 HA 配置 → 复制
  await page.goto('/house/smart-home/settings?section=linkages');
  await page.getByRole('button', { name: /生成密钥和 HA 配置|换一把新密钥并生成 HA 配置/ }).click();
  await expect(page.locator('[data-smart-home-ha-config]')).toBeVisible();
  await page.getByRole('button', { name: /^复制① 加到 configuration\.yaml/ }).click();
  await expectCopied(page);

  expect(errors).toEqual([]);
});

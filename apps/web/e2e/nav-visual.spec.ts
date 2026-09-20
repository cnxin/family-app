import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectNoHorizontalOverflow, watchPageErrors } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`F1 今天与导航截图：${theme}`, async ({ page, isMobile }, testInfo) => {
    const errors = watchPageErrors(page);
    await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByText('今天吃什么', { exact: true })).toBeVisible();
    await expect(page.getByText(/正在读今天的安排/)).toHaveCount(0);
    await expect(page.getByText('正在看今天的菜单…', { exact: true })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expectNoHorizontalOverflow(page);
    const navigation = page.getByRole('navigation', { name: isMobile ? '主导航' : '功能导航' });
    await expect(navigation).toBeVisible();
    const targets = navigation.getByRole(isMobile ? 'button' : 'link');
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    if (isMobile) {
      const avatar = await page.locator('main').getByRole('link', { name: '个人设置', exact: true }).boundingBox();
      const heading = await page.locator('main h1').boundingBox();
      expect(avatar).not.toBeNull();
      expect(avatar!.x).toBeGreaterThan(heading!.x + heading!.width);
      expect(Math.abs(avatar!.y - heading!.y)).toBeLessThanOrEqual(4);
    }
    const dir = resolve(process.cwd(), '../../.tmp-shots');
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `f1-${isMobile ? '390x844' : '1280x800'}-${theme}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach(`F1 ${theme}`, { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

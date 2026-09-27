import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, watchPageErrors } from './helpers';

/**
 * 视口矩阵：窄屏手机、常见手机、横屏手机、竖放平板。尺寸都是显式 setViewportSize 设的，
 * 跟项目自带的视口无关，所以只在 mobile-chrome 这一个项目里跑，桌面项目跑一遍是纯重复。
 */
test.skip(({ isMobile }) => !isMobile, '视口矩阵自己设尺寸，只在手机项目里跑一遍');

const PAGES = [
  '/',
  '/home',
  '/house/shopping',
  '/house/finance',
  '/house/inventory',
  '/life/media',
  '/life/knowledge',
  '/me/assistant',
];

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 844, height: 390 },
  { width: 820, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const path of PAGES) {
      test(`${path} 不横向溢出、无运行期错误`, async ({ page }) => {
        const errors = watchPageErrors(page);
        await page.goto(path);
        await expect(page.locator('main h1')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalOverflow(page);
        expect(errors, '页面抛了运行期错误').toEqual([]);
      });
    }
  });
}

/** 滚到底之后，元素的下沿要在底部标签栏上沿之上——被栏盖住就点不到了。 */
async function expectAboveTabBar(page: Page, selector: string) {
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  const overlap = await page.evaluate((target) => {
    const nodes = document.querySelectorAll(target);
    const last = nodes[nodes.length - 1];
    const bar = document.querySelector('nav[aria-label="主导航"]');
    if (!last || !bar) return null;
    return last.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
  }, selector);
  expect(overlap, `找不到 ${selector} 或主导航`).not.toBeNull();
  expect(overlap!, `${selector} 的最后一个被底部标签栏盖住了 ${overlap}px`).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 844, height: 390 },
]) {
  test(`${viewport.width}x${viewport.height} 家里：最后一个图块和页尾入口都不被底部标签栏盖住`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/home');
    await expect(page.locator('[data-home-grid] [data-home-tile]').last()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectAboveTabBar(page, '[data-home-grid] [data-home-tile]');
    // 页尾那条「家庭设置」是 main 里最后一个能点的东西
    await expectAboveTabBar(page, 'main a[href="/settings"]');
  });
}

test('系统减弱动效时，导航按钮的过渡时长压到几乎为零', async ({ page }) => {
  const durations = async () =>
    page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '家里', exact: true })
      .evaluate((button) =>
        getComputedStyle(button)
          .transitionDuration.split(',')
          .map((value) => parseFloat(value) * (value.trim().endsWith('ms') ? 0.001 : 1)),
      );

  await page.goto('/home');
  // 先确认量的是有过渡的那个元素（平时 150ms），不然「为零」没有意义
  expect(Math.max(...(await durations()))).toBeCloseTo(0.15, 3);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  // index.css：prefers-reduced-motion 下所有元素 transition-duration: 0.01ms !important
  for (const seconds of await durations()) expect(seconds).toBeLessThanOrEqual(0.00001);
});

test('320x568 对话框的关闭按钮够大（≥ 44×44），手指点得中', async ({ page }) => {
  // 最窄的 320 宽下也要够大；dialog.spec 在两个默认视口上测同一件事。
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/schedule/polls?create=1');
  const close = page.getByRole('dialog').getByRole('button', { name: '关闭' });
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box!.width, '关闭按钮宽度').toBeGreaterThanOrEqual(44);
  expect(box!.height, '关闭按钮高度').toBeGreaterThanOrEqual(44);
});

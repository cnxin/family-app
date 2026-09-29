import { expect, test } from '@playwright/test';

// 回归：保存成员资料后，成员列表的重新拉取还没回来就再打开编辑框，看到的必须是刚保存的值。
// 以前只靠失效，编辑框拿到改之前的那一行，再点保存会把修改改回去（write-paths「改掌勺偏好」手机项目偶发的根因）。
// 这里把重新拉取人为拖慢 1.5 秒，让这个竞态每次都出现。

test('保存成员资料后立刻再打开编辑框：看到的是刚保存的值，不是旧缓存', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '缓存竞态与视口无关，桌面项目验一次');
  await page.goto('/house/members');
  let saved = false;
  await page.route('**/api/household/members', async (route) => {
    if (saved && route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const open = async () => {
    await page.getByRole('button', { name: '编辑爸爸' }).click();
    return page.getByRole('dialog', { name: '编辑「爸爸」' });
  };
  const editor = await open();
  const cook = () => page.getByRole('dialog', { name: '编辑「爸爸」' }).getByRole('checkbox', { name: '经常掌勺' });
  const before = await cook().getAttribute('aria-checked');
  await cook().click();
  saved = true;
  const patched = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/household\/members\/[^/]+$/.test(response.url()));
  await editor.getByRole('button', { name: '保存成员资料' }).click();
  expect((await patched).ok()).toBeTruthy();
  await expect(editor).toBeHidden();

  const again = await open();
  await expect(cook()).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  // 改回去，别影响别的用例
  await cook().click();
  const restored = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/household\/members\/[^/]+$/.test(response.url()));
  await again.getByRole('button', { name: '保存成员资料' }).click();
  expect((await restored).ok()).toBeTruthy();
});

import { expect, test } from '@playwright/test';
import { stamp } from './helpers';

test('知识库：写了一半关掉会先问一句，继续编辑内容还在，放弃才真的关', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/knowledge-articles')) {
      posts.push(request.url());
    }
  });
  await page.goto('/life/knowledge');

  // 什么都没改：直接关，不打扰
  await page.getByRole('button', { name: '+ 写一篇' }).click();
  await page.getByRole('dialog', { name: '写一篇' }).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 写了标题再关：先问
  const title = stamp('写一半');
  await page.getByRole('button', { name: '+ 写一篇' }).click();
  const editor = page.getByRole('dialog', { name: '写一篇' });
  await editor.getByLabel('标题').fill(title);
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '放弃未保存的修改？' });
  await expect(confirm).toBeVisible();

  await confirm.getByRole('button', { name: '继续编辑' }).click();
  await expect(confirm).toBeHidden();
  await expect(editor.getByLabel('标题')).toHaveValue(title);

  // Esc 也走同一个确认
  await page.keyboard.press('Escape');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(posts).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';
import { apiClient, stamp, watchPageErrors } from './helpers';

// 深链约定 `dish`：/eat/recipes?dish=<id> 等菜谱到了就打开那道菜的做法，处理完只抹 dish 参数（⌘K 选菜品用）。
// 会造菜、下架菜、模拟 500：只在隔离库跑，别写进演示栈。
test.skip(process.env.E2E_ISOLATED !== '1', '菜谱深链只在隔离库验收');

interface Dish { id: string; name: string }

async function openSearch(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: '快速跳转', exact: true }).click();
  else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const input = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
  await expect(input).toBeVisible();
  return input;
}

async function pickDish(page: Page, isMobile: boolean, name: string) {
  const input = await openSearch(page, isMobile);
  await input.fill(name);
  const row = page.getByRole('dialog', { name: '快速跳转' }).getByRole('button', { name: new RegExp(name) });
  await expect(row).toContainText('菜品');
  await row.click();
}

test('菜谱页 ?dish=<id>：打开那道菜的做法，只抹 dish 参数；关掉后刷新不再弹', async ({ page, request }) => {
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const note = stamp('深链做法备注');
  const dish = await admin.post<Dish>('/dishes', { name: stamp('深链菜'), category: '荤菜', note });
  try {
    await page.goto(`/eat/recipes?dish=${dish.id}&from=e2e`);
    const dialog = page.getByRole('dialog', { name: `${dish.name} 的做法` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(note);
    await expect(page).toHaveURL(/\/eat\/recipes\?from=e2e$/); // 只抹 dish，别的参数留着

    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: `看${dish.name}的做法` })).toBeVisible(); // 列表到了再断言没弹
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await admin.delete(`/dishes/${dish.id}`);
  }
});

test('?dish= 指向下架的菜、乱写的 id、空 id、菜谱读失败：都只抹参数，不弹窗不报错', async ({ page, request }) => {
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const gone = await admin.post<Dish>('/dishes', { name: stamp('下架的菜'), category: '素菜' });
  await admin.delete(`/dishes/${gone.id}`);

  for (const id of [gone.id, '00000000-0000-4000-8000-00000000abcd', 'not-a-uuid', '']) {
    await page.goto(`/eat/recipes?dish=${id}`);
    await expect(page).toHaveURL(/\/eat\/recipes$/); // 抹参数 = 已处理完，此后断言没弹才有意义
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  await page.route('**/api/recipes', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: '暂时失败' } }),
    }),
  );
  await page.goto(`/eat/recipes?dish=${gone.id}`);
  await expect(page.getByText('没加载出来')).toBeVisible(); // retry: 1，约 1 秒后出失败态
  await expect(page).toHaveURL(/\/eat\/recipes$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('⌘K 输菜名选中：打开做法；返回回到原页、前进不再弹；在菜谱页再选同一道还能开', async ({ page, request, isMobile }) => {
  test.setTimeout(60_000);
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const dish = await admin.post<Dish>('/dishes', { name: stamp('搜到的菜'), category: '汤' });
  try {
    // ⌘K 的菜品读 ['dishes'] 缓存且不订阅（command-palette.tsx）：等点菜页把这道菜画出来，缓存里就一定有它
    await page.goto('/eat/order');
    await expect(page.getByRole('button', { name: `把${dish.name}加进菜单` })).toBeVisible();

    await pickDish(page, isMobile, dish.name);
    const dialog = page.getByRole('dialog', { name: `${dish.name} 的做法` });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/eat\/recipes$/);

    // 参数是 replace 抹掉的：返回直接回点菜页；前进回来是干净的菜谱页，不再弹
    await page.goBack();
    await expect(page).toHaveURL(/\/eat\/order$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/eat\/recipes$/);
    await expect(page.getByRole('button', { name: `看${dish.name}的做法` })).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // 菜谱页上（不重挂载）选两次同一道：handled 归零后第二次照样开
    await pickDish(page, isMobile, dish.name);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toBeHidden();
    await pickDish(page, isMobile, dish.name);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/eat\/recipes$/);
    expect(errors).toEqual([]);
  } finally {
    await admin.delete(`/dishes/${dish.id}`);
  }
});

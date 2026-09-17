import { expect, test, type Page } from '@playwright/test';
import { apiClient, isoDate, stamp } from './helpers';

/**
 * 五条关键写路径：每条从 UI 发起、看真实响应码、自己造数据自己清。
 * 不依赖用例顺序，也不依赖演示库里恰好有什么。
 */

const tomorrow = isoDate(1);

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      pathPattern.test(new URL(response.url()).pathname),
  );
}

test('点菜：把一道菜加进明天晚餐并提交', async ({ page, request, isMobile }) => {
  const api = apiClient(request);
  const dish = await api.post<{ id: string; name: string }>('/dishes', {
    name: stamp('菜'),
    category: '荤菜',
  });

  try {
    await page.goto('/eat/order');
    await page.getByLabel('选择日期').fill(tomorrow);
    await page.getByRole('button', { name: '晚餐', exact: true }).click();
    await page.getByPlaceholder('搜菜名').fill(dish.name);
    await page.getByRole('button', { name: `把${dish.name}加进菜单` }).click();

    if (isMobile) {
      await page.getByRole('button', { name: /你的菜单 · 1 道/ }).click();
    }
    const submitted = waitFor(page, 'POST', /\/menus\/[^/]+\/items$/);
    await page.getByRole('button', { name: '提交菜单', exact: true }).click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(201);
    await expect(page.getByText(/已加进晚餐/)).toBeVisible();

    const menu = await api.get<{ items: { id: string; dish: { id: string } }[] }>(
      `/menus?date=${tomorrow}&mealType=dinner`,
    );
    expect(menu.items.some((item) => item.dish.id === dish.id)).toBeTruthy();
  } finally {
    await api.delete(`/dishes/${dish.id}`);
  }
});

test('任务：新建一件今天的事并打勾完成', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('任务');
  let taskId: string | null = null;

  try {
    await page.goto('/schedule/tasks');
    const created = waitFor(page, 'POST', /\/tasks$/);
    await page.getByPlaceholder('加一件今天要做的事').fill(title);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    taskId = ((await createResponse.json()) as { data: { id: string } }).data.id;

    const done = waitFor(page, 'PATCH', /\/tasks\/[^/]+\/instances\/\d{4}-\d{2}-\d{2}$/);
    await page.getByRole('checkbox', { name: `完成${title}` }).click();
    expect((await done).ok()).toBeTruthy();
    await expect(page.getByRole('checkbox', { name: `完成${title}` })).toBeChecked();
  } finally {
    if (taskId) await api.delete(`/tasks/${taskId}`);
  }
});

test('日历：添加一个全天事件，再从当天抽屉里删掉', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('事件');
  let eventId: string | null = null;

  try {
    await page.goto('/schedule/calendar?view=month');
    await page.getByRole('button', { name: '+ 添加事件' }).click();
    const dialog = page.getByRole('dialog', { name: '添加家庭事件' });
    await dialog.getByPlaceholder('比如：奶奶生日、家长会').fill(title);
    await dialog.getByLabel('日期').fill(tomorrow);
    const created = waitFor(page, 'POST', /\/calendar-events$/);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    eventId = ((await createResponse.json()) as { data: { id: string } }).data.id;
    await expect(dialog).toBeHidden();

    // 打开明天的抽屉，删掉刚建的
    const [, month, day] = tomorrow.split('-').map(Number);
    await page
      .getByRole('button', { name: new RegExp(`^${month}月${day}日，`) })
      .first()
      .click();
    await page.getByRole('button', { name: `删除${title}` }).click();
    const deleted = waitFor(page, 'DELETE', /\/calendar-events\/[^/]+$/);
    await page
      .getByRole('dialog', { name: /删除/ })
      .getByRole('button', { name: /^删除/ })
      .click();
    expect((await deleted).ok()).toBeTruthy();
    eventId = null;
    await expect(page.getByRole('button', { name: `删除${title}` })).toBeHidden();
  } finally {
    if (eventId) await api.delete(`/calendar-events/${eventId}`);
  }
});

test('提醒：给一个事件建提醒，再取消', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('提醒源');
  const event = await api.post<{ id: string }>('/calendar-events', {
    date: isoDate(3),
    title,
  });

  try {
    await page.goto('/schedule/reminders');
    await page.getByRole('button', { name: '+ 新建提醒' }).click();
    const dialog = page.getByRole('dialog', { name: '新建提醒' });
    // 表单默认按第一条来源的模块过滤，先切到「日程」再找刚建的事件
    await dialog.getByRole('button', { name: '日程', exact: true }).click();
    await dialog.getByRole('button', { name: title }).click();
    // 收件人默认可能为空，保证至少选了自己（只在「提醒谁」那一组里找，来源列表里也可能有带「爸爸」的标题）
    const me = dialog.locator('p:has-text("提醒谁") + div').getByRole('button', { name: /爸爸/ });
    if ((await me.getAttribute('aria-pressed')) !== 'true') await me.click();
    const created = waitFor(page, 'POST', /\/reminders$/);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: `取消提醒${title}` }).click();
    const cancelled = waitFor(page, 'DELETE', /\/reminders\/[^/]+$/);
    await page
      .getByRole('dialog', { name: '取消这条提醒' })
      .getByRole('button', { name: '取消提醒', exact: true })
      .click();
    expect((await cancelled).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: `取消提醒${title}` })).toBeHidden();
  } finally {
    await api.delete(`/calendar-events/${event.id}`);
  }
});

test('消息：有人划掉我点的菜会收到通知，一键全部已读', async ({ page, request }) => {
  const dad = apiClient(request);
  const dish = await dad.post<{ id: string; name: string }>('/dishes', {
    name: stamp('被划的菜'),
    category: '素菜',
  });

  try {
    const menu = await dad.get<{ id: string }>(`/menus?date=${isoDate(2)}&mealType=lunch`);
    const withItem = await dad.post<{ items: { id: string; dish: { id: string } }[] }>(
      `/menus/${menu.id}/items`,
      { items: [{ dishId: dish.id }] },
    );
    const item = withItem.items.find((one) => one.dish.id === dish.id);
    expect(item).toBeTruthy();

    // 换妈妈来划菜——通知只发给点菜的人，自己划自己不算
    const mom = apiClient(request, '妈妈');
    await mom.patch(`/menu-items/${item!.id}`, { status: 'rejected', reason: 'e2e 划菜' });

    await page.goto('/schedule/notifications');
    await expect(page.getByText(new RegExp(`划掉了你点的「${dish.name}」`))).toBeVisible();
    const readAll = waitFor(page, 'PATCH', /\/notifications\/read-all$/);
    await page.getByRole('button', { name: '全部已读', exact: true }).click();
    expect((await readAll).ok()).toBeTruthy();
    await expect(page.locator('main header p').first()).toHaveText('都看过了');
  } finally {
    await dad.delete(`/dishes/${dish.id}`);
  }
});

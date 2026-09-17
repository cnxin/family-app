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

test('菜谱：新建菜品、改口味、下架', async ({ page, request }) => {
  const api = apiClient(request);
  const name = stamp('新菜');
  let dishId: string | null = null;

  try {
    await page.goto('/eat/recipes');
    await page.getByRole('button', { name: '+ 新建菜品' }).click();
    const dialog = page.getByRole('dialog', { name: '新建菜品' });
    await dialog.getByPlaceholder('比如：番茄炒蛋').fill(name);
    await dialog.getByRole('button', { name: '素菜', exact: true }).click();
    await dialog.getByRole('radio', { name: '难度 2' }).click();
    const created = waitFor(page, 'POST', /\/dishes$/);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    dishId = ((await createResponse.json()) as { data: { id: string } }).data.id;
    await expect(dialog).toBeHidden();

    // 列表里能看到，且分类和难度都对
    await page.getByPlaceholder('搜菜名或食材，比如「西兰花」').fill(name);
    const card = page.locator('main').getByText(name, { exact: true }).first();
    await expect(card).toBeVisible();

    await page.getByRole('button', { name: `编辑菜品${name}` }).click();
    const editDialog = page.getByRole('dialog', { name: `编辑「${name}」` });
    await editDialog.getByPlaceholder('比如：酸甜、微辣').fill('微辣');
    const updated = waitFor(page, 'PATCH', /\/dishes\/[^/]+$/);
    await editDialog.getByRole('button', { name: '保存', exact: true }).click();
    expect((await updated).ok()).toBeTruthy();
    await expect(editDialog).toBeHidden();

    await page.getByRole('button', { name: `编辑菜品${name}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: '下架', exact: true }).click();
    const removed = waitFor(page, 'DELETE', /\/dishes\/[^/]+$/);
    await page.getByRole('dialog').getByRole('button', { name: '确认下架' }).click();
    expect((await removed).ok()).toBeTruthy();
    dishId = null;
    await expect(page.locator('main').getByText(name, { exact: true })).toBeHidden();
  } finally {
    if (dishId) await api.delete(`/dishes/${dishId}`);
  }
});

test('投票：发起、投一票、结束、删除', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('投票');
  let pollId: string | null = null;
  try {
  await page.goto('/schedule/polls');
  await page.getByRole('button', { name: '+ 发起投票' }).click();
  const dialog = page.getByRole('dialog', { name: '发起投票' });
  await dialog.getByPlaceholder('比如：周末去哪儿').fill(title);
  await dialog.getByRole('button', { name: /活动/ }).click();
  await dialog.getByLabel('候选项 1').fill('公园');
  await dialog.getByLabel('候选项 2').fill('博物馆');
  const created = waitFor(page, 'POST', /\/polls$/);
  await dialog.getByRole('button', { name: '发起投票', exact: true }).click();
  const createResponse = await created;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  pollId = ((await createResponse.json()) as { data: { id: string } }).data.id;
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/pollId=/);

  const card = page.getByRole('article', { name: title });
  await card.getByRole('radio', { name: '选择公园' }).click();
  const voted = waitFor(page, 'POST', /\/polls\/[^/]+\/votes$/);
  await card.getByRole('button', { name: '提交选择' }).click();
  expect((await voted).ok()).toBeTruthy();
  await expect(card.getByText(/1 票 · 100%/)).toBeVisible();

  await page.getByRole('button', { name: `结束投票${title}` }).click();
  const closed = waitFor(page, 'POST', /\/polls\/[^/]+\/close$/);
  await page.getByRole('dialog', { name: '结束这个投票？' }).getByRole('button', { name: '结束投票' }).click();
  expect((await closed).ok()).toBeTruthy();
  await page.getByRole('tab', { name: '已结束' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: `删除投票${title}` }).click();
  const archived = waitFor(page, 'DELETE', /\/polls\/[^/]+$/);
  await page.getByRole('dialog', { name: '删除这个投票？' }).getByRole('button', { name: '删除投票' }).click();
  expect((await archived).ok()).toBeTruthy();
  pollId = null;
  await expect(page.getByRole('heading', { name: title })).toBeHidden();
  } finally {
    if (pollId) await api.delete(`/polls/${pollId}`);
  }
});

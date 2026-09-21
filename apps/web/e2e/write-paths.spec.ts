import { expect, test, type Page } from '@playwright/test';
import { addDays, householdToday } from '@family/shared';
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

test('积分：新增奖励、申请兑换、确认、撤销', async ({ page, request }) => {
  const api = apiClient(request);
  // 奖励只能停用不能删，所以用固定名字：隔离库里走「新增」那条路，
  // 本机演示库上重复跑就复用同一行，不会越跑越多。
  const name = 'e2e·兑换测试奖励';
  const existing = (await api.get<{ id: string; name: string }[]>('/rewards?includeInactive=true')).find(
    (one) => one.name === name,
  );
  let rewardId = existing?.id ?? null;

  try {
    await page.goto('/house/points');
    if (existing) {
      await api.patch(`/rewards/${existing.id}`, { isActive: true, cost: 1 });
      await page.reload();
    } else {
      await page.getByRole('button', { name: '+ 新增奖励' }).click();
      const dialog = page.getByRole('dialog', { name: '新增奖励' });
      await dialog.getByPlaceholder('比如：选一次周末电影').fill(name);
      await dialog.getByLabel('需要多少积分').fill('1');
      const created = waitFor(page, 'POST', /\/rewards$/);
      await dialog.getByRole('button', { name: '保存奖励' }).click();
      const createResponse = await created;
      expect(createResponse.status(), await createResponse.text()).toBe(201);
      rewardId = ((await createResponse.json()) as { data: { id: string } }).data.id;
      await expect(dialog).toBeHidden();
    }

    // 先给自己发够分，再兑换
    await api.post('/points/adjustments', {
      memberId: api.memberId,
      delta: 5,
      note: 'e2e 兑换测试发分',
      idempotencyKey: `e2e-${Date.now()}`,
    });
    await page.reload();

    await page.getByRole('button', { name: `兑换${name}` }).click();
    const redeemed = waitFor(page, 'POST', /\/rewards\/[^/]+\/redemptions$/);
    await page.getByRole('dialog', { name: `兑换「${name}」？` }).getByRole('button', { name: '确认兑换' }).click();
    expect((await redeemed).status()).toBe(201);

    // 切到兑换记录，管理员确认
    await page.getByRole('tab', { name: /兑换审批/ }).click();
    await page.getByRole('button', { name: `确认兑换${name}` }).first().click();
    const decided = waitFor(page, 'POST', /\/reward-redemptions\/[^/]+\/decision$/);
    await page.getByRole('dialog', { name: '确认这笔兑换？' }).getByRole('button', { name: '确认通过' }).click();
    expect((await decided).status()).toBe(201);

    // 撤销：退回积分
    await page.getByRole('button', { name: `撤销兑换${name}` }).first().click();
    const reversed = waitFor(page, 'POST', /\/reward-redemptions\/[^/]+\/reverse$/);
    await page.getByRole('dialog', { name: '撤销已确认的兑换？' }).getByRole('button', { name: '撤销并退回' }).click();
    expect((await reversed).status()).toBe(201);
    await expect(page.getByText('已撤销').first()).toBeVisible();
  } finally {
    if (rewardId) await api.patch(`/rewards/${rewardId}`, { isActive: false });
  }
});

test('成员：生成邀请码再撤销、改掌勺偏好', async ({ page }) => {
  const name = stamp('新成员');
  await page.goto('/house/members');

  // 邀请码只显示一次，所以创建后就在对话框里断言它出现了
  await page.getByRole('button', { name: '+ 邀请成员' }).click();
  const invite = page.getByRole('dialog', { name: '邀请家庭成员' });
  await invite.getByLabel('邀请谁').fill(name);
  const created = waitFor(page, 'POST', /\/household\/invitations$/);
  await invite.getByRole('button', { name: '生成邀请码' }).click();
  const createResponse = await created;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const token = ((await createResponse.json()) as { data: { invitationToken: string } }).data
    .invitationToken;
  expect(token.length).toBeGreaterThan(20);
  await expect(page.getByRole('dialog', { name: '邀请码生成好了' }).getByText(token)).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();

  // 侧栏里能看到，撤销掉（用按钮判断在不在，别用名字——toast 里也有名字）
  const revokeButton = page.getByRole('button', { name: `撤销${name}的邀请` });
  await expect(revokeButton).toBeVisible();
  await revokeButton.click();
  const revoked = waitFor(page, 'DELETE', /\/household\/invitations\/[^/]+$/);
  await page.getByRole('dialog', { name: '撤销这个邀请？' }).getByRole('button', { name: '撤销邀请' }).click();
  expect((await revoked).ok()).toBeTruthy();
  await expect(revokeButton).toBeHidden();

  // 改自己的资料：角色不给改，掌勺偏好能改
  await page.getByRole('button', { name: '编辑爸爸' }).click();
  const editor = page.getByRole('dialog', { name: '编辑「爸爸」' });
  await expect(editor.getByText('不能改自己的角色')).toBeVisible();
  const before = await editor.getByRole('checkbox', { name: '经常掌勺' }).getAttribute('aria-checked');
  await editor.getByRole('checkbox', { name: '经常掌勺' }).click();
  const saved = waitFor(page, 'PATCH', /\/household\/members\/[^/]+$/);
  await editor.getByRole('button', { name: '保存成员资料' }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(editor).toBeHidden();

  // 改回去，别影响别的用例
  await page.getByRole('button', { name: '编辑爸爸' }).click();
  const again = page.getByRole('dialog', { name: '编辑「爸爸」' });
  await expect(again.getByRole('checkbox', { name: '经常掌勺' })).toHaveAttribute(
    'aria-checked',
    before === 'true' ? 'false' : 'true',
  );
  await again.getByRole('checkbox', { name: '经常掌勺' }).click();
  const restored = waitFor(page, 'PATCH', /\/household\/members\/[^/]+$/);
  await again.getByRole('button', { name: '保存成员资料' }).click();
  expect((await restored).ok()).toBeTruthy();
});

test('个人：改掌勺偏好、小管家记忆开关、密码校验', async ({ page, request }) => {
  const api = apiClient(request);
  await page.goto('/me/profile');

  // 掌勺偏好：点一下写库，再点回来
  const cooking = page.getByRole('checkbox', { name: '经常掌勺' });
  const before = await cooking.getAttribute('aria-checked');
  const saved = waitFor(page, 'PATCH', /\/members\/me\/preferences$/);
  await cooking.click();
  expect((await saved).ok()).toBeTruthy();
  await expect(cooking).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  const restored = waitFor(page, 'PATCH', /\/members\/me\/preferences$/);
  await cooking.click();
  expect((await restored).ok()).toBeTruthy();

  // 小管家记忆：乐观锁要带 version，改完再改回来
  const memory = page.getByRole('checkbox', { name: '启用记忆' });
  const memoryBefore = await memory.getAttribute('aria-checked');
  const toggled = waitFor(page, 'PATCH', /\/agent\/profile$/);
  await memory.click();
  expect((await toggled).ok()).toBeTruthy();
  await expect(memory).toHaveAttribute('aria-checked', memoryBefore === 'true' ? 'false' : 'true');
  const back = waitFor(page, 'PATCH', /\/agent\/profile$/);
  await memory.click();
  expect((await back).ok()).toBeTruthy();

  // 密码表单只验前端校验，不真改密码（会把后面的用例锁出去）
  await page.getByRole('button', { name: /修改密码|设置密码/ }).click();
  const dialog = page.getByRole('dialog', { name: /修改密码|设置密码/ });
  await dialog.getByLabel('新密码').fill('short');
  await dialog.getByLabel('再输一次').fill('short');
  await dialog.getByRole('button', { name: '更新密码' }).click();
  await expect(dialog.getByText('新密码至少 8 位')).toBeVisible();
  await dialog.getByLabel('新密码').fill('longenough123');
  await dialog.getByLabel('再输一次').fill('different123');
  await dialog.getByRole('button', { name: '更新密码' }).click();
  await expect(dialog.getByText('两次输入的新密码不一样')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 会话里的偏好确实回到了原样
  const me = await api.get<{ prefersCooking: boolean }[]>('/members');
  expect(me.length).toBeGreaterThan(0);
});

test('外部渠道：新增、改接收范围、发测试、删除', async ({ page }) => {
  const name = stamp('渠道');
  await page.goto('/schedule/notifications');
  await page.getByRole('tab', { name: '外部渠道' }).click();

  await page.getByRole('button', { name: '+ 新增渠道' }).click();
  const dialog = page.getByRole('dialog', { name: '新增外部渠道' });
  await dialog.getByLabel('渠道名称').fill(name);
  // 指一个一定连不上的地址：这样「发测试消息」会失败，正好验证失败提示也是好的
  await dialog.getByLabel('接收地址').fill('http://127.0.0.1:1/e2e');
  const created = waitFor(page, 'POST', /\/notification-channels$/);
  await dialog.getByRole('button', { name: '创建渠道' }).click();
  const createResponse = await created;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  await expect(dialog).toBeHidden();

  const card = page.getByRole('article', { name });
  await expect(card).toBeVisible();

  // 开启「接收我的通知」，再取消一个模块
  const receive = card.getByRole('checkbox', { name: `通过${name}接收我的通知` });
  if ((await receive.getAttribute('aria-checked')) !== 'true') {
    const on = waitFor(page, 'PUT', /\/notification-channels\/[^/]+\/preference$/);
    await receive.click();
    expect((await on).ok()).toBeTruthy();
  }
  const moduleChip = card.getByRole('button', { name: '提醒', exact: true });
  const wasOn = await moduleChip.getAttribute('aria-pressed');
  const changed = waitFor(page, 'PUT', /\/notification-channels\/[^/]+\/preference$/);
  await moduleChip.click();
  expect((await changed).ok()).toBeTruthy();
  await expect(moduleChip).toHaveAttribute('aria-pressed', wasOn === 'true' ? 'false' : 'true');

  // 发测试消息：地址是死的，所以这里只要求接口被调到并给出结果
  const tested = waitFor(page, 'POST', /\/notification-channels\/[^/]+\/test$/);
  await card.getByRole('button', { name: `测试${name}` }).click();
  expect((await tested).status()).toBeGreaterThanOrEqual(200);

  await page.getByRole('button', { name: `删除${name}` }).click();
  const removed = waitFor(page, 'DELETE', /\/notification-channels\/[^/]+$/);
  await page.getByRole('dialog', { name: `删除渠道「${name}」？` }).getByRole('button', { name: '删除渠道' }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(card).toBeHidden();
});

test('小管家记忆：记一条、确认、改内容、忘掉', async ({ page, isMobile }) => {
  // 只在一个视口跑：同一个人同一类记忆只能有一条生效，两个 project 并排跑会互相 409
  test.skip(isMobile, '记忆是按 (成员, 类别) 唯一的，跑一个视口就够');
  const content = stamp('记忆');
  await page.goto('/me/assistant/memories');

  await page.getByRole('button', { name: '+ 记一条' }).click();
  const form = page.getByRole('dialog', { name: '记一条给小管家' });
  await form.getByLabel('想让小管家记住什么').fill(content);
  await form.getByRole('button', { name: '其他信息', exact: true }).click();
  const created = waitFor(page, 'POST', /\/agent\/memories\/candidates$/);
  await form.getByRole('button', { name: '记下来' }).click();
  expect((await created).status(), await (await created).text()).toBe(201);
  await expect(form).toBeHidden();

  // 新记的在「待确认」里
  await page.getByRole('tab', { name: /待确认/ }).click();
  const card = page.getByRole('button', { name: new RegExp(`待确认，其他信息：${content}`) });
  await expect(card).toBeVisible();
  await card.click();

  const detail = page.getByRole('dialog', { name: '其他信息' });
  const confirmed = waitFor(page, 'POST', /\/agent\/memories\/[^/]+\/confirm$/);
  await detail.getByRole('button', { name: '确认', exact: true }).click();
  expect((await confirmed).status()).toBe(201);
  await expect(detail).toBeHidden();

  // 确认之后进「已生效」，改一下内容
  await page.getByRole('tab', { name: '已生效' }).click();
  const active = page.getByRole('button', { name: new RegExp(`其他信息：${content}`) });
  await expect(active).toBeVisible();
  await active.click();
  const detail2 = page.getByRole('dialog', { name: '其他信息' });
  await detail2.getByRole('button', { name: '改内容' }).click();
  await detail2.getByLabel('记忆内容').fill(`${content}（改过）`);
  const corrected = waitFor(page, 'PATCH', /\/agent\/memories\/[^/]+$/);
  await detail2.getByRole('button', { name: '保存修改' }).click();
  expect((await corrected).ok()).toBeTruthy();

  // 再打开，忘掉
  const edited = page.getByRole('button', { name: new RegExp(`其他信息：${content}（改过）`) });
  await expect(edited).toBeVisible();
  await edited.click();
  const detail3 = page.getByRole('dialog', { name: '其他信息' });
  const forgotten = waitFor(page, 'DELETE', /\/agent\/memories\/[^/]+$/);
  await detail3.getByRole('button', { name: '忘掉' }).click();
  expect((await forgotten).ok()).toBeTruthy();
  await expect(edited).toBeHidden();
});

test('小管家设置：开关运行方式、签发并作废配对码', async ({ page, isMobile }) => {
  test.skip(isMobile, '设置是全家共用的一份，跑一个视口就够，两个并排跑会互相版本冲突');
  await page.goto('/me/assistant');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '小管家设置' });

  // 运行方式：切到 Hermes 再切回来（乐观锁，要带 version）
  const before = await dialog.getByRole('tab', { name: '本地摘要' }).getAttribute('aria-selected');
  const switched = waitFor(page, 'PATCH', /\/agent\/settings$/);
  await dialog.getByRole('tab', { name: 'Hermes' }).click();
  expect((await switched).ok()).toBeTruthy();
  await expect(dialog.getByRole('tab', { name: 'Hermes' })).toHaveAttribute('aria-selected', 'true');
  if (before === 'true') {
    const back = waitFor(page, 'PATCH', /\/agent\/settings$/);
    await dialog.getByRole('tab', { name: '本地摘要' }).click();
    expect((await back).ok()).toBeTruthy();
  }

  // 配对码：明文只回一次，页面上要看得到
  await dialog.getByRole('button', { name: /爸爸/ }).click();
  const issued = waitFor(page, 'POST', /\/agent\/channel-pairings$/);
  await dialog.getByRole('button', { name: '生成一次性配对码' }).click();
  const issuedResponse = await issued;
  expect(issuedResponse.status(), await issuedResponse.text()).toBe(201);
  const code = ((await issuedResponse.json()) as { data: { pairingCode: string | null } }).data
    .pairingCode;
  expect(code).toBeTruthy();
  await expect(dialog.getByText(code!)).toBeVisible();

  // 作废掉，别留一串能用的码
  const revoked = waitFor(page, 'POST', /\/agent\/channel-pairings\/[^/]+\/revoke$/);
  await dialog.getByRole('button', { name: /作废telegram的配对码/ }).click();
  expect((await revoked).status()).toBe(201);
});

test('访客：新增访客、安排来访、生成并撤销邀请链接', async ({ page, request }) => {
  const api = apiClient(request);
  const guestName = stamp('访客');
  const visitTitle = stamp('来访');
  let guestId: string | null = null;

  try {
    await page.goto('/house/guests');

    // 访客名册里新增一位
    await page.getByRole('tab', { name: '访客名册' }).click();
    await page.getByRole('button', { name: '+ 新增访客' }).click();
    const guestForm = page.getByRole('dialog', { name: '新增访客' });
    await guestForm.getByLabel('访客姓名').fill(guestName);
    const guestCreated = waitFor(page, 'POST', /\/guests$/);
    await guestForm.getByRole('button', { name: '保存访客' }).click();
    const guestResponse = await guestCreated;
    expect(guestResponse.status(), await guestResponse.text()).toBe(201);
    guestId = ((await guestResponse.json()) as { data: { id: string } }).data.id;
    await expect(guestForm).toBeHidden();

    // 安排一次来访，把他选上
    await page.getByRole('tab', { name: /来访/ }).click();
    await page.getByRole('button', { name: '+ 安排来访' }).click();
    const visitForm = page.getByRole('dialog', { name: '安排来访' });
    await visitForm.getByLabel('来访主题').fill(visitTitle);
    await visitForm.getByLabel('来访日期').fill(isoDate(2));
    await visitForm.getByRole('button', { name: new RegExp(guestName) }).click();
    const visitCreated = waitFor(page, 'POST', /\/visits$/);
    await visitForm.getByRole('button', { name: '保存来访计划' }).click();
    expect((await visitCreated).status()).toBe(201);
    await expect(visitForm).toBeHidden();

    // 生成邀请链接：明文只回一次，页面上要看得到
    await page.getByRole('button', { name: `给${visitTitle}生成邀请链接` }).click();
    const inviteForm = page.getByRole('dialog', { name: '生成访客邀请链接' });
    const issued = waitFor(page, 'POST', /\/visits\/[^/]+\/invitations$/);
    await inviteForm.getByRole('button', { name: '生成链接' }).click();
    const issuedResponse = await issued;
    expect(issuedResponse.status(), await issuedResponse.text()).toBe(201);
    const token = ((await issuedResponse.json()) as { data: { invitationToken: string } }).data
      .invitationToken;
    expect(token.length).toBeGreaterThan(20);
    const issuedDialog = page.getByRole('dialog', { name: '邀请链接生成好了' });
    await expect(issuedDialog.getByText(token)).toBeVisible();
    await issuedDialog.getByRole('button', { name: '知道了' }).click();

    // 撤销邀请
    await page.getByRole('button', { name: `撤销给${guestName}的邀请` }).click();
    await expect(page.getByRole('button', { name: `撤销给${guestName}的邀请` })).toBeHidden();

    // 取消来访，别留在演示数据里
    await page.getByRole('button', { name: `取消${visitTitle}` }).click();
    await expect(page.getByRole('article', { name: visitTitle }).getByText('已取消')).toBeVisible();
  } finally {
    if (guestId) await api.patch(`/guests/${guestId}`, { isActive: false });
  }
});

test('资产：登记一件家电、补档案、停用', async ({ page, request }) => {
  const api = apiClient(request);
  const name = stamp('资产');
  let assetId: string | null = null;

  try {
    await page.goto('/house/assets');
    await page.getByRole('button', { name: '+ 登记资产' }).click();
    const form = page.getByRole('dialog', { name: '登记家庭资产' });
    await form.getByLabel('资产名称').fill(name);
    await form.getByLabel('存放位置').fill('客厅');
    const created = waitFor(page, 'POST', /\/assets$/);
    await form.getByRole('button', { name: '保存资产' }).click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    assetId = ((await createdResponse.json()) as { data: { id: string } }).data.id;
    await expect(form).toBeHidden();

    // 从列表点进详情
    await page.getByRole('link', { name: new RegExp(name) }).first().click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    // 编辑档案：补一个品牌，详情右栏立刻能看到
    await page.getByRole('button', { name: '编辑档案' }).click();
    const editor = page.getByRole('dialog', { name: `编辑「${name}」` });
    await editor.getByLabel('品牌').fill('e2e 牌');
    const patched = waitFor(page, 'PATCH', /\/assets\/[^/]+$/);
    await editor.getByRole('button', { name: '保存资产' }).click();
    expect((await patched).status()).toBe(200);
    await expect(editor).toBeHidden();
    await expect(page.getByText('e2e 牌')).toBeVisible();

    // 停用：按钮换成「恢复使用」
    await page.getByRole('button', { name: '停用资产' }).click();
    const retired = waitFor(page, 'PATCH', /\/assets\/[^/]+$/);
    await page.getByRole('button', { name: '确认停用' }).click();
    expect((await retired).status()).toBe(200);
    await expect(page.getByRole('button', { name: '恢复使用' })).toBeVisible();
  } finally {
    if (assetId) await api.patch(`/assets/${assetId}`, { status: 'retired' });
  }
});

test('资产维护：排计划、关联耗材、完成一次、加条资料再删掉', async ({ page, request }) => {
  const api = apiClient(request);
  const assetName = stamp('设备');
  const planTitle = stamp('保养');
  const supplyName = stamp('滤芯');
  let assetId: string | null = null;

  try {
    const asset = await api.post<{ id: string }>('/assets', { name: assetName, category: 'appliance' });
    assetId = asset.id;
    await api.post('/inventory-items', {
      name: supplyName,
      category: '日用品',
      quantity: 10,
      unit: '个',
      lowStockThreshold: 1,
      restockQuantity: 2,
    });

    await page.goto(`/house/assets/${asset.id}`);

    // 排一条维护计划
    await page.getByRole('button', { name: '+ 新增计划' }).click();
    const planForm = page.getByRole('dialog', { name: '新增维护计划' });
    await planForm.getByLabel('维护事项').fill(planTitle);
    await planForm.getByLabel('周期天数').fill('90');
    await planForm.getByLabel('首次到期日').fill(tomorrow);
    const planCreated = waitFor(page, 'POST', /\/assets\/[^/]+\/maintenance-plans$/);
    await planForm.getByRole('button', { name: '保存维护计划' }).click();
    expect((await planCreated).status()).toBe(201);
    await expect(planForm).toBeHidden();
    const planCard = page.getByRole('article', { name: planTitle });

    // 关联一个库存项当耗材
    await page.getByRole('button', { name: `给${planTitle}关联耗材` }).click();
    const consumableForm = page.getByRole('dialog', { name: '关联维护耗材' });
    await consumableForm.getByRole('button', { name: new RegExp(supplyName) }).click();
    await consumableForm.getByLabel('每次用量').fill('2');
    const linked = waitFor(page, 'POST', /\/maintenance-plans\/[^/]+\/consumables$/);
    await consumableForm.getByRole('button', { name: '确认关联' }).click();
    expect((await linked).status()).toBe(201);
    await expect(planCard.getByLabel(`编辑耗材${supplyName}`)).toBeVisible();

    // 完成一次维护：库存够，所以「顺便扣库存」是可以选的
    await planCard.getByRole('button', { name: '完成维护' }).click();
    const completion = page.getByRole('dialog', { name: '确认完成维护' });
    await expect(completion.getByRole('article', { name: supplyName })).toContainText('够扣');
    // 保持默认的家庭「今天」；不再为了绕开时钟竞态手工填昨天。
    await expect(completion.getByLabel('实际完成日期')).toHaveValue(householdToday('Asia/Shanghai'));
    await completion.getByRole('tab', { name: '顺便扣库存' }).click();
    const completed = waitFor(page, 'POST', /\/maintenance-plans\/[^/]+\/complete$/);
    await completion.getByRole('button', { name: /确认完成、扣库并推进日期/ }).click();
    expect((await completed).status()).toBe(201);
    await expect(completion).toBeHidden();
    await expect(page.getByText('已扣减 1 项耗材')).toBeVisible();

    // 加一条外链资料，再删掉
    await page.getByRole('button', { name: '+ 添加' }).click();
    const documentForm = page.getByRole('dialog', { name: '添加资产资料' });
    await documentForm.getByLabel('资料名称').fill('说明书');
    await documentForm.getByLabel('资料链接').fill('https://example.com/manual.pdf');
    const documentAdded = waitFor(page, 'POST', /\/assets\/[^/]+\/documents$/);
    await documentForm.getByRole('button', { name: '保存资料' }).click();
    expect((await documentAdded).status()).toBe(201);
    await expect(page.getByRole('button', { name: '打开资料说明书' })).toBeVisible();

    await page.getByRole('button', { name: '删除资料说明书' }).click();
    const removed = waitFor(page, 'DELETE', /\/asset-documents\/[^/]+$/);
    await page.getByRole('dialog', { name: '删除「说明书」？' }).getByRole('button', { name: '删除', exact: true }).click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByRole('button', { name: '打开资料说明书' })).toBeHidden();
  } finally {
    // 库存项删不掉：维护耗材还引用着它（后端会拒），停用资产就够了
    if (assetId) await api.patch(`/assets/${assetId}`, { status: 'retired' });
  }
});

test('财务：新建账户、记一笔支出、再撤销', async ({ page, request }) => {
  const api = apiClient(request);
  const accountName = stamp('账户');
  const title = stamp('聚餐');

  try {
    await page.goto('/house/finance');

    // 账户：新建一个，余额立刻算出来
    await page.getByRole('tab', { name: '账户' }).click();
    await page.getByRole('button', { name: '+ 新增账户' }).click();
    const accountForm = page.getByRole('dialog', { name: '新增账户' });
    await accountForm.getByLabel('账户名称').fill(accountName);
    await accountForm.getByLabel('初始余额').fill('1000');
    const created = waitFor(page, 'POST', /\/finance\/accounts$/);
    await accountForm.getByRole('button', { name: '保存账户' }).click();
    expect((await created).status(), await (await created).text()).toBe(201);
    await expect(accountForm).toBeHidden();
    const accountRow = page.getByLabel(accountName, { exact: true });
    await expect(accountRow).toContainText('¥1,000.00');

    // 记一笔支出，记在这个账户上
    await page.getByRole('button', { name: '+ 记一笔' }).click();
    const form = page.getByRole('dialog', { name: '记一笔' });
    await form.getByLabel('金额').fill('88.80');
    await form.getByRole('button', { name: new RegExp(accountName) }).click();
    await form.getByLabel('账目名称').fill(title);
    const recorded = waitFor(page, 'POST', /\/finance\/transactions$/);
    await form.getByRole('button', { name: '确认记账' }).click();
    expect((await recorded).status(), await (await recorded).text()).toBe(201);
    await expect(form).toBeHidden();

    // 流水里能看到，金额带负号
    await page.getByRole('tab', { name: '流水' }).click();
    // 撤销之后会多出一条「撤销：<标题>」，名字是包含关系，所以这里必须 exact
    const entry = page.getByRole('article', { name: title, exact: true });
    await expect(entry).toContainText('-¥88.80');

    // 撤销：原流水留着，标成已撤销
    await entry.getByRole('button', { name: `撤销${title}` }).click();
    const reversed = waitFor(page, 'POST', /\/finance\/transactions\/[^/]+\/reverse$/);
    await page.getByRole('dialog', { name: '撤销这笔流水？' }).getByRole('button', { name: '确认撤销' }).click();
    expect((await reversed).status()).toBe(201);
    await expect(entry).toContainText('已经被一笔反向流水撤销');
  } finally {
    // 账本不可删，停用就行；余额和流水都留在历史里
    const accounts = await api.get<{ id: string; name: string; version: number }[]>(
      '/finance/accounts?includeInactive=true',
    );
    const mine = accounts.find((one) => one.name === accountName);
    if (mine) await api.patch(`/finance/accounts/${mine.id}`, { isActive: false, expectedVersion: mine.version });
  }
});

test('财务预算：新增分类、设预算、看进度、再删掉', async ({ page, request }) => {
  const api = apiClient(request);
  const categoryName = stamp('分类');
  let categoryId: string | null = null;

  try {
    await page.goto('/house/finance');

    // 新增一个支出分类
    await page.getByRole('tab', { name: '账户' }).click();
    await page.getByRole('button', { name: '+ 新增分类' }).click();
    const categoryForm = page.getByRole('dialog', { name: '新增收支分类' });
    await categoryForm.getByLabel('分类名称').fill(categoryName);
    const categoryCreated = waitFor(page, 'POST', /\/finance\/categories$/);
    await categoryForm.getByRole('button', { name: '保存分类' }).click();
    const categoryResponse = await categoryCreated;
    expect(categoryResponse.status(), await categoryResponse.text()).toBe(201);
    categoryId = ((await categoryResponse.json()) as { data: { id: string } }).data.id;

    // 给它设一个预算
    await page.getByRole('tab', { name: '预算' }).click();
    await page.getByRole('button', { name: `设置${categoryName}预算` }).click();
    const budgetForm = page.getByRole('dialog', { name: `${categoryName}的月度预算` });
    await budgetForm.getByLabel('预算金额').fill('100');
    const saved = waitFor(page, 'PUT', /\/finance\/budgets$/);
    await budgetForm.getByRole('button', { name: '保存预算' }).click();
    expect((await saved).status(), await (await saved).text()).toBe(200);
    const budgetRow = page.getByLabel(categoryName, { exact: true });
    await expect(budgetRow).toContainText('¥100.00');
    await expect(budgetRow).toContainText('已用 ¥0.00');

    // 删掉
    await page.getByRole('button', { name: `删除${categoryName}预算` }).click();
    const removed = waitFor(page, 'DELETE', /\/finance\/budgets\/[^/?]+/);
    await page
      .getByRole('dialog', { name: `删掉${categoryName}的预算？` })
      .getByRole('button', { name: '删除预算' })
      .click();
    expect((await removed).status()).toBe(200);
    await expect(budgetRow).toContainText('未设');
  } finally {
    if (categoryId) {
      const categories = await api.get<{ id: string; version: number }[]>(
        '/finance/categories?includeInactive=true',
      );
      const mine = categories.find((one) => one.id === categoryId);
      if (mine) {
        await api.patch(`/finance/categories/${categoryId}`, {
          isActive: false,
          expectedVersion: mine.version,
        });
      }
    }
  }
});

test('知识库：写一篇、改一版、还原回上一版、归档', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('说明');
  let articleId: string | null = null;

  try {
    await page.goto('/life/knowledge');
    await page.getByRole('button', { name: '+ 写一篇' }).click();
    const editor = page.getByRole('dialog', { name: '写一篇' });
    await editor.getByLabel('标题').fill(title);
    await editor.getByLabel('正文').fill('第一版：先按开关，再按启动。');
    const created = waitFor(page, 'POST', /\/knowledge-articles$/);
    await editor.getByRole('button', { name: '创建文章' }).click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    articleId = ((await createdResponse.json()) as { data: { id: string } }).data.id;

    // 保存完直接停在这篇的详情上
    const detail = page.getByRole('dialog', { name: title });
    await expect(detail).toContainText('第一版');

    // 改一版
    await detail.getByRole('button', { name: '编辑' }).click();
    const again = page.getByRole('dialog', { name: `编辑「${title}」` });
    await again.getByLabel('正文').fill('第二版：先插电。');
    const patched = waitFor(page, 'PATCH', /\/knowledge-articles\/[^/]+$/);
    await again.getByRole('button', { name: '保存修改' }).click();
    expect((await patched).status()).toBe(200);
    await expect(detail).toContainText('第二版');

    // 还原回 v1：现在的内容照样留在历史里
    await detail.getByRole('button', { name: /版本历史/ }).click();
    const restored = waitFor(page, 'POST', /\/knowledge-articles\/[^/]+\/revisions\/1\/restore$/);
    await page.getByRole('button', { name: '还原到 v1' }).click();
    await page.getByRole('dialog', { name: '还原到 v1？' }).getByRole('button', { name: '确认还原' }).click();
    expect((await restored).status()).toBe(201);
    await expect(detail).toContainText('第一版');

    // 归档：从「使用中」里收起来
    await detail.getByRole('button', { name: '归档' }).click();
    const archived = waitFor(page, 'POST', /\/knowledge-articles\/[^/]+\/archive$/);
    await page.getByRole('dialog', { name: '归档这篇？' }).getByRole('button', { name: '确认归档' }).click();
    expect((await archived).status()).toBe(201);
    await expect(detail).toContainText('已归档');
  } finally {
    // 知识库没有删除，归档就是终点
    if (articleId) {
      const one = await api.get<{ archivedAt: string | null; version: number }>(
        `/knowledge-articles/${articleId}`,
      );
      if (!one.archivedAt) {
        await api.post(`/knowledge-articles/${articleId}/archive`, {
          expectedVersion: one.version,
          idempotencyKey: `e2e-cleanup-${articleId}`,
        });
      }
    }
  }
});

// 1×1 的透明 PNG，够后端认出是图片就行
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('回忆：记一条、放一张照片、归档', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('回忆');
  let memoryId: string | null = null;

  try {
    await page.goto('/life/memories');
    await page.getByRole('button', { name: '+ 记一条' }).click();
    const editor = page.getByRole('dialog', { name: '记一条回忆' });
    await editor.getByLabel('标题').fill(title);
    await editor.getByLabel('故事').fill('今天一起包了饺子。');
    const created = waitFor(page, 'POST', /\/memories$/);
    await editor.getByRole('button', { name: '保存回忆' }).click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    memoryId = ((await createdResponse.json()) as { data: { id: string } }).data.id;

    // 保存完直接停在详情上，往里放一张照片
    const detail = page.getByRole('dialog', { name: title });
    await detail.getByLabel('选择回忆照片').setInputFiles({
      name: 'e2e.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await detail.getByLabel('照片说明').fill('饺子');
    const uploaded = waitFor(page, 'POST', /\/memories\/[^/]+\/photos$/);
    await detail.getByRole('button', { name: '加进去' }).click();
    const uploadedResponse = await uploaded;
    expect(uploadedResponse.status(), await uploadedResponse.text()).toBe(201);
    // 照片正文走的是签名地址，公开端点，img 直接能取到
    await expect(detail.getByRole('img', { name: '饺子' })).toBeVisible();

    // 归档
    await detail.getByRole('button', { name: '归档' }).click();
    const archived = waitFor(page, 'POST', /\/memories\/[^/]+\/archive$/);
    await page.getByRole('dialog', { name: '归档这条回忆？' }).getByRole('button', { name: '确认归档' }).click();
    expect((await archived).status()).toBe(201);
    await expect(page.getByRole('button', { name: title })).toBeHidden();
  } finally {
    // 回忆没有删除，归档就是终点
    if (memoryId) {
      const one = await api.get<{ archivedAt: string | null; version: number }>(`/memories/${memoryId}`);
      if (!one.archivedAt) {
        await api.post(`/memories/${memoryId}/archive`, {
          expectedVersion: one.version,
          idempotencyKey: `e2e-cleanup-${memoryId}`,
        });
      }
    }
  }
});

test('出行：建行程、加一项清单、打勾、完成这趟', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('出行');
  let planId: string | null = null;

  try {
    await page.goto('/life/travel');
    await page.getByRole('button', { name: '+ 新建行程' }).click();
    const form = page.getByRole('dialog', { name: '安排一趟出行' });
    await form.getByLabel('行程名称').fill(title);
    await form.getByLabel('目的地').fill('杭州');
    const created = waitFor(page, 'POST', /\/travel-plans$/);
    await form.getByRole('button', { name: '创建行程' }).click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    planId = ((await createdResponse.json()) as { data: { id: string } }).data.id;

    // 建完直接落到详情页
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();

    // 清单空的时候不能完成
    await expect(page.getByRole('button', { name: '完成行程' })).toBeEnabled();

    // 加一项，行程就有待处理了，完成按钮会被拦住
    await page.getByRole('button', { name: '+ 加一项' }).click();
    const itemForm = page.getByRole('dialog', { name: '加一项' });
    await itemForm.getByLabel('清单项名称').fill('充电器');
    await itemForm.getByRole('button', { name: '增加数量' }).click();
    const itemCreated = waitFor(page, 'POST', /\/travel-plans\/[^/]+\/items$/);
    await itemForm.getByRole('button', { name: '加进清单' }).click();
    expect((await itemCreated).status()).toBe(201);
    await expect(page.getByLabel('充电器', { exact: true })).toContainText('× 2');
    await expect(page.getByRole('button', { name: '完成行程' })).toBeDisabled();

    // 打勾之后才允许完成
    const checked = waitFor(page, 'POST', /\/items\/[^/]+\/complete$/);
    await page.getByRole('checkbox', { name: '完成充电器' }).click();
    expect((await checked).status()).toBe(201);
    const completeButton = page.getByRole('button', { name: '完成行程' });
    await expect(completeButton).toBeEnabled();

    const completed = waitFor(page, 'POST', /\/travel-plans\/[^/]+\/complete$/);
    await completeButton.click();
    await page.getByRole('dialog', { name: '这趟就算完成了？' }).getByRole('button', { name: '确认完成' }).click();
    expect((await completed).status()).toBe(201);
    await expect(page.getByRole('button', { name: '重新打开' })).toBeVisible();
  } finally {
    // 出行没有删除，归档就行
    if (planId) {
      const plan = await api.get<{ archivedAt: string | null; version: number }>(
        `/travel-plans/${planId}`,
      );
      if (!plan.archivedAt) {
        await api.post(`/travel-plans/${planId}/archive`, {
          expectedVersion: plan.version,
          idempotencyKey: `e2e-cleanup-${planId}`,
        });
      }
    }
  }
});

test('出行模板：建一个模板、套进行程、再归档模板', async ({ page, request }) => {
  const api = apiClient(request);
  const templateTitle = stamp('模板');
  const planTitle = stamp('出行');
  let planId: string | null = null;
  let templateId: string | null = null;

  try {
    const plan = await api.post<{ id: string }>('/travel-plans', {
      title: planTitle,
      startDate: isoDate(3),
      endDate: isoDate(4),
      idempotencyKey: `e2e-plan-${Date.now()}`,
    });
    planId = plan.id;

    // 建模板
    await page.goto('/life/travel');
    await page.getByRole('tab', { name: '打包模板' }).click();
    await page.getByRole('button', { name: '+ 新建模板' }).click();
    const form = page.getByRole('dialog', { name: '新建打包模板' });
    await form.getByLabel('模板名称').fill(templateTitle);
    await form.getByLabel('模板清单第 1 项').fill('洗漱包');
    await form.getByRole('button', { name: '+ 再加一行' }).click();
    await form.getByLabel('模板清单第 2 项').fill('雨伞');
    const created = waitFor(page, 'POST', /\/travel-templates$/);
    await form.getByRole('button', { name: '创建模板' }).click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    templateId = ((await createdResponse.json()) as { data: { id: string } }).data.id;
    await expect(page.getByRole('article', { name: templateTitle })).toContainText('2 项');

    // 套进刚才那个行程
    await page.goto(`/life/travel/${plan.id}`);
    await page.getByRole('button', { name: '套用模板' }).click();
    const picker = page.getByRole('dialog', { name: '选一个打包模板' });
    await picker.getByRole('button', { name: templateTitle }).click();
    const applied = waitFor(page, 'POST', /\/templates\/[^/]+\/apply$/);
    await page.getByRole('dialog', { name: `用「${templateTitle}」？` }).getByRole('button', { name: '加到清单' }).click();
    expect((await applied).status(), await (await applied).text()).toBe(201);
    await expect(page.getByLabel('洗漱包', { exact: true })).toBeVisible();
    await expect(page.getByLabel('雨伞', { exact: true })).toBeVisible();

    // 同一个模板不能再套第二次：选择列表里已经置灰
    await page.getByRole('button', { name: '套用模板' }).click();
    await expect(picker.getByRole('button', { name: templateTitle })).toBeDisabled();
    await picker.getByRole('button', { name: '关闭' }).click();

    // 归档模板
    await page.goto('/life/travel');
    await page.getByRole('tab', { name: '打包模板' }).click();
    const archived = waitFor(page, 'POST', /\/travel-templates\/[^/]+\/archive$/);
    await page.getByRole('button', { name: `归档${templateTitle}` }).click();
    expect((await archived).status()).toBe(201);
    await expect(page.getByRole('article', { name: templateTitle })).toContainText('已归档');
  } finally {
    if (planId) {
      const plan = await api.get<{ archivedAt: string | null; version: number }>(
        `/travel-plans/${planId}`,
      );
      if (!plan.archivedAt) {
        await api.post(`/travel-plans/${planId}/archive`, {
          expectedVersion: plan.version,
          idempotencyKey: `e2e-cleanup-plan-${planId}`,
        });
      }
    }
    if (templateId) {
      const templates = await api.get<{ id: string; archivedAt: string | null; version: number }[]>(
        '/travel-templates?status=all',
      );
      const mine = templates.find((one) => one.id === templateId);
      if (mine && !mine.archivedAt) {
        await api.post(`/travel-templates/${templateId}/archive`, {
          expectedVersion: mine.version,
          idempotencyKey: `e2e-cleanup-template-${templateId}`,
        });
      }
    }
  }
});

interface BackupPolicyShape {
  scheduleEnabled: boolean;
  frequency: 'daily' | 'weekly';
  weeklyDay: number | null;
  scheduledHour: number;
  scheduledMinute: number;
  retentionDays: number;
  retentionCount: number;
  capacityWarningPercent: number;
  capacityCriticalPercent: number;
  restoreDrillEnabled: boolean;
  restoreDrillDay: number;
  restoreDrillHour: number;
}

test('备份：改一下保留策略（排队和演练是 worker 的活，这里不碰）', async ({ page, request }) => {
  const api = apiClient(request);
  const before = await api.get<{ policy: BackupPolicyShape }>('/system/backups');
  const original = before.policy;
  const restore: BackupPolicyShape = {
    scheduleEnabled: original.scheduleEnabled,
    frequency: original.frequency,
    weeklyDay: original.frequency === 'weekly' ? original.weeklyDay : null,
    scheduledHour: original.scheduledHour,
    scheduledMinute: original.scheduledMinute,
    retentionDays: original.retentionDays,
    retentionCount: original.retentionCount,
    capacityWarningPercent: original.capacityWarningPercent,
    capacityCriticalPercent: original.capacityCriticalPercent,
    restoreDrillEnabled: original.restoreDrillEnabled,
    restoreDrillDay: original.restoreDrillDay,
    restoreDrillHour: original.restoreDrillHour,
  };

  try {
    await page.goto('/house/backups');
    await expect(page.getByRole('heading', { name: '系统备份', level: 1 })).toBeVisible();

    await page.getByLabel('保留天数').fill('21');
    const saved = waitFor(page, 'PUT', /\/system\/backups\/policy$/);
    await page.getByRole('button', { name: '保存策略' }).click();
    const savedResponse = await saved;
    expect(savedResponse.status(), await savedResponse.text()).toBe(200);
    await expect(page.getByLabel('保留天数')).toHaveValue('21');

    // 阈值填反了要被前端拦住，不该发请求
    await page.getByLabel('容量警告').fill('95');
    await page.getByLabel('容量严重').fill('90');
    await page.getByRole('button', { name: '保存策略' }).click();
    await expect(page.getByText('警告阈值要低于严重阈值')).toBeVisible();
  } finally {
    await api.put('/system/backups/policy', restore);
  }
});

test('家庭动态：写点什么就能在时间线上看到，点一下跳到那一页', async ({ page, request }) => {
  const api = apiClient(request);
  const name = stamp('说明');

  // 造一条一定会写活动流的动作：写一篇知识库文章
  await api.post('/knowledge-articles', {
    title: name,
    category: 'other',
    content: '活动流用例造的。',
    idempotencyKey: `e2e-activity-${Date.now()}`,
  });

  await page.goto('/life/activity');
  await expect(page.getByRole('heading', { name: '家庭动态', level: 1 })).toBeVisible();
  // 今天这一组里应该有刚才那条，而且能点进搬好的知识库页
  await expect(page.getByText(new RegExp(name))).toBeVisible();
  await expect(page.getByRole('heading', { name: '今天', level: 2 })).toBeVisible();

  // 「菜单」这一档只看菜单事件
  await page.getByRole('tab', { name: '菜单' }).click();
  await expect(page.getByRole('tab', { name: '菜单' })).toHaveAttribute('aria-selected', 'true');
});

test('片单：手动加一部、发起观影投票、再改成已排期', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('片');
  let mediaId: string | null = null;
  let pollId: string | null = null;

  try {
    await page.goto('/life/media/watchlist');
    await page.getByRole('button', { name: '+ 加进片单' }).click();
    const form = page.getByRole('dialog', { name: '加进家庭片单' });
    // 隔离库里三个元数据源都没配，所以走手动这条路
    await form.getByRole('button', { name: '都没有？手动填' }).click();
    await form.getByLabel('影视名称').fill(title);
    await form.getByLabel('年份').fill('2026');
    const created = waitFor(page, 'POST', /\/media$/);
    await form.getByRole('button', { name: '加进片单' }).click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    mediaId = ((await createdResponse.json()) as { data: { id: string } }).data.id;

    const card = page.getByRole('article', { name: title });
    await expect(card).toContainText('想看');

    // 发起单片投票：后端会把它置成「投票中」（所以要先投票再排期，
    // 排期之后投票入口就没了，投票期间也不让改状态）
    await card.getByRole('button', { name: `发起${title}的投票` }).click();
    const pollDialog = page.getByRole('dialog', { name: '发起观影投票' });
    const polled = waitFor(page, 'POST', /\/polls$/);
    await pollDialog.getByRole('button', { name: '发起投票' }).click();
    const polledResponse = await polled;
    expect(polledResponse.status(), await polledResponse.text()).toBe(201);
    pollId = ((await polledResponse.json()) as { data: { id: string } }).data.id;
    await expect(page.getByRole('article', { name: title })).toContainText('投票中');

    // 投票结束之后才能改状态
    await api.post(`/polls/${pollId}/close`, {});
    await page.reload();
    await page.getByRole('button', { name: '全部' }).click();
    const again = page.getByRole('article', { name: title });
    await again.getByRole('button', { name: `编辑${title}` }).click();
    const editor = page.getByRole('dialog', { name: `编辑「${title}」的安排` });
    await editor.getByRole('checkbox', { name: '安排观影日期' }).click();
    await editor.getByLabel('观影日期', { exact: true }).fill(tomorrow);
    const patched = waitFor(page, 'PATCH', /\/media\/[^/]+$/);
    await editor.getByRole('button', { name: '保存安排' }).click();
    expect((await patched).status(), await (await patched).text()).toBe(200);
    await expect(again).toContainText('已排期');
  } finally {
    if (pollId) await api.post(`/polls/${pollId}/close`, {}).catch(() => undefined);
    if (mediaId) await api.delete(`/media/${mediaId}`).catch(() => undefined);
  }
});

test('观影设置：改媒体服务地址和搜索数据源，再恢复服务器默认', async ({ page, request }) => {
  const api = apiClient(request);
  const plexUrl = 'http://192.168.1.60:32400';
  const doubanUrl = 'https://frodo.douban.com/api/v2';

  try {
    await page.goto('/life/media/settings');

    // 媒体服务：只改地址，凭据一律不碰（真凭据不该出现在测试库里）
    await page.getByLabel('Plex 服务地址').fill(plexUrl);
    const saved = waitFor(page, 'PUT', /\/media\/connector-settings\/plex$/);
    await page.getByRole('button', { name: '保存 Plex' }).click();
    const savedResponse = await saved;
    expect(savedResponse.status(), await savedResponse.text()).toBe(200);

    // 存下来的东西刷新之后还在，而且这条从「服务器默认」变成了「家庭设置」
    await page.reload();
    await expect(page.getByLabel('Plex 服务地址')).toHaveValue(plexUrl);
    const reset = waitFor(page, 'DELETE', /\/media\/connector-settings\/plex$/);
    await page.getByRole('button', { name: '恢复Plex默认设置' }).click();
    expect((await reset).status()).toBe(200);
    await expect(page.getByLabel('Plex 服务地址')).toHaveValue('');

    // 搜索数据源
    await page.getByRole('tab', { name: '搜索数据源' }).click();
    await page.getByLabel('豆瓣 API 地址').fill(doubanUrl);
    const sourceSaved = waitFor(page, 'PUT', /\/media\/metadata-sources\/douban$/);
    await page.getByRole('button', { name: '保存 豆瓣' }).click();
    const sourceResponse = await sourceSaved;
    expect(sourceResponse.status(), await sourceResponse.text()).toBe(200);
    await page.reload();
    await page.getByRole('tab', { name: '搜索数据源' }).click();
    await expect(page.getByLabel('豆瓣 API 地址')).toHaveValue(doubanUrl);

    // 用户映射这一档：隔离库里两台媒体服务都没连上，给的是「怎么回事」而不是空白
    await page.getByRole('tab', { name: '用户映射' }).click();
    await expect(page.getByRole('button', { name: '刷新媒体用户' })).toBeVisible();
  } finally {
    await api.delete('/media/connector-settings/plex').catch(() => undefined);
    await api.delete('/media/metadata-sources/douban').catch(() => undefined);
  }
});

// 隔离测试库里的 x-test-clock 仅在 NODE_ENV=test 生效；页面时间使用 Playwright 时钟。
for (const time of ['07:00', '23:30']) {
  test(`资产维护：家庭 ${time} 用默认今天完成，明天被拒`, async ({ page, request }) => {
    const api = apiClient(request);
    const today = householdToday('Asia/Shanghai');
    const frozenNow = `${today}T${time}:00+08:00`;
    await page.clock.install({ time: new Date(frozenNow) });
    const asset = await api.post<{ id: string }>('/assets', {
      name: stamp('日期边界设备'), category: 'appliance',
    });
    try {
      const plan = await api.post<{ id: string }>(`/assets/${asset.id}/maintenance-plans`, {
        title: stamp('日期边界计划'), frequencyDays: 30, nextDueDate: today,
      });
      await page.route(/\/maintenance-plans\/[^/]+\/complete$/, (route) =>
        route.continue({ headers: { ...route.request().headers(), 'x-test-clock': frozenNow } }));
      await page.goto(`/house/assets/${asset.id}`);
      const card = page.getByRole('button', { name: '完成维护' }).first();
      await card.click();
      let dialog = page.getByRole('dialog', { name: '确认完成维护' });
      await expect(dialog.getByLabel('实际完成日期')).toHaveValue(today);
      await dialog.getByLabel('实际完成日期').fill(addDays(today, 1));
      const rejected = waitFor(page, 'POST', /\/maintenance-plans\/[^/]+\/complete$/);
      await dialog.getByRole('button', { name: /确认完成/ }).click();
      expect((await rejected).status()).toBe(400);
      await dialog.getByRole('button', { name: '关闭' }).click();
      await card.click();
      dialog = page.getByRole('dialog', { name: '确认完成维护' });
      await expect(dialog.getByLabel('实际完成日期')).toHaveValue(today);
      const accepted = waitFor(page, 'POST', /\/maintenance-plans\/[^/]+\/complete$/);
      await dialog.getByRole('button', { name: /确认完成/ }).click();
      expect((await accepted).status()).toBe(201);
      const details = await api.get<{ maintenanceRecords: { planId: string; performedOn: string }[] }>(`/assets/${asset.id}`);
      expect(details.maintenanceRecords.some((item) => item.planId === plan.id && item.performedOn === today)).toBe(true);
    } finally {
      await api.patch(`/assets/${asset.id}`, { status: 'retired' });
    }
  });
}

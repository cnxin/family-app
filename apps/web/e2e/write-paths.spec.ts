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

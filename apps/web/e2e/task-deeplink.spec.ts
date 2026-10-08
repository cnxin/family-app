import { expect, test, type Page } from '@playwright/test';
import { addDays, householdToday } from '@family/shared';
import { apiClient, stamp } from './helpers';

// 深链约定 `task` / `taskId`（+ `date`）：/schedule/tasks?task=<id>（「晾衣服」留意卡）或 ?date=<d>&taskId=<id>
// （后端通知、日历、提醒、动态、小管家写的 targetPath；旧路径 /tasks?… 会带着查询串跳过来）。
// 滚到那一次并高亮 2 秒；date 在两周显示范围里取那天，否则今天优先、再否则最早；处理完 task / taskId / date 一起抹。

/** 没有实例行的那一次，occurrence id 是 task:<taskId>:<date>（tasks.module.ts presentOccurrence） */
const occurrenceRow = (page: Page, taskId: string, date: string) =>
  page.locator(`[data-task-occurrence="task:${taskId}:${date}"]`);

test('任务页 ?task=<id>：滚到那件、高亮 2 秒后消退，参数从 URL 抹掉；没有这件也不报错', async ({ page, request }) => {
  const admin = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const title = stamp('深链任务');
  const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: today });
  try {
    await page.goto(`/schedule/tasks?task=${task.id}`);
    const row = page.locator('[data-task-occurrence]').filter({ hasText: title });
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
    await expect(row).not.toHaveAttribute('data-highlighted', 'true', { timeout: 4_000 });

    await page.goto('/schedule/tasks?task=00000000-0000-4000-8000-00000000abcd');
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
    await expect(page.locator('[data-highlighted]')).toHaveCount(0);
  } finally {
    await admin.patch(`/tasks/${task.id}`, { isArchived: true });
  }
});

test('任务页 ?date=&taskId=（通知的写法）：date 在两周内就亮那天那一次，三个参数一起抹；只带 date 不动', async ({ page, request }) => {
  const admin = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const target = addDays(today, 3);
  const title = stamp('深链每天');
  const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: today, recurrence: 'daily' });
  try {
    await page.goto(`/schedule/tasks?date=${target}&taskId=${task.id}`);
    await expect(occurrenceRow(page, task.id, target)).toHaveAttribute('data-highlighted', 'true');
    await expect(occurrenceRow(page, task.id, target)).toBeInViewport();
    await expect(occurrenceRow(page, task.id, today)).not.toHaveAttribute('data-highlighted', 'true');
    await expect(page).toHaveURL(/\/schedule\/tasks$/);

    // 只带 date 不是深链：列表出来以后不高亮、参数原样留着
    await page.goto(`/schedule/tasks?date=${target}`);
    await expect(occurrenceRow(page, task.id, target)).toBeVisible();
    await expect(page.locator('[data-highlighted]')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/schedule/tasks\\?date=${target}$`));
  } finally {
    await admin.patch(`/tasks/${task.id}`, { isArchived: true });
  }
});

test('旧路径 /tasks?date=&taskId=：带着查询串跳到 /schedule/tasks 再处理；date 出了两周退回今天那一次；没有这件只抹参数', async ({ page, request }) => {
  const admin = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const inRange = addDays(today, 5);
  const title = stamp('深链旧路径');
  const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: today, recurrence: 'daily' });
  try {
    await page.goto(`/tasks?date=${inRange}&taskId=${task.id}`);
    await expect(occurrenceRow(page, task.id, inRange)).toHaveAttribute('data-highlighted', 'true');
    await expect(page).toHaveURL(/\/schedule\/tasks$/);

    // 显示范围是 today～today+13，第 14 天不在范围
    await page.goto(`/tasks?date=${addDays(today, 14)}&taskId=${task.id}`);
    await expect(occurrenceRow(page, task.id, today)).toHaveAttribute('data-highlighted', 'true');
    await expect(page).toHaveURL(/\/schedule\/tasks$/);

    await page.goto(`/tasks?date=${inRange}&taskId=00000000-0000-4000-8000-00000000abcd`);
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
    await expect(page.locator('[data-highlighted]')).toHaveCount(0);
  } finally {
    await admin.patch(`/tasks/${task.id}`, { isArchived: true });
  }
});

test('消息：点「给你安排了」通知（每天的家务、date 是昨天）→ 任务页亮今天那一次，参数抹掉', async ({ page, request }) => {
  const dad = apiClient(request);
  const mom = apiClient(request, '妈妈');
  const today = householdToday('Asia/Shanghai');
  const title = stamp('深链通知');
  // tasks.module.ts createWithinTransaction：指派给别人 → task_assigned，targetPath=/tasks?date=<startsOn>&taskId=<id>
  const task = await mom.post<{ id: string }>('/tasks', {
    title,
    startsOn: addDays(today, -1),
    recurrence: 'daily',
    defaultAssigneeId: dad.memberId,
  });
  try {
    await page.goto('/schedule/notifications');
    // 行内「标为已读」按钮的文字是 ✓（aria-label 里才有标题），按文字过滤只命中主按钮
    await page.getByRole('button').filter({ hasText: title }).click();
    const row = occurrenceRow(page, task.id, today);
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
  } finally {
    await mom.delete(`/tasks/${task.id}`);
  }
});

test('消息：点「交给了你」通知（date 是第 4 天）→ 任务页亮那天那一次，不是今天', async ({ page, request }) => {
  const dad = apiClient(request);
  const mom = apiClient(request, '妈妈');
  const today = householdToday('Asia/Shanghai');
  const target = addDays(today, 3);
  const title = stamp('深链改派');
  const task = await mom.post<{ id: string }>('/tasks', { title, startsOn: today, recurrence: 'daily' });
  try {
    // tasks.module.ts updateOccurrence：创建者把某一次交给别人 → task_assigned，targetPath=/tasks?date=<dueDate>&taskId=<id>
    // 这一次因此有了实例行，id 是实例 uuid，从响应里拿
    const handed = await mom.patch<{ id: string }>(`/tasks/${task.id}/instances/${target}`, { assigneeId: dad.memberId });
    await page.goto('/schedule/notifications');
    await page.getByRole('button').filter({ hasText: `把「${title}」交给了你` }).click();
    const row = page.locator(`[data-task-occurrence="${handed.id}"]`);
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(occurrenceRow(page, task.id, today)).not.toHaveAttribute('data-highlighted', 'true');
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
  } finally {
    await mom.delete(`/tasks/${task.id}`);
  }
});

test('任务页缓存过期时先等重取：看过任务页再去消息页点刚到的指派，也能亮那件', async ({ page, request, isMobile }) => {
  const dad = apiClient(request);
  const mom = apiClient(request, '妈妈');
  const today = householdToday('Asia/Shanghai');
  const title = stamp('深链缓存');
  // 先在任务页把两周列表拉进缓存，并等 /events 连上（妈妈的写入要靠它把这份缓存标成过期）
  const eventsConnected = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.status() === 200,
  );
  const tasksLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/tasks' && response.ok());
  await page.goto('/schedule/tasks');
  await Promise.all([eventsConnected, tasksLoaded]);

  // 站内切到消息页。不能用 page.goto：整页刷新会把缓存丢掉（导航写法照 nav.spec.ts）
  if (isMobile) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '日程', exact: true }).dispatchEvent('pointerdown');
    await page.getByRole('menu', { name: '日程的功能' }).getByRole('link', { name: /^消息/ }).click();
  } else {
    await page.getByRole('navigation', { name: '功能导航' }).getByRole('link', { name: /^消息/ }).click();
  }
  await expect(page).toHaveURL(/\/schedule\/notifications$/);

  const task = await mom.post<{ id: string }>('/tasks', { title, startsOn: today, defaultAssigneeId: dad.memberId });
  try {
    // 这条通知只能等 /events 推过来再重取才出现；同一次推送已经把 ['tasks', …] 标成过期
    const item = page.getByRole('button').filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.click();
    const row = occurrenceRow(page, task.id, today);
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
  } finally {
    await mom.delete(`/tasks/${task.id}`);
  }
});

test('日历「流」视图点任务条目：带着 taskId / date 到任务页，亮那一次', async ({ page, request }) => {
  const admin = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const target = addDays(today, 2);
  const title = stamp('日历进任务');
  const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: target });
  try {
    await page.goto('/schedule/calendar?view=agenda');
    // 流视图里点这一条先打开那天的弹层，弹层里的条目才跳转（calendar.tsx useOpenEntry）
    await page.getByRole('button').filter({ hasText: title }).first().click();
    const day = page.locator('[data-dialog-place="center"]');
    await expect(day).toBeVisible();
    await day.getByRole('button').filter({ hasText: title }).click();
    const row = occurrenceRow(page, task.id, target);
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
  } finally {
    await admin.patch(`/tasks/${task.id}`, { isArchived: true });
  }
});

test('提醒页点任务来源的提醒：带着 taskId / date 到任务页，亮那一次', async ({ page, request }) => {
  const admin = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const target = addDays(today, 2);
  const title = stamp('提醒进任务');
  const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: target });
  const reminder = await admin.post<{ id: string }>('/reminders', {
    sourceModule: 'task',
    sourceId: task.id,
    occurrenceDate: target,
    remindAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    recipientIds: [admin.memberId],
  });
  try {
    await page.goto('/schedule/reminders');
    // 编辑 / 删除按钮的标题只在 aria-label 里，按文字过滤只命中打开来源的那个按钮
    await page.getByRole('button').filter({ hasText: title }).click();
    const row = occurrenceRow(page, task.id, target);
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
  } finally {
    await admin.delete(`/reminders/${reminder.id}`).catch(() => undefined);
    await admin.patch(`/tasks/${task.id}`, { isArchived: true });
  }
});

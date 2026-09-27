import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { householdToday } from '@family/shared';
import { apiClient, apiURL, stamp } from './helpers';

function waitFor(page: Page, method: string, pattern: RegExp) {
  return page.waitForResponse(
    (response) => response.request().method() === method && pattern.test(new URL(response.url()).pathname),
  );
}

test('任务页：点开任务改名称、指派和积分，刷新后仍在', async ({ page, request }) => {
  const api = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const members = await api.get<{ id: string; name: string }[]>('/members');
  const mom = members.find((member) => member.name === '妈妈');
  expect(mom).toBeTruthy();
  const original = stamp('改我');
  const task = await api.post<{ id: string }>('/tasks', { title: original, startsOn: today, recurrence: 'once' });
  const renamed = stamp('改好了');
  try {
    await page.goto('/schedule/tasks');
    await page.getByRole('button', { name: `看看${original}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-task-detail]')).toContainText('还没人认领');
    await dialog.getByRole('button', { name: '编辑' }).click();
    await dialog.getByLabel('任务名称').fill(renamed);
    await dialog.getByLabel('谁来做').selectOption(mom!.id);
    await dialog.getByLabel('做完给多少积分').fill('5');
    const patched = waitFor(page, 'PATCH', new RegExp(`/tasks/${task.id}$`));
    await dialog.getByRole('button', { name: '保存' }).click();
    const response = await patched;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ title: renamed, defaultAssigneeId: mom!.id, rewardPoints: 5 });
    await expect(dialog).toBeHidden();

    await page.reload();
    await page.getByRole('button', { name: `看看${renamed}` }).click();
    const detail = page.getByRole('dialog').locator('[data-task-detail]');
    await expect(detail).toContainText('妈妈');
    await expect(detail).toContainText('做完 +5');
  } finally {
    await api.delete(`/tasks/${task.id}`);
  }
});

test('今天页：点开一次性任务删除，列表里不再出现', async ({ page, request }) => {
  const api = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const title = stamp('删我');
  const task = await api.post<{ id: string }>('/tasks', { title, startsOn: today, recurrence: 'once' });
  await page.goto('/');
  await page.getByRole('button', { name: `看看${title}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect(dialog.getByRole('button', { name: /只删这次/ })).toHaveCount(0);
  const deleted = waitFor(page, 'DELETE', new RegExp(`/tasks/${task.id}$`));
  await dialog.getByRole('button', { name: '删除这个任务' }).click();
  expect((await deleted).status()).toBe(200);
  await expect(page.getByRole('button', { name: `看看${title}` })).toHaveCount(0);
});

test('重复任务删除时问一次：只删这次跳过当天，全部删掉以后都不出现', async ({ page, request }) => {
  const api = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const title = stamp('每天');
  const task = await api.post<{ id: string }>('/tasks', { title, startsOn: today, recurrence: 'daily' });
  try {
    await page.goto('/schedule/tasks');
    const rows = page.getByRole('button', { name: `看看${title}` });
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    await rows.first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '删除' }).click();
    const skipped = waitFor(page, 'PATCH', new RegExp(`/tasks/${task.id}/instances/${today}$`));
    await dialog.getByRole('button', { name: `只删这次（${today}）` }).click();
    const skipResponse = await skipped;
    expect(skipResponse.status()).toBe(200);
    expect(((await skipResponse.json()) as { data: { status: string } }).data.status).toBe('skipped');
    await expect(dialog).toBeHidden();

    await rows.last().click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '删除' }).click();
    const archived = waitFor(page, 'DELETE', new RegExp(`/tasks/${task.id}$`));
    await dialog.getByRole('button', { name: '全部删掉，以后都不出现' }).click();
    expect((await archived).status()).toBe(200);
    await expect(rows).toHaveCount(0);
  } finally {
    await api.delete(`/tasks/${task.id}`).catch(() => undefined);
  }
});

test.describe('普通成员', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('别人建的任务只能看，不给编辑和删除', async ({ page, request }) => {
    const admin = apiClient(request);
    const today = householdToday('Asia/Shanghai');
    const title = stamp('爸爸建的');
    const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: today, recurrence: 'once' });
    const invitation = await admin.post<{ invitationToken: string }>('/household/invitations', {
      memberName: stamp('只看'),
      role: 'member',
      expiresInHours: 1,
    });
    const redeemed = await request.post(`${apiURL}/auth/invitations/redeem`, {
      data: { invitationToken: invitation.invitationToken, loginName: `view-${randomUUID().slice(0, 8)}`, password: 'view-pass-1234' },
    });
    const session = ((await redeemed.json()) as { data: { member: { id: string } } }).data;
    try {
      await page.addInitScript((value) => localStorage.setItem('family-app.session', value), JSON.stringify(session));
      await page.goto('/schedule/tasks');
      await page.getByRole('button', { name: `看看${title}` }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-task-detail]')).toContainText('只有建的人和管理员能改');
      await expect(dialog.getByRole('button', { name: '编辑' })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '删除' })).toHaveCount(0);
    } finally {
      await admin.delete(`/tasks/${task.id}`);
      await admin.patch(`/household/members/${session.member.id}/status`, { enabled: false });
    }
  });
});

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiClient, apiURL, freshMemberSession, seedSession, stamp } from './helpers';

interface MemoryItem {
  id: string;
  version: number;
  scope: 'member_private' | 'household';
  status: string;
}

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && pathPattern.test(new URL(response.url()).pathname),
  );
}

/** 用某个令牌直接记一条并确认，让用例从「已生效」开始。 */
async function confirmedMemory(request: APIRequestContext, token: string, content: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`${apiURL}/agent/memories/candidates`, {
    headers,
    data: { content, memoryKey: 'other' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const candidate = ((await created.json()) as { data: MemoryItem }).data;
  const confirmed = await request.post(`${apiURL}/agent/memories/${candidate.id}/confirm`, {
    headers,
    data: { expectedVersion: candidate.version },
  });
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  return ((await confirmed.json()) as { data: MemoryItem }).data;
}

test('小管家记忆：把一条已生效的记忆共享到家庭，出现在「家庭共享」里', async ({ page, request }) => {
  const dad = apiClient(request);
  const dadToken = dad.accessToken;
  const content = stamp('共享记忆');
  const memory = await confirmedMemory(request, dadToken, content);
  let shared: MemoryItem | null = null;

  try {
    await page.goto('/me/assistant/memories');
    const card = page.getByRole('button', { name: `其他信息：${content}` });
    await card.click();
    const detail = page.getByRole('dialog', { name: '其他信息' });
    await expect(detail).toContainText('只有自己看得到');
    const shareResponse = waitFor(page, 'POST', /\/agent\/memories\/[^/]+\/share$/);
    await detail.getByRole('button', { name: '共享到家庭' }).click();
    const response = await shareResponse;
    expect(response.status(), await response.text()).toBe(201);
    shared = ((await response.json()) as { data: MemoryItem }).data;
    expect(shared.scope).toBe('household');
    await expect(detail).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: '已共享到家庭' })).toBeVisible();

    // 个人那份被并掉，「我的记忆」里不再有它
    await expect(card).toBeHidden();
    await page.getByRole('tab', { name: '家庭共享' }).click();
    const sharedCard = page.getByRole('button', { name: `其他信息：${content}` });
    await expect(sharedCard).toBeVisible();
    await sharedCard.click();
    await expect(page.getByRole('dialog', { name: '其他信息' })).toContainText('家庭共享');
  } finally {
    const target = shared ?? memory;
    const latest = (await dad.get<MemoryItem[]>(`/agent/memories?scope=${target.scope}&status=active`)).find(
      (one) => one.id === target.id,
    );
    if (latest) {
      const forgotten = await request.delete(`${apiURL}/agent/memories/${latest.id}`, {
        headers: { Authorization: `Bearer ${dadToken}` },
        data: { expectedVersion: latest.version },
      });
      expect(forgotten.ok(), `忘掉共享记忆 → ${forgotten.status()}`).toBeTruthy();
    }
  }
});

test.describe('清空记忆只动自己的', () => {
  // 清空是按「本人」算的；换一个现开的成员来清，不碰爸爸在别的用例里记的东西
  test.use({ storageState: { cookies: [], origins: [] } });

  test('小管家记忆：清空我的记忆，已生效和待确认都清掉', async ({ page, request }) => {
    const admin = apiClient(request);
    const session = await freshMemberSession(request, '清空记忆');
    try {
      const kept = stamp('已生效记忆');
      const pending = stamp('待确认记忆');
      await confirmedMemory(request, session.accessToken, kept);
      const candidate = await request.post(`${apiURL}/agent/memories/candidates`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        data: { content: pending, memoryKey: 'other' },
      });
      expect(candidate.status(), await candidate.text()).toBe(201);

      await seedSession(page, session);
      await page.goto('/me/assistant/memories');
      await expect(page.getByRole('button', { name: `其他信息：${kept}` })).toBeVisible();

      await page.getByRole('button', { name: '清空我的记忆' }).click();
      const dialog = page.getByRole('dialog', { name: '清空我的记忆？' });
      const cleared = waitFor(page, 'DELETE', /\/agent\/memories$/);
      await dialog.getByRole('button', { name: '全部忘掉' }).click();
      const response = await cleared;
      expect(response.status(), await response.text()).toBe(200);
      expect(((await response.json()) as { data: { forgottenCount: number } }).data.forgottenCount).toBe(2);
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('alert').filter({ hasText: '已忘掉 2 条' })).toBeVisible();

      await expect(page.getByText('这里还什么都没记')).toBeVisible();
      await expect(page.getByRole('button', { name: `其他信息：${kept}` })).toHaveCount(0);
      await page.getByRole('tab', { name: '待确认' }).click();
      await expect(page.getByText('没有待确认的记忆')).toBeVisible();
    } finally {
      await admin.patch(`/household/members/${session.member.id}/status`, { enabled: false });
    }
  });
});

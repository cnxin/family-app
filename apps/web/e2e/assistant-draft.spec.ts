import { expect, test } from '@playwright/test';
import { apiClient } from './helpers';

// 旧客户端踩过的坑：点「新对话」把输入框里没发出去的草稿一起清掉了。草稿属于输入框，不属于某次会话。
test('小管家：点「+ 新对话」不清掉输入框里的草稿', async ({ page, request }) => {
  const api = apiClient(request);
  const draft = `e2e 草稿：周末带孩子去哪儿玩 ${Date.now().toString(36)}`;
  let conversationId: string | null = null;

  try {
    await page.goto('/me/assistant');
    const input = page.getByRole('textbox', { name: '问小管家' });
    await expect(input).toBeEnabled();
    await input.fill(draft);

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/agent/conversations',
    );
    await page.getByRole('button', { name: '+ 新对话' }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    conversationId = ((await response.json()) as { data: { id: string } }).data.id;

    // 新会话落地（列表里多出一条、按钮恢复可点）之后草稿仍在
    await expect(page.getByRole('button', { name: '+ 新对话' })).toBeEnabled();
    await page.waitForLoadState('networkidle');
    await expect(input).toHaveValue(draft);
    await expect(page.getByRole('button', { name: '发送问题' })).toBeEnabled();
  } finally {
    if (conversationId) await api.delete(`/agent/conversations/${conversationId}`);
  }
});

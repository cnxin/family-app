import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEFAULT_SMART_HOME_RULES } from '@family/contracts';
import { apiClient, apiURL } from './helpers';

// H3 E3：「假 HA」就是这个测试进程——按设置页生成的 HA 模板同样的算法签名，打真实的 webhook 端点；
// 页面打真实 /events，不刷新。

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function sendFromHomeAssistant(request: APIRequestContext, path: string, secret: string, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return request.post(`${apiURL}${path}`, {
    data: raw,
    headers: {
      'Content-Type': 'application/json',
      'X-Family-Timestamp': timestamp,
      'X-Family-Signature': sha256(secret + sha256(`${secret}${timestamp}.${raw}`)),
    },
  });
}

function eventsConnected(page: Page) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.status() === 200,
  );
}

async function cleanUp(request: APIRequestContext) {
  const admin = apiClient(request);
  await admin.put('/smart-home/webhook-settings/rules', DEFAULT_SMART_HOME_RULES);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const occurrences = await admin.get<{ taskId: string; task: { title: string } }[]>(`/tasks?start=${today}&end=${today}`);
  for (const occurrence of occurrences.filter((one) => one.task.title === '晾衣服')) {
    await admin.patch(`/tasks/${occurrence.taskId}`, { isArchived: true });
  }
  // 联动给全家发了通知：清掉，免得影响别的用例里的未读数
  await admin.patch('/notifications/read-all', {});
}

test.afterEach(async ({ request }) => cleanUp(request));

test('假 HA 打来「烘干完成」：今天页不刷新就出现「晾衣服」家务', async ({ page, request }) => {
  const admin = apiClient(request);
  const { secret, path } = await admin.post<{ secret: string; path: string }>('/smart-home/webhook-settings/secret', {});

  const connected = eventsConnected(page);
  await page.goto('/');
  await connected;
  await expect(page.getByText('晾衣服', { exact: true })).toHaveCount(0);

  const response = await sendFromHomeAssistant(request, path, secret, {
    eventId: `ctx-${randomUUID()}`,
    event: 'laundry_done',
    appliance: 'dryer',
    entityId: 'binary_sensor.dryer_running',
  });
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { data: { result: string } }).data.result).toContain('建了家务「晾衣服」');
  await expect(page.getByText('晾衣服', { exact: true }).first()).toBeVisible({ timeout: 3_000 });

  // 签名不对的一律 401，页面上什么都不多
  const forged = await sendFromHomeAssistant(request, path, `wrong-${secret}`, {
    eventId: `ctx-${randomUUID()}`,
    event: 'laundry_done',
  });
  expect(forged.status()).toBe(401);
});

test('设置页联动：生成密钥后给出可直接粘贴的 HA 配置，改开关，收到的事件列在下面', async ({ page, request }) => {
  const admin = apiClient(request);
  await page.goto('/house/smart-home/settings?section=linkages');
  await page.getByRole('button', { name: /生成密钥和 HA 配置|换一把新密钥并生成 HA 配置/ }).click();
  const config = page.locator('[data-smart-home-ha-config]');
  await expect(config).toBeVisible();
  const restCommand = config.getByRole('textbox', { name: /configuration\.yaml/ });
  await expect(restCommand).toHaveValue(/rest_command:\n {2}family_app_event:/);
  await expect(restCommand).toHaveValue(/\/api\/smart-home\/webhook\/[0-9a-f-]{36}"/);
  await expect(restCommand).toHaveValue(/X-Family-Signature: "\{\{ sha256\('[A-Za-z0-9_-]+' ~ sha256\(/);

  // 关掉「扫完打勾」并保存
  const vacuum = page.locator('[data-smart-home-rule="vacuum"]');
  await vacuum.getByRole('checkbox').click();
  await page.getByRole('button', { name: '保存联动设置' }).click();
  await expect(page.getByRole('button', { name: '保存联动设置' })).toHaveCount(0);
  expect((await admin.get<{ rules: { vacuum: { enabled: boolean } } }>('/smart-home/webhook-settings')).rules.vacuum.enabled).toBe(false);

  // 页面上拿到的密钥就是能用的密钥：用它签一条 ping，事件列表里出现
  const secret = (await restCommand.inputValue()).match(/sha256\('([A-Za-z0-9_-]+)'/)![1];
  const { path } = await admin.get<{ path: string }>('/smart-home/webhook-settings');
  const ping = await sendFromHomeAssistant(request, path, secret, { eventId: `ctx-${randomUUID()}`, event: 'ping' });
  expect(ping.status()).toBe(200);
  await expect(page.locator('[data-smart-home-webhook-events] li').first()).toContainText('连通了', { timeout: 3_000 });
});

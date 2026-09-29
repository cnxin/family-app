import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiClient, apiURL, stamp } from './helpers';

// H3 E4：真 API + 假 Home Assistant。在设置页建联动「打扫就扫地」，到家务页把「打扫…」打勾，
// 假 HA 收到 vacuum.start；HA 出错时打勾照常，联动上显示「没执行成功」。
// E5 起顺带验设置页「最近的操作」按来源筛。只在桌面项目跑一次：手机布局在别的 smart-home 用例里已经覆盖，这里只验链路（CI 时长吃紧）。

interface FakeHomeAssistant {
  url: string;
  serviceMode: 'ok' | 'fail' | 'hang';
  serviceCalls: { domain: string; service: string; data: { entity_id?: string } }[];
  stop(): Promise<void>;
}

// 运行时再加载、类型在这里声明：前端镜像只带 apps/web（教训 33）
const FAKE_HA_MODULE = new URL('../../api/scripts/fake-ha.mjs', import.meta.url).href;
async function startFakeHomeAssistant(options: { token: string }): Promise<FakeHomeAssistant> {
  const module = (await import(FAKE_HA_MODULE)) as {
    startFakeHomeAssistant(options: { token: string }): Promise<FakeHomeAssistant>;
  };
  return module.startFakeHomeAssistant(options);
}

const TOKEN = 'e2e-home-assistant-long-lived-token-0005';

async function cleanSmartHome(request: APIRequestContext) {
  const admin = apiClient(request);
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  for (const link of await admin.get<{ id: string }[]>('/smart-home/links')) await admin.delete(`/smart-home/links/${link.id}`);
  for (const device of await admin.get<{ id: string }[]>('/smart-home/devices')) {
    await admin.delete(`/smart-home/devices/${device.id}`);
  }
  await request.delete(`${apiURL}/smart-home/connector-settings`, { headers });
}

test('设置页建联动「打扫就扫地」：家务打勾后扫地机开扫；HA 出错时打勾照常、联动上显示没执行成功', async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '链路只在桌面项目验一次');
  const ha = await startFakeHomeAssistant({ token: TOKEN });
  const admin = apiClient(request);
  const titles = [stamp('打扫卫生'), stamp('打扫厨房')];
  try {
    await cleanSmartHome(request);
    await admin.put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
    const vacuum = await admin.post<{ id: string }>('/smart-home/devices', { haDeviceId: 'dev_roborock' });
    await admin.patch(`/smart-home/devices/${vacuum.id}`, { displayName: '扫地机', area: '客厅', controllable: true });

    // 设置页建联动
    await page.goto('/house/smart-home/settings?section=linkages');
    const form = page.locator('[data-smart-home-link-form]');
    await form.getByLabel('联动名字').fill('打扫就扫地');
    await form.getByLabel('标题关键词').fill('打扫');
    await expect(form.getByLabel('联动目标设备')).toHaveValue(vacuum.id);
    await expect(form.getByLabel('联动动作')).toHaveValue('start');
    await form.getByRole('button', { name: '建这条联动' }).click();
    const row = page.locator('[data-smart-home-link="打扫就扫地"]');
    await expect(row).toContainText('标题含「打扫」的家务打勾后 → 扫地机：开始清扫');
    await expect(row).toContainText('还没跑过');

    // 家务页加一件「打扫…」并打勾：扫地机开扫
    await page.goto('/schedule/tasks');
    await page.getByPlaceholder('加一件今天要做的事').fill(titles[0]);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.getByRole('checkbox', { name: `完成${titles[0]}` }).click();
    await expect(page.getByRole('checkbox', { name: `完成${titles[0]}` })).toBeChecked();
    await expect.poll(() => ha.serviceCalls.filter((call) => call.service === 'start').length).toBe(1);

    // HA 出错：打勾照常；联动上看得到没执行成功
    ha.serviceMode = 'fail';
    await page.getByPlaceholder('加一件今天要做的事').fill(titles[1]);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.getByRole('checkbox', { name: `完成${titles[1]}` }).click();
    await expect(page.getByRole('checkbox', { name: `完成${titles[1]}` })).toBeChecked();
    await page.goto('/house/smart-home/settings?section=linkages');
    await expect(row).toContainText('没执行成功', { timeout: 5_000 });

    // E5：设置页「最近的操作」按来源筛——联动按的两次都在「联动」下、写着是哪条联动；「手动」下没有
    await page.goto('/house/smart-home/settings');
    const log = page.locator('[data-smart-home-commands]');
    await expect(log.locator('[data-operation-kind="link"]')).toHaveCount(2);
    const sources = page.getByRole('tablist', { name: '按来源筛' });
    await sources.getByRole('tab', { name: '联动' }).click();
    await expect(log).toHaveAttribute('data-source', 'link');
    await expect(log.locator('li')).toHaveCount(2);
    await expect(log.locator('li').first()).toContainText('联动「打扫就扫地」 · 扫地机');
    await expect(log.locator('li').first()).toContainText('失败');
    await sources.getByRole('tab', { name: '手动' }).click();
    await expect(log).toHaveAttribute('data-source', 'manual');
    await expect(log.locator('[data-operation-kind="link"]')).toHaveCount(0);
  } finally {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const occurrences = await admin.get<{ taskId: string; task: { title: string } }[]>(`/tasks?start=${today}&end=${today}`);
    for (const occurrence of occurrences.filter((one) => titles.includes(one.task.title))) {
      await admin.patch(`/tasks/${occurrence.taskId}`, { isArchived: true });
    }
    await cleanSmartHome(request);
    await ha.stop();
  }
});

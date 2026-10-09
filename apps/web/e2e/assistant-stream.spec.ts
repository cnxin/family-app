import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient } from './helpers';

/**
 * J4.4 流式：运行方式切到「小管家自带」，模型是本进程里起的假模型服务（apps/api/scripts/fake-model.mjs，
 * 作答按段慢慢吐）。问「记一笔 38 买菜」→ 字一段段长出来 → 提案卡出现 → 落库后换成正式气泡；
 * 全程走 /events 推送，不按 run 轮询（GET /agent/runs/* 为 0）。/events 连不上时退回 2 秒轮询。
 * 截图存到仓库根的 .tmp-shots/。
 */

const FAKE_MODEL_MODULE = new URL('../../api/scripts/fake-model.mjs', import.meta.url).href;
const ANSWER = '已经起草了一笔 38 元的买菜支出，你在下面确认后才会入账。';

interface FakeModel {
  key: string;
  url: string;
  stop(): Promise<void>;
}

type Api = ReturnType<typeof apiClient>;

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

async function startModel(chunkMs: number) {
  const { startFakeModel } = (await import(FAKE_MODEL_MODULE)) as {
    startFakeModel: (options: { chunkMs: number }) => Promise<FakeModel>;
  };
  return startFakeModel({ chunkMs });
}

/** 配好假模型、测通、切到 native；返回还原函数。 */
async function useNative(api: Api, model: FakeModel) {
  const before = await api.get<{ runtimeKind: string; enabled: boolean; version: number }>('/agent/settings');
  await api.patch('/agent/settings', {
    providerKind: 'custom',
    providerBaseUrl: model.url,
    providerModel: 'fake-model',
    providerKey: model.key,
    expectedVersion: before.version,
  });
  const checked = await api.post<{ ok: boolean; settings: { version: number } }>('/agent/settings/provider-check', {});
  expect(checked.ok).toBe(true);
  await api.patch('/agent/settings', { runtimeKind: 'native', enabled: true, expectedVersion: checked.settings.version });
  return async () => {
    const now = await api.get<{ version: number }>('/agent/settings');
    await api.patch('/agent/settings', {
      runtimeKind: before.runtimeKind,
      enabled: before.enabled,
      providerKind: null,
      providerBaseUrl: null,
      providerModel: null,
      providerKey: null,
      expectedVersion: now.version,
    });
  };
}

/** 开一个新对话，问一句。 */
async function ask(page: Page, text: string) {
  await page.getByRole('button', { name: '+ 新对话' }).click();
  await expect(page.getByText('想了解家里的什么？')).toBeVisible();
  await page.getByRole('textbox', { name: '问小管家' }).fill(text);
  await page.getByRole('button', { name: '发送问题' }).click();
}

const isDetail = (url: string) => /\/agent\/conversations\/[0-9a-f-]{36}$/.test(new URL(url).pathname);

test('小管家自带：回答一段段长出来，提案卡跟着出现，不按 run 轮询', async ({ page, request, isMobile }) => {
  const model = await startModel(250);
  const restore = await useNative(apiClient(request), model);
  const runPolls: string[] = [];
  page.on('request', (sent) => {
    if (sent.method() === 'GET' && new URL(sent.url()).pathname.includes('/agent/runs/')) runPolls.push(sent.url());
  });
  try {
    const connected = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/events' && response.status() === 200,
    );
    await page.goto('/me/assistant');
    await connected;
    await expect(page.getByText('小管家自带 · 自定义服务')).toBeVisible();

    // 记下流式气泡每次变化时的字：要看到它是一段段长出来的，而不是一次蹦出来
    await page.evaluate(() => {
      const samples: string[] = [];
      (window as unknown as { streamSamples: string[] }).streamSamples = samples;
      new MutationObserver(() => {
        const text = document.querySelector('[aria-label="小管家正在回答"]')?.textContent ?? '';
        if (text && samples.at(-1) !== text) samples.push(text);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await ask(page, '记一笔 38 买菜');

    const bubble = page.getByRole('article', { name: '小管家正在回答' });
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    const proposal = page.getByRole('article', { name: '家庭记账操作提案' });
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText('支出：买菜');
    await expect(proposal).toContainText('需要确认');
    await shot(page, `j44-stream-${isMobile ? '390x844' : '1280x800'}.png`);

    // 落库后流式气泡退场，换成正式的回答
    await expect(bubble).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(ANSWER)).toBeVisible();
    const samples = await page.evaluate(() => (window as unknown as { streamSamples: string[] }).streamSamples);
    expect(samples.length, `流式气泡变化了 ${samples.length} 次：${JSON.stringify(samples)}`).toBeGreaterThanOrEqual(3);
    samples.forEach((sample, index) => {
      expect(ANSWER.startsWith(sample), `「${sample}」是回答的前缀`).toBe(true);
      if (index) expect(sample.length).toBeGreaterThan(samples[index - 1].length);
    });
    expect(runPolls).toEqual([]);

    // 深色是应用里的手动开关（不跟系统）：写进 localStorage 再刷新，落库的回答和提案卡照样在
    await page.evaluate(() => localStorage.setItem('family-app.theme', 'dark'));
    await page.reload();
    await expect(page.getByText(ANSWER)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await shot(page, `j44-stream-done-dark-${isMobile ? '390x844' : '1280x800'}.png`);
  } finally {
    await restore();
    await model.stop();
  }
});

test('/events 连不上：有回答在跑时退回 2 秒轮询，回答照样出来', async ({ page, request }) => {
  const model = await startModel(400);
  const restore = await useNative(apiClient(request), model);
  await page.route('**/api/events', (route) => route.abort('internetdisconnected'));
  const detailGets: number[] = [];
  try {
    await page.goto('/me/assistant');
    await expect(page.getByText('小管家自带 · 自定义服务')).toBeVisible();
    await page.getByRole('button', { name: '+ 新对话' }).click();
    await expect(page.getByText('想了解家里的什么？')).toBeVisible();
    page.on('request', (sent) => {
      if (sent.method() === 'GET' && isDetail(sent.url())) detailGets.push(Date.now());
    });
    await page.getByRole('textbox', { name: '问小管家' }).fill('记一笔 38 买菜');
    await page.getByRole('button', { name: '发送问题' }).click();

    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('article', { name: '家庭记账操作提案' })).toBeVisible();
    // 发送后的那次重取之外，至少还有一次是跑着的时候轮询来的
    expect(detailGets.length).toBeGreaterThanOrEqual(2);
    // 连不上就没有流式帧，不出流式气泡
    await expect(page.getByRole('article', { name: '小管家正在回答' })).toHaveCount(0);
  } finally {
    await page.unroute('**/api/events');
    await restore();
    await model.stop();
  }
});

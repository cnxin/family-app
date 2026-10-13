import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, expectNoHorizontalOverflow } from './helpers';

/**
 * J4.7 设置页拉取模型列表：云端模型配成本进程里起的假模型服务（apps/api/scripts/fake-model.mjs，GET /models 回 3 个）、
 * 先测通 → 点「获取列表」→ 下拉出现 3 项（按字母排）→ 选一个 → 模型名改了、「测一下」变回没测过。截图存到仓库根的 .tmp-shots/。
 */

const FAKE_MODEL_MODULE = new URL('../../api/scripts/fake-model.mjs', import.meta.url).href;

interface FakeModel {
  key: string;
  url: string;
  stop(): Promise<void>;
}

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

test('管理员：获取列表 → 选一个模型 → 「测一下」变回没测过', async ({ page, request, isMobile }) => {
  const { startFakeModel } = (await import(FAKE_MODEL_MODULE)) as { startFakeModel: () => Promise<FakeModel> };
  const model = await startFakeModel();
  const api = apiClient(request);
  const before = await api.get<{ runtimeKind: string; enabled: boolean; version: number }>('/agent/settings');
  try {
    await api.patch('/agent/settings', {
      providerKind: 'custom',
      providerBaseUrl: model.url,
      providerModel: 'fake-model',
      providerKey: model.key,
      expectedVersion: before.version,
    });
    const checked = await api.post<{ ok: boolean }>('/agent/settings/provider-check', {});
    expect(checked.ok).toBe(true);

    await page.goto('/me/assistant?settings=1');
    const dialog = page.getByRole('dialog', { name: '小管家设置' });
    await expect(dialog.getByRole('status').filter({ hasText: '测通过' })).toBeVisible();
    await dialog.getByLabel('云端服务商').scrollIntoViewIfNeeded();

    const listed = page.waitForResponse((response) => response.url().endsWith('/agent/settings/provider-models'));
    await dialog.getByRole('button', { name: '获取列表' }).click();
    expect((await listed).status()).toBe(200);
    const options = dialog.getByRole('listbox', { name: '服务商的模型' }).getByRole('option');
    await expect(options).toHaveText(['fake-chat', 'fake-model', 'fake-vision']);
    await expect(dialog.getByText('服务商有 3 个模型')).toBeVisible();
    if (isMobile) await expectNoHorizontalOverflow(page);
    await shot(page, `j47-models-${isMobile ? '390x844' : '1280x800'}.png`);
    // 暗色：应用里是手动开关（html data-theme）；切过去等 150ms 的过渡走完再截
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(400);
    await shot(page, `j47-models-dark-${isMobile ? '390x844' : '1280x800'}.png`);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // 输入按子串过滤
    await dialog.getByRole('combobox', { name: '云端模型名' }).fill('vis');
    await expect(options).toHaveText(['fake-vision']);
    await dialog.getByRole('combobox', { name: '云端模型名' }).fill('');
    await expect(options).toHaveCount(3);

    const saved = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.url().endsWith('/agent/settings'),
    );
    await options.filter({ hasText: 'fake-chat' }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog.getByRole('combobox', { name: '云端模型名' })).toHaveValue('fake-chat');
    await expect(dialog.getByRole('listbox', { name: '服务商的模型' })).toHaveCount(0);
    await expect(dialog.getByRole('status').filter({ hasText: '还没测过' })).toBeVisible();
    const after = await api.get<{ providerModel: string; providerCheckOk: boolean }>('/agent/settings');
    expect(after.providerModel).toBe('fake-chat');
    expect(after.providerCheckOk).toBe(false);
  } finally {
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
    await model.stop();
  }
});

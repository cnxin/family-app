import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient } from './helpers';

/**
 * J4.3 云端档：管理员在设置页配一个自定义的 OpenAI 兼容服务（假模型服务 apps/api/scripts/fake-model.mjs，本进程里起）→
 * 「测一下」→ 切到「小管家自带」→ 问「记一笔 38 买菜」→ 出现待确认的记账提案。截图存到仓库根的 .tmp-shots/。
 */

const FAKE_MODEL_MODULE = new URL('../../api/scripts/fake-model.mjs', import.meta.url).href;

interface FakeModel {
  key: string;
  url: string;
  requests: unknown[];
  stop(): Promise<void>;
}

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

function settingsSaved(page: Page) {
  return page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith('/agent/settings'));
}

test('管理员：配云端模型、测一下、切到小管家自带，记一笔出提案', async ({ page, request, isMobile }) => {
  const { startFakeModel } = (await import(FAKE_MODEL_MODULE)) as { startFakeModel: () => Promise<FakeModel> };
  const model = await startFakeModel();
  const api = apiClient(request);
  const before = await api.get<{ runtimeKind: string; enabled: boolean }>('/agent/settings');
  try {
    await page.goto('/me/assistant?settings=1');
    const dialog = page.getByRole('dialog', { name: '小管家设置' });
    await expect(dialog.getByRole('heading', { name: '三档' })).toBeVisible();

    let saved = settingsSaved(page);
    await dialog.getByLabel('云端服务商').selectOption('custom');
    expect((await saved).status()).toBe(200);
    await dialog.getByLabel('云端模型地址').fill(model.url);
    await dialog.getByLabel('云端模型名').fill('fake-model');
    saved = settingsSaved(page);
    await dialog.getByRole('button', { name: '保存模型' }).click();
    expect((await saved).status()).toBe(200);
    await dialog.getByLabel('云端模型 key').fill(model.key);
    saved = settingsSaved(page);
    await dialog.getByRole('button', { name: '保存 key' }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog.getByText(`key：••••${model.key.slice(-4)}`)).toBeVisible();

    await dialog.getByRole('button', { name: '测一下' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: '测通了' })).toBeVisible();

    saved = settingsSaved(page);
    await dialog.getByRole('tab', { name: '小管家自带' }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog.getByRole('tab', { name: '小管家自带' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('switch', { name: '只对管理员开放（试用期建议）' })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByLabel('云端服务商').scrollIntoViewIfNeeded();
    await shot(page, `j43-cloud-settings-${isMobile ? '390x844' : '1280x800'}.png`);

    await dialog.getByRole('button', { name: '关闭' }).click();
    const input = page.getByRole('textbox', { name: '问小管家' });
    await input.fill('记一笔 38 买菜');
    await page.getByRole('button', { name: '发送问题' }).click();
    const proposal = page.getByRole('article', { name: '家庭记账操作提案' }).or(page.getByLabel('家庭记账操作提案'));
    await expect(proposal.first()).toBeVisible({ timeout: 20_000 });
    await expect(proposal.first()).toContainText('支出：买菜');
    await expect(proposal.first()).toContainText('需要确认');
    await shot(page, `j43-cloud-proposal-${isMobile ? '390x844' : '1280x800'}.png`);
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

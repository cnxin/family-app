import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, authFiles } from './helpers';

/**
 * J2 助理三档与原话记录（docs/architecture.md §8.8）：管理员改开关刷新后还在；成员看得到但只读。
 * 截图存到仓库根的 .tmp-shots/，汇报时附上。
 */

async function openSettings(page: Page) {
  await page.goto('/me/assistant?settings=1');
  const dialog = page.getByRole('dialog', { name: '小管家设置' });
  await expect(dialog.getByRole('heading', { name: '三档' })).toBeVisible();
  return dialog;
}

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

test('管理员：打开第 1 档并填地址，刷新后还在', async ({ page, request, isMobile }) => {
  const api = apiClient(request);
  const before = await api.get<{ version: number }>('/agent/settings');
  try {
    let dialog = await openSettings(page);
    const tier1 = dialog.getByRole('switch', { name: '第 1 档本地模型' });
    await expect(tier1).toHaveAttribute('aria-checked', 'false');
    const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith('/agent/settings'));
    await tier1.click();
    expect((await saved).status()).toBe(200);
    await expect(tier1).toHaveAttribute('aria-checked', 'true');
    await dialog.getByLabel('本地模型地址').fill('http://192.168.1.10:11434');
    await dialog.getByLabel('本地模型名').fill('qwen2.5:7b');
    const savedUrl = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith('/agent/settings'));
    await dialog.getByRole('button', { name: '保存地址' }).click();
    expect((await savedUrl).status()).toBe(200);
    await shot(page, `j2-assistant-settings-${isMobile ? '390x844' : '1280x800'}.png`);
    await dialog.getByRole('heading', { name: '原话记录' }).scrollIntoViewIfNeeded();
    await shot(page, `j2-assistant-settings-${isMobile ? '390x844' : '1280x800'}-2.png`);

    await page.reload();
    dialog = await openSettings(page);
    await expect(dialog.getByRole('switch', { name: '第 1 档本地模型' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByLabel('本地模型地址')).toHaveValue('http://192.168.1.10:11434');
    await expect(dialog.getByRole('switch', { name: '第 0 档本机规则' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('switch', { name: '记录原话' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: '导出 CSV' })).toBeVisible();
  } finally {
    const now = await api.get<{ version: number }>('/agent/settings');
    await api.patch('/agent/settings', {
      tier1Enabled: false, tier1BaseUrl: null, tier1Model: null, expectedVersion: now.version,
    });
    expect(now.version).toBeGreaterThanOrEqual(before.version);
  }
});

test('成员：看得到三档和自己的原话记录，开关都是只读', async ({ page, isMobile }) => {
  const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'];
  await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
  const dialog = await openSettings(page);
  for (const name of ['第 0 档本机规则', '第 1 档本地模型', '云端助理（第 2 档）', '记录原话']) {
    await expect(dialog.getByRole('switch', { name })).toBeDisabled();
  }
  await expect(dialog.getByText('只有家庭管理员能改。')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '原话记录' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导出 CSV' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '清空我的' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: '本地摘要' })).toHaveCount(0);
  await shot(page, `j2-assistant-settings-member-${isMobile ? '390x844' : '1280x800'}.png`);
});

test('⌘K 输「记一笔」选中动作：原话记录里有这条，结果是「点了」', async ({ page, isMobile }) => {
  await page.goto('/');
  const status = page.waitForResponse((response) => response.url().endsWith('/agent/status') && response.ok());
  if (isMobile) await page.getByRole('button', { name: '快速跳转', exact: true }).click();
  else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const palette = page.getByRole('dialog', { name: '快速跳转' });
  // 「记录原话」开关跟着 /agent/status 来，读到之前不记
  expect((await status).ok()).toBeTruthy();
  await palette.getByRole('textbox').fill('记一笔');
  await expect(palette.getByRole('button').first()).toContainText('记一笔支出');
  const recorded = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/assistant/utterances'),
  );
  await palette.getByRole('textbox').press('Enter');
  const response = await recorded;
  expect(response.status()).toBe(201);
  const saved = (await response.json()) as { data: { id: string; outcome: string; chosenKind: string } };
  expect(saved.data.outcome).toBe('navigated');
  expect(saved.data.chosenKind).toBe('action');
  await expect(page).toHaveURL(/\/house\/finance$/);

  const dialog = await openSettings(page);
  const log = dialog.getByRole('list', { name: '原话记录' });
  const row = log.getByRole('listitem').filter({ hasText: '记一笔' }).first();
  await expect(row).toContainText('点了');
  await expect(row).toContainText('动作：finance.record-expense');
});

test('⌘K 没点就关：有候选记 candidates、没候选记 no_match、删光再关记 dismissed、空输入不记', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '记录规则在桌面项目验一次');
  const api = apiClient(request);
  const key = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
  const posts: { text: string; outcome: string }[] = [];
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && new URL(sent.url()).pathname.endsWith('/assistant/utterances')) posts.push(sent.postDataJSON());
  });
  await page.goto('/');
  // 「记录原话」开关跟着 /agent/status 来（缓存 60 秒）：第一次打开时等它读到，后面几次直接用
  let status: Promise<unknown> | null = page.waitForResponse((response) => response.url().endsWith('/agent/status'));
  async function session(type: (input: ReturnType<typeof page.getByRole>) => Promise<void>) {
    await page.keyboard.press(key);
    const input = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
    if (status) {
      await status;
      status = null;
    }
    await type(input);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '快速跳转' })).toHaveCount(0);
  }
  await session(async (input) => input.fill('记一'));
  await session(async (input) => input.fill('呜啦啦不存在的东西'));
  await session(async (input) => {
    await input.fill('买菜');
    await input.fill('');
  });
  await session(async () => undefined);
  await expect.poll(() => posts.length).toBe(3);
  expect(posts.map(({ text, outcome }) => `${text}:${outcome}`)).toEqual(['记一:candidates', '呜啦啦不存在的东西:no_match', '买菜:dismissed']);
  const page1 = await api.get<{ items: { text: string; outcome: string }[] }>('/assistant/utterances?limit=5');
  expect(page1.items.map((one) => one.text)).toEqual(expect.arrayContaining(['记一', '呜啦啦不存在的东西', '买菜']));
});

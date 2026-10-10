import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, watchPageErrors } from './helpers';

/**
 * K2 截图记账（docs/finance-plan.md §3-K2，J4 第四批），桌面、管理员：家里配一个能看图的云端模型（本进程起的
 * 假模型服务 apps/api/scripts/fake-model.mjs，收到图片回固定 JSON）→ 记一笔「传截图」→ 表单预填 → 确认 →
 * 流水里出现这笔，点开编辑面板有截图缩略图。截图存到仓库根的 .tmp-shots/。
 */

const FAKE_MODEL_MODULE = new URL('../../api/scripts/fake-model.mjs', import.meta.url).href;
// 1×1 的 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface FakeModel {
  key: string;
  url: string;
  vision: { mode: 'json' | 'garbage'; reply: Record<string, unknown> };
  stop(): Promise<void>;
}

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

test('管理员：传截图 → 表单预填 → 确认 → 流水有这笔且带缩略图', async ({ page, request, isMobile }) => {
  test.skip(isMobile, '本用例只跑桌面（指令要求一条桌面 e2e）');
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const mark = Date.now().toString(36);
  const { startFakeModel } = (await import(FAKE_MODEL_MODULE)) as { startFakeModel: () => Promise<FakeModel> };
  const model = await startFakeModel();
  // 付款方式里写着账户名 → 按名字认出这个账户（不受测试库里别的支付宝账户影响）
  const merchant = `美团外卖${mark}`;
  model.vision.reply = { ...model.vision.reply, merchant, payMethod: `花呗${mark}`, note: '午饭', occurredAt: '2026-10-09 12:30' };
  const account = await admin.post<{ id: string; name: string }>('/finance/accounts', { name: `花呗${mark}`, type: 'alipay', openingBalance: 0 });
  const before = await admin.get<{ enabled: boolean; tier2Scope: string; version: number }>('/agent/settings');
  try {
    await admin.patch('/agent/settings', {
      providerKind: 'custom',
      providerBaseUrl: model.url,
      providerModel: 'fake-vision',
      providerKey: model.key,
      expectedVersion: before.version,
    });
    const checked = await admin.post<{ ok: boolean; settings: { version: number } }>('/agent/settings/provider-check', {});
    expect(checked.ok).toBe(true);
    await admin.patch('/agent/settings', { enabled: true, tier2Scope: 'admins', expectedVersion: checked.settings.version });

    await page.goto('/house/finance?view=ledger');
    await page.getByRole('button', { name: '+ 记一笔' }).click();
    const form = page.getByRole('dialog', { name: '记一笔' });
    await expect(form.getByRole('button', { name: '传截图' })).toBeVisible();
    await expect(form.getByText('截图会发给家里配置的模型服务商识别')).toBeVisible();

    const recognized = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/finance/screenshot-recognize'),
    );
    await form.getByLabel('选择截图').setInputFiles({ name: 'pay.png', mimeType: 'image/png', buffer: PNG });
    expect((await recognized).status()).toBe(201);
    await expect(form.getByLabel('金额')).toHaveValue('36.5');
    await expect(form.getByLabel('账目名称')).toHaveValue(merchant);
    await expect(form.getByLabel('记账日期')).toHaveValue('2026-10-09');
    await expect(form.getByLabel('备注')).toHaveValue('午饭');
    await expect(form.getByRole('button', { name: new RegExp(`^${account.name}`) })).toHaveAttribute('aria-pressed', 'true');
    await expect(form.getByRole('button', { name: '餐饮', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(form.getByText('已附上截图')).toBeVisible();
    await shot(page, 'k2-screenshot-form-1280x800.png');

    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/finance/transactions'),
    );
    await form.getByRole('button', { name: '确认记账' }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const transaction = ((await createdResponse.json()) as { data: { sourceType: string; attachmentPath: string | null } }).data;
    expect(transaction.sourceType).toBe('screenshot');
    expect(transaction.attachmentPath).toMatch(/\.png$/);

    // 流水在 2026 年 10 月；往回翻到那个月
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const back = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - (2026 * 12 + 10);
    for (let step = 0; step < back; step += 1) await page.getByRole('button', { name: '上个月' }).click();
    const row = page.getByRole('article', { name: merchant, exact: true });
    await expect(row).toBeVisible();
    await row.click();
    const editor = page.getByRole('dialog', { name: '改一笔' });
    await expect(editor.getByText('传截图记的')).toBeVisible();
    const thumb = editor.getByRole('img', { name: '记账截图', exact: true });
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
    await shot(page, 'k2-screenshot-thumb-1280x800.png');
    await editor.getByRole('button', { name: '看截图原图' }).click();
    await expect(page.getByRole('dialog', { name: '记账截图' }).getByRole('img', { name: '记账截图原图' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const now = await admin.get<{ version: number }>('/agent/settings');
    await admin.patch('/agent/settings', {
      enabled: before.enabled,
      tier2Scope: before.tier2Scope,
      providerKind: null,
      providerBaseUrl: null,
      providerModel: null,
      providerKey: null,
      expectedVersion: now.version,
    });
    await model.stop();
  }
});

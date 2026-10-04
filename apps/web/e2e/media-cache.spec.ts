import { expect, test, type Page } from '@playwright/test';
import { apiClient, isoDate, stamp } from './helpers';

// 回归：write-paths「片单：手动加一部、发起观影投票、再改成已排期」桌面项目偶发「保存 200 了，卡片 10 秒还是想看」。
// 两个原因叠在一起（见 docs/refactor-plan.md 教训 52）：
// 1. 保存成功后只让片单失效、不写回，卡片要等重新拉取回来才变；
// 2. 片单页的「片库里有没有」用 POST /media/library-availability 查，拦截器把它当写入发了 media 事件，
//    页面收到又让片单和这个查询一起失效 → 再 POST → 再发事件……每秒几百个请求，
//    每次失效都把在途的片单请求取消掉，服务端慢一点时片单一个都落不了地。

const isMediaList = (url: URL) => url.pathname === '/api/media';

async function addMovie(page: Page, request: Parameters<typeof apiClient>[0], label: string) {
  const api = apiClient(request);
  const title = stamp(label);
  const created = await api.post<{ id: string }>('/media', {
    type: 'movie',
    title,
    originalTitle: null,
    year: 2026,
    overview: null,
    posterUrl: null,
    status: 'watchlist',
    scheduledFor: null,
    note: null,
    externalRefs: [],
  });
  // 有片才会问「片库里有没有」；先挂上等待，免得它比卡片先回来
  const availability = page
    .waitForResponse((response) => response.url().endsWith('/media/library-availability'))
    .catch(() => null);
  await page.goto('/life/media/watchlist');
  await page.getByRole('button', { name: '全部' }).click();
  const card = page.getByRole('article', { name: title });
  await expect(card).toContainText('想看');
  return { api, title, id: created.id, card, availability };
}

test('片单改成已排期：重新拉取还没回来，卡片就已经是已排期', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '缓存竞态与视口无关，桌面项目验一次');
  const { api, title, id, card } = await addMovie(page, request, '排期缓存');
  // 保存之后的片单重新拉取全部扣住，直到断言做完才放行：卡片只能靠保存返回的那一行变
  let saved = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(isMediaList, async (route) => {
    if (saved && route.request().method() === 'GET') await held;
    await route.continue().catch(() => undefined);
  });

  try {
    await card.getByRole('button', { name: `编辑${title}` }).click();
    const editor = page.getByRole('dialog', { name: `编辑「${title}」的安排` });
    await editor.getByRole('checkbox', { name: '安排观影日期' }).click();
    await editor.getByLabel('观影日期', { exact: true }).fill(isoDate(1));
    saved = true;
    const patched = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && /\/media\/[^/]+$/.test(response.url()),
    );
    await editor.getByRole('button', { name: '保存安排' }).click();
    expect((await patched).status()).toBe(200);
    await expect(card).toContainText('已排期', { timeout: 3_000 });
  } finally {
    release();
    await api.delete(`/media/${id}`).catch(() => undefined);
  }
});

test('片单页停着不动：不会自己一遍遍重拉片单', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '事件循环与视口无关，桌面项目验一次');
  const { api, id, availability } = await addMovie(page, request, '不自激');
  try {
    // 等「片库里有没有」头一次查完（头一次没缓存，事件赶在它回来之前到只会合并，不会转起来）
    expect(await availability, '片单页应该问过一次片库').not.toBeNull();
    let refetches = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && isMediaList(new URL(req.url()))) refetches += 1;
    });
    // 「别人」改一下这部片：页面收到 media 事件，片单和片库查询各重拉一次，然后就该停下
    await api.patch(`/media/${id}`, { note: '别处改了一下' });
    await page.waitForTimeout(2_000);
    // 别的 worker 同时写片单 / 投票会正当地推几次 media 事件；自激循环是每秒几十上百次
    expect(refetches, '2 秒里片单被重拉的次数').toBeLessThan(5);
  } finally {
    await api.delete(`/media/${id}`).catch(() => undefined);
  }
});

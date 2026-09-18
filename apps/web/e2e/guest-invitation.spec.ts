import { expect, test, type Page } from '@playwright/test';
import { apiClient, isoDate, stamp } from './helpers';

/**
 * 公开邀请页 `/guest/:token`：在登录闸门之外，所以这一组用例故意清空登录态跑——
 * 一旦有人把它挪回 `<Shell/>` 里，这里会立刻变红。
 */
test.use({ storageState: { cookies: [], origins: [] } });

const visitDate = isoDate(1);

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      pathPattern.test(new URL(response.url()).pathname),
  );
}

test('访客邀请页：确认参加、看到 Wi-Fi 码、点菜', async ({ page, request }) => {
  const api = apiClient(request);
  const guestName = stamp('客人');
  const visitTitle = stamp('来访');
  let guestId: string | null = null;
  let visitId: string | null = null;

  try {
    const guest = await api.post<{ id: string }>('/guests', { name: guestName });
    guestId = guest.id;
    const wifi = await api.post<{ id: string }>('/guest-wifi-profiles', {
      name: stamp('访客网络'),
      ssid: 'e2e-guest-wifi',
      security: 'WPA',
      password: 'guest1234',
    });
    const visit = await api.post<{ id: string }>('/visits', {
      title: visitTitle,
      startsAt: `${visitDate}T10:00:00.000Z`,
      endsAt: `${visitDate}T14:00:00.000Z`,
      guestIds: [guest.id],
      guestWifiProfileId: wifi.id,
    });
    visitId = visit.id;

    // 菜单上摆一道菜，访客才有得可点
    const dish = await api.post<{ id: string; name: string }>('/dishes', {
      name: stamp('菜'),
      category: '荤菜',
    });
    const menu = await api.get<{ id: string }>(`/menus?date=${visitDate}&mealType=dinner`);
    await api.post(`/menus/${menu.id}/items`, { items: [{ dishId: dish.id }] });

    const invitation = await api.post<{ invitationToken: string }>(
      `/visits/${visit.id}/invitations`,
      { guestId: guest.id, allowsMealRequests: true, allowsMovieVoting: true },
    );

    await page.goto(`/guest/${invitation.invitationToken}`);
    await expect(page.getByRole('heading', { name: `你好，${guestName}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: visitTitle })).toBeVisible();
    // 没登录也不该被弹到登录页
    await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);

    // 回复参加：只能回一次，回完页面换成状态条
    const responded = waitFor(page, 'POST', /\/guest-invitations\/[^/]+\/response$/);
    await page.getByRole('button', { name: '我会参加' }).click();
    const respondedResponse = await responded;
    expect(respondedResponse.status(), await respondedResponse.text()).toBe(201);
    await expect(page.getByText('已确认参加')).toBeVisible();
    await expect(page.getByRole('button', { name: '我会参加' })).toBeHidden();

    // 访客 Wi-Fi 的二维码（深色模式下也得是白底，所以这块底色是写死的）
    await expect(page.getByRole('img', { name: /访客 Wi-Fi .+ 的二维码/ })).toBeVisible();

    // 从菜单里点一道
    const claimed = waitFor(page, 'POST', /\/meal-options\/[^/]+\/request$/);
    const dishRow = page.getByRole('article', { name: dish.name });
    await dishRow.getByRole('button', { name: '我要这道' }).click();
    const claimedResponse = await claimed;
    expect(claimedResponse.status(), await claimedResponse.text()).toBe(201);
    await expect(dishRow).toContainText('等家里人确认');

    // 菜单外自由点菜。换到午餐再填：一个「日期 + 餐次」后端只留一条请求，
    // 还在晚餐这一格填就会把刚点的那道菜顶掉。
    await page.getByRole('group', { name: '哪一餐' }).getByRole('button', { name: '午餐' }).click();
    const submitted = waitFor(page, 'POST', /\/guest-invitations\/[^/]+\/meal-requests$/);
    await page.getByPlaceholder('想吃什么菜？').fill('蒜蓉西兰花');
    await page.getByRole('button', { name: '提交点菜请求' }).click();
    const submittedResponse = await submitted;
    expect(submittedResponse.status(), await submittedResponse.text()).toBe(201);
    await expect(page.getByRole('button', { name: '更新这一餐的请求' })).toBeVisible();
    // 晚餐那格还是菜单里点的那道，没被顶掉
    await page.getByRole('group', { name: '哪一餐' }).getByRole('button', { name: '晚餐' }).click();
    await expect(page.getByPlaceholder('想吃什么菜？')).toHaveValue(dish.name);
  } finally {
    if (visitId) await api.patch(`/visits/${visitId}`, { status: 'cancelled' });
    if (guestId) await api.patch(`/guests/${guestId}`, { isActive: false });
  }
});

test('邀请链接失效时说人话，不是白屏', async ({ page }) => {
  await page.goto('/guest/e2e-this-token-was-never-issued-0123456789');
  await expect(page.getByRole('heading', { name: '这个邀请链接打不开了' })).toBeVisible();
});

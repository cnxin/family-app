import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const account = {
  id: 'account-agent-memory-fixture',
  loginName: 'agent-memory-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: 'member-agent-memory-fixture',
  householdId: 'household-agent-memory-fixture',
  name: '妈妈',
  avatarEmoji: '妈',
  role: 'member',
  prefersCooking: false,
};
const now = '2026-08-07T02:00:00.000Z';

function memory(overrides: Record<string, unknown>) {
  return {
    id: 'memory-fixture',
    ownerMemberId: member.id,
    scope: 'member_private',
    kind: 'preference',
    category: 'other',
    memoryKey: 'other',
    content: '家庭记忆测试内容',
    status: 'active',
    confidenceSource: 'explicit',
    confirmedByMemberId: member.id,
    validFrom: now,
    expiresAt: null,
    source: {
      type: 'user_explicit',
      id: null,
      conversationId: null,
      messageId: null,
    },
    visibility: 'member_private',
    untrustedContent: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: 'application/json',
    status,
  });
}

async function installFixture(page: Page) {
  let profile = {
    id: 'profile-agent-memory-fixture',
    memberId: member.id,
    enabled: true,
    assistantName: '小管家',
    responseStyle: 'balanced',
    memoryEnabled: true,
    memorySuggestionEnabled: false,
    proactiveRoutinesEnabled: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  let active = [
    memory({
      id: 'memory-private-active',
      category: 'spice_level',
      memoryKey: 'spice_level',
      content: '做菜偏爱微辣，孩子的餐食不放辣椒',
      createdAt: '2026-08-06T09:00:00.000Z',
    }),
    memory({
      id: 'memory-household-active',
      ownerMemberId: 'member-family-fixture',
      scope: 'household',
      visibility: 'household',
      kind: 'fact',
      category: 'schedule_preference',
      memoryKey: 'schedule_preference',
      content: '周末家庭活动通常安排在上午',
      confidenceSource: 'business',
      createdAt: '2026-08-05T09:00:00.000Z',
    }),
  ];
  let candidates = [
    memory({
      id: 'memory-private-candidate',
      category: 'reply_style',
      memoryKey: 'reply_style',
      content: '回答家庭安排时先给简短结论',
      status: 'candidate',
      confidenceSource: 'summary_candidate',
      confirmedByMemberId: null,
      validFrom: null,
      expiresAt: '2026-08-21T02:00:00.000Z',
      createdAt: '2026-08-07T01:00:00.000Z',
    }),
  ];

  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'agent-memory-token');
      window.localStorage.setItem('family-app-refresh-token', 'agent-memory-refresh-token');
      window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
      window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
    },
    { accountFixture: account, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, (route) =>
    json(route, {
      accessToken: 'agent-memory-token-refreshed',
      refreshToken: 'agent-memory-refresh-token-refreshed',
      account,
      member,
    }),
  );
  await page.route(/\/notifications(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/agent\/profile$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      const input = route.request().postDataJSON() as { memoryEnabled?: boolean };
      profile = {
        ...profile,
        ...(typeof input.memoryEnabled === 'boolean'
          ? { memoryEnabled: input.memoryEnabled }
          : {}),
        version: profile.version + 1,
      };
    }
    await json(route, profile);
  });
  await page.route(/\/agent\/memories(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/agent/memories' && method === 'GET') {
      const status = url.searchParams.get('status') ?? 'active';
      const scope = url.searchParams.get('scope');
      const rows = status === 'candidate' ? candidates : active;
      await json(route, scope ? rows.filter((item) => item.scope === scope) : rows);
      return;
    }

    if (path === '/agent/memories' && method === 'DELETE') {
      const forgottenCount = active.filter((item) =>
        item.ownerMemberId === member.id && item.scope === 'member_private').length
        + candidates.length;
      active = active.filter((item) =>
        item.ownerMemberId !== member.id || item.scope !== 'member_private');
      candidates = [];
      await json(route, { forgottenCount });
      return;
    }

    const id = path.split('/')[3];
    const existing = [...candidates, ...active].find((item) => item.id === id);
    if (!existing) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: '记忆不存在' } }),
        contentType: 'application/json',
        status: 404,
      });
      return;
    }

    if (path.endsWith('/confirm') && method === 'POST') {
      candidates = candidates.filter((item) => item.id !== id);
      const updated = {
        ...existing,
        status: 'active',
        confirmedByMemberId: member.id,
        validFrom: now,
        version: existing.version + 1,
      };
      active = [updated, ...active];
      await json(route, updated);
      return;
    }

    if (path.endsWith('/share') && method === 'POST') {
      const updated = {
        ...existing,
        scope: 'household',
        visibility: 'household',
        version: existing.version + 1,
      };
      active = active.map((item) => item.id === id ? updated : item);
      await json(route, updated);
      return;
    }

    if (method === 'PATCH') {
      const input = request.postDataJSON() as { content: string };
      const updated = {
        ...existing,
        content: input.content,
        version: existing.version + 1,
      };
      active = active.map((item) => item.id === id ? updated : item);
      candidates = candidates.map((item) => item.id === id ? updated : item);
      await json(route, updated);
      return;
    }

    if (method === 'DELETE') {
      active = active.filter((item) => item.id !== id);
      candidates = candidates.filter((item) => item.id !== id);
      await json(route, { id, forgotten: true, status: 'forgotten' });
      return;
    }

    await route.abort('failed');
  });
}

async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label} 应可见`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} 应有尺寸`).not.toBeNull();
  expect(box?.width ?? 0, `${label} 宽度`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} 高度`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.root).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await installFixture(page);
});

test('小管家记忆在移动 Web 可确认、修改、共享、清空并联动开关', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/profile');

  const memoryEntry = page.getByRole('link', { name: '管理小管家记忆' });
  await expectTouchTarget(memoryEntry, '记忆管理入口');
  await expectTouchTarget(
    page.getByRole('switch', { name: '启用小管家记忆' }),
    '成员记忆开关',
  );
  await memoryEntry.click();
  await expect(page).toHaveURL(/\/agent-memory$/);

  for (const label of ['我的记忆', '家庭共享', '偏好', '事实', '对话摘要']) {
    await expectTouchTarget(
      page.getByRole('button', { name: label, exact: true }),
      `${label}分段`,
    );
  }
  const candidate = page.getByRole('button', { name: /待确认，回复方式/ });
  await expect(candidate).toBeVisible();
  await expect(page.getByText('做菜偏爱微辣，孩子的餐食不放辣椒')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await candidate.click();
  await expect(
    page.getByText('回答家庭安排时先给简短结论', { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page).toHaveURL(/\/agent-memory$/);

  await page.getByRole('button', { name: /口味偏好，做菜偏爱微辣/ }).click();
  await page.getByRole('button', { name: '更多记忆操作' }).click();
  await page.getByRole('button', { name: '修改内容', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '记忆内容' });
  await editor.fill('做菜偏爱微辣，孩子和老人不放辣椒');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('记忆内容已修改', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '更多记忆操作' }).click();
  await page.getByRole('button', { name: '共享到家庭', exact: true }).click();
  await page.getByRole('button', { name: '共享', exact: true }).click();
  await expect(page).toHaveURL(/\/agent-memory$/);

  await page.getByRole('button', { name: '家庭共享', exact: true }).click();
  await page.getByRole('button', { name: '事实', exact: true }).click();
  await expect(page.getByText('周末家庭活动通常安排在上午', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: '我的记忆', exact: true }).click();
  await page.getByRole('button', { name: '偏好', exact: true }).click();
  await page.getByRole('button', { name: '清空我的小管家记忆' }).click();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByText(/已遗忘 \d+ 条个人记忆/)).toBeVisible();

  await page.goto('/profile');
  await page.getByRole('switch', { name: '启用小管家记忆' }).click();
  await page.getByRole('link', { name: '管理小管家记忆' }).click();
  await expect(page.getByText('记忆功能未启用', { exact: true })).toBeVisible();
  await expectTouchTarget(
    page.getByRole('button', { name: '前往设置小管家记忆' }),
    '前往设置按钮',
  );

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByText('记忆功能未启用', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('agent-memory-dark-reduced-motion.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload();
  await expect(page.getByText('小管家记忆', { exact: true })).toBeVisible();
  await expect(page.getByText('记忆功能未启用', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

import { resolve } from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const repoRoot = resolve(process.cwd(), '../..');
const screenshots = resolve(repoRoot, 'test-screenshots');
const conversationId = '00000000-0000-4000-8000-000000000301';
const completedRunId = '00000000-0000-4000-8000-000000000302';
const runningRunId = '00000000-0000-4000-8000-000000000303';
const proposalId = '00000000-0000-4000-8000-000000000304';
const proposalGroupId = '00000000-0000-4000-8000-000000000309';
const dishId = '00000000-0000-4000-8000-000000000305';
const memoryId = '00000000-0000-4000-8000-000000000306';
const createdAt = '2099-08-08T08:00:00.000Z';
const account = {
  id: '00000000-0000-4000-8000-000000000307',
  loginName: 'agent-responsive-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: '00000000-0000-4000-8000-000000000001',
  householdId: '00000000-0000-4000-8000-000000000308',
  name: '爸爸',
  avatarEmoji: '爸',
  role: 'admin',
  prefersCooking: true,
};

type AgentMode =
  | 'conversation'
  | 'proposal'
  | 'proposal-group'
  | 'proposal-group-expired'
  | 'running';

async function json(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

function run(id: string, status: 'completed' | 'running') {
  return {
    id,
    conversationId,
    retryOfRunId: null,
    runtimeKind: 'hermes',
    status,
    startedAt: createdAt,
    finishedAt: status === 'completed' ? createdAt : null,
    cancelRequestedAt: null,
    errorCode: null,
    errorMessage: null,
    retryable: false,
    createdAt,
    updatedAt: createdAt,
  };
}

const longAssistantReply =
  '这周家庭安排包括周六晚餐、周日聚餐和周一缴费。晚餐需要准备番茄、鸡蛋与青菜，购物前请先核对冰箱库存；这段较长回复必须在手机气泡内完整换行显示，不能被右侧边界裁切。';

const memory = {
  id: memoryId,
  ownerMemberId: '00000000-0000-4000-8000-000000000001',
  scope: 'member_private',
  kind: 'preference',
  category: 'schedule_preference',
  memoryKey: 'schedule_preference',
  content:
    '周末家庭聚餐前一天提醒我核对菜单、库存和购物清单，并把缺少的食材集中整理出来。',
  status: 'active',
  confidenceSource: 'explicit',
  confirmedByMemberId: '00000000-0000-4000-8000-000000000001',
  validFrom: createdAt,
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
  createdAt,
  updatedAt: createdAt,
};

function conversationDetail(mode: AgentMode) {
  const messages =
    mode === 'proposal'
      ? [
          {
            id: 'message-proposal',
            runId: completedRunId,
            role: 'assistant',
            content: '我整理了一条待确认任务，请检查后再执行。',
            createdAt,
          },
        ]
      : [
          {
            id: 'message-user',
            runId: null,
            role: 'user',
            content: '请告诉我这周家里的安排和需要准备的食材。',
            createdAt,
          },
          {
            id: 'message-assistant',
            runId: completedRunId,
            role: 'assistant',
            content: longAssistantReply,
            createdAt,
          },
        ];
  const toolEvents =
    mode === 'proposal'
      ? []
      : [
          {
            id: 'tool-completed',
            runId: completedRunId,
            toolName: 'get_family_schedule',
            status: 'completed',
            startedAt: createdAt,
            finishedAt: createdAt,
            presentation: {
              kind: 'schedule',
              title: '家庭日程',
              emptyText: '暂时没有安排',
              targetPath: '/calendar',
              items: [
                {
                  id: 'schedule-item',
                  title: '周日家庭聚餐与采购准备',
                  detail: '周日 18:00 · 提前核对番茄、鸡蛋和青菜库存',
                  status: '已安排',
                  targetPath: '/calendar',
                },
              ],
            },
          },
          ...(mode === 'running'
            ? [
                {
                  id: 'tool-running',
                  runId: runningRunId,
                  toolName: 'get_inventory_summary',
                  status: 'running',
                  startedAt: createdAt,
                  finishedAt: null,
                  presentation: null,
                },
              ]
            : []),
        ];
  return {
    id: conversationId,
    title: '一条很长的会话标题，用来验证标题和时间戳不会挤出会话列表',
    status: 'active',
    expiresAt: '2099-09-08T08:00:00.000Z',
    createdAt,
    updatedAt: createdAt,
    latestRun: mode === 'running' ? run(runningRunId, 'running') : run(completedRunId, 'completed'),
    messages,
    runs:
      mode === 'running'
        ? [run(runningRunId, 'running'), run(completedRunId, 'completed')]
        : [run(completedRunId, 'completed')],
    toolEvents,
    proposals:
      mode === 'proposal'
        ? [
            {
              id: proposalId,
              runId: completedRunId,
              actionType: 'task',
              actionLabel: '创建家庭任务',
              preview: {
                title: '整理周末聚餐采购清单并逐项确认库存',
                summary: '确认后才会创建任务，不会自动修改家庭数据。',
                changes: [
                  { label: '负责人', value: '爸爸' },
                  {
                    label: '任务说明',
                    value: '核对番茄、鸡蛋、青菜和牛奶库存后再整理购物清单',
                  },
                ],
                warning: '执行前请确认负责人和日期。',
              },
              status: 'pending',
              expiresAt: '2099-08-09T08:00:00.000Z',
              confirmedAt: null,
              executedAt: null,
              resultModule: null,
              resultId: null,
              failureCode: null,
              failureMessage: null,
              version: 1,
              createdAt,
              updatedAt: createdAt,
            },
          ]
        : [],
  };
}

function proposalGroups(mode: AgentMode) {
  if (mode !== 'proposal-group' && mode !== 'proposal-group-expired') return [];
  const expired = mode === 'proposal-group-expired';
  return [
    {
      id: proposalGroupId,
      conversationId,
      runId: completedRunId,
      requestedByMemberId: member.id,
      title: '周六爸妈来吃饭的完整准备计划',
      summary: '菜单、采购与接待任务会在确认后按顺序全部执行，任一步失败都会整体回滚。',
      status: expired ? 'expired' : 'pending',
      confirmedByMemberId: null,
      confirmedAt: null,
      rejectedAt: null,
      expiresAt: '2099-08-09T08:00:00.000Z',
      version: 1,
      createdAt,
      updatedAt: createdAt,
      steps: [
        {
          id: '00000000-0000-4000-8000-000000000310',
          groupId: proposalGroupId,
          stepOrder: 1,
          runId: completedRunId,
          actionType: 'menu',
          actionLabel: '菜单点菜',
          preview: {
            title: '安排周六晚餐菜单',
            summary: '确认后向菜单加入 3 道菜',
            changes: [{ label: '菜品与做法', value: '清蒸鱼、家常蒸蛋、蒜蓉青菜' }],
          },
          status: 'pending',
          expiresAt: '2099-08-09T08:00:00.000Z',
          confirmedAt: null,
          executedAt: null,
          resultModule: null,
          resultId: null,
          failureCode: null,
          failureMessage: null,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: '00000000-0000-4000-8000-000000000311',
          groupId: proposalGroupId,
          stepOrder: 2,
          runId: completedRunId,
          actionType: 'shopping',
          actionLabel: '购物清单',
          preview: {
            title: '补齐聚餐采购清单',
            summary: '确认后新增 6 个手动购物项，不会直接修改库存',
            changes: [{ label: '新增项目', value: '鲈鱼、鸡蛋、青菜、葱姜、饮料和水果' }],
          },
          status: 'pending',
          expiresAt: '2099-08-09T08:00:00.000Z',
          confirmedAt: null,
          executedAt: null,
          resultModule: null,
          resultId: null,
          failureCode: null,
          failureMessage: null,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: '00000000-0000-4000-8000-000000000312',
          groupId: proposalGroupId,
          stepOrder: 3,
          runId: completedRunId,
          actionType: 'task',
          actionLabel: '家庭任务',
          preview: {
            title: '周六下午整理餐桌和客厅',
            summary: '确认后新增一项家庭任务',
            changes: [{ label: '负责人', value: '爸爸' }],
          },
          status: 'pending',
          expiresAt: '2099-08-09T08:00:00.000Z',
          confirmedAt: null,
          executedAt: null,
          resultModule: null,
          resultId: null,
          failureCode: null,
          failureMessage: null,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      events: [],
    },
  ];
}

async function installMocks(page: Page) {
  let mode: AgentMode = 'conversation';
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'agent-responsive-token');
      window.localStorage.setItem(
        'family-app-refresh-token',
        'agent-responsive-refresh-token',
      );
      window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
      window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
    },
    { accountFixture: account, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, (route) =>
    json(route, {
      accessToken: 'agent-responsive-token-refreshed',
      refreshToken: 'agent-responsive-refresh-token-refreshed',
      account,
      member,
    }),
  );
  await page.route(/\/members$/, (route) => json(route, [member]));
  await page.route(/\/notifications(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/assets\?status=all$/, (route) => json(route, []));
  await page.route(/\/knowledge-articles\?status=active$/, (route) => json(route, []));
  await page.route(/\/travel-plans\?status=active$/, (route) => json(route, []));
  await page.route(/\/travel-templates\?status=all$/, (route) => json(route, []));
  await page.route(/\/polls\?status=all$/, (route) => json(route, []));
  await page.route(new RegExp(`/recipes/${dishId}$`), (route) =>
    json(route, { id: dishId, name: '不辣家常蒸蛋' }),
  );
  await page.route(/\/agent(?:\/[^?]*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== 'GET') {
      await json(route, {});
      return;
    }
    if (path === '/agent/status') {
      await json(route, {
        enabled: true,
        runtimeKind: 'hermes',
        selected: { available: true, configured: true, version: 'mock', message: 'ok' },
        runtimes: {
          fake: { available: true, configured: true, version: 'mock', message: 'ok' },
          hermes: { available: true, configured: true, version: 'mock', message: 'ok' },
        },
        fallbackAvailable: true,
        persistenceEncrypted: true,
        readToolsEnabled: [],
        proposalToolsEnabled: [],
      });
      return;
    }
    if (path === '/agent/settings') {
      await json(route, {
        enabled: true,
        runtimeKind: 'hermes',
        runtimeProfile: 'familyapp',
        modelAlias: 'mock',
        retentionDays: 30,
        readToolsEnabled: [],
        proposalToolsEnabled: [],
        version: 1,
        updatedAt: createdAt,
      });
      return;
    }
    if (path === '/agent/profile') {
      await json(route, {
        id: 'profile-responsive',
        memberId: memory.ownerMemberId,
        enabled: true,
        assistantName: '小管家',
        responseStyle: 'balanced',
        memoryEnabled: true,
        memorySuggestionEnabled: true,
        proactiveRoutinesEnabled: false,
        version: 1,
        createdAt,
        updatedAt: createdAt,
      });
      return;
    }
    if (path === '/agent/memories') {
      await json(route, url.searchParams.get('status') === 'active' ? [memory] : []);
      return;
    }
    if (path === '/agent/conversations') {
      const detail = conversationDetail(mode);
      await json(route, [
        {
          id: detail.id,
          title: detail.title,
          status: detail.status,
          expiresAt: detail.expiresAt,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
          latestRun: detail.latestRun,
        },
      ]);
      return;
    }
    if (path === '/agent/proposal-groups') {
      await json(route, proposalGroups(mode));
      return;
    }
    if (path === `/agent/conversations/${conversationId}`) {
      await json(route, conversationDetail(mode));
      return;
    }
    if (path === '/agent/channels' || path === '/agent/channel-pairings') {
      await json(route, []);
      return;
    }
    await json(route, []);
  });
  return {
    setMode(next: AgentMode) {
      mode = next;
    },
  };
}

async function openFixture(page: Page, path: string, ready: () => Locator) {
  await page.goto(path);
  await ready().waitFor({ state: 'visible' });
}

async function expectNoPageOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth, `${label} 不应产生页面横向滚动`).toBeLessThanOrEqual(
    metrics.clientWidth + 1,
  );
}

async function expectContained(page: Page, locator: Locator, label: string) {
  await expect(locator, `${label} 应可见`).toBeVisible();
  const metrics = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: rect.left,
      right: rect.right,
    };
  });
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(metrics.left, `${label} 左侧应在视口内`).toBeGreaterThanOrEqual(-1);
  expect(metrics.right, `${label} 右侧应在视口内`).toBeLessThanOrEqual(
    viewportWidth + 1,
  );
  expect(metrics.scrollWidth, `${label} 内容应在容器内换行或收缩`).toBeLessThanOrEqual(
    metrics.clientWidth + 1,
  );
}

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} 应可见`).not.toBeNull();
  expect(box?.width ?? 0, `${label} 宽度不少于 44`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} 高度不少于 44`).toBeGreaterThanOrEqual(44);
}

async function assertConversationLayout(page: Page, label: string) {
  await expect(page.getByText(longAssistantReply, { exact: true })).toBeVisible();
  await expectContained(
    page,
    page.getByTestId('agent-message-bubble-assistant'),
    `${label} 助手消息气泡`,
  );
  await expectContained(
    page,
    page.getByTestId('agent-message-bubble-user'),
    `${label} 用户消息气泡`,
  );
  await expectContained(
    page,
    page.getByTestId('agent-result-schedule'),
    `${label} 结果卡片`,
  );
  await expectContained(
    page,
    page.getByTestId('agent-page-context'),
    `${label} 页面上下文提示`,
  );
  await expectContained(page, page.getByTestId('agent-composer'), `${label} 输入区域`);
  await expectTouchTarget(page.getByTestId('agent-page-context-clear'), `${label} 上下文清除按钮`);
  await expectTouchTarget(page.getByTestId('agent-send-button'), `${label} 发送按钮`);
  await expectNoPageOverflow(page, label);
}

async function assertBusinessAssistantEntries(page: Page) {
  const entries = [
    { path: '/home-assets', testId: 'asset-ask-assistant', route: '/home-assets' },
    { path: '/knowledge', testId: 'knowledge-ask-assistant', route: '/knowledge' },
    { path: '/travel', testId: 'travel-ask-assistant', route: '/travel' },
    { path: '/polls', testId: 'poll-ask-assistant', route: '/polls' },
  ];

  for (const entry of entries) {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixture(page, entry.path, () => page.getByTestId(entry.testId));
    for (const width of [320, 375, 390, 414]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      const button = page.getByTestId(entry.testId);
      await expectContained(page, button, `${entry.path} ${width}px 小管家入口`);
      await expectTouchTarget(button, `${entry.path} ${width}px 小管家入口`);
      await expectNoPageOverflow(page, `${entry.path} ${width}px`);
    }

    await page.getByTestId(entry.testId).click();
    await expect(page).toHaveURL(/\/assistant\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/assistant');
    expect([...url.searchParams.keys()]).toEqual(['route']);
    expect(url.searchParams.get('route')).toBe(entry.route);
  }
}

async function showConversationEvidence(page: Page, replyVisible = true) {
  const reply = page.getByText(longAssistantReply, { exact: true });
  const result = page.getByTestId('agent-result-schedule');
  await result.scrollIntoViewIfNeeded();
  if (replyVisible) await expect(reply).toBeInViewport();
  await expect(result).toBeInViewport();
}

test('小管家聊天、提案和记忆页在常见移动视口完整显示', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== 'mobile-chrome', '仅在触控移动视口执行响应式矩阵');
  const mocks = await installMocks(page);
  await assertBusinessAssistantEntries(page);
  const contextPath =
    `/assistant?route=${encodeURIComponent(`/dish/${dishId}`)}` +
    `&entityType=dish&entityId=${dishId}`;
  const viewports = [
    { width: 320, height: 568, screenshot: '14-assistant-320.png' },
    { width: 375, height: 667, screenshot: '15-assistant-375.png' },
    { width: 390, height: 844, screenshot: '16-assistant-390.png' },
    { width: 414, height: 896, screenshot: '17-assistant-414.png' },
  ];

  await openFixture(page, contextPath, () =>
    page.getByText(longAssistantReply, { exact: true }),
  );
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await assertConversationLayout(page, `${viewport.width}px`);
    await showConversationEvidence(page);
    await page.screenshot({ path: resolve(screenshots, viewport.screenshot) });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await assertConversationLayout(page, '390px 横屏');
  await showConversationEvidence(page, false);
  await page.screenshot({ path: resolve(screenshots, '18-assistant-390-landscape.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.reload();
  await assertConversationLayout(page, '390px 暗色减少动态');
  await showConversationEvidence(page);
  await page.screenshot({ path: resolve(screenshots, '19-assistant-390-dark.png') });

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 320, height: 568 });
  mocks.setMode('proposal');
  await page.reload();
  const actions = page.getByTestId('agent-proposal-actions');
  const reject = page.getByTestId(`agent-proposal-reject-${proposalId}`);
  const confirm = page.getByTestId(`agent-proposal-confirm-${proposalId}`);
  await actions.scrollIntoViewIfNeeded();
  await expect(actions).toBeInViewport();
  await expectContained(page, page.getByTestId(`agent-proposal-${proposalId}`), '320px 提案卡片');
  await expectContained(page, actions, '320px 提案操作区');
  await expectContained(page, page.getByTestId('agent-proposal-change-1'), '320px 提案变更值');
  await expectTouchTarget(reject, '提案放弃按钮');
  await expectTouchTarget(confirm, '提案确认按钮');
  const [rejectBox, confirmBox] = await Promise.all([
    reject.boundingBox(),
    confirm.boundingBox(),
  ]);
  await expect(actions).toHaveCSS('flex-direction', 'column');
  expect(confirmBox!.y).toBeGreaterThan(rejectBox!.y + rejectBox!.height - 1);
  expect(Math.abs(confirmBox!.width - rejectBox!.width)).toBeLessThanOrEqual(1);
  await expectNoPageOverflow(page, '320px 提案布局');
  await page.screenshot({ path: resolve(screenshots, '20-assistant-320-proposal.png') });

  mocks.setMode('proposal-group');
  for (const width of [320, 375, 390, 414]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.reload();
    const group = page.getByTestId(`agent-proposal-group-${proposalGroupId}`);
    const groupActions = page.getByTestId('agent-proposal-group-actions');
    const groupReject = page.getByTestId(
      `agent-proposal-group-reject-${proposalGroupId}`,
    );
    const groupConfirm = page.getByTestId(
      `agent-proposal-group-confirm-${proposalGroupId}`,
    );
    await group.scrollIntoViewIfNeeded();
    await expectContained(page, group, `${width}px 组提案卡片`);
    await expectContained(
      page,
      page.getByTestId('agent-proposal-group-step-2'),
      `${width}px 组提案最后一步`,
    );
    await groupActions.scrollIntoViewIfNeeded();
    await expectContained(page, groupActions, `${width}px 组提案操作区`);
    await expectTouchTarget(groupReject, `${width}px 全部放弃按钮`);
    await expectTouchTarget(groupConfirm, `${width}px 全部确认按钮`);
    await expect(groupActions).toHaveCSS('flex-direction', 'column');
    const [groupActionsBox, composerBox] = await Promise.all([
      groupActions.boundingBox(),
      page.getByTestId('agent-composer').boundingBox(),
    ]);
    expect(
      groupActionsBox!.y + groupActionsBox!.height,
      `${width}px 组提案操作区不能被输入栏遮挡`,
    ).toBeLessThanOrEqual(composerBox!.y + 1);
    await expectNoPageOverflow(page, `${width}px 组提案布局`);
    if (width === 320) {
      await page.screenshot({
        path: resolve(screenshots, '21-assistant-320-proposal-group.png'),
      });
    }
  }

  mocks.setMode('proposal-group-expired');
  await page.reload();
  const expiredReject = page.getByTestId(
    `agent-proposal-group-reject-${proposalGroupId}`,
  );
  const expiredConfirm = page.getByTestId(
    `agent-proposal-group-confirm-${proposalGroupId}`,
  );
  await expectTouchTarget(expiredReject, '过期组全部放弃按钮');
  await expectTouchTarget(expiredConfirm, '过期组全部确认按钮');
  await expect(expiredReject).toBeEnabled();
  await expect(expiredConfirm).toBeDisabled();
  await expectNoPageOverflow(page, '320px 过期组提案布局');

  mocks.setMode('running');
  await page.reload();
  await expectContained(page, page.getByTestId('agent-tool-progress'), '320px 工具进度');
  await expectNoPageOverflow(page, '320px 工具进度布局');

  await page.getByTestId('agent-history-trigger').click();
  await expectContained(
    page,
    page.getByTestId(`agent-history-item-${conversationId}`),
    '320px 会话历史项',
  );
  await expectNoPageOverflow(page, '320px 会话历史');
  await page.getByTestId('agent-history-close').click();

  await page.getByTestId('agent-settings-trigger').click();
  await expectContained(page, page.getByTestId('agent-settings-sheet'), '320px 助理设置弹层');
  await expectTouchTarget(page.getByTestId('agent-settings-close'), '助理设置关闭按钮');
  await expectNoPageOverflow(page, '320px 助理设置弹层');
  await page.getByTestId('agent-settings-close').click();

  for (const width of [320, 375, 390, 414]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await openFixture(page, '/agent-memory', () =>
      page.getByText(memory.content, { exact: true }),
    );
    await expect(page.getByText(memory.content, { exact: true })).toBeVisible();
    await expectNoPageOverflow(page, `${width}px 记忆列表`);

    await page.goto(`/agent-memory/${memoryId}`);
    await expect(page.getByText('记忆详情', { exact: true })).toBeVisible();
    await expect(page.getByText(memory.content, { exact: true })).toBeVisible();
    await expectNoPageOverflow(page, `${width}px 记忆详情`);
  }
});

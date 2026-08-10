import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Response } from '@playwright/test';

test.skip(
  process.env.HERMES_LIVE_E2E !== '1',
  '真实 Hermes E2E 只在显式设置 HERMES_LIVE_E2E=1 时运行',
);

type Presentation = {
  kind: string;
  title: string;
  emptyText: string;
  items: { title: string; detail: string; status: string }[];
};

type Run = {
  id: string;
  runtimeKind: 'fake' | 'hermes';
  status: string;
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type ConversationDetail = {
  id: string;
  messages: { runId: string | null; role: string; content: string }[];
  runs: Run[];
  toolEvents: {
    runId: string;
    toolName: string;
    status: string;
    presentation: Presentation | null;
  }[];
};

type ProposalGroup = {
  id: string;
  runId: string;
  status: string;
  steps: { id: string; actionType: string; stepOrder: number }[];
};

type Result = {
  id: number | string;
  prompt: string;
  expectedTool: string;
  expectedKind: string | null;
  screenshot: string;
  runId: string;
  runtimeKind: Run['runtimeKind'];
  runStatus: string;
  errorCode: string | null;
  durationMs: number;
  toolNames: string[];
  cardKinds: string[];
  cardTexts: string[];
  assistantText: string;
  passed: boolean;
  note: string | null;
  proposalGroupId?: string | null;
  proposalStepCount?: number;
  proposalPath?: 'a' | 'b' | null;
};

type ClarificationExpectation = {
  entityLabel: string;
  forbiddenText?: string;
  forbiddenTool: string;
  responsePattern: RegExp;
};

const repoRoot = resolve(process.cwd(), '../..');
const resultPath = resolve(repoRoot, 'test-screenshots/E2E-RESULTS.json');
const screenshotRoot = resolve(repoRoot, 'test-screenshots');
const apiBaseUrl = (
  process.env.FAMILY_API_URL ?? 'http://localhost:3100'
).replace(/\/+$/, '');
const fallbackCode = 'HERMES_UNAVAILABLE_FALLBACK';
const memoryOnly = process.env.HERMES_E2E_MEMORY_ONLY === '1';
const pageContextOnly = process.env.HERMES_E2E_PAGE_CONTEXT_ONLY === '1';

function existingReport() {
  try {
    return JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch {
    return null;
  }
}

async function responseData(response: Response) {
  try {
    const body = await response.json();
    return body?.data ?? null;
  } catch {
    return null;
  }
}

async function agentApi<T>(
  page: Page,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
) {
  let token = await page.evaluate(() =>
    window.localStorage.getItem('family-app-token'),
  );
  expect(token, '真实 Hermes E2E 必须保有当前登录成员的访问令牌').toBeTruthy();
  const execute = () =>
    page.request.fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { data: body }),
    });
  let response = await execute();
  if (response.status() === 401) {
    const refreshToken = await page.evaluate(() =>
      window.localStorage.getItem('family-app-refresh-token'),
    );
    expect(refreshToken, '真实 Hermes E2E 访问令牌过期时必须保有刷新令牌').toBeTruthy();
    const refreshed = await page.request.post(`${apiBaseUrl}/auth/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: { refreshToken },
    });
    expect(
      refreshed.ok(),
      `POST /auth/refresh 应成功，实际为 ${refreshed.status()}`,
    ).toBeTruthy();
    const payload = await refreshed.json();
    const session = payload.data;
    token = session.accessToken;
    await page.evaluate((nextSession) => {
      window.localStorage.setItem('family-app-token', nextSession.accessToken);
      window.localStorage.setItem(
        'family-app-refresh-token',
        nextSession.refreshToken,
      );
      window.localStorage.setItem(
        'family-app-account',
        JSON.stringify(nextSession.account),
      );
      window.localStorage.setItem(
        'family-app-member',
        JSON.stringify(nextSession.member),
      );
    }, session);
    response = await execute();
  }
  const payload = await response.json();
  expect(
    response.ok(),
    `${method} ${path} 应成功，实际为 ${response.status()}`,
  ).toBeTruthy();
  return payload.data as T;
}

function watchConversationDetails(page: Page) {
  const details = new Map<string, ConversationDetail>();
  page.on('response', async (response) => {
    if (response.request().method() !== 'GET') return;
    const path = new URL(response.url()).pathname;
    if (!/\/agent\/conversations\/[0-9a-f-]{36}$/.test(path)) return;
    const detail = (await responseData(response)) as ConversationDetail | null;
    if (detail?.id) details.set(detail.id, detail);
  });
  return details;
}

function runDurationMs(run: Run) {
  if (!run.startedAt || !run.finishedAt) return 0;
  return Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
}

function hasSpecificWeatherClaims(text: string) {
  return (
    /-?\d+(?:\.\d+)?\s*(?:°\s*C|℃|摄氏度)/i.test(text) ||
    /(?:降水|降雨).{0,8}\d+(?:\.\d+)?\s*(?:毫米|mm|%)/i.test(text)
  );
}

test('A7.4-A/A7.3 真实 Hermes 工具与页面上下文', async ({ page }) => {
  test.setTimeout(2_700_000);
  const previous = existingReport();
  const details = watchConversationDetails(page);
  const results: Result[] = memoryOnly || pageContextOnly
    ? (previous?.results ?? []).filter(
        (result: Result) => typeof result.id === 'number',
      )
    : [];
  const memoryChecks: Result[] = pageContextOnly
    ? (previous?.memoryChecks ?? [])
    : [];
  const pageContextChecks: Result[] = memoryOnly
    ? (previous?.pageContextChecks ?? [])
    : [];
  const proposalGroupChecks: Result[] =
    memoryOnly || pageContextOnly ? (previous?.proposalGroupChecks ?? []) : [];
  let conversationId =
    memoryOnly || pageContextOnly ? (previous?.conversationId ?? '') : '';
  let memoryConversationId = pageContextOnly
    ? (previous?.memoryConversationId ?? '')
    : '';
  let activeConversationId = '';

  const summary = () => ({
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    averageDurationMs: results.length
      ? Math.round(
          results.reduce((sum, result) => sum + result.durationMs, 0) /
            results.length,
        )
      : 0,
    runsWithToolEvents: results.filter((result) => result.toolNames.length > 0)
      .length,
    runsWithCards: results.filter((result) => result.cardKinds.length > 0).length,
    multiToolPassed: results.find((result) => result.id === 9)?.passed ?? false,
    fallbackCount: results.filter((result) => result.errorCode === fallbackCode)
      .length,
  });
  const persist = () => {
    writeFileSync(
      resultPath,
      `${JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          device: 'Expo Web / Chrome mobile viewport 390x844 / touch enabled',
          commitBase: process.env.HERMES_E2E_COMMIT ?? 'working-tree',
          conversationId,
          memoryConversationId,
          summary: summary(),
          visibilityGate: previous?.visibilityGate ?? null,
          results,
          memoryChecks,
          pageContextChecks,
          proposalGroupChecks,
        },
        null,
        2,
      )}\n`,
    );
  };
  const persistAuthState = () =>
    page.context().storageState({ path: 'e2e/.auth/mobile.json' });

  await page.goto('/assistant');
  const heading = page.getByRole('heading', {
    name: '问问小管家',
    exact: true,
  });
  const authenticated = await heading
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!authenticated) {
    const password = process.env.E2E_ACCOUNT_PASSWORD;
    expect(
      password !== undefined,
      '真实 Hermes E2E 缺少 E2E_ACCOUNT_PASSWORD；空字符串表示无密码账号',
    ).toBeTruthy();
    await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();
    await page
      .getByPlaceholder('输入账号')
      .fill(process.env.E2E_LOGIN_NAME ?? '爸爸');
    await page.getByPlaceholder('输入密码').fill(password ?? '');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname), {
      timeout: 20_000,
    });
    await page.goto('/assistant');
  }
  await expect(heading).toBeVisible();
  await expect(page.getByText('Hermes 已连接', { exact: true })).toBeVisible();
  await persistAuthState();

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/agent/conversations'),
  );
  await page.getByTestId('agent-new-conversation').click();
  const conversation = await responseData(await createResponsePromise);
  activeConversationId = conversation?.id ?? '';
  expect(activeConversationId).toBeTruthy();
  await expect(
    page.getByTestId(`agent-message-list-${activeConversationId}`),
  ).toBeVisible();
  if (memoryOnly) memoryConversationId = activeConversationId;
  else if (!pageContextOnly) conversationId = activeConversationId;

  await page.getByTestId('agent-history-trigger').click();
  const historyItem = page.getByTestId(
    `agent-history-item-${activeConversationId}`,
  );
  await expect(historyItem).toBeVisible({ timeout: 20_000 });
  await historyItem.click();
  await expect(page.getByText('想了解家里的什么？', { exact: true })).toBeVisible();
  await expect
    .poll(() => details.has(activeConversationId), { timeout: 20_000 })
    .toBeTruthy();

  async function runScenario(input: {
    id: number | string;
    prompt: string;
    expectedTool: string;
    expectedKind: string | null;
    screenshot: string;
    multiTool?: boolean;
    weather?: boolean;
    requiredText?: string;
    clarifyWithoutContext?: ClarificationExpectation;
    proposalGroup?: boolean;
  }) {
    const messageInput = page.getByTestId('agent-message-input');
    await messageInput.fill(input.prompt);
    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/agent\/conversations\/[0-9a-f-]{36}\/messages$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByTestId('agent-send-button').click();
    const runResponse = await runResponsePromise;
    const runConversationId = new URL(runResponse.url()).pathname.split('/').at(-2);
    expect(runConversationId).toBeTruthy();
    activeConversationId = runConversationId!;
    const createdRun = await responseData(runResponse);
    expect(createdRun?.id).toBeTruthy();

    await expect
      .poll(
        () =>
          details
            .get(activeConversationId)
            ?.runs.find((run) => run.id === createdRun.id)?.status ?? 'missing',
        { timeout: 300_000, intervals: [700, 1_000, 2_000] },
      )
      .toMatch(/completed|failed|cancelled/);

    const detail = details.get(activeConversationId);
    const run = detail?.runs.find((entry) => entry.id === createdRun.id);
    expect(run).toBeTruthy();
    const events =
      detail?.toolEvents.filter((event) => event.runId === createdRun.id) ?? [];
    const cards = events.flatMap((event) =>
      event.presentation ? [event.presentation] : [],
    );
    const toolNames = events.map((event) => event.toolName);
    const assistantText =
      detail?.messages.find(
        (message) =>
          message.runId === createdRun.id && message.role === 'assistant',
      )?.content ?? '';
    const fallback = run?.errorCode === fallbackCode;
    const groups = input.proposalGroup
      ? await agentApi<ProposalGroup[]>(page, '/agent/proposal-groups')
      : [];
    const proposalGroup = groups.find((group) => group.runId === createdRun.id);
    const proposalPath = input.proposalGroup
      ? toolNames.includes('propose_plan') &&
        (proposalGroup?.steps.length ?? 0) >= 2
        ? 'a'
        : ['propose_menu', 'propose_shopping_items', 'propose_task'].every(
              (tool) => toolNames.includes(tool),
            )
          ? 'b'
          : null
      : null;
    const expectedMatched = input.proposalGroup
      ? proposalPath !== null
      : input.multiTool
        ? new Set(toolNames).size >= 2 && cards.length >= 2
        : toolNames.includes(input.expectedTool) &&
          (input.expectedKind === null ||
            cards.some((card) => card.kind === input.expectedKind));
    const weatherSafe =
      !input.weather ||
      cards.some((card) => card.kind === 'weather' && card.items.length > 0) ||
      !hasSpecificWeatherClaims(assistantText);
    const grounded =
      !input.requiredText ||
      [assistantText, ...cards.map((card) => JSON.stringify(card))].some((text) =>
        text.includes(input.requiredText!),
      );
    const clarificationSafe =
      !input.clarifyWithoutContext ||
      (!toolNames.includes(input.clarifyWithoutContext.forbiddenTool) &&
        (!input.clarifyWithoutContext.forbiddenText ||
          !assistantText.includes(input.clarifyWithoutContext.forbiddenText)) &&
        input.clarifyWithoutContext.responsePattern.test(assistantText));
    const passed =
      run?.runtimeKind === 'hermes' &&
      !fallback &&
      (input.clarifyWithoutContext ? clarificationSafe : expectedMatched) &&
      weatherSafe &&
      grounded;
    const note = fallback
      ? 'Hermes 回落，模型未参与'
      : !grounded
        ? '回答未基于当前页面实体'
        : input.clarifyWithoutContext
          ? clarificationSafe
            ? null
            : `无上下文时未明确追问${input.clarifyWithoutContext.entityLabel}，或擅自选择了家庭资源`
          : !expectedMatched
            ? input.proposalGroup
              ? '既未生成多子项组提案，也未分别覆盖菜单、购物和任务提案'
              : '未调用预期工具或未生成预期卡片'
            : !weatherSafe
              ? '未取得天气数据却输出了具体温度或降水数字'
              : null;
    const result: Result = {
      id: input.id,
      prompt: input.prompt,
      expectedTool: input.expectedTool,
      expectedKind: input.expectedKind,
      screenshot: input.screenshot,
      runId: createdRun.id,
      runtimeKind: run?.runtimeKind ?? 'fake',
      runStatus: run?.status ?? 'unknown',
      errorCode: run?.errorCode ?? null,
      durationMs: run ? runDurationMs(run) : 0,
      toolNames,
      cardKinds: cards.map((card) => card.kind),
      cardTexts: cards.map((card) =>
        [
          card.title,
          ...card.items.map((item) =>
            `${item.title} ${item.detail} ${item.status}`.trim(),
          ),
          card.items.length ? '' : card.emptyText,
        ]
          .filter(Boolean)
          .join(' | '),
      ),
      assistantText,
      passed,
      note,
      ...(input.proposalGroup
        ? {
            proposalGroupId: proposalGroup?.id ?? null,
            proposalStepCount: proposalGroup?.steps.length ?? 0,
            proposalPath,
          }
        : {}),
    };
    if (typeof input.id === 'number') results.push(result);
    else if (String(input.id).startsWith('proposal-group')) {
      proposalGroupChecks.push(result);
    }
    else if (String(input.id).startsWith('page-context')) {
      pageContextChecks.push(result);
    } else memoryChecks.push(result);
    persist();
    await persistAuthState();
    console.log(`HERMES_E2E_RESULT ${JSON.stringify(result)}`);

    const cardsOnPage = page.locator(
      '[data-testid^="agent-result-"]:not([data-testid^="agent-result-open-"])',
    );
    if (await cardsOnPage.count()) await cardsOnPage.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(screenshotRoot, input.screenshot) });
    return result;
  }

  const scenarios = [
    { id: 1, prompt: '查看我的待办任务', expectedTool: 'get_member_tasks', expectedKind: 'tasks', screenshot: '01-tasks.png' },
    { id: 2, prompt: '这周家里有什么安排', expectedTool: 'get_family_schedule', expectedKind: 'schedule', screenshot: '02-schedule.png' },
    { id: 3, prompt: '家里还有哪些菜快过期了', expectedTool: 'get_inventory_summary', expectedKind: 'inventory', screenshot: '03-inventory.png' },
    { id: 4, prompt: '购物清单里有什么', expectedTool: 'get_shopping_list', expectedKind: 'shopping', screenshot: '04-shopping.png' },
    { id: 5, prompt: '搜索不辣的家常菜', expectedTool: 'search_recipes', expectedKind: 'recipes', screenshot: '05-recipes.png' },
    { id: 6, prompt: '下周点了什么菜', expectedTool: 'get_dish_plan', expectedKind: 'dish-plan', screenshot: '06-dish-plan.png' },
    { id: 7, prompt: '深圳这几天天气怎么样', expectedTool: 'get_weather', expectedKind: 'weather', screenshot: '07-weather.png', weather: true },
    { id: 8, prompt: '我的个人档案', expectedTool: 'get_member_profile', expectedKind: 'member-profile', screenshot: '08-profile.png' },
    { id: 9, prompt: '我明天有什么安排，需要准备什么食材', expectedTool: 'multi-tool', expectedKind: null, screenshot: '09-multi-tool.png', multiTool: true },
  ] as const;

  if (!memoryOnly && !pageContextOnly) {
    for (const scenario of scenarios) await runScenario(scenario);
    const proposalGroup = await runScenario({
      id: 'proposal-group-family-dinner',
      prompt:
        '周六晚上爸妈来家里吃饭，加上我们一共5个人；来访的爸爸不吃辣，其他人没有忌口。请把晚餐菜单、需要购买的食材和当天要做的准备任务都安排好，直接生成提案让我确认。',
      expectedTool: 'propose_plan',
      expectedKind: null,
      screenshot: '14-proposal-group.png',
      proposalGroup: true,
    });
    expect(proposalGroup.passed).toBeTruthy();
  }
  if (!pageContextOnly) {
    const memoryWrite = await runScenario({
      id: 'memory-write',
      prompt: '记住我不吃辣',
      expectedTool: 'remember_preference',
      expectedKind: null,
      screenshot: '10-memory-write.png',
    });
    expect(memoryWrite.passed).toBeTruthy();
    const candidates = await agentApi<
      {
        id: string;
        status: string;
        version: number;
        memoryKey: string;
        source: { id: string | null };
      }[]
    >(page, '/agent/memories?status=candidate&scope=member_private');
    const candidate = candidates.find(
      (memory) => memory.source.id === memoryWrite.runId,
    );
    expect(candidate, '记忆写入 run 必须产生对应的候选记忆').toBeTruthy();
    const activeMemories = await agentApi<
      { id: string; memoryKey: string; version: number }[]
    >(page, '/agent/memories?status=active&scope=member_private');
    const existingActive = activeMemories.find(
      (memory) => memory.memoryKey === candidate!.memoryKey,
    );
    let cleanupVersion = candidate!.version;
    if (!existingActive) {
      const confirmed = await agentApi<{ status: string; version: number }>(
        page,
        `/agent/memories/${candidate!.id}/confirm`,
        'POST',
        { expectedVersion: candidate!.version },
      );
      expect(confirmed.status).toBe('active');
      cleanupVersion = confirmed.version;
    }
    await runScenario({
      id: 'memory-recall',
      prompt: '我有什么饮食偏好',
      expectedTool: 'recall_preferences',
      expectedKind: null,
      screenshot: '11-memory-recall.png',
    });
    await agentApi(
      page,
      `/agent/memories/${candidate!.id}`,
      'DELETE',
      { expectedVersion: cleanupVersion },
    );
  }

  if (!memoryOnly) {
    await page.goto('/recipes');
    const dishEntry = page.locator('[data-testid^="recipe-dish-"]').first();
    await expect(dishEntry).toBeVisible();
    await persistAuthState();
    await dishEntry.tap();
    await expect(page).toHaveURL(/\/dish\/[0-9a-f-]{36}$/);
    const targetDish = {
      id: new URL(page.url()).pathname.split('/').at(-1)!,
      name: await page.getByTestId('dish-detail-name').innerText(),
    };
    await page.getByTestId('dish-ask-assistant').click();
    await expect(page).toHaveURL(/\/assistant\?.*entityType=dish/);
    await expect(page.getByTestId('agent-page-context')).toContainText(
      `正在参考：${targetDish.name}`,
    );

    const contextConversationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/agent/conversations'),
    );
    await page.getByTestId('agent-new-conversation').click();
    const contextConversation = await responseData(
      await contextConversationResponse,
    );
    activeConversationId = contextConversation?.id ?? '';
    expect(activeConversationId).toBeTruthy();
    await expect(
      page.getByTestId(`agent-message-list-${activeConversationId}`),
    ).toBeVisible();
    const contextual = await runScenario({
      id: 'page-context-dish',
      prompt: '这道菜需要什么食材',
      expectedTool: 'search_recipes',
      expectedKind: 'recipes',
      screenshot: '12-page-context.png',
      requiredText: targetDish.name,
    });
    expect(contextual.passed).toBeTruthy();

    await page.getByTestId('agent-page-context-clear').click();
    await expect(page.getByTestId('agent-page-context')).toHaveCount(0);
    await page.goto('/assistant');
    await expect(page.getByTestId('agent-page-context')).toHaveCount(0);
    await persistAuthState();
    const plainConversationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/agent/conversations'),
    );
    await page.getByTestId('agent-new-conversation').click();
    const plainConversation = await responseData(await plainConversationResponse);
    activeConversationId = plainConversation?.id ?? '';
    expect(activeConversationId).toBeTruthy();
    await expect(
      page.getByTestId(`agent-message-list-${activeConversationId}`),
    ).toBeVisible();
    const withoutContext = await runScenario({
      id: 'page-context-cleared',
      prompt: '这道菜需要什么食材',
      expectedTool: 'search_recipes',
      expectedKind: 'recipes',
      screenshot: '13-no-context.png',
      clarifyWithoutContext: {
        entityLabel: '菜品',
        forbiddenText: targetDish.name,
        forbiddenTool: 'search_recipes',
        responsePattern: /哪道菜|具体.*菜|菜名|指的是|请.*说明|无法确定/,
      },
    });
    expect(withoutContext.passed).toBeTruthy();

    await page.goto('/assistant');
    await expect(page.getByTestId('agent-page-context')).toHaveCount(0);
    const knowledgeConversationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/agent/conversations'),
    );
    await page.getByTestId('agent-new-conversation').click();
    const knowledgeConversation = await responseData(
      await knowledgeConversationResponse,
    );
    activeConversationId = knowledgeConversation?.id ?? '';
    expect(activeConversationId).toBeTruthy();
    await expect(
      page.getByTestId(`agent-message-list-${activeConversationId}`),
    ).toBeVisible();
    const knowledgeWithoutContext = await runScenario({
      id: 'page-context-missing-knowledge',
      prompt: '这篇文章主要讲了什么',
      expectedTool: 'search_knowledge',
      expectedKind: 'knowledge',
      screenshot: '15-no-knowledge-context.png',
      clarifyWithoutContext: {
        entityLabel: '知识文章',
        forbiddenTool: 'search_knowledge',
        responsePattern: /哪篇|具体.*文章|文章标题|哪条.*知识|告诉我.*标题|把.*文章.*(?:贴|发)|指的是|请.*说明|无法确定/,
      },
    });
    expect(knowledgeWithoutContext.passed).toBeTruthy();

  }

  if (!pageContextOnly) {
    expect(summary().passed).toBeGreaterThanOrEqual(7);
    expect(summary().fallbackCount).toBe(0);
    expect(memoryChecks.every((result) => result.passed)).toBeTruthy();
    expect(proposalGroupChecks.every((result) => result.passed)).toBeTruthy();
  }
  expect(pageContextChecks.every((result) => result.passed)).toBeTruthy();
});

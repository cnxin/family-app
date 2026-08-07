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
};

const repoRoot = resolve(process.cwd(), '../..');
const resultPath = resolve(repoRoot, 'test-screenshots/E2E-RESULTS.json');
const screenshotRoot = resolve(repoRoot, 'test-screenshots');
const fallbackCode = 'HERMES_UNAVAILABLE_FALLBACK';
const memoryOnly = process.env.HERMES_E2E_MEMORY_ONLY === '1';

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

test('A7.4-A 真实 Hermes 九场景与记忆工具', async ({ page }) => {
  test.setTimeout(2_700_000);
  const previous = existingReport();
  const details = watchConversationDetails(page);
  const results: Result[] = memoryOnly
    ? (previous?.results ?? []).filter(
        (result: Result) => typeof result.id === 'number',
      )
    : [];
  const memoryChecks: Result[] = [];
  let conversationId = memoryOnly ? (previous?.conversationId ?? '') : '';
  let memoryConversationId = '';
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
        },
        null,
        2,
      )}\n`,
    );
  };

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
    await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();
    await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname), {
      timeout: 600_000,
    });
    await page.goto('/assistant');
  }
  await expect(heading).toBeVisible();
  await expect(page.getByText('Hermes 已连接', { exact: true })).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/mobile.json' });

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/agent/conversations'),
  );
  await page.getByTestId('agent-new-conversation').click();
  const conversation = await responseData(await createResponsePromise);
  activeConversationId = conversation?.id ?? '';
  expect(activeConversationId).toBeTruthy();
  if (memoryOnly) memoryConversationId = activeConversationId;
  else conversationId = activeConversationId;

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
    const createdRun = await responseData(await runResponsePromise);
    expect(createdRun?.id).toBeTruthy();

    await expect
      .poll(
        () =>
          details
            .get(activeConversationId)
            ?.runs.find((run) => run.id === createdRun.id)?.status ?? 'missing',
        { timeout: 240_000, intervals: [700, 1_000, 2_000] },
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
    const expectedMatched = input.multiTool
      ? new Set(toolNames).size >= 2 && cards.length >= 2
      : toolNames.includes(input.expectedTool) &&
        (input.expectedKind === null ||
          cards.some((card) => card.kind === input.expectedKind));
    const weatherSafe =
      !input.weather ||
      cards.some((card) => card.kind === 'weather' && card.items.length > 0) ||
      !hasSpecificWeatherClaims(assistantText);
    const passed =
      run?.runtimeKind === 'hermes' && !fallback && expectedMatched && weatherSafe;
    const note = fallback
      ? 'Hermes 回落，模型未参与'
      : !expectedMatched
        ? '未调用预期工具或未生成预期卡片'
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
    };
    if (typeof input.id === 'number') results.push(result);
    else memoryChecks.push(result);
    persist();
    console.log(`HERMES_E2E_RESULT ${JSON.stringify(result)}`);

    const cardsOnPage = page.locator(
      '[data-testid^="agent-result-"]:not([data-testid^="agent-result-open-"])',
    );
    if (await cardsOnPage.count()) await cardsOnPage.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(screenshotRoot, input.screenshot) });
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

  if (!memoryOnly) {
    for (const scenario of scenarios) await runScenario(scenario);
  }
  await runScenario({
    id: 'memory-write',
    prompt: '记住我不吃辣',
    expectedTool: 'remember_preference',
    expectedKind: null,
    screenshot: '10-memory-write.png',
  });
  await runScenario({
    id: 'memory-recall',
    prompt: '我有什么饮食偏好',
    expectedTool: 'recall_preferences',
    expectedKind: null,
    screenshot: '11-memory-recall.png',
  });

  expect(summary().passed).toBeGreaterThanOrEqual(7);
  expect(summary().fallbackCount).toBe(0);
  expect(memoryChecks.every((result) => result.passed)).toBeTruthy();
});

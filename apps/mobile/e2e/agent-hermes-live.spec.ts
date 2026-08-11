import { spawnSync } from 'node:child_process';
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
  footer?: string;
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
  proposals: AgentProposal[];
};

type AgentProposal = {
  id: string;
  runId: string;
  actionType: string;
  status: string;
  version: number;
  payload: Record<string, unknown>;
};

type FinanceAccount = {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
  balance: number;
};

type FinanceSummary = {
  month: string;
  currency: 'CNY';
  income: number;
  expense: number;
  net: number;
  totalBalance: number;
  accounts: FinanceAccount[];
  budgets: { amount: number; spent: number; remaining: number }[];
  categorySpending: { amount: number }[];
};

type FinanceDbProposal = {
  id: string;
  runId: string;
  status: string;
  version: number;
  payload: Record<string, unknown>;
};

type FinanceDbSnapshot = {
  accountId: string;
  householdId: string;
  householdTransactionCount: number;
  accountPostingCount: number;
  proposals: FinanceDbProposal[];
  proposalTransactionIds: string[];
};

type FinanceEvidence = {
  expectedSummary?: Pick<
    FinanceSummary,
    'month' | 'income' | 'expense' | 'net' | 'totalBalance'
  >;
  claimedAmounts?: number[];
  before?: FinanceDbSnapshot;
  afterProposal?: FinanceDbSnapshot;
  rejectedProposalIds?: string[];
  reversedTransactionIds?: string[];
  accountDeactivated?: boolean;
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
  attempts: number;
  attemptDurationsMs: number[];
  attemptRunIds: string[];
  attemptErrorCodes: (string | null)[];
  toolNames: string[];
  cardKinds: string[];
  cardTexts: string[];
  assistantText: string;
  passed: boolean;
  note: string | null;
  proposalGroupId?: string | null;
  proposalStepCount?: number;
  proposalPath?: 'a' | 'b' | null;
  expectedFinanceExpense?: number;
  financeAmountClaims?: number[];
  financeEvidence?: FinanceEvidence;
};

type ClarificationExpectation = {
  entityLabel: string;
  forbiddenText?: string;
  forbiddenTool: string;
  responsePattern: RegExp;
};

type ScenarioInput = {
  id: number | string;
  prompt: string;
  expectedTool: string;
  expectedKind: string | null;
  screenshot: string;
  multiTool?: boolean;
  weather?: boolean;
  requiredText?: string;
  textOnly?: boolean;
  honestUnavailable?: boolean;
  forbidSpecificDate?: boolean;
  clarifyWithoutContext?: ClarificationExpectation;
  proposalGroup?: boolean;
  requiredTools?: string[];
  financeSummary?: FinanceSummary;
  captureRunId?: (runId: string) => void;
  expectedPageContext?: {
    entityType: string;
    entityId: string;
  };
};

const repoRoot = resolve(process.cwd(), '../..');
const resultPath = resolve(repoRoot, 'test-screenshots/E2E-RESULTS.json');
const screenshotRoot = resolve(repoRoot, 'test-screenshots');
const apiBaseUrl = (
  process.env.FAMILY_API_URL ?? 'http://localhost:3100'
).replace(/\/+$/, '');
const fallbackCode = 'HERMES_UNAVAILABLE_FALLBACK';
const maxScenarioAttempts =
  process.env.HERMES_E2E_SINGLE_ATTEMPT === '1' ? 1 : 3;
const retryDelayMs = 90_000;
const runCompletionTimeoutMs = 450_000;
const memoryOnly = process.env.HERMES_E2E_MEMORY_ONLY === '1';
const pageContextOnly = process.env.HERMES_E2E_PAGE_CONTEXT_ONLY === '1';
const readToolsOnly = process.env.HERMES_E2E_READ_TOOLS_ONLY === '1';
const financeOnly = process.env.HERMES_E2E_FINANCE_ONLY === '1';
const proposalGroupOnly = process.env.HERMES_E2E_PROPOSAL_GROUP_ONLY === '1';
const assetOnly = process.env.HERMES_E2E_ASSET_ONLY === '1';
const focusedScenarioPrompts = [
  '购物清单里有什么',
  '下周点了什么菜',
  '我的个人档案',
  '搜索不辣的家常菜',
] as const;
type FocusedScenarioPrompt = (typeof focusedScenarioPrompts)[number];

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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
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

function hasSpecificDateClaims(text: string) {
  return (
    /(?:19|20|21)\d{2}\s*年?/.test(text) ||
    /(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])/.test(text) ||
    /(?:一|二|三|四|五|六|七|八|九|十|十一|十二|[1-9]|1[0-2])月(?:\s*(?:[1-9]|[12]\d|3[01]|[一二三四五六七八九十]{1,3})\s*(?:日|号))?/.test(
      text,
    ) ||
    /(?:今年|明年|后年|去年)/.test(text)
  );
}

function financeAmountClaims(text: string) {
  const claims: number[] = [];
  const patterns = [
    /(?:[¥￥]|人民币\s*|CNY\s*)(-?\d[\d,]*(?:\.\d{1,2})?)(?:\s*元)?/gi,
    /(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:元|块(?:钱)?|人民币|CNY)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1].replaceAll(',', ''));
      if (Number.isFinite(value)) claims.push(value);
    }
  }
  return [...new Set(claims)];
}

function knownFinanceAmounts(summary: FinanceSummary) {
  return [
    summary.income,
    summary.expense,
    summary.net,
    summary.totalBalance,
    ...summary.accounts.flatMap((account) => [account.balance]),
    ...summary.budgets.flatMap((budget) => [
      budget.amount,
      budget.spent,
      budget.remaining,
    ]),
    ...summary.categorySpending.map((entry) => entry.amount),
  ].map(Number);
}

function toolsAppearInOrder(actual: string[], required: string[]) {
  let cursor = 0;
  for (const toolName of required) {
    const index = actual.indexOf(toolName, cursor);
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

function hasGroundedExpenseClaim(text: string, expectedExpense: number) {
  const normalized = text.replaceAll(',', '');
  const [whole, decimals] = expectedExpense.toFixed(2).split('.');
  const amountPattern =
    decimals === '00'
      ? `${whole}(?:\\.0{1,2})?`
      : decimals.endsWith('0')
        ? `${whole}\\.${decimals[0]}(?:0)?`
        : `${whole}\\.${decimals}`;
  return new RegExp(
    `(?:支出|花了|消费).{0,20}(?:[¥￥]|人民币\\s*|CNY\\s*)?${amountPattern}(?:\\s*(?:元|块(?:钱)?|人民币|CNY))?`,
    'i',
  ).test(normalized);
}

function assertUuid(value: string, label: string) {
  expect(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
    `${label} 必须是 UUID，避免把未验证内容拼入只读取证 SQL`,
  ).toBeTruthy();
}

function financeDbSnapshot(accountId: string, runIds: string[] = []) {
  assertUuid(accountId, '财务测试账户 ID');
  runIds.forEach((runId) => assertUuid(runId, 'Hermes run ID'));
  const runIdArray = runIds.length
    ? `ARRAY[${runIds.map((runId) => `'${runId}'::uuid`).join(',')}]`
    : 'ARRAY[]::uuid[]';
  const sql = `
    WITH target_account AS (
      SELECT id, "householdId" FROM finance_accounts WHERE id = '${accountId}'::uuid
    ), finance_proposals AS (
      SELECT p.id, p."runId", p.status, p.version, p.payload, p."createdAt"
      FROM agent_action_proposals p
      WHERE p."runId" = ANY(${runIdArray}) AND p."actionType" = 'finance'
    )
    SELECT json_build_object(
      'accountId', account.id,
      'householdId', account."householdId",
      'householdTransactionCount', (
        SELECT count(*)::int FROM finance_transactions transaction
        WHERE transaction."householdId" = account."householdId"
      ),
      'accountPostingCount', (
        SELECT count(*)::int FROM finance_postings posting
        WHERE posting."accountId" = account.id
      ),
      'proposals', COALESCE((
        SELECT json_agg(json_build_object(
          'id', proposal.id,
          'runId', proposal."runId",
          'status', proposal.status,
          'version', proposal.version,
          'payload', proposal.payload
        ) ORDER BY proposal."createdAt")
        FROM finance_proposals proposal
      ), '[]'::json),
      'proposalTransactionIds', COALESCE((
        SELECT json_agg(transaction.id::text ORDER BY transaction."createdAt")
        FROM finance_transactions transaction
        WHERE transaction."sourceType" = 'agent'
          AND transaction."sourceId" IN (
            SELECT proposal.id::text FROM finance_proposals proposal
          )
      ), '[]'::json)
    )::text
    FROM target_account account;
  `;
  const command = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.dev.yml',
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'family',
      '-d',
      'family_app',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  expect(
    command.status,
    `财务数据库取证失败: ${command.stderr || command.error?.message || '未知错误'}`,
  ).toBe(0);
  const output = command.stdout.trim();
  expect(output, '财务数据库取证必须返回测试账户快照').toBeTruthy();
  return JSON.parse(output) as FinanceDbSnapshot;
}

function claimsFamilyDataWithoutEvidence(text: string) {
  const normalized = text.trim();
  if (!normalized) return false;
  return !/(?:无法|不能|没法|查不到|不确定|工具不可用|没有权限)|(?:请|需要).{0,12}(?:告诉|提供|说明|补充)|(?:哪(?:个|些|项|天|位)|具体(?:是|哪)).{0,12}[？?]/.test(
    normalized,
  );
}

async function runHermesLiveTest(
  page: Page,
  focusedScenarioPrompt?: FocusedScenarioPrompt,
) {
  test.setTimeout(14_400_000);
  const previous = existingReport();
  const details = watchConversationDetails(page);
  const previousResults = (previous?.results ?? []).filter(
    (result: Result) => typeof result.id === 'number',
  );
  const results: Result[] = memoryOnly || pageContextOnly || proposalGroupOnly
    ? previousResults
    : focusedScenarioPrompt
      ? previousResults.filter(
          (result: Result) => result.prompt !== focusedScenarioPrompt,
        )
      : previousResults.filter((result: Result) =>
          focusedScenarioPrompts.includes(
            result.prompt as FocusedScenarioPrompt,
          ),
        );
  const memoryChecks: Result[] =
    pageContextOnly || focusedScenarioPrompt || proposalGroupOnly
    ? (previous?.memoryChecks ?? [])
    : [];
  const pageContextChecks: Result[] =
    memoryOnly || focusedScenarioPrompt || proposalGroupOnly
    ? (previous?.pageContextChecks ?? [])
    : [];
  const proposalGroupChecks: Result[] =
    memoryOnly || pageContextOnly || focusedScenarioPrompt
      ? (previous?.proposalGroupChecks ?? [])
      : [];
  const financeChecks: Result[] =
    memoryOnly || pageContextOnly || focusedScenarioPrompt
      ? (previous?.financeChecks ?? [])
      : [];
  let conversationId =
    memoryOnly || pageContextOnly ? (previous?.conversationId ?? '') : '';
  let memoryConversationId = pageContextOnly
    ? (previous?.memoryConversationId ?? '')
    : '';
  let activeConversationId = '';

  const recordedResults = () => [
    ...results,
    ...memoryChecks,
    ...pageContextChecks,
    ...proposalGroupChecks,
    ...financeChecks,
  ];
  const summary = () => {
    const recorded = recordedResults();
    return {
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
      runsWithCards: results.filter((result) => result.cardKinds.length > 0)
        .length,
      multiToolPassed: results.find((result) => result.id === 9)?.passed ?? false,
      financePassed: financeChecks.filter((result) => result.passed).length,
      financeTotal: financeChecks.length,
      fallbackCount: recorded.filter(
        (result) => result.errorCode === fallbackCode,
      ).length,
      totalAttempts: recorded.reduce(
        (sum, result) => sum + (result.attempts ?? 1),
        0,
      ),
      totalRetries: recorded.reduce(
        (sum, result) => sum + Math.max(0, (result.attempts ?? 1) - 1),
        0,
      ),
      fallbackAttemptCount: recorded.reduce(
        (sum, result) =>
          sum +
          (result.attemptErrorCodes ?? [result.errorCode]).filter(
            (code) => code === fallbackCode,
          ).length,
        0,
      ),
    };
  };
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
          financeChecks,
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

  async function createFreshConversation(delayMs = 0) {
    if (delayMs > 0) await page.waitForTimeout(delayMs);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/agent/conversations'),
    );
    await page.getByTestId('agent-new-conversation').click();
    const conversation = await responseData(await responsePromise);
    activeConversationId = conversation?.id ?? '';
    expect(activeConversationId).toBeTruthy();
    await expect(
      page.getByTestId(`agent-message-list-${activeConversationId}`),
    ).toBeVisible();
    if (memoryOnly) memoryConversationId = activeConversationId;
    else if (!pageContextOnly) conversationId = activeConversationId;
  }

  await createFreshConversation();

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

  async function executeScenarioAttempt(
    input: ScenarioInput,
    attempt: number,
    attemptDurationsMs: number[],
    attemptRunIds: string[],
    attemptErrorCodes: (string | null)[],
  ) {
    const messageInput = page.getByTestId('agent-message-input');
    await messageInput.fill(input.prompt);
    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.status() === 202 &&
        /\/agent\/conversations\/[0-9a-f-]{36}\/messages$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByTestId('agent-send-button').click();
    const runResponse = await runResponsePromise;
    if (input.expectedPageContext) {
      const requestBody = runResponse.request().postDataJSON() as {
        pageContext?: { entityType?: string; entityId?: string };
      };
      expect(requestBody.pageContext).toMatchObject(input.expectedPageContext);
    }
    const runConversationId = new URL(runResponse.url()).pathname.split('/').at(-2);
    expect(runConversationId).toBeTruthy();
    activeConversationId = runConversationId!;
    const createdRun = await responseData(runResponse);
    expect(createdRun?.id).toBeTruthy();
    input.captureRunId?.(createdRun.id);

    await expect
      .poll(
        () =>
          details
            .get(activeConversationId)
            ?.runs.find((run) => run.id === createdRun.id)?.status ?? 'missing',
        { timeout: runCompletionTimeoutMs, intervals: [700, 1_000, 2_000] },
      )
      .toMatch(/completed|failed|cancelled/);

    const detail = details.get(activeConversationId);
    const run = detail?.runs.find((entry) => entry.id === createdRun.id);
    expect(run).toBeTruthy();
    const durationMs = run ? runDurationMs(run) : 0;
    attemptDurationsMs.push(durationMs);
    attemptRunIds.push(createdRun.id);
    attemptErrorCodes.push(run?.errorCode ?? null);
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
    const requiredToolsMatched =
      !input.requiredTools ||
      toolsAppearInOrder(toolNames, input.requiredTools);
    const expectedMatched = input.textOnly
      ? assistantText.trim().length > 0
      : input.proposalGroup
      ? proposalPath !== null
      : input.requiredTools
        ? requiredToolsMatched
      : input.multiTool
        ? new Set(toolNames).size >= 2 && cards.length >= 2
        : toolNames.includes(input.expectedTool) &&
          (input.expectedKind === null ||
            cards.some((card) => card.kind === input.expectedKind));
    const claimedFinanceAmounts = input.financeSummary
      ? financeAmountClaims(assistantText)
      : [];
    const financeSafe =
      !input.financeSummary ||
      (hasGroundedExpenseClaim(assistantText, input.financeSummary.expense) &&
        claimedFinanceAmounts.every((claim) =>
          knownFinanceAmounts(input.financeSummary!).some(
            (known) => Math.abs(claim - known) < 0.001,
          ),
        ));
    const weatherSafe =
      !input.weather ||
      cards.some((card) => card.kind === 'weather' && card.items.length > 0) ||
      !hasSpecificWeatherClaims(assistantText);
    const grounded =
      !input.requiredText ||
      [assistantText, ...cards.map((card) => JSON.stringify(card))].some((text) =>
        text.includes(input.requiredText!),
      );
    const honestUnavailable =
      !input.honestUnavailable ||
      /没有(?:找到|记录|工具)|找不到|无法|没法|缺少|不可用/.test(assistantText);
    const dateSafe =
      !input.forbidSpecificDate || !hasSpecificDateClaims(assistantText);
    const clarificationSafe =
      !input.clarifyWithoutContext ||
      (!toolNames.includes(input.clarifyWithoutContext.forbiddenTool) &&
        (!input.clarifyWithoutContext.forbiddenText ||
          !assistantText.includes(input.clarifyWithoutContext.forbiddenText)) &&
        input.clarifyWithoutContext.responsePattern.test(assistantText));
    const ungroundedFamilyClaim =
      toolNames.length === 0 &&
      input.expectedTool !== 'none' &&
      !input.clarifyWithoutContext &&
      claimsFamilyDataWithoutEvidence(assistantText);
    const toolMarkupSafe = !assistantText.includes('<utils.ToolCalling');
    const passed =
      run?.runtimeKind === 'hermes' &&
      !fallback &&
      (input.clarifyWithoutContext ? clarificationSafe : expectedMatched) &&
      weatherSafe &&
      grounded &&
      honestUnavailable &&
      dateSafe &&
      financeSafe &&
      toolMarkupSafe &&
      !ungroundedFamilyClaim;
    let note: string | null = null;
    if (fallback) note = 'Hermes 回落，模型未参与';
    else if (!dateSafe) note = '无资产详情工具却输出了具体保修日期';
    else if (!grounded) note = '回答未基于当前页面实体';
    else if (!honestUnavailable) note = '资产保修数据不可达时没有诚实说明限制';
    else if (!financeSafe) note = '财务回答没有给出真实支出数字，或编造了汇总中不存在的金额';
    else if (!toolMarkupSafe) note = '回答正文残留了模型内部工具调用标记';
    else if (input.clarifyWithoutContext) {
      if (!clarificationSafe) {
        note = `无上下文时未明确追问${input.clarifyWithoutContext.entityLabel}，或擅自选择了家庭资源`;
      }
    } else if (ungroundedFamilyClaim) {
      note = '未调用任何工具却给出了具体家庭数据结论';
    } else if (!expectedMatched) {
      note = input.proposalGroup
        ? '既未生成多子项组提案，也未分别覆盖菜单、购物和任务提案'
        : '未调用预期工具或未生成预期卡片';
    } else if (!weatherSafe) {
      note = '未取得天气数据却输出了具体温度或降水数字';
    }
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
      durationMs,
      attempts: attempt,
      attemptDurationsMs: [...attemptDurationsMs],
      attemptRunIds: [...attemptRunIds],
      attemptErrorCodes: [...attemptErrorCodes],
      toolNames,
      cardKinds: cards.map((card) => card.kind),
      cardTexts: cards.map((card) =>
        [
          card.title,
          ...card.items.map((item) =>
            `${item.title} ${item.detail} ${item.status}`.trim(),
          ),
          card.footer,
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
      ...(input.financeSummary
        ? {
            expectedFinanceExpense: input.financeSummary.expense,
            financeAmountClaims: claimedFinanceAmounts,
            financeEvidence: {
              expectedSummary: {
                month: input.financeSummary.month,
                income: input.financeSummary.income,
                expense: input.financeSummary.expense,
                net: input.financeSummary.net,
                totalBalance: input.financeSummary.totalBalance,
              },
              claimedAmounts: claimedFinanceAmounts,
            },
          }
        : {}),
    };
    return { result, fallback };
  }

  async function runScenario(input: ScenarioInput) {
    const attemptDurationsMs: number[] = [];
    const attemptRunIds: string[] = [];
    const attemptErrorCodes: (string | null)[] = [];

    for (let attempt = 1; attempt <= maxScenarioAttempts; attempt += 1) {
      await createFreshConversation(attempt > 1 ? retryDelayMs : 0);
      const { result, fallback } = await executeScenarioAttempt(
        input,
        attempt,
        attemptDurationsMs,
        attemptRunIds,
        attemptErrorCodes,
      );
      console.log(
        `HERMES_E2E_ATTEMPT ${JSON.stringify({
          id: input.id,
          attempt,
          runId: result.runId,
          durationMs: result.durationMs,
          errorCode: result.errorCode,
          toolNames: result.toolNames,
          passed: result.passed,
          note: result.note,
        })}`,
      );

      if (fallback && attempt < maxScenarioAttempts) {
        continue;
      }

      if (typeof input.id === 'number') results.push(result);
      else if (String(input.id).startsWith('proposal-group')) {
        proposalGroupChecks.push(result);
      } else if (String(input.id).startsWith('finance-')) {
        financeChecks.push(result);
      } else if (String(input.id).startsWith('page-context')) {
        pageContextChecks.push(result);
      } else memoryChecks.push(result);
      persist();
      await persistAuthState();
      console.log(`HERMES_E2E_RESULT ${JSON.stringify(result)}`);

      const cardsOnPage = page.locator(
        '[data-testid^="agent-result-"]:not([data-testid^="agent-result-open-"])',
      );
      if (await cardsOnPage.count()) {
        await cardsOnPage.last().scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: resolve(screenshotRoot, input.screenshot) });
      return result;
    }
    throw new Error(`场景 ${input.id} 未产生最终结果`);
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

  if (!memoryOnly && !pageContextOnly && !financeOnly && !assetOnly) {
    const selectedScenarios = proposalGroupOnly
      ? []
      : focusedScenarioPrompt
      ? scenarios.filter((scenario) => scenario.prompt === focusedScenarioPrompt)
      : scenarios.filter(
          (scenario) =>
            !focusedScenarioPrompts.includes(
              scenario.prompt as FocusedScenarioPrompt,
            ),
        );
    for (const scenario of selectedScenarios) await runScenario(scenario);
    if (!readToolsOnly && !focusedScenarioPrompt) {
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
  }

  if (
    !memoryOnly &&
    !pageContextOnly &&
    !readToolsOnly &&
    !focusedScenarioPrompt &&
    !proposalGroupOnly &&
    !assetOnly
  ) {
    const testAccountName = 'Hermes 真机记账测试账户';
    const accounts = await agentApi<FinanceAccount[]>(
      page,
      '/finance/accounts?includeInactive=true',
    );
    let testAccount = accounts.find((account) => account.name === testAccountName);
    if (!testAccount) {
      testAccount = await agentApi<FinanceAccount>(
        page,
        '/finance/accounts',
        'POST',
        { name: testAccountName, type: 'cash', openingBalance: 0 },
      );
    } else if (!testAccount.isActive) {
      testAccount = await agentApi<FinanceAccount>(
        page,
        `/finance/accounts/${testAccount.id}`,
        'PATCH',
        { isActive: true, expectedVersion: testAccount.version },
      );
    }
    expect(testAccount.isActive, '财务真机测试账户必须已启用').toBeTruthy();

    const before = financeDbSnapshot(testAccount.id);
    let financeQuery: Result | undefined;
    let financeProposal: Result | undefined;
    let proposalDatabaseSafe = false;
    const rejectedProposalIds: string[] = [];
    const reversedTransactionIds: string[] = [];
    const financeProposalRunIds: string[] = [];
    try {
      const liveSummary = await agentApi<FinanceSummary>(page, '/finance/summary');
      expect(
        liveSummary.expense,
        '财务查询真机场景使用的开发家庭本月真实支出应为 0',
      ).toBe(0);
      financeQuery = await runScenario({
        id: 'finance-summary',
        prompt: '这个月花了多少钱',
        expectedTool: 'get_finance_summary',
        expectedKind: 'finance',
        screenshot: '17-finance-summary.png',
        financeSummary: liveSummary,
      });

      financeProposal = await runScenario({
        id: 'finance-proposal',
        prompt: '记一笔 200 块买菜',
        expectedTool: 'propose_finance_transaction',
        expectedKind: null,
        screenshot: '18-finance-proposal.png',
        requiredTools: [
          'get_finance_summary',
          'propose_finance_transaction',
        ],
        captureRunId: (runId) => financeProposalRunIds.push(runId),
      });
      const afterProposal = financeDbSnapshot(
        testAccount.id,
        financeProposal.attemptRunIds,
      );
      const finalRunProposals = afterProposal.proposals.filter(
        (proposal) => proposal.runId === financeProposal!.runId,
      );
      const finalProposal = finalRunProposals.find(
        (proposal) => proposal.status === 'pending',
      );
      const allProposalsUnexecuted = afterProposal.proposals.every(
        (proposal) => proposal.status !== 'confirmed' && proposal.status !== 'executed',
      );
      const payloadMatches =
        finalProposal?.payload.type === 'expense' &&
        Number(finalProposal.payload.amount) === 200 &&
        finalProposal.payload.accountId === testAccount.id;
      proposalDatabaseSafe =
        finalRunProposals.length === 1 &&
        Boolean(finalProposal) &&
        payloadMatches &&
        allProposalsUnexecuted &&
        afterProposal.proposalTransactionIds.length === 0 &&
        afterProposal.accountPostingCount === before.accountPostingCount &&
        afterProposal.householdTransactionCount ===
          before.householdTransactionCount;
      financeProposal.financeEvidence = {
        before,
        afterProposal,
      };
      financeProposal.passed = financeProposal.passed && proposalDatabaseSafe;
      if (!proposalDatabaseSafe) {
        financeProposal.note =
          '财务提案状态、200 元测试载荷或未自动入账数据库断言失败';
      }
      persist();
      console.log(
        `HERMES_E2E_FINANCE_DB ${JSON.stringify({
          runIds: financeProposal.attemptRunIds,
          before,
          afterProposal,
          proposalDatabaseSafe,
        })}`,
      );
    } finally {
      const attemptRunIds = [
        ...new Set([
          ...financeProposalRunIds,
          ...(financeProposal?.attemptRunIds ?? []),
        ]),
      ];
      const cleanupSnapshot = financeDbSnapshot(testAccount.id, attemptRunIds);
      for (const proposal of cleanupSnapshot.proposals) {
        if (proposal.status !== 'pending') continue;
        const rejected = await agentApi<AgentProposal>(
          page,
          `/agent/proposals/${proposal.id}/reject`,
          'POST',
          { expectedVersion: proposal.version },
        );
        expect(rejected.status).toBe('rejected');
        rejectedProposalIds.push(rejected.id);
      }
      for (const transactionId of cleanupSnapshot.proposalTransactionIds) {
        const reversed = await agentApi<{ id: string }>(
          page,
          `/finance/transactions/${transactionId}/reverse`,
          'POST',
          {
            note: 'Hermes 真机测试检测到意外自动入账，按财务规则创建反向交易',
            idempotencyKey: `hermes-live-reversal:${transactionId}`,
          },
        );
        expect(reversed.id).toBeTruthy();
        reversedTransactionIds.push(transactionId);
      }
      const latestAccounts = await agentApi<FinanceAccount[]>(
        page,
        '/finance/accounts?includeInactive=true',
      );
      const latestAccount = latestAccounts.find(
        (account) => account.id === testAccount!.id,
      );
      expect(latestAccount, '财务真机测试账户在清理前必须仍然存在').toBeTruthy();
      const deactivated = latestAccount!.isActive
        ? await agentApi<FinanceAccount>(
            page,
            `/finance/accounts/${latestAccount!.id}`,
            'PATCH',
            { isActive: false, expectedVersion: latestAccount!.version },
          )
        : latestAccount!;
      expect(deactivated.isActive).toBeFalsy();
      if (financeProposal?.financeEvidence) {
        financeProposal.financeEvidence.rejectedProposalIds =
          rejectedProposalIds;
        financeProposal.financeEvidence.reversedTransactionIds =
          reversedTransactionIds;
        financeProposal.financeEvidence.accountDeactivated = true;
        persist();
      }
    }
    expect(financeQuery?.passed, '财务汇总真机场景必须通过').toBeTruthy();
    expect(
      financeProposal?.passed,
      '财务提案必须由 LongCat 调用工具生成，并经查库证明未自动入账',
    ).toBeTruthy();
    expect(
      proposalDatabaseSafe,
      'pending 财务提案不得写入 finance_transactions 或 finance_postings',
    ).toBeTruthy();
  }

  if (
    !pageContextOnly &&
    !readToolsOnly &&
    !financeOnly &&
    !focusedScenarioPrompt &&
    !proposalGroupOnly &&
    !assetOnly
  ) {
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
    const attemptCandidates = candidates.filter((memory) =>
      memoryWrite.attemptRunIds.includes(memory.source.id ?? ''),
    );
    const candidate = attemptCandidates.find(
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
    for (const attemptCandidate of attemptCandidates) {
      await agentApi(
        page,
        `/agent/memories/${attemptCandidate.id}`,
        'DELETE',
        {
          expectedVersion:
            attemptCandidate.id === candidate!.id
              ? cleanupVersion
              : attemptCandidate.version,
        },
      );
    }
  }

  if (
    !memoryOnly &&
    !readToolsOnly &&
    !financeOnly &&
    !focusedScenarioPrompt &&
    !proposalGroupOnly
  ) {
    let targetDish: { id: string; name: string } | null = null;
    if (!assetOnly) {
      await page.goto('/recipes');
      const dishEntry = page.locator('[data-testid^="recipe-dish-"]').first();
      await expect(dishEntry).toBeVisible();
      await persistAuthState();
      await dishEntry.tap();
      await expect(page).toHaveURL(/\/dish\/[0-9a-f-]{36}$/);
      targetDish = {
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
    }

    const testAsset = await agentApi<{
      id: string;
      name: string;
      status: 'active' | 'retired';
      warrantyExpiresOn: string;
    }>(
      page,
      '/assets',
      'POST',
      {
        name: `Hermes 资产上下文 E2E-${Date.now().toString(36)}`,
        category: 'appliance',
        location: '真机 E2E 测试位置',
        brand: 'E2E',
        model: 'context-fixture',
        purchaseDate: '2026-08-10',
        warrantyExpiresOn: '2199-12-31',
        note: '真机页面上下文临时资产，测试后通过正常 API 归档。',
      },
    );
    expect(testAsset.status).toBe('active');
    try {
      await page.goto(`/asset/${testAsset.id}`);
      await expect(page).toHaveURL(/\/asset\/[0-9a-f-]{36}$/);
      const targetAsset = {
        id: new URL(page.url()).pathname.split('/').at(-1)!,
        name: await page.getByTestId('asset-detail-name').innerText(),
      };
      expect(targetAsset.id).toBe(testAsset.id);
      await page.getByTestId('asset-ask-assistant').click();
      await expect(page).toHaveURL(/\/assistant\?.*entityType=asset/);
      await expect(page.getByTestId('agent-page-context')).toContainText(
        `正在参考：${targetAsset.name}`,
      );

      const assetConversationResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/agent/conversations'),
      );
      await page.getByTestId('agent-new-conversation').click();
      const assetConversation = await responseData(
        await assetConversationResponse,
      );
      activeConversationId = assetConversation?.id ?? '';
      expect(activeConversationId).toBeTruthy();
      await expect(
        page.getByTestId(`agent-message-list-${activeConversationId}`),
      ).toBeVisible();
      const assetContextual = await runScenario({
        id: 'page-context-asset',
        prompt: '这个东西保修到什么时候',
        expectedTool: 'get_asset_detail',
        expectedKind: 'asset-detail',
        screenshot: '16-page-context-asset.png',
        requiredText: testAsset.warrantyExpiresOn,
        expectedPageContext: {
          entityType: 'asset',
          entityId: testAsset.id,
        },
      });
      const warrantyDateVariants = [
        testAsset.warrantyExpiresOn,
        testAsset.warrantyExpiresOn.replace(
          /^(\d{4})-(\d{2})-(\d{2})$/,
          '$1年$2月$3日',
        ),
      ];
      expect(
        warrantyDateVariants.some((date) =>
          assetContextual.assistantText.includes(date),
        ),
        '资产保修回答必须包含工具返回的真实到期日',
      ).toBeTruthy();
      expect(assetContextual.passed).toBeTruthy();
    } finally {
      const retired = await agentApi<{ status: 'active' | 'retired' }>(
        page,
        `/assets/${testAsset.id}`,
        'PATCH',
        { status: 'retired' },
      );
      expect(retired.status).toBe('retired');
    }
    if (assetOnly) {
      expect(pageContextChecks).toHaveLength(1);
      expect(pageContextChecks[0]?.passed).toBeTruthy();
      return;
    }

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
        forbiddenText: targetDish!.name,
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

  if (focusedScenarioPrompt) {
    const focusedResult = results.find(
      (result) => result.prompt === focusedScenarioPrompt,
    );
    expect(focusedResult, `未执行单场景：${focusedScenarioPrompt}`).toBeTruthy();
    expect(focusedResult?.passed).toBeTruthy();
  } else if (proposalGroupOnly) {
    expect(proposalGroupChecks).toHaveLength(1);
    expect(proposalGroupChecks[0]?.passed).toBeTruthy();
  } else if (!pageContextOnly) {
    if (!financeOnly) expect(summary().passed).toBeGreaterThanOrEqual(7);
    expect(summary().fallbackCount).toBe(0);
    expect(memoryChecks.every((result) => result.passed)).toBeTruthy();
    expect(proposalGroupChecks.every((result) => result.passed)).toBeTruthy();
    expect(financeChecks.every((result) => result.passed)).toBeTruthy();
  }
  expect(pageContextChecks.every((result) => result.passed)).toBeTruthy();
}

if (assetOnly) {
  test('A7.4-A/A7.3 真实 Hermes 资产保修页面上下文', async ({ page }) => {
    await runHermesLiveTest(page);
  });
} else {
  if (!memoryOnly && !pageContextOnly && !financeOnly && !proposalGroupOnly) {
    for (const prompt of focusedScenarioPrompts) {
      test(`A7.4-A/A7.3 真实 Hermes 单场景 / ${prompt}`, async ({ page }) => {
        await runHermesLiveTest(page, prompt);
      });
    }
  }

  test('A7.4-A/A7.3 真实 Hermes 其余工具与页面上下文', async ({ page }) => {
    await runHermesLiveTest(page);
  });
}

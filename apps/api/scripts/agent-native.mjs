// J4.2 native 运行时黑盒：小管家自带的循环（packages/agent-core 的 runLoop）+ 回放模型。
// API 由 run-api-tests.mjs 带 AGENT_NATIVE_PROVIDER=replay:scripts/fixtures/agent-native/suite.json 启动（只在测试模式生效），
// 回放套件按成员原话挑录制：「记一笔 38 买菜」是 J4.0 的 DeepSeek 模拟录制，另有只读、超步数、慢回答三条。
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const MCP_KEY = process.env.AGENT_MCP_KEY || 'family-app-local-agent-mcp-key';
const DATABASE = process.env.DB_NAME || 'family_app';
// 录制里写死的账户、分类 ID（packages/agent-core/tests/recordings/deepseek-finance.json）
const REPLAY_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const REPLAY_CATEGORY = '22222222-2222-4222-8222-222222222222';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('agent-native.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  assert(response.status === 201, `${loginName}可以登录 native 回归`);
  return response.data;
}

async function mcp(body) {
  const response = await fetch(`${BASE}/internal/agent/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${MCP_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
  const payload = dataLine ? dataLine.slice(6) : text;
  return { status: response.status, body: payload ? JSON.parse(payload) : null };
}

async function waitFor(check, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`等待超时：${label}`);
}

async function ask(token, message) {
  const conversation = await request('/agent/conversations', token, 'POST', {});
  const queued = await request(`/agent/conversations/${conversation.data.id}/messages`, token, 'POST', {
    message,
    clientRequestId: randomUUID(),
  });
  if (queued.status !== 202) throw new Error(`发消息失败：${JSON.stringify(queued)}`);
  return { conversationId: conversation.data.id, runId: queued.data.id };
}

async function finished(token, { conversationId, runId }) {
  return waitFor(async () => {
    const detail = await request(`/agent/conversations/${conversationId}`, token);
    const run = detail.data?.runs?.find((entry) => entry.id === runId);
    return run && ['completed', 'failed', 'cancelled'].includes(run.status) ? { run, detail: detail.data } : null;
  }, `run ${runId} 结束`);
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: DATABASE,
});
await db.connect();

const toolEvents = async (runId) =>
  (await db.query('SELECT "toolName", status FROM agent_tool_events WHERE "runId" = $1 ORDER BY "startedAt"', [runId])).rows;
const runRow = async (runId) =>
  (await db.query('SELECT "runtimeKind", "inputTokens", "outputTokens", "errorCode", "allowedTools" FROM agent_runs WHERE id = $1', [runId])).rows[0];
const utterance = (runId) =>
  waitFor(async () => (await db.query(
    'SELECT text, source, tier, outcome FROM assistant_utterances WHERE "clientId" = $1',
    [runId],
  )).rows[0], `run ${runId} 的原话`);

const owner = await login('爸爸');
const created = [];
let restoreKind = null;
try {
  console.log('1. 切到「小管家自带」运行方式');
  const status = await request('/agent/status', owner.accessToken);
  assert(status.data.runtimes.native.available === true, 'native 运行时在测试模式下可用（回放模型）');
  const before = await request('/agent/settings', owner.accessToken);
  restoreKind = before.data.runtimeKind;
  const switched = await request('/agent/settings', owner.accessToken, 'PATCH', {
    runtimeKind: 'native',
    enabled: true,
    expectedVersion: before.data.version,
  });
  assert(switched.status === 200 && switched.data.runtimeKind === 'native', '管理员把运行方式切到 native');

  console.log('2. 「记一笔 38 买菜」（DeepSeek 模拟录制）→ 记账提案');
  for (const [path, body, fixedId] of [
    ['/finance/accounts', { name: `现金（回放 ${randomUUID().slice(0, 4)}）`, type: 'cash' }, REPLAY_ACCOUNT],
    ['/finance/categories', { name: `买菜（回放 ${randomUUID().slice(0, 4)}）`, kind: 'expense' }, REPLAY_CATEGORY],
  ]) {
    const response = await request(path, owner.accessToken, 'POST', body);
    if (response.status !== 201) throw new Error(`建 ${path} 失败：${JSON.stringify(response)}`);
    const table = path === '/finance/accounts' ? 'finance_accounts' : 'finance_categories';
    // 录制里的 ID 是写死的：把刚建的这条改成同一个 ID，模型的提案才能通过预览校验
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [fixedId]);
    await db.query(`UPDATE ${table} SET id = $1 WHERE id = $2`, [fixedId, response.data.id]);
    created.push([table, fixedId]);
  }
  const finance = await ask(owner.accessToken, '记一笔 38 买菜');
  const financeDone = await finished(owner.accessToken, finance);
  assert(financeDone.run.status === 'completed' && financeDone.run.runtimeKind === 'native', 'run 用 native 完成');
  const financeEvents = await toolEvents(finance.runId);
  assert(
    financeEvents.length === 2 &&
      financeEvents[0].toolName === 'get_finance_summary' &&
      financeEvents[1].toolName === 'propose_finance_transaction' &&
      financeEvents.every((event) => event.status === 'completed'),
    'agent_tool_events 两条：先查账户分类，再起草记账提案',
  );
  const proposal = financeDone.detail.proposals.find((entry) => entry.runId === finance.runId);
  assert(proposal?.actionType === 'finance' && proposal.status === 'pending', '对话里出现一条待确认的记账提案');
  assert(
    financeDone.detail.messages.some((message) => message.role === 'assistant' && message.content.includes('38 元的买菜支出')),
    '回答是录制里的正文',
  );
  const financeRun = await runRow(finance.runId);
  assert(financeRun.inputTokens === 812 + 1046 + 1160 && financeRun.outputTokens === 12 + 71 + 38, 'token 用量累加写进 agent_runs');
  const financeUtterance = await utterance(finance.runId);
  assert(
    financeUtterance.text === '记一笔 38 买菜' && financeUtterance.source === 'agent_chat' &&
      financeUtterance.tier === 2 && financeUtterance.outcome === 'proposed',
    '原话表一条：tier=2 / source=agent_chat / outcome=proposed',
  );

  console.log('3. 「今天吃什么」只读路径');
  const meal = await ask(owner.accessToken, '今天吃什么');
  const mealDone = await finished(owner.accessToken, meal);
  const mealEvents = await toolEvents(meal.runId);
  assert(
    mealDone.run.status === 'completed' && mealEvents.length === 1 && mealEvents[0].toolName === 'get_meal_plan',
    '只调一次 get_meal_plan，run 完成',
  );
  assert(!mealDone.detail.proposals.some((entry) => entry.runId === meal.runId), '只读路径不产生提案');
  assert((await utterance(meal.runId)).outcome === 'no_match', '只回答没动作，原话记 no_match');

  console.log('4. 超步数：run 失败、记代码、不重试');
  const loop = await ask(owner.accessToken, '把所有事情都查一遍');
  const loopDone = await finished(owner.accessToken, loop);
  assert(loopDone.run.status === 'failed' && loopDone.run.errorCode === 'AGENT_MAX_STEPS', 'run 失败，errorCode = AGENT_MAX_STEPS');
  assert((await toolEvents(loop.runId)).length === 8, '8 步里每步一次工具调用，第 9 次请求前停下');
  assert((await utterance(loop.runId)).outcome === 'dismissed', '失败的 run 原话记 dismissed');

  console.log('5. 取消：在途请求中断，不写回答');
  const slow = await ask(owner.accessToken, '慢慢想一想');
  await waitFor(async () => (await request(`/agent/conversations/${slow.conversationId}`, owner.accessToken))
    .data?.runs?.find((entry) => entry.id === slow.runId)?.status === 'running', 'run 开始运行');
  const cancelled = await request(`/agent/runs/${slow.runId}/cancel`, owner.accessToken, 'POST', {});
  assert(cancelled.status === 201 && cancelled.data.status === 'cancelled', '取消接口立即回 cancelled');
  assert((await utterance(slow.runId)).outcome === 'dismissed', '取消的 run 原话记 dismissed（循环收尾后才记）');
  const slowDetail = await request(`/agent/conversations/${slow.conversationId}`, owner.accessToken);
  assert(
    slowDetail.data.runs.find((entry) => entry.id === slow.runId).status === 'cancelled' &&
      !slowDetail.data.messages.some((message) => message.role === 'assistant' && message.runId === slow.runId),
    '取消后没有写回答，run 仍是 cancelled',
  );

  console.log('6. 模块开关：财务关掉后工具消失，直接调用被拒');
  const off = await request('/system/modules/finance', owner.accessToken, 'PATCH', { override: 'off' });
  assert(off.status === 200, '管理员关掉财务模块');
  try {
    const blocked = await ask(owner.accessToken, '今天吃什么');
    await finished(owner.accessToken, blocked);
    const allowed = (await runRow(blocked.runId)).allowedTools;
    assert(
      !allowed.includes('get_finance_summary') && !allowed.includes('propose_finance_transaction') &&
        allowed.includes('get_meal_plan'),
      '新 run 的授权名单里没有财务工具，其余照旧',
    );
    // 直接经 MCP 调：哪怕 run 的授权名单里有它（关模块之前开的会话），也按当前的模块开关拒绝
    await db.query(
      `UPDATE agent_runs SET status = 'running', "allowedTools" = "allowedTools" || '["get_finance_summary"]'::jsonb,
         "authorizationExpiresAt" = now() + interval '5 minutes' WHERE id = $1`,
      [blocked.runId],
    );
    const direct = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_finance_summary', arguments: { runId: blocked.runId } },
    });
    assert(
      direct.body?.result?.isError === true && JSON.stringify(direct.body).includes('这个模块已被家庭关闭'),
      '直接经 MCP 调 get_finance_summary 被拒（403：这个模块已被家庭关闭）',
    );
    await db.query(`UPDATE agent_runs SET status = 'completed' WHERE id = $1`, [blocked.runId]);
  } finally {
    await request('/system/modules/finance', owner.accessToken, 'PATCH', { override: null });
  }
} finally {
  if (restoreKind) {
    const current = await request('/agent/settings', owner.accessToken);
    await request('/agent/settings', owner.accessToken, 'PATCH', {
      runtimeKind: restoreKind,
      expectedVersion: current.data.version,
    });
  }
  for (const [table, id] of created.reverse()) {
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]).catch(() => undefined);
  }
  await db.end();
}
console.log('agent-native.mjs 全部通过');

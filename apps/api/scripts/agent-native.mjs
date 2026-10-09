// J4.2 native 运行时黑盒：小管家自带的循环（packages/agent-core 的 runLoop）+ 回放模型。
// API 由 run-api-tests.mjs 带 AGENT_NATIVE_PROVIDER=replay:scripts/fixtures/agent-native/suite.json 启动（只在测试模式生效），
// 回放套件按成员原话挑录制：「记一笔 38 买菜」是 J4.0 的 DeepSeek 模拟录制，另有只读、超步数、慢回答、记忆（记 / 召回）。
// J4.4：订阅 /events 看流式事件（agent.run）——native 按序推过程，fake 只在结束时推一条 done，只推给发起成员。
// J4.5：外部渠道（tier2Scope 按消息所属成员判）、记忆工具在 native 循环里跑通。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { openEventStream } from './events-client.mjs';
import { startFakeModel } from './fake-model.mjs';

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

async function internal(path, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MCP_KEY}` },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
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

/** 某个 run 的流式事件（按到达顺序）。 */
const runFrames = (stream, runId) =>
  stream.frames
    .filter((frame) => frame.event === 'agent.run')
    .map((frame) => JSON.parse(frame.data))
    .filter((event) => event.runId === runId);
const runDone = (stream, runId) =>
  stream.waitFor((frame) => frame.event === 'agent.run' && JSON.parse(frame.data).runId === runId &&
    JSON.parse(frame.data).type === 'done', 10_000);

const owner = await login('爸爸');
const other = await login('妈妈');
const created = [];
const model = await startFakeModel();
const ownerStream = await openEventStream(BASE, owner.accessToken);
const otherStream = await openEventStream(BASE, other.accessToken);
let restoreKind = null;
const pairedChannels = [];
try {
  assert(
    ownerStream.status === 200 && otherStream.status === 200 &&
      Boolean(await ownerStream.waitFor((frame) => frame.event === 'hello', 5_000)) &&
      Boolean(await otherStream.waitFor((frame) => frame.event === 'hello', 5_000)),
    '爸爸、妈妈都订阅上 /events',
  );

  console.log('1. 切换前的运行方式：run 结束时推一条 done（fake 不流式；native 第二遍时这里已是 native）');
  const before = await request('/agent/settings', owner.accessToken);
  restoreKind = before.data.runtimeKind;
  const enabled = await request('/agent/settings', owner.accessToken, 'PATCH', {
    enabled: true,
    expectedVersion: before.data.version,
  });
  assert(enabled.status === 200, '管理员打开小管家（运行方式不变）');
  const plain = await ask(owner.accessToken, '今天吃什么');
  await finished(owner.accessToken, plain);
  await runDone(ownerStream, plain.runId);
  const plainFrames = runFrames(ownerStream, plain.runId);
  // native 第二遍里 runtimeKind 仍记 fake（AGENT_TEST_RUNTIME 只换执行的运行时），看 runtimeVersion
  const plainVersion = (await db.query('SELECT "runtimeVersion" FROM agent_runs WHERE id = $1', [plain.runId])).rows[0].runtimeVersion;
  if (plainVersion === 'native-loop-1') {
    assert(
      plainFrames.at(-1)?.type === 'done' && plainFrames.some((event) => event.type === 'text_delta'),
      'native：过程事件流式推送，最后一条 done',
    );
  } else {
    assert(
      plainFrames.length === 1 && plainFrames[0].type === 'done' && plainFrames[0].status === 'completed' &&
        plainFrames[0].seq === 1 && plainFrames[0].conversationId === plain.conversationId,
      `${plainVersion}：不流式，只推一条 done（status = completed、seq = 1）`,
    );
  }

  console.log('2. 配好云端模型、测通，切到「小管家自带」运行方式');
  const status = await request('/agent/status', owner.accessToken);
  assert(status.data.runtimes.native.available === true, 'native 运行时在测试模式下可用（回放模型）');
  // J4.3：切到 native 前必须「测一下」通过（「测一下」按家庭配置真打，这里打假模型服务）
  const configured = await request('/agent/settings', owner.accessToken, 'PATCH', {
    providerKind: 'custom',
    providerBaseUrl: model.url,
    providerModel: 'fake-model',
    providerKey: model.key,
    expectedVersion: enabled.data.version,
  });
  const checked = await request('/agent/settings/provider-check', owner.accessToken, 'POST');
  assert(configured.status === 200 && checked.data?.ok === true, '云端模型配好并测通');
  const switched = await request('/agent/settings', owner.accessToken, 'PATCH', {
    runtimeKind: 'native',
    enabled: true,
    expectedVersion: checked.data.settings.version,
  });
  assert(switched.status === 200 && switched.data.runtimeKind === 'native', '管理员把运行方式切到 native');
  const nativeStatus = await request('/agent/status', owner.accessToken);
  assert(
    nativeStatus.data.runtimeKind === 'native' && nativeStatus.data.providerKind === 'custom',
    '状态接口带上服务商（对话页标题写「小管家自带 · 自定义服务」）',
  );

  console.log('3. 「记一笔 38 买菜」（DeepSeek 模拟录制）→ 记账提案');
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

  console.log('4. 流式事件（J4.4）：按序推给发起成员，增量拼起来就是落库的回答');
  assert(Boolean(await runDone(ownerStream, finance.runId)), '爸爸收到这次 run 的 done');
  const stream = runFrames(ownerStream, finance.runId);
  assert(stream.every((event, index) => event.seq === index + 1), `seq 从 1 连续递增（共 ${stream.length} 条）`);
  const milestones = stream.filter((event) => event.type !== 'text_delta' && event.type !== 'usage');
  assert(
    JSON.stringify(milestones.map((event) => `${event.type}:${event.toolName ?? event.status}`)) === JSON.stringify([
      'tool_call:get_finance_summary', 'tool_result:get_finance_summary',
      'tool_call:propose_finance_transaction', 'tool_result:propose_finance_transaction',
      'proposal:propose_finance_transaction', 'done:completed',
    ]),
    '按序收到 tool_call → tool_result → tool_call → tool_result → proposal → done',
  );
  assert(milestones.find((event) => event.type === 'proposal').proposalId === proposal.id, 'proposal 事件带的是对话里那条提案的 ID');
  const answer = financeDone.detail.messages.find((message) => message.role === 'assistant' && message.runId === finance.runId);
  const deltas = stream.filter((event) => event.type === 'text_delta');
  assert(
    deltas.length > 1 && deltas.map((event) => event.text).join('').trim() === answer.content,
    `text_delta（${deltas.length} 段）拼起来 == 落库的回答`,
  );
  const usageEvents = stream.filter((event) => event.type === 'usage');
  assert(
    usageEvents.reduce((sum, event) => sum + event.inputTokens, 0) === financeRun.inputTokens &&
      usageEvents.reduce((sum, event) => sum + event.outputTokens, 0) === financeRun.outputTokens,
    'usage 事件逐步累加 == agent_runs 的 token 用量',
  );
  const raw = JSON.stringify(stream);
  assert(
    !raw.includes(REPLAY_ACCOUNT) && !raw.includes('"arguments"') && !raw.includes('"result"'),
    '载荷只有增量和状态：不带工具参数、不带工具结果',
  );
  assert(runFrames(otherStream, finance.runId).length === 0, '妈妈的 /events 收不到爸爸这次 run 的任何流式事件');
  const financeUtterance = await utterance(finance.runId);
  assert(
    financeUtterance.text === '记一笔 38 买菜' && financeUtterance.source === 'agent_chat' &&
      financeUtterance.tier === 2 && financeUtterance.outcome === 'proposed',
    '原话表一条：tier=2 / source=agent_chat / outcome=proposed',
  );

  console.log('5. 「今天吃什么」只读路径');
  const meal = await ask(owner.accessToken, '今天吃什么');
  const mealDone = await finished(owner.accessToken, meal);
  const mealEvents = await toolEvents(meal.runId);
  assert(
    mealDone.run.status === 'completed' && mealEvents.length === 1 && mealEvents[0].toolName === 'get_meal_plan',
    '只调一次 get_meal_plan，run 完成',
  );
  assert(!mealDone.detail.proposals.some((entry) => entry.runId === meal.runId), '只读路径不产生提案');
  assert((await utterance(meal.runId)).outcome === 'no_match', '只回答没动作，原话记 no_match');

  console.log('6. 超步数：run 失败、记代码、不重试');
  const loop = await ask(owner.accessToken, '把所有事情都查一遍');
  const loopDone = await finished(owner.accessToken, loop);
  assert(loopDone.run.status === 'failed' && loopDone.run.errorCode === 'AGENT_MAX_STEPS', 'run 失败，errorCode = AGENT_MAX_STEPS');
  assert((await toolEvents(loop.runId)).length === 8, '8 步里每步一次工具调用，第 9 次请求前停下');
  assert((await utterance(loop.runId)).outcome === 'dismissed', '失败的 run 原话记 dismissed');
  await runDone(ownerStream, loop.runId);
  const loopFrames = runFrames(ownerStream, loop.runId);
  assert(
    loopFrames.at(-2)?.type === 'error' && loopFrames.at(-2).code === 'AGENT_MAX_STEPS' &&
      loopFrames.at(-1).type === 'done' && loopFrames.at(-1).status === 'failed' && loopFrames.at(-1).errorCode === 'AGENT_MAX_STEPS',
    '失败的 run：先推 error（AGENT_MAX_STEPS），再推 done（failed）',
  );

  console.log('7. 取消：在途请求中断，不写回答');
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
  await runDone(ownerStream, slow.runId);
  const slowFrames = runFrames(ownerStream, slow.runId);
  assert(
    slowFrames.at(-1)?.type === 'done' && slowFrames.at(-1).status === 'cancelled' &&
      slowFrames.filter((event) => event.type === 'done').length === 1,
    '取消的 run 只推一条 done（cancelled）',
  );

  console.log('8. 模块开关：财务关掉后工具消失，直接调用被拒');
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

  console.log('9. 外部渠道（J4.5）：配对、收发走 native；tier2Scope 按消息所属成员判');
  const pairFor = async (who) => {
    const pairing = await request('/agent/channel-pairings', owner.accessToken, 'POST', {
      memberId: who.member.id,
      platform: 'telegram',
      expiresInMinutes: 10,
      idempotencyKey: `native-pair:${randomUUID()}`,
    });
    const paired = await internal('/internal/agent/channels/pair', 'POST', {
      pairingCode: pairing.data?.pairingCode,
      externalAccountId: `native-${randomUUID()}`,
    });
    if (paired.status !== 201) return null;
    pairedChannels.push(paired.data.channel);
    return paired.data.channel.id;
  };
  const ownerChannel = await pairFor(owner);
  const memberChannel = await pairFor(other);
  assert(Boolean(ownerChannel && memberChannel), '管理员给自己、给妈妈各配好一个渠道');
  const channelSend = (channelId, message) =>
    internal(`/internal/agent/channels/${channelId}/messages`, 'POST', {
      externalThreadRef: `native-thread-${randomUUID()}`,
      message,
      clientRequestId: `native-channel:${randomUUID()}`,
    });
  const channelDone = (channelId, runId) =>
    waitFor(async () => {
      const result = await internal(`/internal/agent/channels/${channelId}/runs/${runId}`);
      return ['completed', 'failed', 'cancelled'].includes(result.data?.status) ? result.data : null;
    }, `渠道 run ${runId} 结束`);
  const channelRow = async (runId) =>
    (await db.query('SELECT "runtimeVersion", tier, "allowedTools" FROM agent_runs WHERE id = $1', [runId])).rows[0];
  const scope = (await request('/agent/settings', owner.accessToken)).data;
  assert(scope.tier2Scope === 'admins', '试用期默认 tier2Scope = admins');
  const memberBlocked = await channelSend(memberChannel, '今天吃什么');
  assert(memberBlocked.status === 403, '妈妈（普通成员）的渠道消息 403：不因为走的是渠道就绕过 tier2Scope');
  const ownerChannelMessage = await channelSend(ownerChannel, '今天吃什么');
  assert(ownerChannelMessage.status === 202, '爸爸（管理员）的渠道消息排上队');
  const ownerChannelRun = await channelDone(ownerChannel, ownerChannelMessage.data.id);
  const ownerChannelState = await channelRow(ownerChannelMessage.data.id);
  assert(
    ownerChannelRun.status === 'completed' && ownerChannelRun.readOnly === true &&
      ownerChannelRun.content === '今天的菜单还没定，想吃什么可以直接点。' &&
      ownerChannelState.runtimeVersion === 'native-loop-1' && ownerChannelState.tier === 2 &&
      ownerChannelState.allowedTools.includes('get_meal_plan') &&
      !ownerChannelState.allowedTools.some((tool) => tool.startsWith('propose_') || tool === 'remember_preference'),
    '渠道 run 走 native 循环（tier = 2、计入每日额度），只读工具，回答是录制的正文',
  );
  const opened = await request('/agent/settings', owner.accessToken, 'PATCH', { tier2Scope: 'all', expectedVersion: scope.version });
  assert(opened.status === 200, '管理员把 tier2Scope 改成 all');
  const memberChannelMessage = await channelSend(memberChannel, '今天吃什么');
  const memberChannelRun = memberChannelMessage.status === 202
    ? await channelDone(memberChannel, memberChannelMessage.data.id)
    : null;
  assert(
    memberChannelRun?.status === 'completed' &&
      (await channelRow(memberChannelMessage.data.id)).runtimeVersion === 'native-loop-1',
    'tier2Scope = all 后妈妈的渠道消息照常走 native 回答',
  );
  await request('/agent/settings', owner.accessToken, 'PATCH', { tier2Scope: 'admins', expectedVersion: opened.data.version });

  console.log('10. 记忆工具（J4.5）：native 循环里 remember_preference 建候选，确认后 recall_preferences 召回');
  const profile = await request('/agent/profile', owner.accessToken);
  if (!profile.data.memoryEnabled) {
    await request('/agent/profile', owner.accessToken, 'PATCH', { memoryEnabled: true, expectedVersion: profile.data.version });
  }
  const recallItems = async (runId) =>
    (await db.query(
      `SELECT "toolName", status, ("outputSummary"->>'itemCount')::int AS items FROM agent_tool_events WHERE "runId" = $1`,
      [runId],
    )).rows;
  const remember = await ask(owner.accessToken, '记住我不吃香菜');
  const rememberDone = await finished(owner.accessToken, remember);
  const rememberEvents = await toolEvents(remember.runId);
  assert(
    rememberDone.run.status === 'completed' && rememberEvents.length === 1 &&
      rememberEvents[0].toolName === 'remember_preference' && rememberEvents[0].status === 'completed',
    'native 循环调 remember_preference 一次，run 完成',
  );
  const candidates = await request('/agent/memories?status=candidate', owner.accessToken);
  const candidate = candidates.data?.find((item) => item.content === '不吃香菜' && item.source?.type === 'agent_tool');
  assert(
    candidate?.memoryKey === 'diet_restriction' && candidate.visibility === 'member_private' && candidate.status === 'candidate',
    '候选照旧落库：本人私有、diet_restriction、来源 agent_tool，待确认',
  );
  const recallBefore = await ask(owner.accessToken, '我记过哪些忌口');
  await finished(owner.accessToken, recallBefore);
  const beforeRows = await recallItems(recallBefore.runId);
  assert(
    beforeRows.length === 1 && beforeRows[0].toolName === 'recall_preferences' && beforeRows[0].status === 'completed' &&
      beforeRows[0].items === 0,
    '确认前 recall_preferences 召回 0 条（候选不生效）',
  );
  const confirmed = await request(`/agent/memories/${candidate.id}/confirm`, owner.accessToken, 'POST', {
    expectedVersion: candidate.version,
  });
  assert(confirmed.status === 201, '爸爸确认这条候选');
  const recallAfter = await ask(owner.accessToken, '我记过哪些忌口');
  await finished(owner.accessToken, recallAfter);
  const afterRows = await recallItems(recallAfter.runId);
  assert(afterRows.length === 1 && afterRows[0].status === 'completed' && afterRows[0].items === 1, '确认后 recall_preferences 召回 1 条');
  await request(`/agent/memories/${candidate.id}`, owner.accessToken, 'DELETE', { expectedVersion: confirmed.data.version });
} finally {
  if (restoreKind) {
    const current = await request('/agent/settings', owner.accessToken);
    await request('/agent/settings', owner.accessToken, 'PATCH', {
      runtimeKind: restoreKind,
      providerKind: null,
      providerBaseUrl: null,
      providerModel: null,
      providerKey: null,
      expectedVersion: current.data.version,
    });
  }
  for (const channel of pairedChannels) {
    await request(`/agent/channels/${channel.id}/revoke`, owner.accessToken, 'POST', { expectedVersion: channel.version });
  }
  await model.stop();
  ownerStream.close();
  otherStream.close();
  for (const [table, id] of created.reverse()) {
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]).catch(() => undefined);
  }
  await db.end();
}
console.log('agent-native.mjs 全部通过');

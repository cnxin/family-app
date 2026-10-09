// J4.3 云端档配置黑盒：服务商 / 地址 / 模型 / 加密存的 key、「测一下」、切到 native 的闸、tier2Scope、脱敏、每日上限。
// 云端模型用 fake-model.mjs（假的 OpenAI 兼容服务）；对话走它要在原话里带「（走家里配的模型）」（回放套件的约定）。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startFakeModel } from './fake-model.mjs';
import { usageReport } from './usage-report-probe.mjs';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';
const VIA_MODEL = '（走家里配的模型）';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('agent-cloud.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error, raw: text };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  assert(response.status === 201, `${loginName}可以登录云端档回归`);
  return response.data;
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

async function settings(token) {
  return (await request('/agent/settings', token)).data;
}

async function patch(token, body) {
  const current = await settings(token);
  return request('/agent/settings', token, 'PATCH', { ...body, expectedVersion: current.version });
}

async function send(token, conversationId, message) {
  return request(`/agent/conversations/${conversationId}/messages`, token, 'POST', { message, clientRequestId: randomUUID() });
}

async function finished(token, conversationId, runId) {
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
const model = await startFakeModel();
const owner = await login('爸爸');
const member = await login('妈妈');
const original = await settings(owner.accessToken);

try {
  console.log('1. 新列的默认值（老家庭升级后也是这样）');
  assert(
    original.providerKind === null && original.providerBaseUrl === null && original.providerModel === null &&
      original.providerKeyConfigured === false && original.providerKeyLast4 === null &&
      original.providerCheckOk === false && original.providerCheckedAt === null && original.tier2Scope === 'admins',
    '服务商、地址、模型、key 为空，没测过，tier2Scope = admins',
  );

  console.log('2. 服务商、模型、key：预填、加密、只回末 4 位');
  assert((await patch(member.accessToken, { providerKind: 'deepseek' })).status === 403, '成员不能改云端档配置');
  const deepseek = await patch(owner.accessToken, { providerKind: 'deepseek' });
  assert(
    deepseek.status === 200 && deepseek.data.providerBaseUrl === 'https://api.deepseek.com' && deepseek.data.providerModel === 'deepseek-chat',
    '选 DeepSeek：地址和推荐模型按预设填',
  );
  const wrongKey = 'sk-wrong-key-98765';
  const custom = await patch(owner.accessToken, {
    providerKind: 'custom',
    providerBaseUrl: model.url,
    providerModel: 'fake-model',
    providerKey: wrongKey,
  });
  assert(
    custom.status === 200 && custom.data.providerKeyConfigured === true && custom.data.providerKeyLast4 === '8765' &&
      !custom.raw.includes(wrongKey),
    '自定义服务商：key 只回「已配置」和末 4 位，响应里没有原文',
  );
  const stored = (await db.query('SELECT "providerKeyEncrypted" AS key FROM agent_settings WHERE "householdId" = $1', [owner.member.householdId])).rows[0].key;
  assert(stored.startsWith('v1:') && !stored.includes(wrongKey), '库里存的是密文');
  const memberView = await settings(member.accessToken);
  assert(memberView.providerKeyLast4 === '8765' && !JSON.stringify(memberView).includes(wrongKey), '成员能看配置（只读），也只看到末 4 位');
  assert(
    (await patch(owner.accessToken, { runtimeKind: 'native' })).status === 400,
    '没测通之前切「小管家自带」被拒（400）',
  );

  console.log('3. 「测一下」：错误原文带出、key 打码；换对 key 后测通');
  const failed = await request('/agent/settings/provider-check', owner.accessToken, 'POST');
  assert(
    failed.status === 201 && failed.data.ok === false && failed.data.message.includes('401') &&
      failed.data.message.includes('***') && !failed.raw.includes(wrongKey) && failed.data.settings.providerCheckOk === false,
    'key 错：ok=false，回服务商原文（401），原文里的 key 打成 ***',
  );
  assert((await request('/agent/settings/provider-check', member.accessToken, 'POST')).status === 403, '成员不能点「测一下」');
  await patch(owner.accessToken, { providerKey: model.key });
  const passed = await request('/agent/settings/provider-check', owner.accessToken, 'POST');
  assert(
    passed.data.ok === true && passed.data.message === null && passed.data.settings.providerCheckOk === true &&
      passed.data.settings.providerCheckedAt != null,
    'key 对：ok=true，记下测试时间',
  );
  assert(model.requests.at(-1)?.max_tokens === 1, '「测一下」只发一条 max_tokens=1 的请求');
  const changed = await patch(owner.accessToken, { providerModel: 'fake-model-2' });
  assert(changed.data.providerCheckOk === false && changed.data.providerCheckedAt === null, '改了模型，测试结果清掉');
  await patch(owner.accessToken, { providerModel: 'fake-model' });
  await request('/agent/settings/provider-check', owner.accessToken, 'POST');

  console.log('4. tier2Scope：云端档默认只对管理员开放');
  // 切到云端之前，成员先开好一个会话（本地确定性助理不受 tier2Scope 管）
  const memberConversation = await request('/agent/conversations', member.accessToken, 'POST', {});
  assert(memberConversation.status === 201, '本地助理下成员照常开会话');
  const native = await patch(owner.accessToken, { runtimeKind: 'native', enabled: true });
  assert(native.status === 200 && native.data.runtimeKind === 'native', '测通后切到「小管家自带」');
  const ownerStatus = (await request('/agent/status', owner.accessToken)).data;
  const memberStatus = (await request('/agent/status', member.accessToken)).data;
  assert(ownerStatus.enabled === true && ownerStatus.runtimes.native.available === true, '管理员看到小管家开着');
  assert(memberStatus.enabled === false, '成员看到小管家关着（入口隐藏）');
  assert((await send(member.accessToken, memberConversation.data.id, '你好')).status === 403, '成员发消息 403');
  assert((await request('/agent/conversations', member.accessToken, 'POST', {})).status === 403, '成员开新会话 403');
  await patch(owner.accessToken, { tier2Scope: 'all' });
  assert((await request('/agent/status', member.accessToken)).data.enabled === true, 'tier2Scope 改成 all 后成员看到开着');
  await patch(owner.accessToken, { tier2Scope: 'admins' });

  console.log('5. 脱敏：手机号、车牌、成员真名进模型前打码，金额日期不动');
  const conversation = await request('/agent/conversations', owner.accessToken, 'POST', {});
  const sentText = `${VIA_MODEL}记下：妈妈的手机 13800138000，车牌浙AGS6398，10 月 9 日花了 38.5 元`;
  const redactedRun = await send(owner.accessToken, conversation.data.id, sentText);
  const redactedDone = await finished(owner.accessToken, conversation.data.id, redactedRun.data.id);
  const outgoing = model.requests.at(-1).messages.findLast((message) => message.role === 'user').content;
  // 称呼按成员加入家庭的先后编号（前面的脚本可能往这家加过人，现算）
  const order = (await db.query('SELECT name FROM members WHERE "householdId" = $1 ORDER BY "createdAt", id', [owner.member.householdId])).rows;
  const alias = `成员${order.findIndex((row) => row.name === '妈妈') + 1}`;
  assert(redactedDone.run.status === 'completed', '走家里配的模型完成一次对话');
  assert(
    outgoing.includes('13*******00') && outgoing.includes('浙A****98') && outgoing.includes(alias) &&
      !outgoing.includes('13800138000') && !outgoing.includes('浙AGS6398') && !outgoing.includes('妈妈') &&
      outgoing.includes('10 月 9 日') && outgoing.includes('38.5 元'),
    `发出去的是 13*******00、浙A****98、${alias}；日期和金额原样`,
  );
  const runRow = (await db.query('SELECT tier, redacted FROM agent_runs WHERE id = $1', [redactedRun.data.id])).rows[0];
  assert(runRow.tier === 2 && runRow.redacted === true, 'run 记 tier = 2、redacted = true');

  console.log('6. 每日上限：设成 2，当天第 3 次被拒');
  // 测试库里前面的脚本也在这一家开过云端 run：先把今天的计数清零，再按「上限 2」走一遍
  await db.query('UPDATE agent_runs SET tier = NULL WHERE "householdId" = $1 AND tier = 2', [owner.member.householdId]);
  await patch(owner.accessToken, { tier2DailyLimit: 2 });
  for (const index of [1, 2]) {
    const queued = await send(owner.accessToken, conversation.data.id, `${VIA_MODEL}第 ${index} 次`);
    const done = await finished(owner.accessToken, conversation.data.id, queued.data.id);
    assert(done.run.status === 'completed', `第 ${index} 次照常回答`);
  }
  const requestsBefore = model.requests.length;
  const refused = await send(owner.accessToken, conversation.data.id, `${VIA_MODEL}第 3 次`);
  assert(
    refused.status === 202 && refused.data.status === 'failed' && refused.data.errorCode === 'AGENT_DAILY_LIMIT' &&
      refused.data.errorMessage === '今天小管家的云端额度用完了，明天再问',
    '第 3 次不开 run：直接回固定文案「今天小管家的云端额度用完了，明天再问」',
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const refusedRow = (await db.query('SELECT tier, "startedAt" FROM agent_runs WHERE id = $1', [refused.data.id])).rows[0];
  const refusedEvents = (await db.query('SELECT COUNT(*)::int AS n FROM agent_tool_events WHERE "runId" = $1', [refused.data.id])).rows[0].n;
  assert(
    model.requests.length === requestsBefore && refusedRow.tier === null && refusedRow.startedAt === null && refusedEvents === 0,
    '没有打模型、没有调工具；记下的这条（审计）tier 留空，不占额度',
  );
  const refusedUtterance = await waitFor(async () => (await db.query(
    'SELECT outcome, tier FROM assistant_utterances WHERE "clientId" = $1',
    [refused.data.id],
  )).rows[0], '被拒那次的原话');
  assert(refusedUtterance.outcome === 'dismissed' && refusedUtterance.tier === 2, '原话记 dismissed');

  console.log('7. 用量报告：云端档按天的 run 数、token、被上限拒绝次数');
  const report = await usageReport(1);
  const household = report.split('\n## ').find((section) => section.includes('云端档（J4.3'));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const row = household?.split('\n').find((line) => line.startsWith(`| ${day} |`))?.split('|').map((cell) => cell.trim());
  assert(row && Number(row[2]) === 2 && Number(row[3]) > 0 && Number(row[4]) === 1, `报告里今天：云端 run 2 次、token > 0、被拒 1 次（${row?.join(' ')}）`);
  assert(row?.[5] === '2 / 2（100%）', `流式 run 占比：两次都走 native 循环（${row?.[5]}）`);

  console.log('8. 并发（J4.5）：上限 3、10 个请求同时发，只放行 3 个');
  await db.query('UPDATE agent_runs SET tier = NULL WHERE "householdId" = $1 AND tier = 2', [owner.member.householdId]);
  await patch(owner.accessToken, { tier2DailyLimit: 3 });
  const lanes = await Promise.all(
    Array.from({ length: 10 }, () => request('/agent/conversations', owner.accessToken, 'POST', {})),
  );
  const burst = await Promise.all(lanes.map((lane, index) => send(owner.accessToken, lane.data.id, `并发第 ${index + 1} 问`)));
  const admitted = burst.filter((one) => one.status === 202 && one.data.status === 'queued');
  const limited = burst.filter((one) => one.status === 202 && one.data.errorCode === 'AGENT_DAILY_LIMIT');
  const counted = (await db.query(
    `SELECT COUNT(*)::int AS n FROM agent_runs WHERE "householdId" = $1 AND tier = 2
       AND id = ANY($2::uuid[])`,
    [owner.member.householdId, burst.map((one) => one.data.id)],
  )).rows[0].n;
  assert(
    admitted.length === 3 && limited.length === 7 && counted === 3,
    `放行 ${admitted.length} 个、挡下 ${limited.length} 个；记 tier = 2 的 ${counted} 个`,
  );
  await Promise.all(admitted.map((one, index) => finished(owner.accessToken, lanes[burst.indexOf(one)].data.id, one.data.id)
    .then((done) => assert(done.run.status === 'completed', `放行的第 ${index + 1} 个照常回答`))));
} finally {
  const current = await settings(owner.accessToken);
  await request('/agent/settings', owner.accessToken, 'PATCH', {
    runtimeKind: original.runtimeKind,
    enabled: original.enabled,
    tier2Scope: original.tier2Scope,
    tier2DailyLimit: original.tier2DailyLimit,
    providerKind: null,
    providerBaseUrl: null,
    providerModel: null,
    providerKey: null,
    expectedVersion: current.version,
  });
  await model.stop();
  await db.end();
}
console.log('agent-cloud.mjs 全部通过');

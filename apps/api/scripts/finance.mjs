import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const MCP_KEY = process.env.AGENT_MCP_KEY || 'family-app-local-agent-mcp-key';
const DATABASE = process.env.DB_NAME || 'family_app';
const MONTH = '2199-11';
const DATE = `${MONTH}-18`;

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('finance.mjs 只允许在 API 临时测试库中运行');
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
  return { status: response.status, data: json?.data, error: json?.error, body: json };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录家庭财务模块`);
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

function toolCall(id, name, runId, args = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: { runId, ...args } },
  };
}

function toolResult(response) {
  const text = response.body?.result?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : null;
}

function closeEnough(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: DATABASE,
});
await db.connect();

const other = {
  householdId: randomUUID(),
  memberId: randomUUID(),
  accountId: randomUUID(),
  categoryId: randomUUID(),
};

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');

  console.log('1. 默认分类、账户权限和家庭范围');
  const categories = await request('/finance/categories', member.accessToken);
  const food = categories.data.find((entry) => entry.systemKey === 'expense_food');
  const salary = categories.data.find((entry) => entry.systemKey === 'income_salary');
  assert(
    categories.status === 200 && categories.data.length >= 12 && food && salary,
    '首次读取幂等建立家庭默认收支分类',
  );

  const forbiddenAccount = await request('/finance/accounts', member.accessToken, 'POST', {
    name: '普通成员不应创建',
    type: 'cash',
  });
  const cash = await request('/finance/accounts', owner.accessToken, 'POST', {
    name: `家庭现金-${randomUUID().slice(0, 6)}`,
    type: 'cash',
    openingBalance: 500,
  });
  const bank = await request('/finance/accounts', owner.accessToken, 'POST', {
    name: `家庭银行卡-${randomUUID().slice(0, 6)}`,
    type: 'bank',
    openingBalance: 1000,
  });
  const duplicateAccount = await request('/finance/accounts', owner.accessToken, 'POST', {
    name: cash.data.name,
    type: 'cash',
  });
  assert(
    forbiddenAccount.status === 403 && cash.status === 201 && bank.status === 201 && duplicateAccount.status === 409,
    '普通成员不能管理账户，管理员可建账户且同名被拒绝',
  );

  await db.query('INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)', [
    other.householdId,
    '财务隔离家庭',
    `finance-${other.householdId}`,
  ]);
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '财务隔离成员', 'F', 'owner')`,
    [other.memberId, other.householdId],
  );
  await db.query(
    `INSERT INTO finance_accounts
       (id, "householdId", name, type, "openingBalance", "createdById")
     VALUES ($1, $2, '其他家庭账户', 'cash', 0, $3)`,
    [other.accountId, other.householdId, other.memberId],
  );
  await db.query(
    `INSERT INTO finance_categories
       (id, "householdId", name, kind, "createdById")
     VALUES ($1, $2, '其他家庭分类', 'expense', $3)`,
    [other.categoryId, other.householdId, other.memberId],
  );
  const crossHousehold = await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'expense',
    amount: 1,
    accountId: other.accountId,
    categoryId: other.categoryId,
    title: '跨家庭不应写入',
    occurredOn: DATE,
    idempotencyKey: randomUUID(),
  });
  assert(crossHousehold.status === 404, '跨家庭账户和分类按不存在处理');

  console.log('2. 收入、支出、转账、余额和幂等');
  const expenseKey = randomUUID();
  const expenseBody = {
    type: 'expense',
    amount: 120,
    accountId: cash.data.id,
    categoryId: food.id,
    title: '家庭聚餐',
    note: '财务回归支出',
    occurredOn: DATE,
    idempotencyKey: expenseKey,
  };
  const expense = await request('/finance/transactions', member.accessToken, 'POST', expenseBody);
  const replay = await request('/finance/transactions', member.accessToken, 'POST', expenseBody);
  const conflict = await request('/finance/transactions', member.accessToken, 'POST', {
    ...expenseBody,
    amount: 121,
  });
  const income = await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'income',
    amount: 1000,
    accountId: bank.data.id,
    categoryId: salary.id,
    title: '家庭收入',
    occurredOn: DATE,
    idempotencyKey: randomUUID(),
  });
  const transfer = await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'transfer',
    amount: 200,
    accountId: bank.data.id,
    toAccountId: cash.data.id,
    title: '转入家庭现金',
    occurredOn: DATE,
    idempotencyKey: randomUUID(),
  });
  const invalidTransfer = await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'transfer',
    amount: 1,
    accountId: cash.data.id,
    toAccountId: cash.data.id,
    title: '无效转账',
    occurredOn: DATE,
    idempotencyKey: randomUUID(),
  });
  const summary = await request(`/finance/summary?month=${MONTH}`, member.accessToken);
  const cashBalance = summary.data.accounts.find((entry) => entry.id === cash.data.id)?.balance;
  const bankBalance = summary.data.accounts.find((entry) => entry.id === bank.data.id)?.balance;
  assert(
    expense.status === 201 && replay.data.id === expense.data.id && conflict.status === 409 &&
      income.status === 201 && transfer.status === 201 && transfer.data.postings.length === 2 &&
      invalidTransfer.status === 400 && closeEnough(cashBalance, 580) && closeEnough(bankBalance, 1800) &&
      closeEnough(summary.data.income, 1000) && closeEnough(summary.data.expense, 120) &&
      closeEnough(summary.data.net, 880) && closeEnough(summary.data.totalBalance, 2380),
    '三类流水正确过账，重复键只写一次且余额和月度汇总一致',
  );

  console.log('3. 月度预算、反向撤销和不可变保护');
  const budget = await request('/finance/budgets', owner.accessToken, 'PUT', {
    categoryId: food.id,
    month: MONTH,
    amount: 300,
  });
  const staleBudget = await request('/finance/budgets', owner.accessToken, 'PUT', {
    categoryId: food.id,
    month: MONTH,
    amount: 350,
    expectedVersion: 99,
  });
  const budgetSummary = await request(`/finance/summary?month=${MONTH}`, owner.accessToken);
  const foodBudget = budgetSummary.data.budgets.find((entry) => entry.categoryId === food.id);
  const memberBudget = await request('/finance/budgets', member.accessToken, 'PUT', {
    categoryId: food.id,
    month: MONTH,
    amount: 1,
    expectedVersion: budget.data.version,
  });
  assert(
    budget.status === 200 && staleBudget.status === 409 && memberBudget.status === 403 &&
      closeEnough(foodBudget.spent, 120) && closeEnough(foodBudget.remaining, 180) && closeEnough(foodBudget.ratio, 40),
    '预算按分类统计实际支出并使用版本冲突保护',
  );

  const forbiddenReverse = await request(
    `/finance/transactions/${expense.data.id}/reverse`,
    member.accessToken,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  const reverseKey = randomUUID();
  const reversed = await request(
    `/finance/transactions/${expense.data.id}/reverse`,
    owner.accessToken,
    'POST',
    { note: '撤销测试支出', idempotencyKey: reverseKey },
  );
  const reverseReplay = await request(
    `/finance/transactions/${expense.data.id}/reverse`,
    owner.accessToken,
    'POST',
    { note: '撤销测试支出', idempotencyKey: reverseKey },
  );
  const reverseConflict = await request(
    `/finance/transactions/${expense.data.id}/reverse`,
    owner.accessToken,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  const reversedSummary = await request(`/finance/summary?month=${MONTH}`, owner.accessToken);
  assert(
    forbiddenReverse.status === 403 && reversed.status === 201 && reverseReplay.data.id === reversed.data.id &&
      reverseConflict.status === 409 && closeEnough(reversedSummary.data.expense, 0) &&
      closeEnough(reversedSummary.data.totalBalance, 2500),
    '只有管理员可通过幂等反向流水撤销，原流水保留且统计恢复',
  );

  let transactionUpdateBlocked = false;
  let postingDeleteBlocked = false;
  try {
    await db.query('UPDATE finance_transactions SET title = $1 WHERE id = $2', ['不应更新', income.data.id]);
  } catch (error) {
    transactionUpdateBlocked = error?.code === '55000';
  }
  try {
    await db.query('DELETE FROM finance_postings WHERE "transactionId" = $1', [income.data.id]);
  } catch (error) {
    postingDeleteBlocked = error?.code === '55000';
  }
  assert(transactionUpdateBlocked && postingDeleteBlocked, '数据库拒绝更新交易或删除过账明细');

  console.log('4. Hermes 财务查询和确认式记账提案');
  await request('/agent/settings', owner.accessToken);
  await request('/agent/profile', member.accessToken);
  const conversation = await request('/agent/conversations', member.accessToken, 'POST', {
    title: '家庭财务提案回归',
  });
  const profile = await db.query(
    `SELECT id FROM agent_member_profiles WHERE "householdId" = $1 AND "memberId" = $2`,
    [member.member.householdId, member.member.id],
  );
  const runId = randomUUID();
  await db.query(
    `INSERT INTO agent_runs (
       id, "householdId", "conversationId", "requestedByMemberId", "agentProfileId",
       "clientRequestId", "runtimeKind", "runtimeVersion", "modelAlias", status,
       "allowedTools", "authorizationExpiresAt", "startedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, 'fake', 'finance-contract', 'hermes-agent',
       'running', $7, now() + interval '10 minutes', now())`,
    [
      runId,
      member.member.householdId,
      conversation.data.id,
      member.member.id,
      profile.rows[0].id,
      `finance-agent:${runId}`,
      JSON.stringify(['get_finance_summary', 'propose_finance_transaction']),
    ],
  );
  const toolSummary = toolResult(await mcp(toolCall(1, 'get_finance_summary', runId, { month: MONTH })));
  assert(
    toolSummary.accounts.some((entry) => entry.id === cash.data.id) &&
      toolSummary.categories.some((entry) => entry.id === food.id),
    'Hermes 只读工具返回真实账户、分类和月度财务数据',
  );

  const agentTitle = `Hermes记账-${randomUUID().slice(0, 6)}`;
  const proposal = toolResult(await mcp(toolCall(2, 'propose_finance_transaction', runId, {
    type: 'expense',
    amount: 12.34,
    accountId: cash.data.id,
    categoryId: food.id,
    title: agentTitle,
    note: '必须确认后才落库',
    occurredOn: DATE,
  })));
  const beforeConfirm = await db.query(
    `SELECT id FROM finance_transactions WHERE "householdId" = $1 AND title = $2`,
    [member.member.householdId, agentTitle],
  );
  const confirmed = await request(
    `/agent/proposals/${proposal.id}/confirm`,
    member.accessToken,
    'POST',
    { expectedVersion: proposal.version, clientRequestId: randomUUID() },
  );
  const afterConfirm = await db.query(
    `SELECT id, "sourceType", "sourceId" FROM finance_transactions
     WHERE "householdId" = $1 AND title = $2`,
    [member.member.householdId, agentTitle],
  );
  assert(
    proposal.actionType === 'finance' && proposal.status === 'pending' && beforeConfirm.rowCount === 0 &&
      confirmed.status === 201 && confirmed.data.status === 'executed' &&
      afterConfirm.rowCount === 1 && afterConfirm.rows[0].sourceType === 'agent' &&
      afterConfirm.rows[0].sourceId === proposal.id,
    'Hermes 只能生成财务提案，成员明确确认后才通过 FinanceService 写入一笔流水',
  );

  const activities = await request('/activities?scope=all&limit=100', owner.accessToken);
  assert(activities.data.some((entry) => entry.module === 'finance'), '账户和记账操作进入家庭活动审计');

  console.log('\n家庭财务与 Hermes 记账回归测试全部通过');
} finally {
  await db.query('DELETE FROM finance_categories WHERE id = $1', [other.categoryId]);
  await db.query('DELETE FROM finance_accounts WHERE id = $1', [other.accountId]);
  await db.query('DELETE FROM members WHERE id = $1', [other.memberId]);
  await db.query('DELETE FROM households WHERE id = $1', [other.householdId]);
  await db.end();
}

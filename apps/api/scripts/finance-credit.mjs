// K4 信用卡账户黑盒（docs/finance-plan.md §2.5、§3-K4、§5-K4）：建卡与校验、刷卡后余额为负、转账还款归零、
// 预算 / 月汇总按消费分类计入而不把还款算成支出、还款日前的留意。
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('finance-credit.mjs 只允许在 API 临时测试库中运行');
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
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.data;
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: DATABASE,
});
await db.connect();

const suffix = randomUUID().slice(0, 6);
const created = [];

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const householdId = owner.member.householdId;
  const timezone = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows[0].timezone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());
  const month = today.slice(0, 7);
  const categories = (await request('/finance/categories', owner.accessToken)).data;
  const food = categories.find((one) => one.systemKey === 'expense_food');
  const shopping = categories.find((one) => one.systemKey === 'expense_shopping');
  const accountOf = async (id) =>
    (await request('/finance/accounts?includeInactive=true', member.accessToken)).data.find((one) => one.id === id);

  console.log('1. 建信用卡：账单日、还款日必填，额度选填；别的类型不能填');
  const cardBody = {
    name: `招行信用卡-${suffix}`,
    type: 'credit',
    openingBalance: 0,
    creditLimit: 20000,
    billingDay: 5,
    dueDay: Number(today.slice(8, 10)),
  };
  const memberCard = await request('/finance/accounts', member.accessToken, 'POST', cardBody);
  const card = await request('/finance/accounts', owner.accessToken, 'POST', cardBody);
  created.push(card.data?.id);
  const bank = await request('/finance/accounts', owner.accessToken, 'POST', {
    name: `还款银行卡-${suffix}`,
    type: 'bank',
    openingBalance: 5000,
  });
  created.push(bank.data?.id);
  assert(
    memberCard.status === 403 && card.status === 201 && card.data.type === 'credit' && card.data.creditLimit === 20000 &&
      card.data.billingDay === 5 && card.data.dueDay === cardBody.dueDay && card.data.balance === 0 &&
      bank.status === 201 && bank.data.creditLimit === null && bank.data.billingDay === null && bank.data.dueDay === null,
    '成员不能建；管理员建的信用卡带额度、账单日、还款日，银行卡三项都是 null',
  );
  const invalid = await Promise.all([
    request('/finance/accounts', owner.accessToken, 'POST', { ...cardBody, name: `缺还款日-${suffix}`, dueDay: undefined }),
    request('/finance/accounts', owner.accessToken, 'POST', { name: `银行卡带账单日-${suffix}`, type: 'bank', billingDay: 5 }),
    request('/finance/accounts', owner.accessToken, 'POST', { ...cardBody, name: `32号-${suffix}`, dueDay: 32 }),
    request('/finance/accounts', owner.accessToken, 'POST', { ...cardBody, name: `0号-${suffix}`, billingDay: 0 }),
    request('/finance/accounts', owner.accessToken, 'POST', { ...cardBody, name: `额度0-${suffix}`, creditLimit: 0 }),
  ]);
  assert(invalid.every((response) => response.status === 400), '信用卡缺还款日、银行卡填账单日、32 号、0 号、额度 0 都 400');
  let checkCode = null;
  try {
    await db.query(
      `INSERT INTO finance_accounts ("householdId", name, type, "dueDay", "createdById") VALUES ($1, $2, 'bank', 10, $3)`,
      [householdId, `绕过接口-${suffix}`, owner.member.id],
    );
  } catch (error) {
    checkCode = error.code;
  }
  assert(checkCode === '23514', '库里也拦：非信用卡写还款日违反 CHECK');

  console.log('2. 刷卡两笔：余额为负 = 欠款；月汇总按消费分类计入');
  const before = (await request(`/finance/summary?month=${month}`, member.accessToken)).data;
  const spend = (title, amount, categoryId) =>
    request('/finance/transactions', member.accessToken, 'POST', {
      type: 'expense',
      amount,
      accountId: card.data.id,
      categoryId,
      title: `${title}-${suffix}`,
      occurredOn: today,
      idempotencyKey: randomUUID(),
    });
  const meal = await spend('花呗吃饭', 120.5, food.id);
  const goods = await spend('信用卡网购', 79.5, shopping.id);
  const owing = await accountOf(card.data.id);
  const afterSpend = (await request(`/finance/summary?month=${month}`, member.accessToken)).data;
  const spentOn = (summary, categoryId) => summary.categorySpending.find((row) => row.category?.id === categoryId)?.amount ?? 0;
  assert(
    meal.status === 201 && goods.status === 201 && owing.balance === -200 &&
      Math.round((afterSpend.expense - before.expense) * 100) / 100 === 200 &&
      Math.round((spentOn(afterSpend, food.id) - spentOn(before, food.id)) * 100) / 100 === 120.5 &&
      Math.round((spentOn(afterSpend, shopping.id) - spentOn(before, shopping.id)) * 100) / 100 === 79.5,
    '成员在信用卡上记两笔支出：卡上欠 200（余额 -200），本月支出 +200，分别记在餐饮、购物',
  );

  console.log('3. 转账还款：欠款归零，银行卡扣钱，不算支出');
  const repay = await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'transfer',
    amount: 200,
    accountId: bank.data.id,
    toAccountId: card.data.id,
    title: `还信用卡-${suffix}`,
    occurredOn: today,
    idempotencyKey: randomUUID(),
  });
  const afterRepay = (await request(`/finance/summary?month=${month}`, member.accessToken)).data;
  assert(
    repay.status === 201 && (await accountOf(card.data.id)).balance === 0 && (await accountOf(bank.data.id)).balance === 4800 &&
      afterRepay.expense === afterSpend.expense && afterRepay.income === afterSpend.income &&
      spentOn(afterRepay, food.id) === spentOn(afterSpend, food.id),
    '还款 = 银行卡转进信用卡：卡上归零、银行卡 4800；本月支出、收入、分类花销都不变（还款不重复算支出）',
  );

  console.log('4. 改卡：改还款日、改成别的类型会清掉三项、改回信用卡要重填');
  const moved = await request(`/finance/accounts/${card.data.id}`, owner.accessToken, 'PATCH', {
    dueDay: 10,
    expectedVersion: card.data.version,
  });
  const toBank = await request(`/finance/accounts/${card.data.id}`, owner.accessToken, 'PATCH', {
    type: 'bank',
    expectedVersion: moved.data.version,
  });
  const backWithoutDays = await request(`/finance/accounts/${card.data.id}`, owner.accessToken, 'PATCH', {
    type: 'credit',
    expectedVersion: toBank.data.version,
  });
  const back = await request(`/finance/accounts/${card.data.id}`, owner.accessToken, 'PATCH', {
    type: 'credit',
    billingDay: 5,
    dueDay: cardBody.dueDay,
    expectedVersion: toBank.data.version,
  });
  assert(
    moved.status === 200 && moved.data.dueDay === 10 && moved.data.billingDay === 5 && moved.data.creditLimit === 20000 &&
      toBank.status === 200 && toBank.data.creditLimit === null && toBank.data.dueDay === null &&
      backWithoutDays.status === 400 && back.status === 200 && back.data.creditLimit === null && back.data.dueDay === cardBody.dueDay,
    '改还款日其余沿用；改成银行卡三项清空；改回信用卡不填日子 400，填了就行（额度这次没填就是空）',
  );

  console.log('5. 留意：还款日当天、还欠着钱才出现，还清就没了');
  const attentionItems = async () =>
    (await request('/today/attention', member.accessToken)).data.items.filter((one) => one.domain === 'finance');
  assert((await attentionItems()).length === 0, '不欠钱时没有信用卡的留意');
  await spend('还款日前刷卡', 66.6, food.id);
  const due = await attentionItems();
  assert(
    due.length === 1 && due[0].kind === 'credit' && due[0].dueOn === today && due[0].overdue === false &&
      due[0].entity?.id === card.data.id && due[0].entity.name === `${cardBody.name}（欠 ¥66.60）`,
    '今天是还款日、卡上欠 66.6：成员的留意里出现，名字带上欠多少',
  );
  await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'transfer', amount: 66.6, accountId: bank.data.id, toAccountId: card.data.id,
    title: `再还信用卡-${suffix}`, occurredOn: today, idempotencyKey: randomUUID(),
  });
  assert((await attentionItems()).length === 0, '还清之后留意里没有了');

  console.log('\n信用卡账户回归测试全部通过');
} finally {
  // 账本不可删：本脚本建的账户停用就行
  const cleaner = (await login('爸爸')).accessToken;
  const accounts = (await request('/finance/accounts?includeInactive=true', cleaner)).data ?? [];
  for (const account of accounts.filter((one) => created.includes(one.id) && one.isActive)) {
    await request(`/finance/accounts/${account.id}`, cleaner, 'PATCH', { isActive: false, expectedVersion: account.version });
  }
  await db.end();
}

// K3 周期账单黑盒（docs/finance-plan.md §2.4、§3-K3、§5-K3）：增删改与权限、「已付」幂等、下一期推算。
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('finance-recurring.mjs 只允许在 API 临时测试库中运行');
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

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 与服务端同一个算法：第 index 个月，日取 anchor 的日，短月按月末。 */
function addMonthsClamped(anchor, months) {
  const [year, month, day] = anchor.split('-').map(Number);
  const total = month - 1 + months;
  const y = year + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function firstMonthlyOnOrAfter(anchor, date) {
  let index = 0;
  while (addMonthsClamped(anchor, index) < date) index += 1;
  return addMonthsClamped(anchor, index);
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

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const householdId = owner.member.householdId;
  const timezone = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows[0].timezone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());

  const categories = (await request('/finance/categories', owner.accessToken)).data;
  const housing = categories.find((one) => one.systemKey === 'expense_housing');
  const insurance = categories.find((one) => one.systemKey === 'expense_insurance');
  const salary = categories.find((one) => one.systemKey === 'income_salary');
  const bank = await request('/finance/accounts', owner.accessToken, 'POST', {
    name: `周期账单银行卡-${suffix}`,
    type: 'bank',
    openingBalance: 10000,
  });
  const spare = await request('/finance/accounts', owner.accessToken, 'POST', {
    name: `周期账单备用卡-${suffix}`,
    type: 'bank',
    openingBalance: 0,
  });
  assert(bank.status === 201 && spare.status === 201 && housing && insurance && salary, '准备好账户与「物业房租 / 保险 / 工资」分类');
  const balanceOf = async (id) =>
    (await request('/finance/accounts?includeInactive=true', owner.accessToken)).data.find((one) => one.id === id).balance;

  console.log('1. 增删改只有管理员，成员只读');
  const rentBody = {
    title: `房租-${suffix}`,
    type: 'expense',
    amount: 3200,
    accountId: bank.data.id,
    categoryId: housing.id,
    cadence: 'monthly',
    anchorOn: today,
  };
  const forbidden = await request('/finance/recurring', member.accessToken, 'POST', rentBody);
  const rent = await request('/finance/recurring', owner.accessToken, 'POST', rentBody);
  assert(
    forbidden.status === 403 && rent.status === 201 && rent.data.nextDueOn === today && rent.data.autoPost === false &&
      rent.data.payable === true && rent.data.monthlyAmount === 3200 && rent.data.lastPostedOn === null &&
      rent.data.account.name === bank.data.name && rent.data.category.name === housing.name,
    '成员不能建；管理员建的月付从今天起，默认不自动记账，今天就能点「已付」',
  );
  const anchorPast = '2025-01-31';
  const yearly = await request('/finance/recurring', owner.accessToken, 'POST', {
    title: `车险-${suffix}`,
    type: 'expense',
    amount: 4800,
    accountId: bank.data.id,
    categoryId: insurance.id,
    cadence: 'yearly',
    anchorOn: addDays(today, -400),
    autoPost: true,
  });
  const monthlyPast = await request('/finance/recurring', owner.accessToken, 'POST', {
    title: `物业费-${suffix}`,
    type: 'expense',
    amount: 300,
    accountId: bank.data.id,
    categoryId: housing.id,
    cadence: 'monthly',
    anchorOn: anchorPast,
  });
  assert(
    yearly.status === 201 && yearly.data.nextDueOn > today && yearly.data.nextDueOn <= addDays(today, 366) &&
      yearly.data.monthlyAmount === 400 && yearly.data.payable === false &&
      monthlyPast.status === 201 && monthlyPast.data.nextDueOn === firstMonthlyOnOrAfter(anchorPast, today),
    '第一次应付日早于今天时不往回补：从不早于今天的那一期开始（31 号起的月付在短月按月末算）；年付月均 = 金额 ÷ 12',
  );
  const weekly = await request('/finance/recurring', owner.accessToken, 'POST', {
    title: `周薪-${suffix}`,
    type: 'income',
    amount: 1200,
    accountId: bank.data.id,
    categoryId: salary.id,
    cadence: 'weekly',
    anchorOn: addDays(today, 10),
  });
  assert(
    weekly.status === 201 && weekly.data.nextDueOn === addDays(today, 10) && weekly.data.monthlyAmount === 5200,
    '收入也能周期；第一次应付日在以后就从那天开始；周付月均 = 金额 × 52 ÷ 12',
  );
  const invalid = await Promise.all([
    request('/finance/recurring', owner.accessToken, 'POST', { ...rentBody, categoryId: salary.id }),
    request('/finance/recurring', owner.accessToken, 'POST', { ...rentBody, amount: 0 }),
    request('/finance/recurring', owner.accessToken, 'POST', { ...rentBody, cadence: 'daily' }),
    request('/finance/recurring', owner.accessToken, 'POST', { ...rentBody, anchorOn: '2026-02-30' }),
    request('/finance/recurring', owner.accessToken, 'POST', { ...rentBody, accountId: randomUUID() }),
  ]);
  assert(
    invalid[0].status === 400 && invalid[1].status === 400 && invalid[2].status === 400 && invalid[3].status === 400 &&
      invalid[4].status === 404,
    '支出配收入分类、金额 0、不认识的周期、不存在的日期都 400，账户不存在 404',
  );
  const listed = await request('/finance/recurring', member.accessToken);
  const mine = listed.data.filter((one) => one.title.endsWith(suffix));
  assert(
    listed.status === 200 && mine.length === 4 &&
      mine.map((one) => one.nextDueOn).every((due, index, all) => index === 0 || all[index - 1] <= due),
    '成员能看列表，在用的按下一期排',
  );

  console.log('2. 「已付」：成员可点、同一期只落一笔、推到下一期');
  const before = await balanceOf(bank.data.id);
  const paid = await request(`/finance/recurring/${rent.data.id}/pay`, member.accessToken, 'POST', { dueOn: today });
  const paidAgain = await request(`/finance/recurring/${rent.data.id}/pay`, member.accessToken, 'POST', { dueOn: today });
  const posted = await db.query(
    `SELECT id, "sourceType", "sourceId", "occurredOn"::text AS "occurredOn", "actorId", amount
       FROM finance_transactions WHERE "householdId" = $1 AND "idempotencyKey" = $2`,
    [householdId, `recurring:${rent.data.id}:${today}`],
  );
  assert(
    paid.status === 201 && paidAgain.status === 201 && paid.data.transaction.id === paidAgain.data.transaction.id &&
      posted.rowCount === 1 && posted.rows[0].sourceType === 'recurring' && posted.rows[0].sourceId === rent.data.id &&
      posted.rows[0].occurredOn === today && posted.rows[0].actorId === member.member.id && Number(posted.rows[0].amount) === 3200 &&
      paid.data.transaction.type === 'expense' && paid.data.transaction.title === rentBody.title,
    '成员点「已付」落一笔（来源 recurring、记账日今天、记在点的人名下），同一期再点返回同一笔',
  );
  assert(
    paid.data.recurring.nextDueOn === addMonthsClamped(today, 1) && paid.data.recurring.lastPostedOn === today &&
      paid.data.recurring.payable === false && (await balanceOf(bank.data.id)) === before - 3200,
    '推到下一个月同一天，余额只扣一次',
  );
  const early = await request(`/finance/recurring/${rent.data.id}/pay`, member.accessToken, 'POST', {
    dueOn: paid.data.recurring.nextDueOn,
  });
  const stale = await request(`/finance/recurring/${monthlyPast.data.id}/pay`, member.accessToken, 'POST', {
    dueOn: addDays(monthlyPast.data.nextDueOn, -1),
  });
  const auto = await request(`/finance/recurring/${yearly.data.id}/pay`, member.accessToken, 'POST', {
    dueOn: yearly.data.nextDueOn,
  });
  assert(
    early.status === 409 && stale.status === 409 && auto.status === 409,
    '离到期还早于 3 天、带的不是当前这一期、自动记账的，点「已付」都 409',
  );

  console.log('3. 改、停用、删除（乐观锁）');
  const staleEdit = await request(`/finance/recurring/${rent.data.id}`, owner.accessToken, 'PATCH', {
    amount: 3300,
    expectedVersion: rent.data.version,
  });
  const memberEdit = await request(`/finance/recurring/${rent.data.id}`, member.accessToken, 'PATCH', {
    amount: 1,
    expectedVersion: paid.data.recurring.version,
  });
  const edited = await request(`/finance/recurring/${rent.data.id}`, owner.accessToken, 'PATCH', {
    amount: 3300,
    autoPost: true,
    accountId: spare.data.id,
    expectedVersion: paid.data.recurring.version,
  });
  assert(
    staleEdit.status === 409 && memberEdit.status === 403 && edited.status === 200 && edited.data.amount === 3300 &&
      edited.data.autoPost === true && edited.data.accountId === spare.data.id &&
      edited.data.nextDueOn === paid.data.recurring.nextDueOn && edited.data.payable === false,
    '「已付」推进后旧版本号改不动；成员不能改；管理员改金额、账户、打开自动记账，下一期不变',
  );
  const rescheduled = await request(`/finance/recurring/${monthlyPast.data.id}`, owner.accessToken, 'PATCH', {
    cadence: 'quarterly',
    anchorOn: addDays(today, 5),
    expectedVersion: monthlyPast.data.version,
  });
  const paused = await request(`/finance/recurring/${weekly.data.id}`, owner.accessToken, 'PATCH', {
    isActive: false,
    expectedVersion: weekly.data.version,
  });
  assert(
    rescheduled.status === 200 && rescheduled.data.cadence === 'quarterly' && rescheduled.data.nextDueOn === addDays(today, 5) &&
      rescheduled.data.monthlyAmount === 100 && paused.status === 200 && paused.data.isActive === false && paused.data.payable === false,
    '换周期 / 起始日后下一期重算（季付月均 = 金额 ÷ 3）；停用后不能点「已付」',
  );
  const memberDelete = await request(
    `/finance/recurring/${rent.data.id}?expectedVersion=${edited.data.version}`,
    member.accessToken,
    'DELETE',
  );
  const deleted = await request(`/finance/recurring/${rent.data.id}?expectedVersion=${edited.data.version}`, owner.accessToken, 'DELETE');
  const afterDelete = await request('/finance/recurring', owner.accessToken);
  const keptTransaction = await db.query('SELECT count(*)::int AS n FROM finance_transactions WHERE "sourceId" = $1', [rent.data.id]);
  assert(
    memberDelete.status === 403 && deleted.status === 200 && !afterDelete.data.some((one) => one.id === rent.data.id) &&
      keptTransaction.rows[0].n === 1,
    '成员不能删；管理员删掉后列表里没了，已经落的流水还在',
  );
  const activities = await request('/activities?scope=all&limit=100', owner.accessToken);
  assert(
    activities.data.some((one) => one.module === 'finance' && one.summary.includes(`新增了周期账单「房租-${suffix}」`)) &&
      activities.data.some((one) => one.module === 'finance' && one.summary.includes(`删除了周期账单「房租-${suffix}」`)),
    '新增、删除周期账单进家庭动态',
  );

  // 收尾：停掉本脚本建的，免得后面的调度把自动记账的那几条落下来
  for (const row of (await request('/finance/recurring', owner.accessToken)).data.filter((one) => one.title.endsWith(suffix))) {
    await request(`/finance/recurring/${row.id}?expectedVersion=${row.version}`, owner.accessToken, 'DELETE');
  }
  console.log('\n周期账单增删改与「已付」回归测试全部通过');
} finally {
  await db.end();
}

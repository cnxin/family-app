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

async function waitFor(check, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

  console.log('4. 自动记账调度：到期落一条、再跑不重复、漏跑几期逐期补、非自动的不落');
  // 调度按真实时钟跑（和助理例行任务一样）：把「下一期」拨回已经过去的日子，等它自己落。用昨天而不是今天，
  // 免得撞上当地 06:00 之前（那时今天的还不该落）
  const yesterday = addDays(today, -1);
  const create = async (body) =>
    (await request('/finance/recurring', owner.accessToken, 'POST', {
      type: 'expense', accountId: bank.data.id, categoryId: housing.id, cadence: 'monthly', ...body,
    })).data;
  const ruleRow = async (id) =>
    (await db.query(
      `SELECT "nextDueOn"::text AS "nextDueOn", "lastPostedOn"::text AS "lastPostedOn", version FROM finance_recurring WHERE id = $1`,
      [id],
    )).rows[0];
  const postedFor = async (id) =>
    (await db.query(
      `SELECT "occurredOn"::text AS "occurredOn", "actorName", "sourceType", amount FROM finance_transactions
        WHERE "sourceId" = $1 ORDER BY "occurredOn"`,
      [id],
    )).rows;
  const autoRent = await create({ title: `自动房租-${suffix}`, amount: 2000, anchorOn: yesterday, autoPost: true });
  const autoBalance = await balanceOf(bank.data.id);
  assert(autoRent.nextDueOn === addMonthsClamped(yesterday, 1) && (await postedFor(autoRent.id)).length === 0, '昨天起的自动记账月付，建的时候不往回补');
  await db.query('UPDATE finance_recurring SET "nextDueOn" = "anchorOn" WHERE id = $1', [autoRent.id]);
  const firstRun = await waitFor(async () => ((await ruleRow(autoRent.id)).lastPostedOn === yesterday ? ruleRow(autoRent.id) : null));
  const firstPosts = await postedFor(autoRent.id);
  assert(
    firstRun && firstRun.nextDueOn === addMonthsClamped(yesterday, 1) && firstPosts.length === 1 &&
      firstPosts[0].occurredOn === yesterday && firstPosts[0].actorName === '自动记账' && firstPosts[0].sourceType === 'recurring' &&
      (await balanceOf(bank.data.id)) === autoBalance - 2000,
    '到期后调度落一条（记账日是那一期、记在「自动记账」名下、余额扣一次），推到下一期',
  );
  await db.query('UPDATE finance_recurring SET "nextDueOn" = "anchorOn", "lastPostedOn" = NULL WHERE id = $1', [autoRent.id]);
  const rerun = await waitFor(async () => ((await ruleRow(autoRent.id)).lastPostedOn === yesterday ? ruleRow(autoRent.id) : null));
  assert(
    rerun && rerun.nextDueOn === addMonthsClamped(yesterday, 1) && (await postedFor(autoRent.id)).length === 1 &&
      (await balanceOf(bank.data.id)) === autoBalance - 2000,
    '同一期再被调度一次（比如上次落完没来得及推进）：只推进，不重复落',
  );
  const missedAnchor = addMonthsClamped(yesterday, -2);
  const autoFee = await create({ title: `自动物业-${suffix}`, amount: 150, anchorOn: missedAnchor, autoPost: true });
  await db.query('UPDATE finance_recurring SET "nextDueOn" = "anchorOn" WHERE id = $1', [autoFee.id]);
  const caughtUp = await waitFor(async () => {
    const row = await ruleRow(autoFee.id);
    return row.nextDueOn === addMonthsClamped(missedAnchor, 3) ? row : null;
  });
  const feePosts = await postedFor(autoFee.id);
  assert(
    caughtUp && feePosts.length === 3 &&
      JSON.stringify(feePosts.map((row) => row.occurredOn)) ===
        JSON.stringify([0, 1, 2].map((index) => addMonthsClamped(missedAnchor, index))),
    '漏跑三期（NAS 关机）：下一轮逐期补三条，每期一条，推到第四期',
  );
  const manualWater = await create({ title: `手动水费-${suffix}`, amount: 80, anchorOn: yesterday });
  await db.query('UPDATE finance_recurring SET "nextDueOn" = "anchorOn" WHERE id = $1', [manualWater.id]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const manualListed = (await request('/finance/recurring', member.accessToken)).data.find((one) => one.id === manualWater.id);
  assert(
    (await postedFor(manualWater.id)).length === 0 && manualListed.payable === true && manualListed.nextDueOn === yesterday,
    '没开自动记账的到期了调度不落，等人点「已付」',
  );

  console.log('5. 留意：没开自动记账的到期前 3 天起出现，成员也看得到，点了「已付」就消失');
  const attentionItems = async () => (await request('/today/attention', member.accessToken)).data.items.filter((one) => one.domain === 'finance');
  const overdueItems = await attentionItems();
  assert(
    overdueItems.length === 1 && overdueItems[0].kind === 'recurring' && overdueItems[0].count === 1 &&
      overdueItems[0].entity?.id === manualWater.id && overdueItems[0].dueOn === yesterday && overdueItems[0].overdue === true,
    '昨天到期、没点「已付」的手动水费：成员的留意里出现，标逾期；自动记账的不进留意',
  );
  const soon = await create({ title: `手动网费-${suffix}`, amount: 120, anchorOn: addDays(today, 3) });
  const later = await create({ title: `手动燃气-${suffix}`, amount: 60, anchorOn: addDays(today, 4) });
  const withSoon = await attentionItems();
  assert(
    soon.payable === true && later.payable === false && withSoon.length === 1 && withSoon[0].count === 2 &&
      JSON.stringify(withSoon[0].kinds) === JSON.stringify(['recurring']),
    '3 天后到期的也出现（两条合成一张卡），4 天后的还不出现、也还不能点「已付」',
  );
  await request(`/finance/recurring/${manualWater.id}/pay`, member.accessToken, 'POST', { dueOn: yesterday });
  await request(`/finance/recurring/${soon.id}/pay`, member.accessToken, 'POST', { dueOn: addDays(today, 3) });
  assert((await attentionItems()).length === 0, '两条都点了「已付」之后留意里没有财务的事了');

  console.log('6. 汇总页「固定支出」= 周期账单月均 + 资产续费月均（资产经门面读）');
  const subscription = await request('/assets', owner.accessToken, 'POST', {
    name: `视频会员-${suffix}`,
    category: 'subscription',
    purchaseDate: addDays(today, -30),
    purchasePrice: 90,
    renewsOn: addDays(today, 60),
    renewalIntervalMonths: 3,
  });
  const summary = await request('/finance/summary', owner.accessToken);
  const activeExpense = (await request('/finance/recurring', owner.accessToken)).data.filter((one) => one.isActive && one.type === 'expense');
  const expectedRecurring = Math.round(activeExpense.reduce((sum, one) => sum + one.monthlyAmount, 0) * 100) / 100;
  const [{ monthly }] = (await db.query(
    `SELECT COALESCE(SUM(COALESCE("renewalPrice", "purchasePrice") / "renewalIntervalMonths"), 0) AS monthly FROM home_assets
      WHERE "householdId" = $1 AND category = 'subscription' AND status = 'active'
        AND "renewalIntervalMonths" IS NOT NULL AND COALESCE("renewalPrice", "purchasePrice") IS NOT NULL`,
    [householdId],
  )).rows;
  const expectedAssets = Math.round(Number(monthly) * 100) / 100;
  assert(
    subscription.status === 201 && summary.status === 200 && expectedAssets >= 30 &&
      summary.data.fixedCosts.recurring === expectedRecurring && summary.data.fixedCosts.assets === expectedAssets &&
      summary.data.fixedCosts.total === Math.round((expectedRecurring + expectedAssets) * 100) / 100 &&
      !activeExpense.some((one) => one.type === 'income'),
    '固定支出三项合计正确：周期账单只算在用的支出（季付 90 元的视频会员折每月 30 元算进资产续费）',
  );
  // K 收尾：填了每次续费金额（季付 150）就按它算，月均 50；清空退回购买价
  await request(`/assets/${subscription.data.id}`, owner.accessToken, 'PATCH', { renewalPrice: 150 });
  const withRenewal = (await request('/finance/summary', owner.accessToken)).data.fixedCosts;
  await request(`/assets/${subscription.data.id}`, owner.accessToken, 'PATCH', { renewalPrice: null });
  const withoutRenewal = (await request('/finance/summary', owner.accessToken)).data.fixedCosts;
  assert(
    withRenewal.assets === Math.round((expectedAssets + 20) * 100) / 100 &&
      withRenewal.total === Math.round((expectedRecurring + expectedAssets + 20) * 100) / 100 &&
      withoutRenewal.assets === expectedAssets && withoutRenewal.total === summary.data.fixedCosts.total,
    '订阅填了每次续费 150（季付）后资产续费月均 +20、合计跟着变；清空后回到按购买价算',
  );
  await request(`/assets/${subscription.data.id}`, owner.accessToken, 'PATCH', { status: 'retired' });

  // 收尾：停掉本脚本建的，免得后面的调度把自动记账的那几条落下来
  for (const row of (await request('/finance/recurring', owner.accessToken)).data.filter((one) => one.title.endsWith(suffix))) {
    await request(`/finance/recurring/${row.id}?expectedVersion=${row.version}`, owner.accessToken, 'DELETE');
  }
  console.log('\n周期账单增删改与「已付」回归测试全部通过');
} finally {
  await db.end();
}

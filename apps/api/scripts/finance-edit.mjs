// K5 流水编辑黑盒（docs/finance-plan.md §3-K5）：原地改不动分录、改金额 / 账户 / 收支冲销后另记一笔且列表折叠、
// 单号跟到新笔上（同一账单再导 0 新增）、删除 = 冲销 + 隐藏、权限（成员只能动自己记的、自动记账的只有管理员）、
// 批量（逐条判、跳过原因、≤ 200）、分类学习与「同商户还有 N 笔」、列表筛选、汇总与超预算留意不算已删除 / 已改过的。
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';
const FIXTURES = new URL('../test/fixtures/finance/', import.meta.url);

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('finance-edit.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

const round = (value) => Math.round(value * 100) / 100;

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function upload(token, fields, file, fileName = 'statement.csv') {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([file], { type: 'text/csv' }), fileName);
  const response = await fetch(`${BASE}/finance/imports`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const json = await response.json();
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
const createdAccounts = [];
const createdBudgets = [];
let householdId = null;

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  householdId = owner.member.householdId;
  const timezone = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows[0].timezone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());
  const month = today.slice(0, 7);
  const categories = (await request('/finance/categories', owner.accessToken)).data;
  const byKey = Object.fromEntries(categories.filter((one) => one.systemKey).map((one) => [one.systemKey, one.id]));
  const newAccount = async (name, type, extra = {}) => {
    const response = await request('/finance/accounts', owner.accessToken, 'POST', { name: `${name}-${suffix}`, type, ...extra });
    if (response.status !== 201) throw new Error(`建账户失败 ${response.status}`);
    createdAccounts.push(response.data.id);
    return response.data;
  };
  const bank = await newAccount('改账银行卡', 'bank', { openingBalance: 1000 });
  const wallet = await newAccount('改账零钱', 'wechat', { openingBalance: 0 });
  const imported = await newAccount('改账导入', 'wechat', { openingBalance: 0 });
  const balanceOf = async (id) =>
    (await request('/finance/accounts?includeInactive=true', member.accessToken)).data.find((one) => one.id === id).balance;
  const postingCount = async () =>
    Number((await db.query('SELECT count(*) FROM finance_postings WHERE "householdId" = $1', [householdId])).rows[0].count);
  const list = async (token, params = {}) =>
    (await request(`/finance/transactions?${new URLSearchParams({ month, limit: '200', ...params })}`, token)).data;
  const record = (token, body) =>
    request('/finance/transactions', token, 'POST', {
      occurredOn: today, note: null, toAccountId: null, idempotencyKey: randomUUID(), ...body,
    });
  const patch = (token, id, body) => request(`/finance/transactions/${id}`, token, 'PATCH', body);
  const remove = (token, id) => request(`/finance/transactions/${id}`, token, 'DELETE');
  const batch = (token, body) => request('/finance/transactions/batch', token, 'POST', body);
  const summaryOf = async () => (await request(`/finance/summary?month=${month}`, owner.accessToken)).data;

  console.log('1. 原地改：名称 / 分类 / 备注 / 日期 / 商户，不动分录');
  const lunch = (await record(member.accessToken, {
    type: 'expense', amount: 30, accountId: bank.id, categoryId: byKey.expense_food, title: `午饭-${suffix}`,
  })).data;
  const postingsBefore = await postingCount();
  const renamed = await patch(member.accessToken, lunch.id, {
    title: `午饭-公司楼下-${suffix}`, categoryId: byKey.expense_snacks, note: '加了饮料', merchant: `楼下面馆${suffix}`,
  });
  assert(
    renamed.status === 200 && renamed.data.id === lunch.id && renamed.data.title === `午饭-公司楼下-${suffix}` &&
      renamed.data.category.id === byKey.expense_snacks && renamed.data.note === '加了饮料' &&
      renamed.data.merchant === `楼下面馆${suffix}` && renamed.data.amount === 30 && renamed.data.sameMerchantPending === 0 &&
      (await postingCount()) === postingsBefore && (await balanceOf(bank.id)) === 970,
    '成员改自己记的：还是同一笔、字段都改了、分录数不变、余额不变；改了分类也没有同商户的别的笔',
  );
  const rule = (await db.query(
    'SELECT kind, "categoryId", hits FROM finance_merchant_rules WHERE "householdId" = $1 AND pattern = $2',
    [householdId, `楼下面馆${suffix}`.toLowerCase()],
  )).rows;
  assert(rule.length === 1 && rule[0].kind === 'expense' && rule[0].categoryId === byKey.expense_snacks && rule[0].hits === 1,
    '改了分类、这笔有商户：记成商户规则（和导入预览同一张表）');
  const invalid = [
    await patch(member.accessToken, lunch.id, {}),
    await patch(member.accessToken, lunch.id, { categoryId: byKey.income_salary }),
    await patch(member.accessToken, lunch.id, { occurredOn: '2026-02-30' }),
  ];
  assert(invalid[0].status === 400 && invalid[1].status === 404 && invalid[2].status === 400,
    '什么都没传 400；支出配收入分类 404（同记一笔）；不存在的日期 400');

  console.log('2. 改金额 / 账户 / 收支：冲销原笔另记一笔，列表只剩新的');
  const summaryBefore = await summaryOf();
  const bigger = await patch(member.accessToken, lunch.id, { amount: 45.5 });
  const after = await list(member.accessToken);
  const withHidden = await list(member.accessToken, { includeDeleted: 'true' });
  const original = withHidden.find((one) => one.id === lunch.id);
  const summaryAfter = await summaryOf();
  assert(
    bigger.status === 200 && bigger.data.id !== lunch.id && bigger.data.amount === 45.5 &&
      bigger.data.title === `午饭-公司楼下-${suffix}` && bigger.data.merchant === `楼下面馆${suffix}` &&
      bigger.data.category.id === byKey.expense_snacks && bigger.data.note === '加了饮料' &&
      bigger.data.actorName === member.member.name && bigger.data.sourceType === 'manual' &&
      (await balanceOf(bank.id)) === 954.5 &&
      after.some((one) => one.id === bigger.data.id) && !after.some((one) => one.id === lunch.id) &&
      !after.some((one) => one.reversalOfId === lunch.id) &&
      original?.supersededById === bigger.data.id && original.supersededBy.amount === 45.5 &&
      !withHidden.some((one) => one.reversalOfId === lunch.id) &&
      round(summaryAfter.expense - summaryBefore.expense) === 15.5,
    '改金额：返回新笔（名称、商户、分类、备注、记账人跟过去），余额按新金额；列表只有新的、原笔和冲销都不见；' +
      '「显示已删除」能看到原笔、指向新笔；冲销笔一直不列；本月支出 +15.5',
  );
  const again = await patch(member.accessToken, lunch.id, { title: '再改原笔' });
  const moved = await patch(member.accessToken, bigger.data.id, { accountId: wallet.id });
  assert(
    again.status === 409 && moved.status === 200 && (await balanceOf(bank.id)) === 1000 && (await balanceOf(wallet.id)) === -45.5,
    '改过的原笔再改 409；改账户：银行卡回到 1000、零钱 -45.5',
  );
  const toIncome = await patch(member.accessToken, moved.data.id, { type: 'income' });
  const asIncome = await patch(member.accessToken, moved.data.id, { type: 'income', categoryId: byKey.income_refund });
  assert(
    toIncome.status === 400 && asIncome.status === 200 && asIncome.data.type === 'income' &&
      asIncome.data.category.id === byKey.income_refund && (await balanceOf(wallet.id)) === 45.5,
    '改成收入不带分类 400；带上收入分类：变成收入，零钱 +45.5',
  );
  const transfer = (await record(owner.accessToken, {
    type: 'transfer', amount: 100, accountId: bank.id, toAccountId: wallet.id, title: `转零钱-${suffix}`,
  })).data;
  const memberTransfer = await patch(member.accessToken, transfer.id, { amount: 120 });
  const ownerTransfer = await patch(owner.accessToken, transfer.id, { amount: 120 });
  const transferCategory = await patch(owner.accessToken, ownerTransfer.data.id, { categoryId: byKey.expense_food });
  assert(
    memberTransfer.status === 403 && ownerTransfer.status === 200 && (await balanceOf(bank.id)) === 880 &&
      (await balanceOf(wallet.id)) === 165.5 && ownerTransfer.data.postings.map((one) => one.delta).join() === '-120,120' &&
      transferCategory.status === 400,
    '成员改不了管理员记的转账（403）；管理员改成 120：银行卡 880、零钱 165.5，分录先转出后转入；转账不能配分类（400）',
  );

  console.log('3. 删除：冲销 + 隐藏，「显示已删除」能看到');
  const coffee = (await record(member.accessToken, {
    type: 'expense', amount: 18, accountId: bank.id, categoryId: byKey.expense_food, title: `咖啡-${suffix}`,
  })).data;
  const deleted = await remove(member.accessToken, coffee.id);
  const afterDelete = await list(member.accessToken);
  const deletedVisible = (await list(member.accessToken, { includeDeleted: 'true' })).find((one) => one.id === coffee.id);
  assert(
    deleted.status === 200 && deleted.data.deletedAt && !afterDelete.some((one) => one.id === coffee.id) &&
      deletedVisible?.deletedAt && (await balanceOf(bank.id)) === 880 &&
      (await remove(member.accessToken, coffee.id)).status === 409 &&
      (await patch(member.accessToken, coffee.id, { title: '改删掉的' })).status === 409,
    '删除：列表不见、「显示已删除」可见、余额回到删除前；再删、再改都 409',
  );

  console.log('4. 权限：成员只能动自己记的；周期账单自动记的只有管理员');
  const ownerExpense = (await record(owner.accessToken, {
    type: 'expense', amount: 66, accountId: bank.id, categoryId: byKey.expense_food, title: `爸爸记的-${suffix}`,
  })).data;
  const memberExpense = (await record(member.accessToken, {
    type: 'expense', amount: 12, accountId: bank.id, categoryId: byKey.expense_food, title: `妈妈记的-${suffix}`,
  })).data;
  // 周期账单自动落的一笔：记在成员名下、显示名「自动记账」（账本不许改记账人，直接写一笔）
  const auto = { id: randomUUID() };
  await db.query(
    `INSERT INTO finance_transactions (id, "householdId", type, amount, title, "occurredOn", "categoryId", "actorId", "actorName",
       "sourceType", "sourceId", "idempotencyKey", "requestFingerprint")
     VALUES ($1, $2, 'expense', 99, $3, $4, $5, $6, '自动记账', 'recurring', $7, $8, 'test')`,
    [auto.id, householdId, `自动房租-${suffix}`, today, byKey.expense_housing, member.member.id, randomUUID(), `recurring:test:${auto.id}`],
  );
  await db.query('INSERT INTO finance_postings ("householdId", "transactionId", "accountId", delta) VALUES ($1, $2, $3, -99)', [
    householdId, auto.id, bank.id,
  ]);
  const permission = {
    memberOnOwner: await patch(member.accessToken, ownerExpense.id, { title: '偷改' }),
    memberDeleteOwner: await remove(member.accessToken, ownerExpense.id),
    ownerOnMember: await patch(owner.accessToken, memberExpense.id, { note: '管理员补的备注' }),
    memberOnAuto: await patch(member.accessToken, auto.id, { title: '改自动' }),
    ownerOnAuto: await patch(owner.accessToken, auto.id, { note: '管理员能改自动的' }),
  };
  assert(
    permission.memberOnOwner.status === 403 && permission.memberDeleteOwner.status === 403 &&
      permission.ownerOnMember.status === 200 && permission.memberOnAuto.status === 403 && permission.ownerOnAuto.status === 200,
    '成员改 / 删管理员记的 403；管理员能改成员记的；记在成员名下的自动记账，成员改不了、管理员能改',
  );
  const reversedOne = (await record(owner.accessToken, {
    type: 'expense', amount: 7, accountId: bank.id, categoryId: byKey.expense_food, title: `撤销的-${suffix}`,
  })).data;
  const reversal = await request(`/finance/transactions/${reversedOne.id}/reverse`, owner.accessToken, 'POST', { idempotencyKey: randomUUID() });
  assert(
    (await patch(owner.accessToken, reversal.data.id, { title: '改撤销' })).status === 400 &&
      (await patch(owner.accessToken, reversedOne.id, { title: '改被撤销的' })).status === 409 &&
      (await remove(owner.accessToken, reversedOne.id)).status === 409,
    '撤销流水不能改（400）；已经撤销的原笔不能改、不能删（409）',
  );

  console.log('5. 批量：逐条判权限，跳过的说原因；一次最多 200 笔');
  const mine = [];
  for (const amount of [5, 6, 7]) {
    mine.push((await record(member.accessToken, {
      type: 'expense', amount, accountId: bank.id, categoryId: byKey.expense_food, title: `批量-${amount}-${suffix}`,
    })).data);
  }
  const ghost = randomUUID();
  const mixed = await batch(member.accessToken, {
    ids: [mine[0].id, mine[1].id, ownerExpense.id, coffee.id, ghost, mine[0].id],
    action: 'category', categoryId: byKey.expense_shopping,
  });
  const reasons = Object.fromEntries((mixed.data?.skipped ?? []).map((one) => [one.id, one.reason]));
  const recategorized = await list(member.accessToken, { categoryId: byKey.expense_shopping });
  assert(
    mixed.status === 201 && mixed.data.done === 2 && mixed.data.skipped.length === 3 &&
      reasons[ownerExpense.id] === '只能改自己记的流水' && reasons[coffee.id] === '这笔已经删了' && reasons[ghost] === '财务流水不存在' &&
      recategorized.some((one) => one.id === mine[0].id) && recategorized.some((one) => one.id === mine[1].id),
    '成员批量改分类：自己的 2 笔改了；管理员的、已删的、不存在的跳过并说原因；重复的 id 只算一次',
  );
  const wrongKind = await batch(owner.accessToken, { ids: [mine[2].id, transfer.id], action: 'category', categoryId: byKey.income_salary });
  const accountBatch = await batch(member.accessToken, { ids: [mine[0].id, mine[1].id, mine[2].id], action: 'account', accountId: wallet.id });
  const walletAfter = await balanceOf(wallet.id);
  const deleteBatch = await batch(member.accessToken, { ids: [mine[2].id, ownerExpense.id], action: 'delete' });
  const tooMany = await batch(owner.accessToken, { ids: Array.from({ length: 201 }, () => randomUUID()), action: 'delete' });
  const noCategory = await batch(owner.accessToken, { ids: [mine[0].id], action: 'category' });
  assert(
    wrongKind.data.done === 0 && wrongKind.data.skipped.length === 2 &&
      accountBatch.data.done === 3 && walletAfter === round(165.5 - 18) &&
      deleteBatch.data.done === 0 && deleteBatch.data.skipped.length === 2 &&
      tooMany.status === 400 && noCategory.status === 400,
    '收支对不上的跳过；批量改账户 3 笔（零钱 -18）；改过账户的旧 id 再删跳过、管理员的跳过；201 笔 400；改分类不带分类 400',
  );

  console.log('6. 导入的流水：改分类学成规则、同商户还有几笔；改金额后单号跟到新笔，再导仍 0 新增');
  // 单号、「美团」商户名都换成这次独有的：前面的脚本导过同一份样例，同商户的笔会混进来
  const mapId = (id) => id.replace(/42000(\d{23})/g, (_, rest) => `K5${suffix}${rest}`);
  const meituanName = `美团${suffix}-望京店`;
  const statement = mapId(readFileSync(new URL('wechat-sample.csv', FIXTURES), 'utf8')).replaceAll('美团-望京店', meituanName);
  const preview = await upload(member.accessToken, { source: 'wechat', accountId: imported.id }, Buffer.from(statement));
  const committed = await request(`/finance/imports/${preview.data.id}/commit`, member.accessToken, 'POST', { rows: [] });
  const septemberRows = (await request(`/finance/transactions?month=2026-09&limit=200&accountId=${imported.id}`, member.accessToken)).data;
  const meituan = septemberRows.filter((one) => one.merchant === meituanName);
  const firstMeituan = meituan.find((one) => one.amount === 36.8);
  const learned = await patch(member.accessToken, firstMeituan.id, { categoryId: byKey.expense_snacks });
  const meituanRule = (await db.query(
    `SELECT "categoryId", hits FROM finance_merchant_rules WHERE "householdId" = $1 AND pattern = $2 AND kind = 'expense'`,
    [householdId, `美团${suffix}`],
  )).rows[0];
  assert(
    committed.data.imported === 45 && meituan.length === 3 && learned.status === 200 &&
      learned.data.sameMerchantPending === 2 && learned.data.sameMerchantIds.length === 2 &&
      learned.data.sameMerchantIds.every((id) => meituan.some((one) => one.id === id && one.id !== firstMeituan.id)) &&
      meituanRule?.categoryId === byKey.expense_snacks,
    '导入的「美团…-望京店」改成烟酒零食：规则记下归一化后的商户名 → 烟酒零食；同商户还有 2 笔分类不一样，返回它们的 id',
  );
  const followUp = await batch(member.accessToken, { ids: learned.data.sameMerchantIds, action: 'category', categoryId: byKey.expense_snacks });
  const ownerView = await patch(owner.accessToken, firstMeituan.id, { categoryId: byKey.expense_food });
  assert(
    followUp.data.done === 2 && ownerView.data.sameMerchantPending === 2,
    '「同时改另外 2 笔」走批量：都改好；管理员把它改回餐饮时同商户的 2 笔又和它不一样了',
  );
  const pharmacy = septemberRows.find((one) => one.externalId === mapId('42000016721202609300005219699'));
  const cheaper = await patch(member.accessToken, pharmacy.id, { amount: 90 });
  const oldRow = (await db.query('SELECT "externalId", "supersededById" FROM finance_transactions WHERE id = $1', [pharmacy.id])).rows[0];
  const again2 = await upload(member.accessToken, { source: 'wechat', accountId: imported.id }, Buffer.from(statement));
  const againCommit = await request(`/finance/imports/${again2.data.id}/commit`, member.accessToken, 'POST', { rows: [] });
  assert(
    cheaper.status === 200 && cheaper.data.externalId === pharmacy.externalId && cheaper.data.sourceType === 'import' &&
      oldRow.externalId === null && oldRow.supersededById === cheaper.data.id &&
      again2.data.stats.alreadyImported === 52 && againCommit.data.imported === 0,
    '导入的一笔改金额：单号跟到新笔（来源仍是导入），原笔不再占单号；同一份账单再导 52 行全「已导入」、0 新增',
  );

  console.log('7. 列表筛选：关键词、分类、成员、账户');
  const byKeyword = (await request(`/finance/transactions?month=2026-09&limit=200&q=${encodeURIComponent(`美团${suffix}`)}`, member.accessToken)).data;
  const byMember = await list(owner.accessToken, { memberId: member.member.id });
  const byCategory = await list(owner.accessToken, { categoryId: byKey.expense_shopping });
  const percent = await list(owner.accessToken, { q: '%' });
  assert(
    byKeyword.length === 3 && byKeyword.every((one) => one.merchant === meituanName) &&
      byMember.length > 0 && byMember.every((one) => one.actorId === member.member.id) &&
      byCategory.every((one) => one.categoryId === byKey.expense_shopping) &&
      percent.every((one) => `${one.title}${one.merchant ?? ''}${one.note ?? ''}`.includes('%')),
    '按商户名关键词找出那 3 笔；按成员、按分类筛；「%」按字面找，不当通配符',
  );

  // K 收尾：搜索框纯数字按金额精确找，「a-b」按金额范围（反着写也认），不是数字的仍按文字（C2 批 2 起纯数字同时按文字找）
  for (const amount of [4321.09, 4399, 4401]) {
    await record(member.accessToken, {
      type: 'expense', amount, accountId: bank.id, categoryId: byKey.expense_food, title: `金额搜索-${amount}-${suffix}`,
    });
  }
  const exactAmount = await list(owner.accessToken, { q: '4321.09', accountId: bank.id });
  const rangeAmount = await list(owner.accessToken, { q: '4400-4300', accountId: bank.id });
  const textNumber = await list(owner.accessToken, { q: `金额搜索-4399-${suffix}` });
  assert(
    exactAmount.length === 1 && exactAmount[0].amount === 4321.09 &&
      rangeAmount.map((one) => one.amount).sort((a, b) => a - b).join() === '4321.09,4399',
    '搜「4321.09」只出这一笔；搜「4400-4300」出 4300～4400 之间的两笔（反着写也认），4401 不在里面',
  );
  assert(textNumber.length === 1 && textNumber[0].amount === 4399, '带字的照旧按名称找');
  // C2 批 2：纯数字两种都找：金额对上的排前面，名称 / 商户 / 备注里含这串数字的补在后面（「12306」火车票）
  await record(member.accessToken, {
    type: 'expense', amount: 553.5, accountId: bank.id, categoryId: byKey.expense_food, title: `12306 火车票-${suffix}`,
  });
  await record(member.accessToken, {
    type: 'expense', amount: 12306, accountId: bank.id, categoryId: byKey.expense_food, title: `大额-${suffix}`,
  });
  const both = await list(owner.accessToken, { q: '12306', accountId: bank.id });
  assert(
    both.length === 2 && both[0].amount === 12306 && both[1].title === `12306 火车票-${suffix}`,
    '搜「12306」：金额是 12306 的排前面，名称里含 12306 的火车票也找得到',
  );

  console.log('8. 超预算留意不算已删除 / 已改过的');
  const budget = await request('/finance/budgets', owner.accessToken, 'PUT', { categoryId: byKey.expense_repair, month, amount: 40 });
  createdBudgets.push(budget.data);
  const attentionOf = async () =>
    (await request('/today/attention', owner.accessToken)).data.items.filter((one) => one.domain === 'finance' && one.kind === 'budget');
  const repair = (await record(member.accessToken, {
    type: 'expense', amount: 30, accountId: bank.id, categoryId: byKey.expense_repair, title: `修水管-${suffix}`,
  })).data;
  const beforeEdit = await attentionOf();
  const repairBigger = await patch(member.accessToken, repair.id, { amount: 45 });
  const overBudget = await attentionOf();
  await remove(member.accessToken, repairBigger.data.id);
  const afterRemove = await attentionOf();
  assert(
    beforeEdit.length === 0 && overBudget.length === 1 && afterRemove.length === 0,
    '30 没超 40；改成 45 超了出现留意（原来那笔 30 不再算）；删掉后留意消失',
  );

  console.log('9. 账本触发器：只许改不动钱的列，分录不许改，流水不许删');
  const sqlError = async (sql, params) => {
    try {
      await db.query(sql, params);
      return null;
    } catch (error) {
      return error.code;
    }
  };
  const live = (await db.query('SELECT id FROM finance_transactions WHERE id = $1', [memberExpense.id])).rows[0].id;
  const guard = {
    amount: await sqlError('UPDATE finance_transactions SET amount = 1 WHERE id = $1', [live]),
    actor: await sqlError('UPDATE finance_transactions SET "actorId" = $2 WHERE id = $1', [live, owner.member.id]),
    remove: await sqlError('DELETE FROM finance_transactions WHERE id = $1', [live]),
    posting: await sqlError('UPDATE finance_postings SET delta = -1 WHERE "transactionId" = $1', [live]),
    undelete: await sqlError('UPDATE finance_transactions SET "deletedAt" = NULL WHERE id = $1', [coffee.id]),
    title: await sqlError('UPDATE finance_transactions SET title = title WHERE id = $1', [live]),
  };
  const positions = (await db.query('SELECT id, "createdAt" FROM finance_transactions WHERE id = ANY($1::uuid[])', [[lunch.id, bigger.data.id]])).rows;
  assert(
    guard.amount === '55000' && guard.actor === '55000' && guard.remove === '55000' && guard.posting === '55000' &&
      guard.undelete === '55000' && guard.title === null &&
      positions.length === 2 && positions[0].createdAt.getTime() === positions[1].createdAt.getTime(),
    '库里直接改金额、改记账人、删流水、改分录、把删掉的改回来都被触发器拦下；改名称这类允许；改金额另记的新笔沿用原笔的记录时间',
  );

  console.log('\n流水编辑回归测试全部通过');
} finally {
  const cleaner = (await login('爸爸')).accessToken;
  for (const budget of createdBudgets) {
    await request(`/finance/budgets/${budget.id}?expectedVersion=${budget.version}`, cleaner, 'DELETE');
  }
  const accounts = (await request('/finance/accounts?includeInactive=true', cleaner)).data ?? [];
  for (const account of accounts.filter((one) => createdAccounts.includes(one.id) && one.isActive)) {
    await request(`/finance/accounts/${account.id}`, cleaner, 'PATCH', { isActive: false, expectedVersion: account.version });
  }
  if (householdId) await db.query('DELETE FROM finance_merchant_rules WHERE "householdId" = $1', [householdId]);
  await db.end();
}

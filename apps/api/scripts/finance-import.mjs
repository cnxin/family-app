// K1 账单导入黑盒（docs/finance-plan.md §3-K1、§5-K1）：三份样例各导一次（预览行数、标记、确认后流水数与余额）、
// 同一文件再导 0 新增、改分类后相似商户自动命中、通用 CSV 选列（含不选单号）、成员导入与账户 / 文件校验、
// 5 MB / 5000 行上限、预览过期 410、导入记录。
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';
const FIXTURES = new URL('../test/fixtures/finance/', import.meta.url);
const MAX_BYTES = 5 * 1024 * 1024;

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('finance-import.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

const round = (value) => Math.round(value * 100) / 100;
const fixture = (name) => readFileSync(new URL(name, FIXTURES));

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

/** multipart 上传：fields 是文本字段，file 不传就是「没带文件」 */
async function upload(token, fields, file, fileName = 'statement.csv') {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append('file', new Blob([file], { type: 'text/csv' }), fileName);
  const response = await fetch(`${BASE}/finance/imports`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
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
let householdId = null;

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  householdId = owner.member.householdId;
  const categories = (await request('/finance/categories', owner.accessToken)).data;
  const byKey = Object.fromEntries(categories.filter((one) => one.systemKey).map((one) => [one.systemKey, one.id]));
  const newAccount = async (name, type, extra = {}) => {
    const response = await request('/finance/accounts', owner.accessToken, 'POST', {
      name: `${name}-${suffix}`, type, openingBalance: 0, ...extra,
    });
    if (response.status !== 201) throw new Error(`建账户失败 ${response.status} ${JSON.stringify(response.error)}`);
    created.push(response.data.id);
    return response.data;
  };
  const wallet = await newAccount('微信零钱', 'wechat');
  const alipayAccount = await newAccount('支付宝余额', 'alipay');
  const bank = await newAccount('银行流水', 'bank');
  const plain = await newAccount('无单号流水', 'bank');
  // 和样例里信用卡还款的交易对方「招行信用卡」同名：预览会建议转账到这张卡
  const card = await newAccount('招行信用卡', 'credit', { billingDay: 5, dueDay: 25 });
  const balanceOf = async (id) =>
    (await request('/finance/accounts?includeInactive=true', member.accessToken)).data.find((one) => one.id === id).balance;
  const importedCount = async (importId) =>
    Number((await db.query(`SELECT count(*) FROM finance_transactions WHERE "sourceType" = 'import' AND "sourceId" = $1`, [importId])).rows[0].count);
  const row = (preview, rowNo) => preview.rows.find((one) => one.rowNo === rowNo);
  /** 预期余额变化：勾上的行按建议类型算（转账从本账户转出） */
  const delta = (rows) => round(rows.reduce((sum, one) => sum + (one.suggestedType === 'income' ? one.amount : -one.amount), 0));
  const commit = (id, rows = []) => request(`/finance/imports/${id}/commit`, member.accessToken, 'POST', { rows });
  const wechatFile = fixture('wechat-sample.csv');
  const wechatName = '微信支付账单(20260901-20260930).csv';

  console.log('1. 成员导微信账单：预览行数、标记、建议');
  const wechat = await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, wechatFile, wechatName);
  const w = wechat.data;
  assert(
    wechat.status === 201 && w.status === 'previewing' && w.stage === 'ready' && w.fileName === wechatName &&
      w.createdBy.name === '妈妈' && w.totalRows === 52 && w.rows.length === 52 && w.rangeFrom === '2026-09-01' &&
      w.rangeTo === '2026-09-30' && w.stats.total === 52 && w.stats.suggested === 45 && w.stats.alreadyImported === 1 &&
      w.stats.notCounted === 3 && w.stats.refund === 2 && w.stats.closed === 1 && w.stats.suspectedDuplicate === 0 &&
      w.stats.skippedLines === 0 && new Date(w.expiresAt).getTime() - Date.now() > 25 * 60_000,
    '成员上传微信样例（中文文件名原样保留）：52 行，建议导入 45；同一单号第二次出现 1、不计收支 3、退款 2、已关闭 1；预览 30 分钟',
  );
  assert(
    row(w, 22).flags.includes('already_imported') && !row(w, 22).selectable && !row(w, 22).included &&
      row(w, 8).flags.includes('not_counted') && row(w, 8).suggestedType === 'transfer' && row(w, 8).toAccountId === card.id &&
      !row(w, 8).included && row(w, 45).flags.includes('not_counted') && !row(w, 45).included &&
      row(w, 1).status === 'success' && row(w, 1).amount === 36.8 && row(w, 1).included &&
      row(w, 21).flags.includes('refund') && row(w, 40).flags.includes('closed') &&
      row(w, 12).direction === 'income' && row(w, 12).flags.includes('refund') && row(w, 12).suggestedCategoryId === byKey.income_refund,
    '标记：重复单号不能勾；「招行信用卡」还款建议转账并预填同名信用卡；部分退款的那笔消费照常勾上；全额退款、已关闭不勾；退款收入建议「退款」',
  );
  assert(
    row(w, 1).suggestedCategoryId === byKey.expense_food && row(w, 2).suggestedCategoryId === byKey.expense_health &&
      row(w, 3).suggestedCategoryId === byKey.expense_transport && row(w, 4).suggestedCategoryId === byKey.expense_telecom &&
      row(w, 5).suggestedCategoryId === byKey.expense_shopping && row(w, 9).suggestedCategoryId === byKey.expense_utilities &&
      row(w, 49).suggestedType === 'income' && row(w, 49).suggestedCategoryId === byKey.income_red_packet &&
      row(w, 31).suggestedType === 'income' && row(w, 31).suggestedCategoryId === byKey.income_other,
    '默认关键词表：美团→餐饮、药房→医疗、滴滴→交通、联通→通讯、京东→购物、国家电网→水电燃气；红包→红包、转账收入→其他收入',
  );

  console.log('2. 确认：改一行分类、勾上信用卡还款（转账）；流水数、余额对得上，记下商户规则');
  const wechatCommit = await commit(w.id, [
    { rowNo: 2, included: true, categoryId: byKey.expense_childcare },
    { rowNo: 8, included: true },
    // 不能勾的勾了也不导
    { rowNo: 22, included: true },
  ]);
  const expectedWallet = delta(w.rows.filter((one) => one.included || one.rowNo === 8));
  const medicine = (
    await db.query(
      `SELECT "categoryId", merchant, title, note, "sourceType", "idempotencyKey" FROM finance_transactions WHERE "sourceId" = $1 AND "externalId" = $2`,
      [w.id, '42000016721202609300005219699'],
    )
  ).rows[0];
  const rules = (
    await db.query(`SELECT pattern, kind, "categoryId", hits FROM finance_merchant_rules WHERE "householdId" = $1`, [householdId])
  ).rows;
  assert(
    wechatCommit.status === 201 && wechatCommit.data.imported === 46 && wechatCommit.data.duplicates === 1 &&
      wechatCommit.data.skipped === 5 && wechatCommit.data.import.status === 'committed' &&
      wechatCommit.data.import.importedRows === 46 && wechatCommit.data.import.duplicateRows === 1 &&
      wechatCommit.data.import.skippedRows === 5 && (await importedCount(w.id)) === 46 &&
      (await balanceOf(wallet.id)) === expectedWallet && (await balanceOf(card.id)) === 1268.4,
    `导入 46 笔（建议的 45 + 勾上的还款）、重复 1、跳过 5：流水 46 条，零钱余额 ${expectedWallet}，信用卡 +1268.40`,
  );
  assert(
    medicine.categoryId === byKey.expense_childcare && medicine.merchant === '康安大药房-望京店' && medicine.sourceType === 'import' &&
      medicine.title === '康安大药房-望京店' && medicine.note === '药品' &&
      medicine.idempotencyKey === `import:${w.id}:42000016721202609300005219699` &&
      rules.length === 1 && rules[0].pattern === '康安大药房' && rules[0].kind === 'expense' &&
      rules[0].categoryId === byKey.expense_childcare && rules[0].hits === 1,
    '改了分类的那笔按改的记；流水名字是交易对方、备注是商品，带 import:<批次>:<单号>；商户规则记下「康安大药房」→ 改的分类（hits 1）',
  );
  const activity = await db.query(
    `SELECT summary FROM household_activity_logs WHERE "householdId" = $1 AND action = 'finance_import_committed' ORDER BY "createdAt" DESC LIMIT 1`,
    [householdId],
  );
  assert(activity.rows[0]?.summary === '妈妈导入了微信账单 46 笔', '动态里记一条整批的「导入了微信账单 46 笔」，不是 46 条');

  console.log('3. 同一份文件再导一次：整份「以前导过」，确认 0 新增');
  const again = await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, wechatFile, wechatName);
  const againCommit = await commit(again.data.id, [{ rowNo: 1, included: true }]);
  assert(
    again.status === 201 && again.data.stats.alreadyImported === 52 && again.data.stats.suggested === 0 &&
      again.data.rows.every((one) => one.flags.includes('already_imported') && !one.selectable && !one.included) &&
      againCommit.status === 201 && againCommit.data.imported === 0 && againCommit.data.duplicates === 52 &&
      (await importedCount(again.data.id)) === 0 && (await balanceOf(wallet.id)) === expectedWallet,
    '52 行全标「已导入」、都不能勾（上次没导的不计收支 / 退款 / 关闭也算处理过）；硬勾一行确认也是 0 新增，余额不变',
  );

  console.log('4. 支付宝账单（GBK）：学到的规则命中相似商户；手工记过的同日同额标疑似重复');
  const manual = await request('/finance/transactions', member.accessToken, 'POST', {
    type: 'expense', amount: 43.35, accountId: alipayAccount.id, categoryId: byKey.expense_transport,
    title: `手记打车-${suffix}`, occurredOn: '2026-09-27', idempotencyKey: randomUUID(),
  });
  const alipay = await upload(member.accessToken, { source: 'alipay', accountId: alipayAccount.id }, fixture('alipay-sample.csv'));
  const a = alipay.data;
  assert(
    manual.status === 201 && alipay.status === 201 && a.totalRows === 55 && a.stats.skippedLines === 1 &&
      a.stats.suggested === 46 && a.stats.alreadyImported === 1 && a.stats.suspectedDuplicate === 1 &&
      a.stats.notCounted === 4 && a.stats.closed === 2 && a.stats.refund === 2 &&
      row(a, 8).flags.includes('suspected_duplicate') && row(a, 8).selectable && !row(a, 8).included &&
      row(a, 34).flags.includes('already_imported'),
    '支付宝样例：55 行（表尾 1 行跳过），建议 46；重复单号 1、疑似重复 1（手记过的那笔打车）、不计收支 4、关闭 2、退款 2',
  );
  assert(
    [16, 29, 31].every((rowNo) => row(a, rowNo).suggestedCategoryId === byKey.expense_childcare) &&
      row(a, 3).suggestedCategoryId === byKey.expense_food && row(a, 18).suggestedCategoryId === byKey.expense_pet &&
      row(a, 24).suggestedCategoryId === byKey.income_investment && row(a, 9).suggestedCategoryId === byKey.expense_entertainment &&
      row(a, 26).suggestedType === 'transfer' && row(a, 26).toAccountId === card.id,
    '「康安大药房-朝阳店」命中刚学到的规则；美团→餐饮、宠物医院→宠物、余额宝收益→理财、爱奇艺→娱乐；信用卡还款建议转账',
  );
  const badCommits = [
    await commit(a.id, [{ rowNo: 14, included: true, type: 'transfer' }]),
    await commit(a.id, [{ rowNo: 999, included: true }]),
    await commit(a.id, [{ rowNo: 3, included: true, type: 'expense', categoryId: byKey.income_salary }]),
  ];
  assert(
    badCommits[0].status === 400 && badCommits[1].status === 400 && badCommits[2].status === 404 &&
      (await importedCount(a.id)) === 0,
    '记成转账却没有转入账户、预览里没有的行 400，支出配收入分类 404（同记一笔）：整批一笔不写',
  );
  const alipayCommit = await commit(a.id, [{ rowNo: 8, included: true }]);
  const expectedAlipay = round(-43.35 + delta(a.rows.filter((one) => one.included || one.rowNo === 8)));
  assert(
    alipayCommit.status === 201 && alipayCommit.data.imported === 47 && alipayCommit.data.duplicates === 1 &&
      alipayCommit.data.skipped === 7 && (await importedCount(a.id)) === 47 && (await balanceOf(alipayAccount.id)) === expectedAlipay,
    `疑似重复可以手动勾上：导入 47 笔、重复 1、跳过 7；支付宝余额 ${expectedAlipay}（含手记的那笔）`,
  );

  console.log('5. 通用 CSV：先看表头选列，再预览、确认');
  const genericFile = fixture('generic-sample.csv');
  const mapping = { occurredOn: 0, amount: 1, direction: 2, merchant: 3, note: 4, externalId: 5 };
  const generic = await upload(member.accessToken, { source: 'csv', accountId: bank.id }, genericFile, 'bank.csv');
  const g0 = generic.data;
  const mapTo = (id, columnMapping) => request(`/finance/imports/${id}/mapping`, member.accessToken, 'POST', { columnMapping });
  const early = await commit(g0.id);
  const badMappings = [
    await mapTo(g0.id, { ...mapping, amount: 9 }),
    await mapTo(g0.id, { ...mapping, occurredOn: 4 }),
    await mapTo(g0.id, { ...mapping, merchant: null }),
  ];
  const mapped = await mapTo(g0.id, mapping);
  const g = mapped.data;
  assert(
    generic.status === 201 && g0.stage === 'mapping' && g0.headers.join() === '交易日期,金额,收支方向,交易对方,摘要,流水号,余额' &&
      g0.sampleRows.length === 5 && g0.rows.length === 0 && early.status === 409 &&
      badMappings.every((response) => response.status === 400) &&
      mapped.status === 201 && g.stage === 'ready' && g.columnMapping.externalId === 5 && g.totalRows === 53 &&
      g.stats.suggested === 51 && g.stats.alreadyImported === 1 && g.stats.notCounted === 1 &&
      row(g, 48).suggestedType === 'income' && row(g, 48).suggestedCategoryId === byKey.income_salary &&
      row(g, 51).suggestedCategoryId === byKey.income_refund && row(g, 52).flags.includes('not_counted'),
    '上传后先回表头和前 5 行；没选列不能确认（409）；列不存在、日期列选错读不出行、对方没选都 400；选好后 53 行、建议 51',
  );
  const genericCommit = await commit(g.id);
  assert(
    genericCommit.status === 201 && genericCommit.data.imported === 51 && genericCommit.data.duplicates === 1 &&
      (await balanceOf(bank.id)) === delta(g.rows.filter((one) => one.included)),
    '确认导入 51 笔，银行流水账户余额对得上',
  );
  const genericAgain = await upload(member.accessToken, { source: 'csv', accountId: bank.id }, genericFile, 'bank.csv');
  const genericAgainMapped = await mapTo(genericAgain.data.id, mapping);
  const discarded = await request(`/finance/imports/${genericAgain.data.id}`, member.accessToken, 'DELETE');
  const afterDiscard = await request(`/finance/imports/${genericAgain.data.id}`, member.accessToken);
  assert(
    genericAgainMapped.data.stats.alreadyImported === 53 && genericAgainMapped.data.stats.suggested === 0 &&
      discarded.status === 200 && discarded.data.status === 'discarded' && afterDiscard.status === 200 &&
      afterDiscard.data.stage === 'done' && afterDiscard.data.rows.length === 0 &&
      (await commit(genericAgain.data.id)).status === 409,
    '同一份通用 CSV（选了单号列）再导：53 行全「已导入」；放弃后只剩记录、预览清空，再确认 409',
  );
  const noIdMapping = { ...mapping, externalId: null };
  const plainFirst = await upload(member.accessToken, { source: 'csv', accountId: plain.id }, genericFile, 'bank.csv');
  const plainFirstMapped = await mapTo(plainFirst.data.id, noIdMapping);
  const plainCommit = await commit(plainFirst.data.id);
  const plainAgain = await upload(member.accessToken, { source: 'csv', accountId: plain.id }, genericFile, 'bank.csv');
  const plainAgainMapped = await mapTo(plainAgain.data.id, noIdMapping);
  await request(`/finance/imports/${plainAgain.data.id}`, member.accessToken, 'DELETE');
  assert(
    plainFirstMapped.data.stats.alreadyImported === 0 && plainFirstMapped.data.stats.suggested === 52 &&
      plainCommit.data.imported === 52 && plainAgainMapped.data.stats.suspectedDuplicate === 52 &&
      plainAgainMapped.data.stats.suggested === 0 && plainAgainMapped.data.stats.alreadyImported === 0,
    '不选单号列：不做单号去重（重复流水号两行都导，52 笔）；同一份再导时 52 行都标「疑似重复」、默认不勾',
  );

  console.log('6. 账户与文件校验');
  const inactive = await newAccount('停用账户', 'bank');
  await request(`/finance/accounts/${inactive.id}`, owner.accessToken, 'PATCH', { isActive: false, expectedVersion: inactive.version });
  const invalid = {
    missingAccount: await upload(member.accessToken, { source: 'wechat', accountId: randomUUID() }, wechatFile),
    inactiveAccount: await upload(member.accessToken, { source: 'wechat', accountId: inactive.id }, wechatFile),
    noFile: await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }),
    badSource: await upload(member.accessToken, { source: 'bank', accountId: wallet.id }, wechatFile),
    zip: await upload(member.accessToken, { source: 'alipay', accountId: wallet.id }, Buffer.from('PK\x03\x04'), '支付宝账单.zip'),
    excel: await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, Buffer.from('x'), '微信账单.xlsx'),
    wrongSource: await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, fixture('alipay-sample.csv')),
    anonymous: await upload(null, { source: 'wechat', accountId: wallet.id }, wechatFile),
  };
  assert(
    invalid.missingAccount.status === 404 && invalid.inactiveAccount.status === 404 && invalid.noFile.status === 400 &&
      invalid.badSource.status === 400 && invalid.zip.status === 400 && invalid.zip.error.message.includes('先解压') &&
      invalid.excel.status === 400 && invalid.excel.error.message.includes('另存为 csv') &&
      invalid.wrongSource.status === 400 && invalid.wrongSource.error.message.includes('不像是微信导出的账单') &&
      invalid.anonymous.status === 401,
    '不存在 / 停用的账户 404；没带文件、来源不对 400；zip 提示先解压、Excel 提示另存为 csv；支付宝文件选成微信说清楚；未登录 401',
  );

  console.log('7. 上限：5 MB、5000 行');
  const tooBig = await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, Buffer.alloc(MAX_BYTES + 1, 0x20));
  const muchTooBig = await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, Buffer.alloc(6 * MAX_BYTES / 5, 0x20));
  const wechatLines = wechatFile.toString('utf8').split(/\r?\n/);
  const headerLine = wechatLines.findIndex((line) => line.startsWith('交易时间'));
  const wechatRows = (count) =>
    Buffer.from(
      [
        ...wechatLines.slice(0, headerLine + 1),
        ...Array.from(
          { length: count },
          (_, index) => `2026-08-15 12:00:00,商户消费,美团-望京店,"美团订单",支出,¥10.00,零钱,支付成功,${43000000000000 + index}\t,,"/"`,
        ),
      ].join('\n'),
    );
  const fiveThousand = await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, wechatRows(5000));
  if (fiveThousand.data) await request(`/finance/imports/${fiveThousand.data.id}`, member.accessToken, 'DELETE');
  const overRows = await upload(member.accessToken, { source: 'wechat', accountId: wallet.id }, wechatRows(5001));
  const genericOver = await upload(
    member.accessToken,
    { source: 'csv', accountId: bank.id },
    Buffer.from(['日期,金额,对方', ...Array.from({ length: 5001 }, (_, index) => `2026-08-15,${index + 1},某商户`)].join('\n')),
  );
  assert(
    tooBig.status === 413 && tooBig.error.message.includes('5 MB') && muchTooBig.status === 413 && muchTooBig.error.message.includes('5 MB') &&
      fiveThousand.status === 201 && fiveThousand.data.stats.total === 5000 && fiveThousand.data.stats.suggested === 5000 &&
      overRows.status === 400 && overRows.error.message.includes('5000') &&
      genericOver.status === 400 && genericOver.error.message.includes('5000'),
    '超过 5 MB 413（刚过线、远超都是中文提示）；5000 行能预览，5001 行 400（支付宝 / 微信与通用 CSV 都拦）',
  );

  console.log('8. 预览 30 分钟过期：再看、选列、确认都 410，放弃可以；上传新文件顺手收掉过期的预览');
  const stale = await upload(member.accessToken, { source: 'csv', accountId: bank.id }, genericFile, 'stale.csv');
  const forgotten = await upload(member.accessToken, { source: 'csv', accountId: bank.id }, genericFile, 'forgotten.csv');
  await db.query(`UPDATE finance_imports SET "expiresAt" = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [
    [stale.data.id, forgotten.data.id],
  ]);
  const staleGet = await request(`/finance/imports/${stale.data.id}`, member.accessToken);
  const staleMap = await mapTo(stale.data.id, mapping);
  const staleCommit = await commit(stale.data.id);
  const staleDiscard = await request(`/finance/imports/${stale.data.id}`, member.accessToken, 'DELETE');
  const fresh = await upload(member.accessToken, { source: 'csv', accountId: bank.id }, genericFile, 'fresh.csv');
  await request(`/finance/imports/${fresh.data.id}`, member.accessToken, 'DELETE');
  const swept = (await db.query('SELECT status, preview FROM finance_imports WHERE id = $1', [forgotten.data.id])).rows[0];
  assert(
    staleGet.status === 410 && staleGet.error.message.includes('过期') && staleMap.status === 410 && staleCommit.status === 410 &&
      staleDiscard.status === 200 && staleDiscard.data.status === 'discarded' &&
      swept.status === 'discarded' && swept.preview === null,
    '过期的预览：看、选列、确认都 410，放弃照常；之后再上传时，过期没人管的预览记成放弃、解析结果清空',
  );

  console.log('9. 导入记录');
  const list = await request('/finance/imports', member.accessToken);
  const listed = list.data.find((one) => one.id === w.id);
  assert(
    list.status === 200 && listed.status === 'committed' && listed.source === 'wechat' && listed.account.name === wallet.name &&
      listed.importedRows === 46 && listed.duplicateRows === 1 && listed.skippedRows === 5 && listed.createdBy.name === '妈妈' &&
      list.data.some((one) => one.id === again.data.id && one.importedRows === 0 && one.duplicateRows === 52) &&
      list.data.some((one) => one.id === genericAgain.data.id && one.status === 'discarded') &&
      !list.data.some((one) => one.status === 'previewing'),
    '导入记录列出已确认 / 已放弃的批次（来源、账户、导入 / 跳过 / 重复数、谁导的），预览中的不列',
  );

  console.log('\n账单导入回归测试全部通过');
} finally {
  // 账本不可删：本脚本建的账户停用就行；学到的商户规则删掉，免得影响后面的脚本
  const cleaner = (await login('爸爸')).accessToken;
  const accounts = (await request('/finance/accounts?includeInactive=true', cleaner)).data ?? [];
  for (const account of accounts.filter((one) => created.includes(one.id) && one.isActive)) {
    await request(`/finance/accounts/${account.id}`, cleaner, 'PATCH', { isActive: false, expectedVersion: account.version });
  }
  if (householdId) await db.query('DELETE FROM finance_merchant_rules WHERE "householdId" = $1', [householdId]);
  await db.end();
}

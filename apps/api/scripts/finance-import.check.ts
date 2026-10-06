// K1 账单导入解析器的单测（与 kernel-units.check.ts 一样用 ts-node 跑、node:assert 断言，不碰数据库）。
// run-api-tests.mjs 全量模式里执行；单独跑：node -r ts-node/register scripts/finance-import.check.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeText, decodeUnknown, parseCsv } from '../src/finance/import/csv';
import { IMPORT_MAX_ROWS, STATEMENT_FORMATS } from '../src/finance/import/import-formats';
import {
  parseAmount,
  parseDate,
  parseGenericRows,
  parseStatement,
  readGenericTable,
  StatementFormatError,
  validateGenericMapping,
} from '../src/finance/import/import-parser';
import { normalizeMerchant, suggestCategory } from '../src/finance/import/merchant-rules';

const FIXTURES = join(__dirname, '../test/fixtures/finance');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const count = <T>(rows: readonly T[], test: (row: T) => boolean) => rows.filter(test).length;

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('CSV 与解码');
check('GBK 解码、去 BOM；通用 CSV 先试 UTF-8、不行再 GBK', () => {
  const gbk = Buffer.from([0xbd, 0xbb, 0xd2, 0xd7, 0xca, 0xb1, 0xbc, 0xe4]);
  assert.equal(decodeText(gbk, 'gbk'), '交易时间');
  assert.equal(decodeText(Buffer.from('﻿交易时间', 'utf8'), 'utf-8'), '交易时间');
  assert.deepEqual(decodeUnknown(gbk), { text: '交易时间', encoding: 'gbk' });
  assert.equal(decodeUnknown(Buffer.from('﻿日期,金额', 'utf8')).encoding, 'utf-8');
});
check('引号里的逗号、换行、两个双引号；\\r\\n 与 \\n 都认', () => {
  assert.deepEqual(parseCsv('a,"b,c","d\n""e"""\r\nf,,g\n'), [['a', 'b,c', 'd\n"e"'], ['f', '', 'g']]);
});
check('日期与金额：多种写法、带 ¥ / 逗号 / 负号；看不懂的返回 null', () => {
  assert.equal(parseDate('2026-09-30 21:15:03'), '2026-09-30');
  assert.equal(parseDate('2026/9/3 8:01'), '2026-09-03');
  assert.equal(parseDate('2026年9月3日'), '2026-09-03');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('昨天'), null);
  assert.equal(parseAmount('¥1,234.50'), 1234.5);
  assert.equal(parseAmount('￥12'), 12);
  assert.equal(parseAmount(' -35.5 '), -35.5);
  assert.equal(parseAmount('+8.8'), 8.8);
  assert.equal(parseAmount('abc'), null);
});

console.log('支付宝样例（GBK）');
check('表头前的说明文字跳过、表尾分隔行跳过；55 行全部读出，单号去掉尾部制表符', () => {
  const parsed = parseStatement(fixture('alipay-sample.csv'), 'alipay');
  assert.equal(parsed.rows.length, 55);
  assert.ok(parsed.skipped.some((one) => one.reason.startsWith('列数不足')));
  assert.equal(parsed.rangeFrom, '2026-09-01');
  assert.equal(parsed.rangeTo, '2026-09-30');
  assert.ok(parsed.rows.every((row) => row.externalId && row.externalId === row.externalId.trim() && !row.externalId.includes('\t')));
  assert.deepEqual(parsed.rows.map((row) => row.rowNo), parsed.rows.map((_, index) => index + 1));
});
check('收/支与状态：收入 3、不计收支 4（余额宝转入 / 信用卡还款 / 亲友转账 / 退款）、交易关闭 2、退款成功 2', () => {
  const { rows } = parseStatement(fixture('alipay-sample.csv'), 'alipay');
  assert.equal(count(rows, (row) => row.direction === 'income'), 3);
  assert.equal(count(rows, (row) => row.direction === 'not_counted'), 4);
  assert.equal(count(rows, (row) => row.direction === 'expense'), 48);
  assert.equal(count(rows, (row) => row.status === 'closed'), 2);
  assert.equal(count(rows, (row) => row.status === 'refund'), 2);
  assert.ok(rows.some((row) => row.merchant === '招行信用卡' && row.title === '信用卡还款' && row.direction === 'not_counted'));
});
check('同一单号出现两次（解析器照实给出，去重留给预览）；商户名带门店后缀', () => {
  const { rows } = parseStatement(fixture('alipay-sample.csv'), 'alipay');
  const ids = rows.map((row) => row.externalId);
  assert.equal(new Set(ids).size, rows.length - 1);
  assert.ok(rows.some((row) => row.merchant.startsWith('美团-')) && rows.some((row) => row.merchant === '滴滴出行-快车'));
  assert.ok(rows.every((row) => row.platformCategory && row.payMethod !== undefined));
});

console.log('微信样例（UTF-8 带 BOM）');
check('BOM、金额带 ¥、带引号的「¥1,268.40」；52 行', () => {
  const { rows } = parseStatement(fixture('wechat-sample.csv'), 'wechat');
  assert.equal(rows.length, 52);
  assert.ok(rows.some((row) => row.amount === 1268.4 && row.merchant === '招行信用卡'));
  assert.ok(rows.every((row) => Number.isFinite(row.amount) && row.amount > 0));
});
check('「/」是不计收支（零钱通 / 提现 / 信用卡还款）；已全额退款算退款，「已退款(¥5.00)」部分退款仍算成功；已关闭', () => {
  const { rows } = parseStatement(fixture('wechat-sample.csv'), 'wechat');
  assert.equal(count(rows, (row) => row.direction === 'not_counted'), 3);
  assert.equal(count(rows, (row) => row.direction === 'income'), 3);
  assert.equal(count(rows, (row) => row.status === 'refund'), 2);
  assert.equal(count(rows, (row) => row.status === 'closed'), 1);
  assert.equal(rows.find((row) => row.amount === 36.8)?.status, 'success');
});
check('列顺序打乱照样对得上；缺列报出缺哪列、认哪些名字；找不到表头报错', () => {
  const shuffled = '﻿说明一行\n交易单号,金额(元),交易对方,当前状态,收/支,交易时间\n42001,¥12.00,美团-望京店,支付成功,支出,2026-09-01 10:00:00\n';
  const [row] = parseStatement(Buffer.from(shuffled, 'utf8'), 'wechat').rows;
  assert.deepEqual([row.externalId, row.amount, row.merchant, row.direction, row.occurredOn], ['42001', 12, '美团-望京店', 'expense', '2026-09-01']);
  assert.throws(
    () => parseStatement(Buffer.from('交易时间,交易对方,收/支,金额(元),当前状态\n2026-09-01,美团,支出,¥1,支付成功\n', 'utf8'), 'wechat'),
    (error: unknown) => error instanceof StatementFormatError && /交易单号（认的列名：交易单号）/.test(error.message),
  );
  assert.throws(() => parseStatement(Buffer.from('日期,金额\n2026-09-01,1\n', 'utf8'), 'alipay'), /找不到表头/);
});
check('表尾汇总行（列数不足）跳过；金额 / 日期看不懂的行跳过并记下行号', () => {
  const text = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n' +
    '2026-09-01 10:00:00,商户消费,美团,订单,支出,¥12.00,零钱,支付成功,1\n' +
    '2026-09-02 10:00:00,商户消费,美团,订单,支出,一百,零钱,支付成功,2\n' +
    '共2笔记录\n';
  const parsed = parseStatement(Buffer.from(text, 'utf8'), 'wechat');
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.skipped, [{ line: 3, reason: '金额看不懂' }, { line: 4, reason: '列数不足（表尾汇总行之类）' }]);
});
check(`超过 ${IMPORT_MAX_ROWS} 行报错`, () => {
  const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n';
  const line = (index: number) => `2026-09-01 10:00:00,商户消费,美团,订单,支出,¥1.00,零钱,支付成功,${index}\n`;
  const big = header + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, index) => line(index)).join('');
  assert.throws(() => parseStatement(Buffer.from(big, 'utf8'), 'wechat'), /超过 5000 行/);
  assert.throws(() => readGenericTable(Buffer.from(big, 'utf8')), /超过 5000 行/);
});

console.log('通用 CSV');
check('读出表头让用户选列；按选的列转换，收支「转账」算不计收支；不选收支按正负', () => {
  const table = readGenericTable(fixture('generic-sample.csv'));
  assert.deepEqual(table.headers, ['交易日期', '金额', '收支方向', '交易对方', '摘要', '流水号', '余额']);
  const mapping = { occurredOn: 0, amount: 1, direction: 2, merchant: 3, note: 4, externalId: 5 };
  assert.equal(validateGenericMapping(table.headers, mapping), null);
  const { rows } = parseGenericRows(table, mapping);
  assert.equal(rows.length, 53);
  assert.equal(count(rows, (row) => row.direction === 'not_counted'), 1);
  assert.equal(count(rows, (row) => row.direction === 'income'), 3);
  assert.ok(rows.every((row) => /^2026-09-\d\d$/.test(row.occurredOn) && row.externalId?.startsWith('LS')));
  const signed = readGenericTable(Buffer.from('日期,金额,对方\n2026-09-01,-12.5,美团\n2026-09-02,100,张三\n', 'utf8'));
  const unsigned = parseGenericRows(signed, { occurredOn: 0, amount: 1, direction: null, merchant: 2, note: null, externalId: null });
  assert.deepEqual(unsigned.rows.map((row) => [row.direction, row.amount, row.externalId, row.title]), [['expense', 12.5, null, '美团'], ['income', 100, null, '张三']]);
  assert.match(validateGenericMapping(signed.headers, { occurredOn: 0, amount: null, direction: null, merchant: 2, note: null, externalId: null }) ?? '', /金额/);
  assert.match(validateGenericMapping(signed.headers, { occurredOn: 0, amount: 1, direction: null, merchant: 9, note: null, externalId: null }) ?? '', /对方/);
});

console.log('商户名归一化与分类建议');
check('去「-」后缀、括号、门店编号、空白，转小写；「-」前不足两个字不切', () => {
  assert.equal(normalizeMerchant('美团-望京SOHO店'), '美团');
  assert.equal(normalizeMerchant('滴滴出行-快车'), '滴滴出行');
  assert.equal(normalizeMerchant('星巴克(国贸店)'), '星巴克');
  assert.equal(normalizeMerchant('全家便利店#1024'), '全家便利店');
  assert.equal(normalizeMerchant('某某超市12号店'), '某某超市');
  assert.equal(normalizeMerchant(' JD 京东 '), 'jd京东');
  assert.equal(normalizeMerchant('7-ELEVEN'), '7-eleven');
  assert.equal(normalizeMerchant('康安大药房－朝阳店'), '康安大药房');
});
check('建议顺序：家庭规则（长的优先、对得上收支）→ 内置关键词 → 平台分类 → 其他', () => {
  const kinds: Record<string, 'expense' | 'income'> = { travel: 'expense', food: 'expense', bonus: 'income', exact: 'expense' };
  const kindOf = (id: string) => kinds[id] ?? null;
  const platform = STATEMENT_FORMATS.alipay.platformCategories;
  const base = { title: '', platformCategory: null } as const;
  const learned = [
    { pattern: '滴滴', categoryId: 'travel', hits: 1 },
    { pattern: '滴滴出行', categoryId: 'exact', hits: 0 },
    { pattern: '美团', categoryId: 'bonus', hits: 9 },
  ];
  assert.deepEqual(suggestCategory({ ...base, merchant: '滴滴出行-专车', kind: 'expense' }, learned, kindOf, platform), { categoryId: 'exact' });
  assert.deepEqual(suggestCategory({ ...base, merchant: '美团-望京店', kind: 'expense' }, learned, kindOf, platform), { systemKey: 'expense_food' });
  assert.deepEqual(suggestCategory({ ...base, merchant: '国家电网', kind: 'expense' }, [], kindOf, platform), { systemKey: 'expense_utilities' });
  assert.deepEqual(suggestCategory({ ...base, merchant: '某某服装店', kind: 'expense', platformCategory: '服饰装扮' }, [], kindOf, platform), { systemKey: 'expense_clothing' });
  assert.deepEqual(suggestCategory({ ...base, merchant: '某某', kind: 'expense' }, [], kindOf, platform), { systemKey: 'expense_other' });
  assert.deepEqual(suggestCategory({ merchant: '美团', title: '退款-美团订单', kind: 'income', platformCategory: null }, [], kindOf, platform), { systemKey: 'income_refund' });
  assert.deepEqual(suggestCategory({ ...base, merchant: '张三', kind: 'income' }, [], kindOf, platform), { systemKey: 'income_other' });
});

console.log(`账单导入解析单测全部通过（${passed} 条）`);

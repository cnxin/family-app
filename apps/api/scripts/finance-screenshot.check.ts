// K2 截图记账的纯函数单测（和 finance-import.check.ts 同一写法：ts-node 跑、node:assert 断言）：
// 付款方式 → 账户的猜测规则表、模型回复的解析、交易时间 → 记账日期、按文件头认图片。
// run-api-tests.mjs 全量模式里执行；单独跑：node -r ts-node/register scripts/finance-screenshot.check.ts
import assert from 'node:assert/strict';
import {
  guessAccount,
  orphanScreenshots,
  ORPHAN_SCREENSHOT_AGE_MS,
  normalizeOccurredOn,
  parseScreenshotReply,
  screenshotTitle,
  sniffScreenshot,
  type GuessableAccount,
} from '../src/finance/finance-screenshot.rules';

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const account = (id: string, name: string, type: GuessableAccount['type'], isActive = true): GuessableAccount => ({
  id,
  name,
  type,
  isActive,
});
const FAMILY = [
  account('cash', '现金', 'cash'),
  account('alipay', '支付宝', 'alipay'),
  account('wechat', '微信零钱', 'wechat'),
  account('cmb-credit', '招商银行信用卡', 'credit'),
  account('ccb-credit', '建设银行信用卡', 'credit'),
  account('icbc', '工商银行储蓄卡', 'bank'),
  account('old-wechat', '旧微信', 'wechat', false),
];

check('付款方式 → 账户：规则表', () => {
  const table: [string | null, string | null][] = [
    ['花呗', 'alipay'],
    ['余额', 'alipay'],
    ['余额宝', 'alipay'],
    ['支付宝', 'alipay'],
    ['零钱', 'wechat'],
    ['零钱通', 'wechat'],
    ['微信支付', 'wechat'],
    ['招商银行信用卡(1234)', 'cmb-credit'],
    ['建设银行信用卡', 'ccb-credit'],
    // 钱是从信用卡出的：银行 / 信用卡排在微信之前
    ['微信支付-招商银行信用卡', 'cmb-credit'],
    // 两张信用卡、没写哪家银行：不猜
    ['信用卡', null],
    ['工商银行储蓄卡(8888)', 'icbc'],
    ['借记卡', 'icbc'],
    // 写了银行却没有这家的账户：不猜
    ['交通银行信用卡', null],
    ['现金', 'cash'],
    ['云闪付', null],
    ['', null],
    [null, null],
  ];
  for (const [method, expected] of table) assert.equal(guessAccount(method, FAMILY), expected, String(method));
});

check('付款方式 → 账户：同类只有一个就选它，多个按名字挑，停用的不算', () => {
  const two = [account('a1', '爸爸的支付宝', 'alipay'), account('a2', '妈妈的支付宝', 'alipay')];
  assert.equal(guessAccount('花呗', two), null);
  assert.equal(guessAccount('支付宝-妈妈的支付宝', two), 'a2');
  assert.equal(guessAccount('信用卡', [account('only', '我的信用卡', 'credit')]), 'only');
  assert.equal(guessAccount('零钱', [account('w', '微信', 'wechat', false)]), null);
  // 账户名本身就写在付款方式里：哪怕类型不对也按名字来（家里把花呗记成了信用卡账户）
  assert.equal(guessAccount('花呗', [account('hb', '花呗', 'credit'), account('ali', '支付宝', 'alipay')]), 'hb');
});

check('模型回复解析：容忍代码块与多余的字；不是 JSON、金额或收支不对都算没认出来', () => {
  const reply = { amount: 36.5, direction: 'expense', merchant: '美团', occurredAt: '2026-10-09 12:30', payMethod: '花呗', note: null };
  assert.deepEqual(parseScreenshotReply(JSON.stringify(reply)), reply);
  assert.equal(parseScreenshotReply('```json\n' + JSON.stringify(reply) + '\n```')?.amount, 36.5);
  assert.equal(parseScreenshotReply(`识别结果如下：${JSON.stringify({ ...reply, amount: '¥1,280.00' })}`)?.amount, 1280);
  assert.equal(parseScreenshotReply(JSON.stringify({ ...reply, amount: 12.345 }))?.amount, 12.35);
  assert.equal(parseScreenshotReply('这张图看不太清楚'), null);
  assert.equal(parseScreenshotReply('{"amount": null}'), null);
  assert.equal(parseScreenshotReply(JSON.stringify({ ...reply, direction: 'transfer' })), null);
  assert.equal(parseScreenshotReply(JSON.stringify({ ...reply, amount: -3 })), null);
  assert.equal(parseScreenshotReply('{"amount": 1, '), null);
});

check('交易时间 → 记账日期', () => {
  const today = '2026-10-10';
  assert.equal(normalizeOccurredOn('2026-10-09 12:30', today), '2026-10-09');
  assert.equal(normalizeOccurredOn('2026/10/09', today), '2026-10-09');
  assert.equal(normalizeOccurredOn('2026年10月9日 12:30', today), '2026-10-09');
  assert.equal(normalizeOccurredOn('2026-10-09T04:30:00Z', today), '2026-10-09');
  assert.equal(normalizeOccurredOn('10月9日 12:30', today), '2026-10-09');
  // 没写年份、按今年算在明天之后：当去年
  assert.equal(normalizeOccurredOn('12-31', today), '2025-12-31');
  assert.equal(normalizeOccurredOn('2026-02-30', today), null);
  assert.equal(normalizeOccurredOn('昨天', today), null);
  assert.equal(normalizeOccurredOn(null, today), null);
});

check('账目名称：商户名清洗后用，没有用备注，都没有「截图记账」', () => {
  assert.equal(screenshotTitle('美团外卖', '午饭'), '美团外卖');
  assert.equal(screenshotTitle(null, '午饭'), '午饭');
  assert.equal(screenshotTitle('  ', null), '截图记账');
});

check('按文件头认图片，不信声明的类型', () => {
  assert.deepEqual(sniffScreenshot(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), { ext: '.jpg', mime: 'image/jpeg' });
  assert.deepEqual(sniffScreenshot(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), { ext: '.png', mime: 'image/png' });
  assert.deepEqual(sniffScreenshot(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), { ext: '.webp', mime: 'image/webp' });
  assert.equal(sniffScreenshot(Buffer.from('GIF89a')), null);
  assert.equal(sniffScreenshot(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

check('孤儿截图：只删超过 24 小时、没有流水引用的；不认的文件名不碰；最旧的先删、按上限截断', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const old = now - ORPHAN_SCREENSHOT_AGE_MS - 60_000;
  const referencedName = '11111111-1111-4111-8111-111111111111.png';
  const freshName = '22222222-2222-4222-8222-222222222222.jpg';
  const orphanName = '33333333-3333-4333-8333-333333333333.webp';
  const olderOrphan = '44444444-4444-4444-8444-444444444444.png';
  const files = [
    { name: referencedName, mtimeMs: old },
    { name: freshName, mtimeMs: now - 60_000 },
    { name: orphanName, mtimeMs: old },
    { name: olderOrphan, mtimeMs: old - 3_600_000 },
    { name: 'notes.txt', mtimeMs: old },
  ];
  const referenced = new Set([referencedName]);
  assert.deepEqual(orphanScreenshots(files, referenced, now), [olderOrphan, orphanName]);
  assert.deepEqual(orphanScreenshots(files, referenced, now, 1), [olderOrphan]);
  assert.deepEqual(orphanScreenshots(files, referenced, now, 0), []);
  assert.deepEqual(orphanScreenshots(files.slice(0, 2), referenced, now), []);
});

console.log(`截图记账单测通过：${passed} 项`);

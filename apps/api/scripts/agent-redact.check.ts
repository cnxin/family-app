// J4.3 单测（kernel-units.check.ts 写法）：发给云端模型前的脱敏 redactForModel。
// 每类各 3 条正例、3 条反例；金额、日期、地址、位置名不动。run-api-tests.mjs 全量模式里执行；
// 单独跑：node -r ts-node/register scripts/agent-redact.check.ts
import assert from 'node:assert/strict';
import { redactForModel, redactionNames, type RedactionContext } from '../src/agent/redact';

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const none: RedactionContext = { names: [] };
const family: RedactionContext = {
  names: [
    { name: '王小明', alias: '成员3' },
    { name: '爸爸', alias: '成员1' },
    { name: '妈妈', alias: '成员2' },
  ],
};
const same = (text: string, context = none) => assert.equal(redactForModel(text, context), text);

console.log('手机号（11 位、1 开头）');
check('正例：保留前 2 后 2', () => {
  assert.equal(redactForModel('打 13800138000', none), '打 13*******00');
  assert.equal(redactForModel('电话:19912345678。', none), '电话:19*******78。');
  assert.equal(redactForModel('{"phone":"15011112222"}', none), '{"phone":"15*******22"}');
});
check('反例：已打码的、位数不对的、2 开头的不动', () => {
  same('138****1234');
  same('1380013800');
  same('23800138000');
});

console.log('车牌（省简称 + 字母 + 5～6 位）');
check('正例', () => {
  assert.equal(redactForModel('车牌浙AGS6398', none), '车牌浙A****98');
  assert.equal(redactForModel('粤B12345 停在楼下', none), '粤B***45 停在楼下');
  assert.equal(redactForModel('京AD12345（新能源）', none), '京A****45（新能源）');
});
check('反例：没有省简称、字母是 I / O、位数太少', () => {
  same('车牌 AGS6398');
  same('浙IGS6398');
  same('浙A1234');
});

console.log('身份证样式（18 位）');
check('正例', () => {
  assert.equal(redactForModel('身份证 110101199003071234', none), '身份证 11**************34');
  assert.equal(redactForModel('11010119900307123X', none), '11**************3X');
  assert.equal(redactForModel('id=44030619851210002x;', none), 'id=44**************2x;');
});
check('反例：15 位旧证号、带空格分组的、夹在字母里的（17 位纯数字归银行卡样式）', () => {
  same('110101900307123');
  same('110101 19900307 1234');
  same('A110101199003071234B');
});

console.log('银行卡样式（16～19 位数字）');
check('正例', () => {
  assert.equal(redactForModel('卡号 6222020200112233', none), '卡号 62************33');
  assert.equal(redactForModel('6217000010001234567', none), '62***************67');
  assert.equal(redactForModel('尾号是 62258801234567891 的卡', none), '尾号是 62*************91 的卡');
});
check('反例：15 位、20 位、带空格的', () => {
  same('622202020011223');
  same('62220202001122334455');
  same('6222 0202 0011 2233');
});

console.log('成员真名');
check('正例：真名换成称呼，长名先换', () => {
  assert.equal(redactForModel('妈妈说今晚吃鱼', family), '成员2说今晚吃鱼');
  assert.equal(redactForModel('{"assigneeName":"爸爸"}', family), '{"assigneeName":"成员1"}');
  assert.equal(redactForModel('王小明和妈妈', family), '成员3和成员2');
});
check('反例：不是成员的名字、一个字的不换', () => {
  same('王阿姨来做客', family);
  same('小明天去', family);
  same('妈', family);
});

console.log('访客名（第四批收尾）');
check('替换表：成员 → 成员N、访客 → 访客N；单字不换；同名成员优先；统一按长度降序', () => {
  const names = redactionNames(['爸爸', '妈', '王小明'], ['小明', '外婆', '爸爸', '王', '李阿姨家的小明']);
  assert.deepEqual(names, [
    { name: '李阿姨家的小明', alias: '访客5' },
    { name: '王小明', alias: '成员3' },
    { name: '爸爸', alias: '成员1' },
    { name: '小明', alias: '访客1' },
    { name: '外婆', alias: '访客2' },
  ]);
});
check('正文里成员名、访客名、同名、单字名一起出现', () => {
  const context: RedactionContext = { names: redactionNames(['爸爸', '妈', '王小明'], ['小明', '外婆', '爸爸', '王']) };
  assert.equal(
    redactForModel('王小明和小明周六来，外婆也来；爸爸接，妈不去，王老师请假', context),
    '成员3和访客1周六来，访客2也来；成员1接，妈不去，王老师请假',
  );
  assert.equal(
    redactForModel('{"guests":["外婆","小明"],"host":"爸爸"}', context),
    '{"guests":["访客2","访客1"],"host":"成员1"}',
  );
});

console.log('不动的内容');
check('金额、日期、时间、地址、位置名、UUID 原样', () => {
  same('10 月 9 日花了 38.5 元，余额 12345.67');
  same('2026-10-09T08:30:00.000Z');
  same('上海市浦东新区世纪大道 100 号 / 客厅 / 电视柜');
  same('11111111-1111-4111-8111-111111111111');
  same('金额 999999999999.99');
});

console.log(`脱敏单测通过：${passed} 项`);

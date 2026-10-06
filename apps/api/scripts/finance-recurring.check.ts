// K3 周期账单日期推算的单测（与 kernel-units.check.ts 一样用 ts-node 跑、node:assert 断言）。
// run-api-tests.mjs 全量模式里执行；单独跑：node -r ts-node/register scripts/finance-recurring.check.ts
import assert from 'node:assert/strict';
import {
  firstOccurrenceOnOrAfter,
  monthlyAverage,
  nextOccurrenceAfter,
  occurrenceAt,
  postingCutoff,
  recurringIdempotencyKey,
} from '../src/finance/finance-recurring.schedule';

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('周期账单日期推算');
check('月付取第一次应付日的「日」，短月按月末，下一期不会被上一期的月末带偏', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 13].map((index) => occurrenceAt('2026-01-31', 'monthly', index)),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2027-02-28'],
  );
  assert.equal(occurrenceAt('2027-12-31', 'monthly', 2), '2028-02-29');
});
check('周付按 7 天、季付按 3 个月、年付 2 月 29 日在平年落 28 日', () => {
  assert.equal(occurrenceAt('2026-12-28', 'weekly', 1), '2027-01-04');
  assert.equal(occurrenceAt('2026-11-30', 'quarterly', 1), '2027-02-28');
  assert.equal(occurrenceAt('2028-02-29', 'yearly', 1), '2029-02-28');
  assert.equal(occurrenceAt('2028-02-29', 'yearly', 4), '2032-02-29');
});
check('不早于某天的第一期 / 某天之后的下一期，长跨度也不会多跳', () => {
  assert.equal(firstOccurrenceOnOrAfter('2026-10-10', 'monthly', '2026-10-06'), '2026-10-10');
  assert.equal(firstOccurrenceOnOrAfter('2020-01-31', 'monthly', '2026-10-06'), '2026-10-31');
  assert.equal(firstOccurrenceOnOrAfter('2016-03-15', 'monthly', '2026-03-15'), '2026-03-15');
  assert.equal(firstOccurrenceOnOrAfter('2010-06-01', 'yearly', '2026-06-02'), '2027-06-01');
  assert.equal(firstOccurrenceOnOrAfter('2026-01-01', 'weekly', '2026-01-08'), '2026-01-08');
  assert.equal(nextOccurrenceAfter('2026-01-31', 'monthly', '2026-02-28'), '2026-03-31');
  assert.equal(nextOccurrenceAfter('2026-01-01', 'weekly', '2026-01-01'), '2026-01-08');
});
check('自动记账的截止日：家庭当地 06:00 起是今天，之前是昨天', () => {
  assert.equal(postingCutoff('Asia/Shanghai', new Date('2026-10-05T21:59:00Z')), '2026-10-05');
  assert.equal(postingCutoff('Asia/Shanghai', new Date('2026-10-05T22:00:00Z')), '2026-10-06');
  assert.equal(postingCutoff('America/Los_Angeles', new Date('2026-10-06T12:59:00Z')), '2026-10-05');
  assert.equal(postingCutoff('America/Los_Angeles', new Date('2026-10-06T13:00:00Z')), '2026-10-06');
});
check('月均：周付 × 52 ÷ 12、季付 ÷ 3、年付 ÷ 12，两位小数；幂等键按规则与那一期', () => {
  assert.equal(monthlyAverage(100, 'weekly'), 433.33);
  assert.equal(monthlyAverage(3200, 'monthly'), 3200);
  assert.equal(monthlyAverage(100, 'quarterly'), 33.33);
  assert.equal(monthlyAverage(4800, 'yearly'), 400);
  assert.equal(recurringIdempotencyKey('r1', '2026-10-06'), 'recurring:r1:2026-10-06');
});
console.log(`周期账单日期推算单测全部通过（${passed} 条）`);

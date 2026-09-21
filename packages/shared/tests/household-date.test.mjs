import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, compare, diffDays, householdToday, monthRange, startOfHouseholdDay } from '../dist/index.js';

const instant = (value) => new Date(value);
test('上海家庭零点前后 1 分钟、异地设备不影响家庭今天', () => {
  assert.equal(householdToday('Asia/Shanghai', instant('2026-09-20T15:59:00Z')), '2026-09-20');
  assert.equal(householdToday('Asia/Shanghai', instant('2026-09-20T16:01:00Z')), '2026-09-21');
  assert.equal(startOfHouseholdDay('Asia/Shanghai', '2026-09-21').toISOString(), '2026-09-20T16:00:00.000Z');
  assert.notEqual(householdToday('America/Los_Angeles', instant('2026-09-20T16:01:00Z')), '2026-09-21');
});
test('跨月与闰年始终以日历日计算', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(diffDays('2024-02-28', '2024-03-01'), 2);
  assert.equal(compare('2024-02-29', '2024-03-01'), -1);
  assert.deepEqual(monthRange('2024-02'), { start: '2024-02-01', end: '2024-03-01' });
});
test('洛杉矶夏令时开始/结束均按下一次当地零点', () => {
  assert.equal(startOfHouseholdDay('America/Los_Angeles', '2026-03-08').toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(startOfHouseholdDay('America/Los_Angeles', '2026-03-09').toISOString(), '2026-03-09T07:00:00.000Z');
  assert.equal(startOfHouseholdDay('America/Los_Angeles', '2026-11-02').toISOString(), '2026-11-02T08:00:00.000Z');
});
test('UTC+13 与 UTC−11 极端时区，日期不受设备时区左右', () => {
  const now = instant('2026-09-21T11:30:00Z');
  assert.equal(householdToday('Pacific/Apia', now), '2026-09-22');
  assert.equal(householdToday('Pacific/Pago_Pago', now), '2026-09-21');
  assert.equal(startOfHouseholdDay('Pacific/Apia', '2026-09-22').toISOString(), '2026-09-21T11:00:00.000Z');
  assert.equal(startOfHouseholdDay('Pacific/Pago_Pago', '2026-09-21').toISOString(), '2026-09-21T11:00:00.000Z');
});

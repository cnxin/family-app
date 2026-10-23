import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatShanghaiInstant,
  longestConsecutiveDayStreak,
  nativeRunSectionLines,
  summarizeNativeDailyRows,
} from './usage-report-native.mjs';

const row = (overrides = {}) => ({
  day: '2026-10-20',
  version: 'native-loop-1',
  runs: 1,
  started: 1,
  completed: 1,
  failed: 0,
  cancelled: 0,
  queued: 0,
  running: 0,
  unknown: 0,
  first_record_at: '2026-10-20T00:00:00.000Z',
  last_record_at: '2026-10-20T00:00:00.000Z',
  ...overrides,
});

test('无 Native 数据时明确说明边界且不推定验收达标', () => {
  const output = nativeRunSectionLines({ days: 7, dailyRows: [], errorRows: [] }).join('\n');
  assert.match(output, /没有持久化的 Native run/);
  assert.match(output, /不证明 King 已完成人工连续一周验收/);
  assert.match(output, /不会自动宣布 J4\.6 达标/);
});

test('上海时间格式跨 UTC 日期时使用 +08:00 的本地日期', () => {
  assert.equal(formatShanghaiInstant('2026-12-31T16:30:45.000Z'), '2027-01-01 00:30:45 +08:00');
  assert.equal(formatShanghaiInstant('invalid'), '未知');
});

test('连续自然日正确处理缺口以及跨月跨年', () => {
  assert.equal(longestConsecutiveDayStreak([]), 0);
  assert.equal(longestConsecutiveDayStreak(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-03']), 3);
  assert.equal(longestConsecutiveDayStreak(['2026-01-31', '2026-02-01', '2026-02-03']), 2);
});

test('只有失败和取消时保留记录日但 completed 连续日为零', () => {
  const summary = summarizeNativeDailyRows([
    row({ completed: 0, failed: 1 }),
    row({ day: '2026-10-21', completed: 0, cancelled: 1, first_record_at: '2026-10-21T00:00:00Z', last_record_at: '2026-10-21T00:00:00Z' }),
  ]);
  assert.equal(summary.recordDays, 2);
  assert.equal(summary.completedStreak, 0);
});

test('不同版本、未知版本与未知状态分别保留在日汇总中', () => {
  const output = nativeRunSectionLines({
    days: 14,
    dailyRows: [
      row(),
      row({ version: 'native-loop-2', runs: 2, started: 1, completed: 0, queued: 1, unknown: 1 }),
      row({ day: '2026-10-21', version: null, first_record_at: '2026-10-21T01:00:00Z', last_record_at: '2026-10-21T02:00:00Z' }),
    ],
    errorRows: [{ code: 'AGENT_PROVIDER_ERROR', count: 2 }],
  }).join('\n');
  assert.match(output, /native-loop-1/);
  assert.match(output, /native-loop-2/);
  assert.match(output, /\| 未知 \|/);
  assert.match(output, /\| 2 \| 1 \| 0 \| 0 \| 0 \| 1 \| 0 \| 1 \|/);
  assert.match(output, /AGENT_PROVIDER_ERROR/);
  assert.doesNotMatch(output, /errorMessage/);
});

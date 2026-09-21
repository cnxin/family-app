import { test } from 'node:test';
import assert from 'node:assert/strict';
import contracts from '../dist/index.js';
const { PlainDate } = contracts;

test('合法日历日期与闰年可用，2 月 30 日不可用', () => {
  assert.equal(PlainDate.parse('2024-02-29'), '2024-02-29');
  for (const invalid of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-9-1']) {
    assert.equal(PlainDate.safeParse(invalid).success, false, invalid);
  }
});

import assert from 'node:assert/strict';
import pg from 'pg';

import {
  NATIVE_DAILY_SQL,
  NATIVE_ERRORS_SQL,
  nativeRunSectionLines,
  summarizeNativeDailyRows,
} from './usage-report-native.mjs';

const { Client } = pg;
const TEST_DATABASE_PATTERN = /^family_app_test_[a-f0-9]{32}$/;
const database = process.env.DB_NAME ?? '';

if (!TEST_DATABASE_PATTERN.test(database)) {
  throw new Error(
    `Native 用量 SQL 集成测试拒绝非隔离数据库：${database || '（未设置 DB_NAME）'}`,
  );
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database,
});

const DAY_MS = 86_400_000;
const ids = {
  primary: 'household-native-primary',
  secondary: 'household-native-secondary',
};

function instant(anchor, dayOffset, hour, minute = 0) {
  return new Date(
    anchor.getTime() +
      dayOffset * DAY_MS +
      hour * 60 * 60 * 1000 +
      minute * 60 * 1000,
  );
}

function rowFor(rows, household, day, version) {
  return rows.find(
    (row) =>
      row.household === household && row.day === day && row.version === version,
  );
}

await db.connect();
let transactionOpen = false;

try {
  const currentDatabase = (await db.query('SELECT current_database() AS name'))
    .rows[0]?.name;
  assert.equal(
    currentDatabase,
    database,
    '连接目标必须是 runner 创建的隔离数据库',
  );

  await db.query("SET TIME ZONE 'America/New_York'");
  assert.equal(
    (await db.query("SELECT current_setting('TimeZone') AS value")).rows[0]
      .value,
    'America/New_York',
    '测试会话应使用非上海时区',
  );

  const anchor = (
    await db.query(`
      SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')
             AT TIME ZONE 'Asia/Shanghai' AS instant`)
  ).rows[0].instant;
  const dayLabels = Object.fromEntries(
    (
      await db.query(`
        SELECT day_offset,
               to_char(
                 (now() AT TIME ZONE 'Asia/Shanghai')::date + day_offset,
                 'YYYY-MM-DD'
               ) AS day
          FROM unnest(ARRAY[-6, -5, -4, -2]) AS offsets(day_offset)`)
    ).rows.map((row) => [Number(row.day_offset), row.day]),
  );

  await db.query('BEGIN');
  transactionOpen = true;
  assert.equal(
    (await db.query("SELECT current_setting('transaction_read_only') AS value"))
      .rows[0].value,
    'off',
    '夹具事务必须可写',
  );
  await db.query(`
    CREATE TEMP TABLE agent_runs (
      "householdId" text NOT NULL,
      "runtimeKind" text NOT NULL,
      "runtimeVersion" text,
      status text,
      "startedAt" timestamptz,
      "createdAt" timestamptz NOT NULL,
      "errorCode" text,
      "errorMessage" text
    ) ON COMMIT PRESERVE ROWS`);

  const fixtures = [
    [
      ids.primary,
      'native',
      'native-loop-1',
      'completed',
      instant(anchor, -6, 12),
      instant(anchor, -6, 12),
      null,
      null,
    ],
    [
      ids.primary,
      'native',
      'native-loop-1',
      'completed',
      instant(anchor, -5, 23, 59),
      instant(anchor, -5, 23, 59),
      null,
      null,
    ],
    [
      ids.primary,
      'native',
      'native-loop-2',
      'failed',
      instant(anchor, -4, 0, 1),
      instant(anchor, -4, 0, 1),
      'PROVIDER_ERROR',
      'sensitive-provider-detail',
    ],
    [
      ids.primary,
      'native',
      'native-loop-2',
      'cancelled',
      instant(anchor, -4, 9),
      instant(anchor, -4, 9),
      '   ',
      'sensitive-cancel-detail',
    ],
    [
      ids.primary,
      'native',
      '   ',
      'queued',
      null,
      instant(anchor, -4, 10),
      null,
      null,
    ],
    [
      ids.primary,
      'native',
      null,
      'running',
      instant(anchor, -4, 11),
      instant(anchor, -4, 11),
      null,
      null,
    ],
    [
      ids.primary,
      'native',
      'native-loop-2',
      'paused',
      null,
      instant(anchor, -4, 12),
      null,
      null,
    ],
    [
      ids.primary,
      'native',
      'native-loop-2',
      null,
      null,
      instant(anchor, -4, 13),
      null,
      null,
    ],
    [
      ids.primary,
      'native',
      'native-loop-1',
      'completed',
      instant(anchor, -2, 12),
      instant(anchor, -2, 12),
      null,
      null,
    ],
    [
      ids.secondary,
      'native',
      'native-loop-1',
      'completed',
      instant(anchor, -5, 12),
      instant(anchor, -5, 12),
      'SECONDARY_ERROR',
      'sensitive-secondary-detail',
    ],
    [
      ids.primary,
      'fake',
      'family-fake-2',
      'failed',
      instant(anchor, -5, 14),
      instant(anchor, -5, 14),
      'NON_NATIVE_ERROR',
      'sensitive-fake-detail',
    ],
    [
      ids.primary,
      'native',
      'native-loop-old',
      'failed',
      instant(anchor, -30, 12),
      instant(anchor, -30, 12),
      'OUTSIDE_WINDOW_ERROR',
      'sensitive-old-detail',
    ],
  ];
  for (const fixture of fixtures) {
    await db.query(
      `INSERT INTO agent_runs
         ("householdId", "runtimeKind", "runtimeVersion", status, "startedAt", "createdAt", "errorCode", "errorMessage")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      fixture,
    );
  }
  await db.query('COMMIT');
  transactionOpen = false;

  await db.query('BEGIN READ ONLY');
  transactionOpen = true;
  assert.equal(
    (await db.query("SELECT current_setting('transaction_read_only') AS value"))
      .rows[0].value,
    'on',
    '汇总事务必须只读',
  );
  const dailyRows = (await db.query(NATIVE_DAILY_SQL, [14])).rows;
  const errorRows = (await db.query(NATIVE_ERRORS_SQL, [14])).rows;
  await db.query('COMMIT');
  transactionOpen = false;

  assert.deepEqual(
    [...new Set(dailyRows.map((row) => row.household))].sort(),
    [ids.primary, ids.secondary],
    '两个家庭必须分别汇总',
  );
  assert.equal(
    dailyRows.reduce((total, row) => total + row.runs, 0),
    10,
    '非 Native 与窗口外数据必须排除',
  );

  const beforeMidnight = rowFor(
    dailyRows,
    ids.primary,
    dayLabels[-5],
    'native-loop-1',
  );
  const afterMidnight = rowFor(
    dailyRows,
    ids.primary,
    dayLabels[-4],
    'native-loop-2',
  );
  assert.equal(
    beforeMidnight?.completed,
    1,
    '上海午夜前的 run 应归入前一自然日',
  );
  assert.deepEqual(
    {
      runs: afterMidnight?.runs,
      started: afterMidnight?.started,
      failed: afterMidnight?.failed,
      cancelled: afterMidnight?.cancelled,
      unknown: afterMidnight?.unknown,
    },
    { runs: 4, started: 2, failed: 1, cancelled: 1, unknown: 2 },
    '上海午夜后的 run 及失败、取消、未知状态应正确汇总',
  );

  const unknownVersion = rowFor(dailyRows, ids.primary, dayLabels[-4], '未知');
  assert.deepEqual(
    {
      runs: unknownVersion?.runs,
      started: unknownVersion?.started,
      queued: unknownVersion?.queued,
      running: unknownVersion?.running,
    },
    { runs: 2, started: 1, queued: 1, running: 1 },
    '空白和 null 版本应合并为未知，且保留 queued/running',
  );

  const primaryRows = dailyRows.filter((row) => row.household === ids.primary);
  const primaryErrors = errorRows.filter(
    (row) => row.household === ids.primary,
  );
  const summary = summarizeNativeDailyRows(primaryRows);
  assert.equal(summary.recordDays, 4, '日期缺口不能被首末时间跨度替代');
  assert.equal(
    summary.completedStreak,
    2,
    'completed 最长连续自然日应忽略缺口',
  );
  assert.deepEqual(
    primaryErrors.map((row) => [row.code, row.count]).sort(),
    [
      ['PROVIDER_ERROR', 1],
      ['（空 errorCode）', 1],
    ],
    'errorCode 应按家庭聚合并规范化空白值',
  );

  const report = nativeRunSectionLines({
    days: 14,
    dailyRows: primaryRows,
    errorRows: primaryErrors,
  }).join('\n');
  assert.match(report, /PROVIDER_ERROR/);
  assert.match(report, /最长连续自然日数为 2 天/);
  assert.doesNotMatch(report, /sensitive-/, '报告不得包含错误正文');
  assert.doesNotMatch(JSON.stringify({ dailyRows, errorRows }), /sensitive-/);
  assert.doesNotMatch(
    report,
    /NON_NATIVE_ERROR|OUTSIDE_WINDOW_ERROR|SECONDARY_ERROR/,
  );

  console.log(
    '  ✓ Native 用量 SQL 在真实 PostgreSQL 中按家庭、上海自然日与窗口正确汇总',
  );
  console.log('  ✓ 状态、版本、错误码和连续日统计已覆盖，报告不包含错误正文');
} finally {
  if (transactionOpen) await db.query('ROLLBACK').catch(() => {});
  await db.end();
}

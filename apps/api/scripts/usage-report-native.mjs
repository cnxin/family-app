const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export const NATIVE_RUN_COLUMNS = [
  'householdId',
  'runtimeKind',
  'runtimeVersion',
  'status',
  'startedAt',
  'createdAt',
  'errorCode',
];

export const NATIVE_DAILY_SQL = `
  SELECT "householdId" AS household,
         to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day,
         COALESCE(NULLIF(BTRIM("runtimeVersion"), ''), '未知') AS version,
         COUNT(*)::int AS runs,
         COUNT(*) FILTER (WHERE "startedAt" IS NOT NULL)::int AS started,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'running')::int AS running,
         COUNT(*) FILTER (WHERE status IS NULL OR status NOT IN ('completed', 'failed', 'cancelled', 'queued', 'running'))::int AS "unknown",
         MIN("createdAt") AS first_record_at,
         MAX("createdAt") AS last_record_at
    FROM agent_runs
   WHERE "createdAt" >= now() - make_interval(days => $1)
     AND "runtimeKind" = 'native'
   GROUP BY 1, 2, 3
   ORDER BY 2, 3`;

export const NATIVE_ERRORS_SQL = `
  SELECT "householdId" AS household,
         COALESCE(NULLIF(BTRIM("errorCode"), ''), '（空 errorCode）') AS code,
         COUNT(*)::int AS count
    FROM agent_runs
   WHERE "createdAt" >= now() - make_interval(days => $1)
     AND "runtimeKind" = 'native'
     AND "errorCode" IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 3 DESC, 2`;

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const count = (value) => Number(value ?? 0);
const cell = (value, fallback = '未知') =>
  String(value == null || String(value).trim() === '' ? fallback : value)
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('|', '\\|');

function dateNumber(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return value / 86_400_000;
}

export function longestConsecutiveDayStreak(days) {
  const values = [...new Set(days.map(dateNumber).filter((value) => value != null))].sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const value of values) {
    current = previous != null && value === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = value;
  }
  return longest;
}

export function formatShanghaiInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '未知';
  const parts = Object.fromEntries(shanghaiFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} +08:00`;
}

export function summarizeNativeDailyRows(rows) {
  const normalized = rows
    .map((row) => ({
      day: String(row.day),
      version: cell(row.version),
      runs: count(row.runs),
      started: count(row.started),
      completed: count(row.completed),
      failed: count(row.failed),
      cancelled: count(row.cancelled),
      queued: count(row.queued),
      running: count(row.running),
      unknown: count(row.unknown),
      firstRecordAt: row.first_record_at,
      lastRecordAt: row.last_record_at,
    }))
    .sort((left, right) => left.day.localeCompare(right.day) || left.version.localeCompare(right.version));
  const recordDays = [...new Set(normalized.map((row) => row.day))];
  const completedDays = [...new Set(normalized.filter((row) => row.completed > 0).map((row) => row.day))];
  const instants = normalized.flatMap((row) => [row.firstRecordAt, row.lastRecordAt]).filter(Boolean).map((value) => new Date(value));
  const validInstants = instants.filter((value) => !Number.isNaN(value.getTime())).sort((left, right) => left - right);
  return {
    rows: normalized,
    recordDays: recordDays.length,
    completedStreak: longestConsecutiveDayStreak(completedDays),
    firstRecordAt: validInstants[0] ?? null,
    lastRecordAt: validInstants.at(-1) ?? null,
  };
}

export function nativeRunSectionLines({ days, dailyRows, errorRows }) {
  const summary = summarizeNativeDailyRows(dailyRows);
  const lines = [`**Native 运行轨迹（最近 ${days} 天，按 Asia/Shanghai 创建日）**`, ''];
  if (!summary.rows.length) {
    lines.push('- 这段时间没有持久化的 Native run。', '');
  } else {
    lines.push(
      '| 日期 | 运行时版本 | run 数 | 实际启动 | completed | failed | cancelled | queued | running | 未知状态 |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const row of summary.rows) {
      lines.push(
        `| ${row.day} | ${row.version} | ${row.runs} | ${row.started} | ${row.completed} | ${row.failed} | ${row.cancelled} | ${row.queued} | ${row.running} | ${row.unknown} |`,
      );
    }
    lines.push(
      '',
      `- 窗口内有 Native 记录 ${summary.recordDays} 个自然日；有 completed 记录的最长连续自然日数为 ${summary.completedStreak} 天。`,
      `- 首条 / 末条记录时间（上海时间）：${formatShanghaiInstant(summary.firstRecordAt)} / ${formatShanghaiInstant(summary.lastRecordAt)}。`,
      '',
      '| errorCode | 次数 |',
      '| --- | ---: |',
    );
    if (errorRows.length) {
      for (const row of [...errorRows].sort((left, right) => count(right.count) - count(left.count) || String(left.code).localeCompare(String(right.code)))) {
        lines.push(`| ${cell(row.code, '（空 errorCode）')} | ${count(row.count)} |`);
      }
    } else {
      lines.push('| （无） | 0 |');
    }
    lines.push('');
  }
  lines.push(
    '- 说明：这里只反映持久化运行轨迹，可能包含回放或自动触发；它不证明 King 已完成人工连续一周验收，不会自动宣布 J4.6 达标，也不新增验收门槛。',
  );
  return lines;
}

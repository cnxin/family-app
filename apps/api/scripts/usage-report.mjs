#!/usr/bin/env node
/**
 * C2 用量统计：按「域 × 成员」统计最近 N 天的写操作次数。只读，不改任何数据。
 *
 * 两种计数来源，输出里逐行标明：
 *   - 流水：household_activity_logs（按 module）与 menu_events（点菜 / 厨房）。
 *   - 主表新增：不写流水的域，直接数各域主表最近 N 天新增的行（created_at + 创建人列）。
 * 统计不到的（没有创建时间或创建人列的表）列在末尾，不猜。
 *
 * 本机（开发库）：
 *   node apps/api/scripts/usage-report.mjs --days 14
 * NAS（在仓库根目录，借 api 镜像里的 node 与 pg，连生产库）：
 *   docker compose --env-file deploy/.env.production -f docker-compose.prod.yml run --rm --no-deps -T \
 *     -v "$PWD/apps/api/scripts/usage-report.mjs:/app/apps/api/usage-report.mjs:ro" \
 *     api node usage-report.mjs --days 14
 *
 * 连接参数读 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD（或 DB_PASSWORD_FILE）/ DB_NAME，
 * 与 API 相同。库里没有只读角色，脚本用现有账号，但整个会话设为只读事务，只发 SELECT。
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}
const DAYS = Number(option('days', '14'));
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 366) {
  console.error('--days 需要 1–366 的整数');
  process.exit(2);
}

function password() {
  if (process.env.DB_PASSWORD_FILE) return readFileSync(process.env.DB_PASSWORD_FILE, 'utf8').trim();
  return process.env.DB_PASSWORD ?? 'family123';
}

// 流水 module → 域名。成员与邀请并成一个域。
const ACTIVITY_DOMAINS = {
  member: '成员',
  invitation: '成员',
  menu: '点菜（智能菜单）',
  media: '观影',
  guest: '访客',
  asset: '资产',
  points: '积分',
  knowledge: '知识库',
  memory: '回忆',
  travel: '出行',
  finance: '财务',
  system: '家庭设置与备份',
  calendar: '日历',
  task: '任务',
  poll: '投票',
  reminder: '提醒',
  shopping: '购物',
  inventory: '库存',
  recipe: '菜谱',
};

// 不写流水的域：主表最近 N 天新增的行。timestamp（无时区）列按数据库会话时区比较。
const TABLE_SOURCES = [
  { domain: '日历', source: '主表新增 calendar_events', sql: `SELECT "householdId" AS household, "createdById" AS member FROM calendar_events WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '任务', source: '主表新增 household_tasks', sql: `SELECT "householdId" AS household, "createdById" AS member FROM household_tasks WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '提醒', source: '主表新增 reminders', sql: `SELECT "householdId" AS household, "createdById" AS member FROM reminders WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '投票', source: '主表新增 polls（观影投票除外，已在流水）', sql: `SELECT "householdId" AS household, "createdById" AS member FROM polls WHERE "sourceModule" IS DISTINCT FROM 'media' AND "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '投票（投票人）', source: '主表新增 poll_votes', sql: `SELECT "householdId" AS household, "memberId" AS member FROM poll_votes WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '菜谱', source: '主表新增 dishes', sql: `SELECT "householdId" AS household, "createdBy" AS member FROM dishes WHERE "createdAt" >= LOCALTIMESTAMP - make_interval(days => $1)` },
  { domain: '库存', source: '主表新增 inventory_transactions', sql: `SELECT "householdId" AS household, "actorId" AS member FROM inventory_transactions WHERE "createdAt" >= now() - make_interval(days => $1)` },
];

const UNCOUNTED = [
  '购物：shopping_items 没有创建时间和创建人列，无法按成员计数',
  '任务完成：只数新建任务；完成 / 认领（household_task_instances.resolvedById）不是新增行，未计入',
  '菜谱做法：dish_recipe_variants 没有创建人列，未计入',
];

const client = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: password(),
  database: process.env.DB_NAME || 'family_app',
});

await client.connect();
try {
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '30s'");

  const households = (await client.query('SELECT id, name, timezone FROM households ORDER BY "createdAt"')).rows;
  const members = (await client.query('SELECT id, "householdId" AS household, name FROM members ORDER BY "createdAt"')).rows;

  // rows: { household, domain, source, member, count }
  const rows = [];
  const logs = await client.query(
    `SELECT "householdId" AS household, module, "actorId" AS member, COUNT(*)::int AS count
       FROM household_activity_logs
      WHERE "createdAt" >= now() - make_interval(days => $1)
      GROUP BY 1, 2, 3`,
    [DAYS],
  );
  for (const row of logs.rows) {
    rows.push({
      household: row.household,
      domain: ACTIVITY_DOMAINS[row.module] ?? row.module,
      source: '流水 household_activity_logs',
      member: row.member,
      count: row.count,
    });
  }
  const menuEvents = await client.query(
    `SELECT "householdId" AS household, "actorId" AS member, COUNT(*)::int AS count
       FROM menu_events
      WHERE "createdAt" >= LOCALTIMESTAMP - make_interval(days => $1)
      GROUP BY 1, 2`,
    [DAYS],
  );
  for (const row of menuEvents.rows) {
    rows.push({ household: row.household, domain: '点菜 / 厨房', source: '流水 menu_events', member: row.member, count: row.count });
  }
  for (const table of TABLE_SOURCES) {
    const result = await client.query(
      `SELECT household, member, COUNT(*)::int AS count FROM (${table.sql}) t GROUP BY 1, 2`,
      [DAYS],
    );
    for (const row of result.rows) {
      rows.push({ household: row.household, domain: table.domain, source: table.source, member: row.member, count: row.count });
    }
  }
  await client.query('COMMIT');

  console.log(`# 小管家用量：最近 ${DAYS} 天的写操作次数\n`);
  console.log(`统计时间：${new Date().toISOString()}（只读查询）\n`);
  for (const household of households) {
    const own = rows.filter((row) => row.household === household.id);
    const people = members.filter((member) => member.household === household.id);
    const columns = [...people.map((member) => ({ id: member.id, name: member.name }))];
    if (own.some((row) => row.member == null || !people.some((member) => member.id === row.member))) {
      columns.push({ id: null, name: '系统 / 已删成员' });
    }
    const domains = [...new Map(own.map((row) => [`${row.domain}|${row.source}`, row])).values()]
      .sort((left, right) => left.domain.localeCompare(right.domain, 'zh-CN'));

    console.log(`## ${household.name}（${household.timezone}）\n`);
    if (!domains.length) {
      console.log('这段时间没有写操作。\n');
      continue;
    }
    console.log(`| 域 | ${columns.map((column) => column.name).join(' | ')} | 合计 | 计数来源 |`);
    console.log(`| --- | ${columns.map(() => '---:').join(' | ')} | ---: | --- |`);
    for (const { domain, source } of domains) {
      const cells = columns.map((column) =>
        own
          .filter((row) => row.domain === domain && row.source === source)
          .filter((row) =>
            column.id == null
              ? row.member == null || !people.some((member) => member.id === row.member)
              : row.member === column.id,
          )
          .reduce((sum, row) => sum + row.count, 0),
      );
      const total = cells.reduce((sum, value) => sum + value, 0);
      console.log(`| ${domain} | ${cells.join(' | ')} | ${total} | ${source} |`);
    }
    console.log('');
  }
  console.log('**没有计入的写操作**\n');
  for (const line of UNCOUNTED) console.log(`- ${line}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

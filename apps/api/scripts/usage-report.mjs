#!/usr/bin/env node
/**
 * C2 用量统计：按「域 × 成员」统计最近 N 天的写操作次数。只读，不改任何数据。
 *
 * 两种计数来源，输出里逐行标明：
 *   - 流水：household_activity_logs（按 module）与 menu_events（点菜 / 厨房）。
 *   - 主表新增：不写流水的域，直接数各域主表最近 N 天新增的行（created_at + 创建人列）。
 *     智能家居控制按来源（手动 / 联动）分开数，HA 打来的事件没有成员、记在「系统」一列。
 *   - 位置（I1）另起一段现状快照：库存 / 批次 / 资产各有多少条记着位置。
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
import contracts from '@family/contracts';
import pg from 'pg';

// 已迁到插件 manifest 的域，流水名、主表来源、未计入说明都由 manifest 生成（J1）；下面只手写还没迁的。
const generated = contracts.pluginUsage();

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
const HANDWRITTEN_ACTIVITY_DOMAINS = {
  member: '成员',
  invitation: '成员',
  menu: '点菜（智能菜单）',
  media: '观影',
  asset: '资产',
  finance: '财务',
  system: '家庭设置与备份',
  calendar: '日历',
  task: '任务',
  reminder: '提醒',
  shopping: '购物',
  inventory: '库存',
};
const ACTIVITY_DOMAINS = { ...HANDWRITTEN_ACTIVITY_DOMAINS, ...generated.activityDomains };

// 不写流水的域：主表最近 N 天新增的行。timestamp（无时区）列按数据库会话时区比较。
const HANDWRITTEN_TABLE_SOURCES = [
  { domain: '日历', source: '主表新增 calendar_events', sql: `SELECT "householdId" AS household, "createdById" AS member FROM calendar_events WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '任务', source: '主表新增 household_tasks', sql: `SELECT "householdId" AS household, "createdById" AS member FROM household_tasks WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '提醒', source: '主表新增 reminders', sql: `SELECT "householdId" AS household, "createdById" AS member FROM reminders WHERE "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '库存', source: '主表新增 inventory_transactions', sql: `SELECT "householdId" AS household, "actorId" AS member FROM inventory_transactions WHERE "createdAt" >= now() - make_interval(days => $1)` },
  // 智能家居控制按来源分开：联动按的记在家庭主人名下（联动以他的名义执行），不是他本人按的
  { domain: '智能家居（手动控制）', source: '主表新增 smart_home_commands（source = manual）', sql: `SELECT "householdId" AS household, "memberId" AS member FROM smart_home_commands WHERE source = 'manual' AND "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '智能家居（联动控制）', source: '主表新增 smart_home_commands（source = link，记在家庭主人名下）', sql: `SELECT "householdId" AS household, "memberId" AS member FROM smart_home_commands WHERE source = 'link' AND "createdAt" >= now() - make_interval(days => $1)` },
  { domain: '智能家居（HA 回报）', source: '主表新增 smart_home_events（HA 打来的，没有成员）', sql: `SELECT "householdId" AS household, NULL::uuid AS member FROM smart_home_events WHERE event <> 'ping' AND "receivedAt" >= now() - make_interval(days => $1)` },
];
const TABLE_SOURCES = [...HANDWRITTEN_TABLE_SOURCES, ...generated.tables];

// 位置（I1）：不是写操作次数，是现状快照——各处有多少条记着位置。位置的改动没有操作人列，按成员数不了。
const LOCATION_SNAPSHOT = `
  SELECT h.id AS household,
    (SELECT count(*) FROM storage_locations l WHERE l."householdId" = h.id AND l."archivedAt" IS NULL AND l."systemKey" IS NULL)::int AS locations,
    (SELECT count(*) FROM storage_locations l JOIN storage_locations p ON p.id = l."parentId"
      WHERE l."householdId" = h.id AND l."archivedAt" IS NULL AND p."systemKey" IS NOT NULL)::int AS unsorted,
    (SELECT count(*) FROM inventory_items i WHERE i."householdId" = h.id)::int AS items,
    (SELECT count(*) FROM inventory_items i WHERE i."householdId" = h.id AND i."defaultLocationId" IS NOT NULL)::int AS items_located,
    (SELECT count(*) FROM inventory_batches b WHERE b."householdId" = h.id AND b.quantity > 0)::int AS batches,
    (SELECT count(*) FROM inventory_batches b WHERE b."householdId" = h.id AND b.quantity > 0 AND b."locationId" IS NOT NULL)::int AS batches_located,
    (SELECT count(*) FROM inventory_batches b WHERE b."householdId" = h.id AND b."locationUpdatedAt" >= now() - make_interval(days => $1))::int AS batches_moved,
    (SELECT count(*) FROM home_assets a WHERE a."householdId" = h.id AND a.status = 'active')::int AS assets,
    (SELECT count(*) FROM home_assets a WHERE a."householdId" = h.id AND a.status = 'active' AND a."locationId" IS NOT NULL)::int AS assets_located,
    (SELECT count(*) FROM home_assets a WHERE a."householdId" = h.id AND a.status = 'active' AND a."locationId" IS NULL AND a.location IS NOT NULL)::int AS assets_text
  FROM households h`;

const HANDWRITTEN_UNCOUNTED = [
  '购物：shopping_items 没有创建时间和创建人列，无法按成员计数',
  '任务完成：只数新建任务；完成 / 认领（household_task_instances.resolvedById）不是新增行，未计入',
  '位置：storage_locations 与库存 / 批次 / 资产的位置列都没有操作人，只给现状快照（见各家庭「位置」一段），不按成员计数',
];
const UNCOUNTED = [...HANDWRITTEN_UNCOUNTED, ...generated.uncounted];

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
  const locations = new Map((await client.query(LOCATION_SNAPSHOT, [DAYS])).rows.map((row) => [row.household, row]));
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
    const place = locations.get(household.id);
    const locationLines = place
      ? [
          `- 位置：${place.locations} 个（不含「未整理」）；家人新建、还挂在「未整理」下待归位的 ${place.unsorted} 个`,
          `- 库存物品记着默认位置：${place.items_located} / ${place.items}`,
          `- 在用批次记着位置：${place.batches_located} / ${place.batches}（最近 ${DAYS} 天改过位置的 ${place.batches_moved} 个）`,
          `- 在用资产记着位置：${place.assets_located} / ${place.assets}（还只有旧文字位置、没整理的 ${place.assets_text} 件）`,
        ]
      : [];
    const printLocations = () => {
      console.log('**位置（现状快照，不是写操作次数）**\n');
      for (const line of locationLines) console.log(line);
      console.log('');
    };
    if (!domains.length) {
      console.log('这段时间没有写操作。\n');
      printLocations();
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
    printLocations();
  }
  console.log('**没有计入的写操作**\n');
  for (const line of UNCOUNTED) console.log(`- ${line}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

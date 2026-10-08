#!/usr/bin/env node
/**
 * C2 用量统计：按「域 × 成员」统计最近 N 天的写操作次数。只读，不改任何数据。
 *
 * 两种计数来源，输出里逐行标明：
 *   - 流水：household_activity_logs（按 module）与 menu_events（点菜 / 厨房）。
 *   - 主表新增：不写流水的域，直接数各域主表最近 N 天新增的行（created_at + 创建人列）。
 *     智能家居控制按来源（手动 / 联动）分开数，HA 打来的事件没有成员、记在「系统」一列。
 *   - 位置（I1）另起一段现状快照：库存 / 批次 / 资产各有多少条记着位置。
 *   - 助理原话（J2）也另起一段：最近 N 天按「成员 × 入口 source × 结果 outcome」数 assistant_utterances 的条数（不打印原话），不是写操作次数。
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

// 插件的流水名、主表来源、未计入说明、快照都由 manifest 生成（J1）；下面只写内核的。
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

// 流水 module → 域名。成员与邀请并成一个域。内核条目，不属于任何插件；assistant 工具清单归 J1b（§8.6 第 2 条）。
const CORE_ACTIVITY_DOMAINS = {
  member: '成员',
  invitation: '成员',
  system: '家庭设置与备份',
};
const ACTIVITY_DOMAINS = { ...CORE_ACTIVITY_DOMAINS, ...generated.activityDomains };

// 不写流水的域：主表最近 N 天新增的行（全部由 manifest 的 usage.tables 生成）。timestamp（无时区）列按数据库会话时区比较。
const TABLE_SOURCES = generated.tables;

// 现状快照：manifest 的 usage.snapshots 只声明 id 和名字，查询与每行文案按 id 写在这里（§8.4 第 5 条）。
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

const SNAPSHOT_SOURCES = {
  'locations.snapshot': {
    sql: LOCATION_SNAPSHOT,
    lines: (place) => [
      `- 位置：${place.locations} 个（不含「未整理」）；家人新建、还挂在「未整理」下待归位的 ${place.unsorted} 个`,
      `- 库存物品记着默认位置：${place.items_located} / ${place.items}`,
      `- 在用批次记着位置：${place.batches_located} / ${place.batches}（最近 ${DAYS} 天改过位置的 ${place.batches_moved} 个）`,
      `- 在用资产记着位置：${place.assets_located} / ${place.assets}（还只有旧文字位置、没整理的 ${place.assets_text} 件）`,
    ],
  },
};
const SNAPSHOTS = generated.snapshots.map((snapshot) => {
  const source = SNAPSHOT_SOURCES[snapshot.server];
  if (!source) throw new Error(`用量快照 ${snapshot.server} 在 SNAPSHOT_SOURCES 里没有实现`);
  return { ...snapshot, ...source };
});

// 统计不到的写操作（manifest 的 usage.uncounted）
const UNCOUNTED = generated.uncounted;

// 助理原话（J2）：⌘K / 今天页搜索条 / 小管家对话每「一次输入结束」一条。不是写操作，单独一段，只数条数、不打印原话。
// 助理层是内核、不是插件，SQL 写在这里。createdAt 是 timestamptz，与流水同口径：现在往前 N×24 小时，不按家庭时区切日。
// 排序用契约的枚举顺序；取不到（镜像里的契约早于 J2）就保持 SQL 的字母序。
const UTTERANCE_SOURCES = contracts.ASSISTANT_UTTERANCE_SOURCES ?? [];
const UTTERANCE_OUTCOMES = contracts.ASSISTANT_UTTERANCE_OUTCOMES ?? [];
const UTTERANCE_RECENT = `
  SELECT "householdId" AS household, "memberId" AS member, source, outcome,
         COUNT(*)::int AS count, COUNT("chosenKind")::int AS chosen
    FROM assistant_utterances
   WHERE "createdAt" >= now() - make_interval(days => $1)
   GROUP BY 1, 2, 3, 4
   ORDER BY 3, 4`;
const UTTERANCE_TOTAL = 'SELECT "householdId" AS household, COUNT(*)::int AS count FROM assistant_utterances GROUP BY 1';
const rank = (list, value) => (list.includes(value) ? list.indexOf(value) : list.length);

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
  for (const table of TABLE_SOURCES) {
    const result = await client.query(
      `SELECT household, member, COUNT(*)::int AS count FROM (${table.sql}) t GROUP BY 1, 2`,
      [DAYS],
    );
    for (const row of result.rows) {
      rows.push({ household: row.household, domain: table.domain, source: table.source, member: row.member, count: row.count });
    }
  }
  const snapshotRows = [];
  for (const snapshot of SNAPSHOTS) {
    snapshotRows.push(new Map((await client.query(snapshot.sql, [DAYS])).rows.map((row) => [row.household, row])));
  }
  // J2 迁移之前的库（NAS 上仓库比镜像新时）没有这张表：跳过这一段，不让整份报告失败
  const hasUtterances = (await client.query("SELECT to_regclass('public.assistant_utterances') IS NOT NULL AS ok")).rows[0].ok;
  const utteranceRows = hasUtterances ? (await client.query(UTTERANCE_RECENT, [DAYS])).rows : [];
  const utteranceTotals = new Map(
    hasUtterances ? (await client.query(UTTERANCE_TOTAL)).rows.map((row) => [row.household, row.count]) : [],
  );
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
    const printSnapshots = () => {
      SNAPSHOTS.forEach((snapshot, index) => {
        const row = snapshotRows[index].get(household.id);
        console.log(`**${snapshot.label}（现状快照，不是写操作次数）**\n`);
        for (const line of row ? snapshot.lines(row) : []) console.log(line);
        console.log('');
      });
    };
    const printUtterances = () => {
      if (!hasUtterances) return;
      console.log(`**助理原话（J2，最近 ${DAYS} 天的输入条数，不是写操作次数）**\n`);
      const order = people.map((member) => member.id);
      const mine = utteranceRows
        .filter((row) => row.household === household.id)
        .sort(
          (left, right) =>
            rank(order, left.member) - rank(order, right.member) ||
            rank(UTTERANCE_SOURCES, left.source) - rank(UTTERANCE_SOURCES, right.source) ||
            rank(UTTERANCE_OUTCOMES, left.outcome) - rank(UTTERANCE_OUTCOMES, right.outcome),
        );
      if (mine.length) {
        console.log('| 成员 | 入口 source | 结果 outcome | 条数 | 其中带 chosenKind |');
        console.log('| --- | --- | --- | ---: | ---: |');
        for (const row of mine) {
          const name = people.find((member) => member.id === row.member)?.name ?? '已删成员';
          console.log(`| ${name} | ${row.source} | ${row.outcome} | ${row.count} | ${row.chosen} |`);
        }
        console.log('');
      }
      const recent = mine.reduce((sum, row) => sum + row.count, 0);
      const chosen = mine.reduce((sum, row) => sum + row.chosen, 0);
      console.log(`- 最近 ${DAYS} 天共 ${recent} 条，其中带 chosenKind 的 ${chosen} 条；全部时间共 ${utteranceTotals.get(household.id) ?? 0} 条\n`);
    };
    if (!domains.length) {
      console.log('这段时间没有写操作。\n');
      printSnapshots();
      printUtterances();
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
    printSnapshots();
    printUtterances();
  }
  if (!hasUtterances) console.log('**助理原话（J2）**：库里还没有 assistant_utterances（J2 迁移之前），这一段跳过\n');
  console.log('**没有计入的写操作**\n');
  for (const line of UNCOUNTED) console.log(`- ${line}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

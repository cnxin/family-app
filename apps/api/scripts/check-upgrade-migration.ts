import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database.options';

/**
 * 升级演练：在有数据的库上，从「生产基线」回退再升级，模拟 NAS 实际要走的那一步。
 *
 * PRODUCTION_BASELINE 是 NAS 当前库里最新的迁移（2026-09-27 为旧 main `2127c70` 的最后一个迁移）。
 * NAS 每升级一次，就把它改成那次上线后的最新迁移。
 * 空库不算数（教训 29）：先断言 migration-fixture.mjs 造的数据都在。
 */
const PRODUCTION_BASELINE = 'AddSubscriptionRenewalCycle1785232300000';
const FIXTURE_TABLES = [
  'maintenance_records',
  'maintenance_plans',
  'home_assets',
  'visits',
  'menus',
  'menu_items',
] as const;

async function main() {
  // 只允许全量验收创建的隔离库；执行时 API 尚未启动。
  assert.match(process.env.DB_NAME ?? '', /^family_app_test_[a-f0-9]+$/);
  const db = new DataSource({ ...databaseOptions(), migrationsRun: false });
  await db.initialize();
  try {
    const counts = async () => {
      const result: Record<string, number> = {};
      for (const table of FIXTURE_TABLES) {
        const [row] = await db.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
        result[table] = row.count;
      }
      return result;
    };
    const before = await counts();
    for (const table of FIXTURE_TABLES) {
      assert(before[table] > 0, `升级演练要求 ${table} 有数据，空库演练不算数`);
    }
    const performedOn = async () =>
      db.query(`SELECT id, "performedOn"::text AS "performedOn" FROM maintenance_records ORDER BY id`);
    const datesBefore = await performedOn();

    const applied: { name: string }[] = await db.query(
      'SELECT name FROM app_migrations ORDER BY id DESC',
    );
    const baselineIndex = applied.findIndex((row) => row.name === PRODUCTION_BASELINE);
    assert(baselineIndex >= 0, '生产基线迁移必须已经应用');
    const newer = applied.slice(0, baselineIndex);
    for (const migration of newer) {
      const [current] = await db.query('SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1');
      assert.equal(current?.name, migration.name, '只回退生产基线之后的迁移');
      await db.undoLastMigration({ transaction: 'all' });
    }
    const [latest] = await db.query('SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1');
    assert.equal(latest?.name, PRODUCTION_BASELINE);
    console.log(`  ✓ 升级演练 down：回退 ${newer.length} 个迁移到生产基线，数据仍在`);

    const rerun = await db.runMigrations({ transaction: 'all' });
    assert.deepEqual(
      rerun.map((migration) => migration.name),
      newer.map((migration) => migration.name).reverse(),
    );
    assert.deepEqual(await counts(), before, '升级前后业务数据行数不变');
    assert.deepEqual(await performedOn(), datesBefore, 'performedOn 按家庭时区回填，与原值一致');
    const [fixture] = await db.query(
      `SELECT "performedOn"::text AS "performedOn" FROM maintenance_records WHERE note = '迁移演练'`,
    );
    assert.equal(fixture?.performedOn, '2026-01-16', '上海 00:30 完成的维护按家庭日期回填，不是 UTC 前一天');
    console.log(`  ✓ 升级演练 up：${rerun.length} 个迁移在有数据的库上重新执行，行数与维护日期一致`);
  } finally {
    await db.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

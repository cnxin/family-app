import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database.options';

// 只允许全量验收创建的隔离库；执行时 API 尚未启动，避免其他连接使用正在回滚的表。
async function main() {
  assert.match(process.env.DB_NAME ?? '', /^family_app_test_[a-f0-9]+$/);
  const db = new DataSource({ ...databaseOptions(), migrationsRun: false });
  await db.initialize();
  try {
    const name = 'AddHouseholdModuleOverrides1785232400000';
    const applied: { name: string }[] = await db.query(
      'SELECT name FROM app_migrations ORDER BY id DESC',
    );
    const targetIndex = applied.findIndex((row) => row.name === name);
    assert(targetIndex >= 0, '模块目标迁移必须已经应用');
    // 自动回退后续迁移（包括新加的迁移），只验证模块表本身的 up/down/up。
    for (const migration of applied.slice(0, targetIndex)) {
      const current: { name: string }[] = await db.query(
        'SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1',
      );
      assert.equal(current[0]?.name, migration.name, '只回退目标之后的迁移');
      await db.undoLastMigration({ transaction: 'all' });
    }
    const latest: { name: string }[] = await db.query(
      'SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1',
    );
    assert.equal(latest[0]?.name, name, '回退只到模块迁移为止');
    const snapshot = async () =>
      db.query(`SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename <> 'household_module_overrides' ORDER BY tablename, indexname`);
    const before = await snapshot();
    assert.equal(
      (
        await db.query(
          "SELECT to_regclass('household_module_overrides') AS name",
        )
      )[0].name,
      'household_module_overrides',
    );
    console.log('  ✓ 模块迁移 up：种子启动已经应用新表');
    await db.undoLastMigration({ transaction: 'all' });
    assert.equal(
      (
        await db.query(
          "SELECT to_regclass('household_module_overrides') AS name",
        )
      )[0].name,
      null,
    );
    assert.deepEqual(await snapshot(), before);
    console.log('  ✓ 模块迁移 down：新表删除，现有表与索引不变');
    const rerun = await db.runMigrations({ transaction: 'all' });
    assert.deepEqual(
      rerun.map((migration) => migration.name),
      applied.slice(0, targetIndex + 1).reverse().map((migration) => migration.name),
    );
    assert.deepEqual(await snapshot(), before);
    console.log('  ✓ 模块迁移再次 up：仅目标迁移恢复，现有表与索引不变');
  } finally {
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

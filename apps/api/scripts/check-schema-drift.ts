import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database.options';

const dataSource = new DataSource({
  ...databaseOptions(),
  migrationsRun: false,
});

async function main() {
  await dataSource.initialize();
  const schemaChanges = await dataSource.driver.createSchemaBuilder().log();
  if (schemaChanges.upQueries.length > 0) {
    for (const query of schemaChanges.upQueries) console.error(query.query);
    throw new Error('实体元数据与迁移后的数据库结构不一致');
  }
  console.log('数据库结构 ✓ 实体与迁移一致');
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

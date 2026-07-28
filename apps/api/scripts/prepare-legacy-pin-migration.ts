import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DEFAULT_HOUSEHOLD_ID } from '../src/database/database.constants';
import { databaseOptions } from '../src/database/database.options';
import { InitialSchema1785226400000 } from '../src/database/migrations/1785226400000-initial-schema';
import { AddHouseholdScope1785226500000 } from '../src/database/migrations/1785226500000-add-household-scope';

const dataSource = new DataSource({
  ...databaseOptions(),
  migrations: [InitialSchema1785226400000, AddHouseholdScope1785226500000],
  migrationsRun: false,
});

async function main() {
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.query(
    `INSERT INTO members ("householdId", name, "avatarEmoji", role, pin)
     VALUES ($1, $2, $3, $4, $5)`,
    [DEFAULT_HOUSEHOLD_ID, 'PIN 迁移测试成员', 'T', 'member', '2468'],
  );
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

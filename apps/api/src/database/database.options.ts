import { DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from '../entities';
import { databasePassword } from '../common/config';
import { ALL_MIGRATIONS } from './migrations';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5433),
    username: process.env.DB_USER || 'family',
    password: databasePassword(),
    database: process.env.DB_NAME || 'family_app',
    entities: ALL_ENTITIES,
    migrations: ALL_MIGRATIONS,
    migrationsTableName: 'app_migrations',
    migrationsRun: true,
    synchronize: false,
    // TypeORM 1.0 起，find / update / delete 的条件对象里出现 null 或 undefined 默认直接抛错；0.3 是悄悄跳过这个条件。
    // 升级这一笔先保持 0.3 的行为，不把语义变化和版本升级混在一次发布里。改回默认的 throw 另开一笔：
    // 2026-11-12 实测默认 throw 下全量黑盒零命中、全部通过（docs/dependency-upgrade-assessment.md 第四节）。
    invalidWhereValuesBehavior: { null: 'ignore', undefined: 'ignore' },
  };
}

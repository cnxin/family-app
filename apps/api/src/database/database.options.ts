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
  };
}

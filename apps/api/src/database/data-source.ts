import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database.options';

const AppDataSource = new DataSource({
  ...databaseOptions(),
  migrationsRun: false,
});

export default AppDataSource;

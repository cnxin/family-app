import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

const { Client } = pg;
const API_PORT = Number(process.env.TEST_API_PORT || 3199);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const TEST_DATABASE = `family_app_test_${randomUUID().replaceAll('-', '')}`;
const testEnvironment = {
  ...process.env,
  API_URL,
  DB_NAME: TEST_DATABASE,
  PORT: String(API_PORT),
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForApi(processHandle) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processHandle.exitCode != null) {
      throw new Error(`API 提前退出，状态码 ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(`${API_URL}/members`);
      if (response.ok) return;
    } catch {
      // API is still starting.
    }
    await wait(250);
  }
  throw new Error('等待 API 启动超时');
}

async function runProcess(command, args) {
  const child = spawn(command, args, {
    env: testEnvironment,
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} 执行失败，状态码 ${code}`);
}

function runScript(path) {
  return runProcess(process.execPath, [path]);
}

const admin = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: 'postgres',
});
let api = null;
let databaseCreated = false;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  databaseCreated = true;
  console.log(`临时测试数据库：${TEST_DATABASE}`);

  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'src/seed.ts',
  ]);

  api = spawn(
    process.execPath,
    ['-r', 'ts-node/register', 'src/main.ts'],
    {
      env: testEnvironment,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  await waitForApi(api);
  await runScript('scripts/smoke.mjs');
  await runScript('scripts/household-isolation.mjs');
} finally {
  if (api?.exitCode == null) {
    api.kill('SIGTERM');
    await once(api, 'exit');
  }
  if (databaseCreated) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [TEST_DATABASE],
    );
    await admin.query(`DROP DATABASE "${TEST_DATABASE}"`);
    console.log('临时测试数据库已删除');
  }
  await admin.end();
}

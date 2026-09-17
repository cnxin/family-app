import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
// --client web 跑新客户端（apps/web，Vite）；默认仍是旧客户端（apps/mobile，Expo）。
// 旧客户端下线后这个开关就没意义了，届时把 mobile 分支删掉。
const rawArgs = process.argv.slice(2);
const clientFlag = rawArgs.indexOf('--client');
const CLIENT = clientFlag === -1 ? 'mobile' : rawArgs[clientFlag + 1];
if (CLIENT !== 'mobile' && CLIENT !== 'web') {
  throw new Error(`--client 只能是 mobile 或 web，收到：${CLIENT}`);
}
const API_PORT = Number(process.env.E2E_API_PORT || 3198);
const WEB_PORT = Number(
  process.env.E2E_WEB_PORT || (CLIENT === 'web' ? 5181 : 8083),
);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const TEST_DATABASE = `family_app_web_test_${randomUUID().replaceAll('-', '')}`;
const TEST_UPLOAD_DIR = join(
  tmpdir(),
  `family-app-web-test-${randomUUID().replaceAll('-', '')}`,
);
const TEST_PASSWORD = `web-${randomUUID()}`;
const apiRoot = process.cwd();
const repoRoot = resolve(apiRoot, '../..');
const rawPlaywrightArgs =
  clientFlag === -1 ? rawArgs : [...rawArgs.slice(0, clientFlag), ...rawArgs.slice(clientFlag + 2)];
const playwrightArgs = rawPlaywrightArgs[0] === '--'
  ? rawPlaywrightArgs.slice(1)
  : rawPlaywrightArgs;

if (!/^family_app_web_test_[a-f0-9]+$/.test(TEST_DATABASE)) {
  throw new Error('拒绝使用不安全的浏览器测试数据库名称');
}

const testEnvironment = {
  ...process.env,
  API_URL,
  BOOTSTRAP_SECRET: 'family-app-web-test-bootstrap-secret',
  BOOTSTRAP_SECRET_FILE: '',
  CORS_ORIGINS: WEB_URL,
  DB_NAME: TEST_DATABASE,
  DB_PASSWORD_FILE: '',
  E2E_ACCOUNT_PASSWORD: TEST_PASSWORD,
  E2E_LOGIN_NAME: '爸爸',
  EXPO_PUBLIC_API_URL: API_URL,
  FAMILY_API_URL: API_URL,
  FAMILY_WEB_URL: WEB_URL,
  INTEGRATION_SECRET_KEY: '',
  INTEGRATION_SECRET_KEY_FILE: '',
  JWT_EXPIRES_SECONDS: '900',
  JWT_SECRET: 'family-app-web-test-jwt-secret',
  JWT_SECRET_FILE: '',
  LOGIN_RATE_LIMIT: '100',
  LOGIN_RATE_WINDOW_MS: '60000',
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  REFRESH_TOKEN_EXPIRES_SECONDS: '2592000',
  SEED_ACCOUNT_PASSWORD: TEST_PASSWORD,
  PLEX_BASE_URL: '',
  PLEX_TOKEN: '',
  EMBY_BASE_URL: '',
  EMBY_API_KEY: '',
  MOVIEPILOT_BASE_URL: '',
  MOVIEPILOT_API_KEY: '',
  MOVIEPILOT_RECONCILE_ENABLED: 'false',
  TMDB_API_TOKEN: '',
  TMDB_API_KEY: '',
  UPLOAD_DIR: TEST_UPLOAD_DIR,
  DOUBAN_API_BASE_URL: '',
  DOUBAN_API_TOKEN: '',
  BANGUMI_API_BASE_URL: 'http://127.0.0.1:1',
  BANGUMI_ACCESS_TOKEN: '',
};
const browserEnvironment = {
  ...testEnvironment,
  NODE_ENV: 'development',
  // 新客户端的 Vite dev server 直连隔离 API，要自己剥 /api 前缀
  FAMILY_API_ORIGIN: API_URL,
  FAMILY_API_STRIP_PREFIX: '1',
};

function configuredDatabasePassword() {
  if (process.env.DB_PASSWORD) return process.env.DB_PASSWORD;
  if (process.env.DB_PASSWORD_FILE) {
    return readFileSync(process.env.DB_PASSWORD_FILE, 'utf8').trim();
  }
  return 'family123';
}

const admin = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: configuredDatabasePassword(),
  database: 'postgres',
});

let api = null;
let apiOutput = '';
let databaseCreated = false;

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function runProcess(command, args, cwd, environment = testEnvironment) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} 执行失败，状态码 ${code}`);
}

function startApi() {
  apiOutput = '';
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register', 'src/main.ts'],
    {
      cwd: apiRoot,
      env: testEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    apiOutput = `${apiOutput}${chunk}`.slice(-40_000);
  });
  child.stderr.on('data', (chunk) => {
    apiOutput = `${apiOutput}${chunk}`.slice(-40_000);
  });
  return child;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (api?.exitCode != null) {
      throw new Error(`隔离 API 提前退出，状态码 ${api.exitCode}\n${apiOutput}`);
    }
    try {
      const response = await fetch(`${API_URL}/health/ready`);
      if (response.ok) return;
    } catch {
      // The isolated API is still starting.
    }
    await wait(250);
  }
  throw new Error(`等待隔离 API 启动超时\n${apiOutput}`);
}

async function stopApi() {
  if (api && api.exitCode == null) {
    api.kill('SIGTERM');
    await once(api, 'exit');
  }
  api = null;
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  databaseCreated = true;
  console.log(`隔离浏览器测试数据库：${TEST_DATABASE}`);

  await runProcess(
    process.execPath,
    ['-r', 'ts-node/register', 'src/seed.ts'],
    apiRoot,
  );
  api = startApi();
  await waitForApi();

  const browserCommand = ['pnpm', '--filter', CLIENT, 'test:web'];
  if (playwrightArgs.length) browserCommand.push(...playwrightArgs);
  await runProcess('corepack', browserCommand, repoRoot, browserEnvironment);
} finally {
  await stopApi();
  if (databaseCreated) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [TEST_DATABASE],
    );
    await admin.query(`DROP DATABASE "${TEST_DATABASE}"`);
    console.log('隔离浏览器测试数据库已删除');
  }
  await admin.end();
  await rm(TEST_UPLOAD_DIR, { recursive: true, force: true });
}

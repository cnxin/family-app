import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
// 起隔离库 + 隔离 API，再跑 apps/web 的 Playwright；额外参数原样交给 Playwright（如文件名过滤）。
const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--client')) {
  throw new Error('旧客户端已在 H1 删除，只剩 apps/web，不再需要 --client');
}
async function resolvePort(envValue) {
  if (envValue) return Number(envValue);
  const probe = createNetServer();
  await new Promise((resolvePort, rejectPort) => {
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => resolvePort());
  });
  const { port } = probe.address();
  await new Promise((resolveClose) => probe.close(() => resolveClose()));
  return port;
}
const API_PORT = await resolvePort(process.env.E2E_API_PORT);
const WEB_PORT = await resolvePort(process.env.E2E_WEB_PORT);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const TEST_DATABASE = `family_app_web_test_${randomUUID().replaceAll('-', '')}`;
const TEST_UPLOAD_DIR = join(
  tmpdir(),
  `family-app-web-test-${randomUUID().replaceAll('-', '')}`,
);
const TEST_PASSWORD = `web-${randomUUID()}`;
const WEB_TEST_TOKEN_SECONDS = 3600;
const apiRoot = process.cwd();
const repoRoot = resolve(apiRoot, '../..');
const playwrightArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

if (!/^family_app_web_test_[a-f0-9]+$/.test(TEST_DATABASE)) {
  throw new Error('拒绝使用不安全的浏览器测试数据库名称');
}

const testEnvironment = {
  ...process.env,
  API_URL,
  BOOTSTRAP_SECRET: 'family-app-web-test-bootstrap-secret',
  BOOTSTRAP_SECRET_FILE: '',
  // 第二个是「不安全上下文」冒烟用的来源（playwright.config.ts 的 insecure-context）
  CORS_ORIGINS: `${WEB_URL},http://insecure.test:${WEB_PORT}`,
  DB_NAME: TEST_DATABASE,
  DB_PASSWORD_FILE: '',
  E2E_ACCOUNT_PASSWORD: TEST_PASSWORD,
  E2E_LOGIN_NAME: '爸爸',
  FAMILY_API_URL: API_URL,
  FAMILY_WEB_URL: WEB_URL,
  INTEGRATION_SECRET_KEY: '',
  INTEGRATION_SECRET_KEY_FILE: '',
  // 用例直接拿 auth.setup 存下的访问令牌调 API，整套跑完之前不能过期。
  // 900 秒时 CI 上 Playwright 已跑到 14.5 分钟（见 pre-trial-plan E4），再加用例就一串 401。
  JWT_EXPIRES_SECONDS: String(WEB_TEST_TOKEN_SECONDS),
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
  HOME_ASSISTANT_BASE_URL: '',
  HOME_ASSISTANT_TOKEN: '',
  HOME_ASSISTANT_TOKEN_FILE: '',
  TAILSCALE_API_BASE_URL: '',
  TAILSCALE_TAILNET: '',
  TAILSCALE_PUBLIC_URL: '',
  TAILSCALE_NODE_HOSTNAME: '',
  TAILSCALE_OAUTH_CLIENT_ID: '',
  TAILSCALE_OAUTH_CLIENT_ID_FILE: '',
  TAILSCALE_OAUTH_CLIENT_SECRET: '',
  TAILSCALE_OAUTH_CLIENT_SECRET_FILE: '',
  TAILSCALE_API_TOKEN: '',
  TAILSCALE_API_TOKEN_FILE: '',
  TAILSCALE_ALLOWED_HOUSEHOLD_ID: '',
  TAILSCALE_TIMEOUT_MS: '1500',
  EXTERNAL_ACCESS_POLL_INTERVAL_MS: '300000',
  EXTERNAL_ACCESS_OFFLINE_ATTENTION_MS: '',
  TRUST_PROXY_HOPS: '0',
  // E4 的日程联动轮询；e2e 只验家务打勾，1 秒够用
  SMART_HOME_LINKS_POLL_MS: '1000',
};
const browserEnvironment = {
  ...testEnvironment,
  NODE_ENV: 'development',
  // Vite dev server 直连隔离 API，要自己剥 /api 前缀；
  // E2E_ISOLATED 让 Playwright 不去复用「恰好在这个端口上」的别的 dev server
  FAMILY_API_ORIGIN: API_URL,
  FAMILY_API_STRIP_PREFIX: '1',
  E2E_ISOLATED: '1',
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
let activeChild = null;
let apiOutput = '';
let databaseCreated = false;
let cleanupDone = false;

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function terminateProcess(proc) {
  if (!proc || proc.exitCode != null || proc.signalCode != null) return;
  proc.kill('SIGTERM');
  const exited = await Promise.race([
    once(proc, 'exit').then(() => true),
    wait(5000).then(() => false),
  ]);
  if (!exited && proc.exitCode == null && proc.signalCode == null) {
    proc.kill('SIGKILL');
    await once(proc, 'exit').catch(() => {});
  }
}

async function runProcess(command, args, cwd, environment = testEnvironment) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  activeChild = child;
  try {
    const [code, signal] = await once(child, 'exit');
    if (code !== 0) {
      throw new Error(`${command} 执行失败，状态码 ${code ?? signal}`);
    }
  } finally {
    if (activeChild === child) activeChild = null;
  }
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
    if (api?.exitCode != null || api?.signalCode != null) {
      throw new Error(
        `隔离 API 提前退出，状态码 ${api.exitCode ?? api.signalCode}\n${apiOutput}`,
      );
    }
    if (apiOutput.includes('"event":"api_started"')) {
      try {
        const response = await fetch(`${API_URL}/health/ready`);
        if (response.ok) return;
      } catch {
        // The isolated API is still starting.
      }
    }
    await wait(250);
  }
  throw new Error(`等待隔离 API 启动超时\n${apiOutput}`);
}

async function stopApi() {
  const target = api;
  api = null;
  await terminateProcess(target);
}

async function cleanupResources() {
  if (cleanupDone) return;
  cleanupDone = true;
  await terminateProcess(activeChild);
  await stopApi();
  if (databaseCreated) {
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [TEST_DATABASE],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}"`);
      console.log('隔离浏览器测试数据库已删除');
    } catch {
      // 忽略中断时的清理次生错误
    }
    databaseCreated = false;
  }
  await admin.end().catch(() => {});
  await rm(TEST_UPLOAD_DIR, { recursive: true, force: true }).catch(() => {});
}

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.once(signal, () => {
    void cleanupResources().finally(() => process.exit(code));
  });
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
  // 冒烟要有东西可渲染：走 HTTP 造一套演示数据（幂等，见 demo-data.mjs）
  await runProcess(process.execPath, ['scripts/demo-data.mjs'], apiRoot, {
    ...testEnvironment,
    API_URL,
    DEMO_PASSWORD: TEST_PASSWORD,
  });

  const browserCommand = ['pnpm', '--filter', 'web', 'test:web'];
  if (playwrightArgs.length) browserCommand.push(...playwrightArgs);
  const browserStarted = Date.now();
  try {
    await runProcess('corepack', browserCommand, repoRoot, browserEnvironment);
  } finally {
    // 每次都报一下用了令牌寿命的多少：超过八成就该分片或再拉长，别等到一串 401 才发现
    const minutes = (Date.now() - browserStarted) / 60_000;
    const share = Math.round(((Date.now() - browserStarted) / 1000 / WEB_TEST_TOKEN_SECONDS) * 100);
    const line = `Playwright 用时 ${minutes.toFixed(1)} 分钟，占测试访问令牌寿命（${WEB_TEST_TOKEN_SECONDS / 60} 分钟）的 ${share}%`;
    console.log(share >= 80 ? `⚠️ ${line}，快到上限了` : line);
  }
} finally {
  await cleanupResources();
}

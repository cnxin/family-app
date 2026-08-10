import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const API_PORT = Number(process.env.TEST_API_PORT || 3199);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const TEST_DATABASE = `family_app_test_${randomUUID().replaceAll('-', '')}`;
const TEST_UPLOAD_DIR = join(
  tmpdir(),
  `family-app-api-test-${randomUUID().replaceAll('-', '')}`,
);
const testEnvironment = {
  ...process.env,
  API_URL,
  BOOTSTRAP_SECRET: 'family-app-api-test-bootstrap-secret',
  DB_NAME: TEST_DATABASE,
  CORS_ORIGINS: 'http://localhost:8081,http://192.168.1.20:8081',
  JWT_EXPIRES_SECONDS: '900',
  JWT_SECRET: 'family-app-api-test-secret',
  AGENT_PURGE_POLL_INTERVAL_MS: '100',
  AGENT_ROUTINE_POLL_INTERVAL_MS: '100',
  AGENT_RUNTIME_KEY: 'family-app-api-test-runtime-key',
  AGENT_RUNTIME_URL: 'http://127.0.0.1:3200',
  REFRESH_TOKEN_EXPIRES_SECONDS: '2592000',
  REMINDER_POLL_INTERVAL_MS: '200',
  NOTIFICATION_DELIVERY_POLL_INTERVAL_MS: '100',
  NOTIFICATION_DELIVERY_RETRY_BASE_MS: '100',
  NOTIFICATION_DELIVERY_TIMEOUT_MS: '1000',
  BACKUP_SCHEDULER_POLL_INTERVAL_MS: '100',
  LOGIN_RATE_LIMIT: '100',
  LOGIN_RATE_WINDOW_MS: '60000',
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  PLEX_BASE_URL: '',
  PLEX_TOKEN: '',
  EMBY_BASE_URL: '',
  EMBY_API_KEY: '',
  MOVIEPILOT_BASE_URL: '',
  MOVIEPILOT_API_KEY: '',
  MOVIEPILOT_RECONCILE_ENABLED: 'false',
  OPENWEATHER_API_KEY: '',
  OPENWEATHER_BASE_URL: 'http://127.0.0.1:1',
  TMDB_API_TOKEN: '',
  TMDB_API_KEY: '',
  DOUBAN_API_BASE_URL: '',
  DOUBAN_API_TOKEN: '',
  BANGUMI_API_BASE_URL: 'http://127.0.0.1:1',
  BANGUMI_ACCESS_TOKEN: '',
  SMOKE_DATE: '2199-12-28',
  UPLOAD_DIR: TEST_UPLOAD_DIR,
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
      const response = await fetch(`${API_URL}/health/ready`);
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

function runScript(path, ...args) {
  return runProcess(process.execPath, [path, ...args]);
}

function startApi() {
  activeApiOutput = '';
  const child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/main.ts'], {
    env: testEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    activeApiOutput += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    activeApiOutput += chunk;
    process.stderr.write(chunk);
  });
  return child;
}

function assertApiLogs(output) {
  const records = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const requests = records.filter((record) => record.event === 'http_request');
  const authenticated = requests.find(
    (record) => record.requestId === 'family-test-auth-0001',
  );
  if (
    !authenticated ||
    typeof authenticated.accountId !== 'string' ||
    typeof authenticated.householdId !== 'string' ||
    typeof authenticated.memberId !== 'string' ||
    typeof authenticated.durationMs !== 'number' ||
    authenticated.statusCode !== 200
  ) {
    throw new Error('断言失败: 结构化访问日志缺少已登录家庭上下文');
  }

  const dynamicRoute = requests.find(
    (record) => record.requestId === 'family-test-route-0001',
  );
  if (dynamicRoute?.path !== '/menus/:id/chef') {
    throw new Error('断言失败: 访问日志没有使用脱敏后的路由模板');
  }

  const serverError = requests.find(
    (record) => record.requestId === 'family-test-error-5001',
  );
  const exception = records.find(
    (record) =>
      record.event === 'unhandled_exception' &&
      record.requestId === 'family-test-error-5001',
  );
  if (
    serverError?.statusCode !== 500 ||
    serverError.errorCode !== 'INTERNAL_ERROR' ||
    !exception
  ) {
    throw new Error('断言失败: 500 访问日志与异常日志没有共享请求 ID');
  }

  if (requests.some((record) => record.requestId === 'family-test-health-0001')) {
    throw new Error('断言失败: 成功的健康轮询不应写入访问日志');
  }

  const sensitiveMarkers = [
    'body-sensitive-marker-2468',
    'query-sensitive-marker-9081',
    'header-sensitive-marker-1357',
  ];
  if (sensitiveMarkers.some((marker) => output.includes(marker))) {
    throw new Error('断言失败: API 日志包含请求中的敏感标记');
  }
  if (
    /\b(?:authorization|password|pin|refresh[_-]?token|access[_-]?token)\b/i.test(
      output,
    )
  ) {
    throw new Error('断言失败: API 日志包含敏感字段名称');
  }

  console.log('  ✓ 结构化日志关联请求、家庭上下文与 500 异常');
  console.log('  ✓ 路由、健康轮询和敏感信息日志策略符合预期');
}

async function stopApi() {
  if (api && api.exitCode == null) {
    api.kill('SIGTERM');
    await once(api, 'exit');
  }
  api = null;
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
let activeApiOutput = '';

try {
  await runScript('scripts/hermes-config-contract.mjs');
  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'scripts/agent-runtime.contract.ts',
  ]);
  await admin.connect();
  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'scripts/media-connectors.contract.ts',
  ]);
  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'scripts/moviepilot-reconciliation.contract.ts',
  ]);
  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'scripts/media-metadata.contract.ts',
  ]);
  await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  databaseCreated = true;
  console.log(`临时测试数据库：${TEST_DATABASE}`);

  api = startApi();
  await waitForApi(api);
  await runScript('scripts/bootstrap-invitations.mjs');
  await stopApi();
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
    [TEST_DATABASE],
  );
  await admin.query(`DROP DATABASE "${TEST_DATABASE}"`);
  await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  console.log('  ✓ 全新数据库初始化演练完成，已重建业务测试库');

  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'scripts/prepare-legacy-pin-migration.ts',
  ]);
  await runProcess(process.execPath, ['-r', 'ts-node/register', 'src/seed.ts']);
  await runScript('scripts/verify-legacy-pin-migration.mjs');
  await runProcess(process.execPath, ['-r', 'ts-node/register', 'src/seed.ts']);
  await runScript('scripts/agent-proposal-groups.mjs', '--migration');
  await runScript('scripts/agent-routines.mjs', '--migration');
  await runScript('scripts/agent-profiles.mjs', '--migration');
  await runProcess(process.execPath, [
    '-r',
    'ts-node/register',
    'scripts/check-schema-drift.ts',
  ]);

  api = startApi();
  await waitForApi(api);
  await runScript('scripts/observability.mjs');
  await runScript('scripts/smoke.mjs');
  await runScript('scripts/recipes.mjs');
  await runScript('scripts/calendar.mjs');
  await runScript('scripts/guests.mjs');
  await runScript('scripts/tasks.mjs');
  await runScript('scripts/points.mjs');
  await runScript('scripts/finance.mjs');
  await runScript('scripts/polls.mjs');
  await runScript('scripts/reminders.mjs');
  await runScript('scripts/external-notifications.mjs');
  await runScript('scripts/backups.mjs');
  await runScript('scripts/knowledge.mjs');
  await runScript('scripts/memories.mjs');
  await runScript('scripts/agent.mjs');
  await runScript('scripts/agent-retention.mjs');
  await runScript('scripts/agent-profiles.mjs');
  await runScript('scripts/agent-memory.mjs');
  await runScript('scripts/agent-tools.mjs');
  await runScript('scripts/agent-page-context.mjs');
  await runScript('scripts/agent-routines.mjs');
  await runScript('scripts/agent-proposal-groups.mjs');
  await runScript('scripts/travel.mjs');
  await runScript('scripts/members-activities.mjs');
  await runScript('scripts/media.mjs');
  await runScript('scripts/media-source-settings.mjs');
  await runScript('scripts/media-connector-settings.mjs');
  await runScript('scripts/moviepilot-webhook.mjs');
  await runScript('scripts/media-library.mjs');
  await runScript('scripts/playback-webhook.mjs');
  await runScript('scripts/household-isolation.mjs');
  await runScript('scripts/security-consistency.mjs');
  await runScript('scripts/shopping-inventory.mjs');
  await runScript('scripts/food-batches-smart-menu.mjs');
  await runScript('scripts/assets.mjs');
  await wait(50);
  assertApiLogs(activeApiOutput);

  await stopApi();
  testEnvironment.LOGIN_RATE_LIMIT = '3';
  api = startApi();
  await waitForApi(api);
  await runScript('scripts/login-rate-limit.mjs');
} finally {
  await stopApi();
  if (databaseCreated) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [TEST_DATABASE],
    );
    await admin.query(`DROP DATABASE "${TEST_DATABASE}"`);
    console.log('临时测试数据库已删除');
  }
  await admin.end();
  await rm(TEST_UPLOAD_DIR, { recursive: true, force: true });
}

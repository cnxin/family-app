import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const timings = [];

async function runScript(path, ...args) {
  const startedAt = Date.now();
  try {
    await runProcess(process.execPath, [path, ...args]);
  } finally {
    timings.push({ script: path.replace(/^scripts\//, ''), ms: Date.now() - startedAt });
  }
}

// 业务黑盒脚本，按依赖顺序排列；--only 过滤时保持这个顺序。
const BUSINESS_SCRIPTS = [
  'observability',
  'smoke',
  'recipes',
  'calendar',
  'guests',
  'tasks',
  'points',
  'finance',
  'polls',
  'reminders',
  'external-notifications',
  'backups',
  'knowledge',
  'memories',
  'agent',
  'agent-retention',
  'agent-profiles',
  'agent-memory',
  'agent-tools',
  'agent-page-context',
  'agent-routines',
  'agent-proposal-groups',
  'travel',
  'members-activities',
  'media',
  'media-source-settings',
  'media-connector-settings',
  'moviepilot-webhook',
  'media-library',
  'playback-webhook',
  'system-modules',
  'household-isolation',
  'security-consistency',
  'shopping-inventory',
  'food-batches-smart-menu',
  'assets',
];

function parseCliOptions(argv) {
  const options = { only: null, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--list') options.list = true;
    else if (argument === '--only') {
      options.only = (argv[index + 1] ?? '').split(',');
      index += 1;
    } else if (argument.startsWith('--only=')) {
      options.only = argument.slice('--only='.length).split(',');
    }
  }
  if (options.only) {
    options.only = options.only.map((name) => name.trim().replace(/\.mjs$/, '')).filter(Boolean);
    const unknown = options.only.filter((name) => !BUSINESS_SCRIPTS.includes(name));
    if (unknown.length) {
      throw new Error(
        `--only 包含未知脚本：${unknown.join(', ')}。可用脚本见 --list。`,
      );
    }
  }
  return options;
}

function printTimings() {
  if (!timings.length) return;
  const width = Math.max(...timings.map((item) => item.script.length));
  console.log('\n脚本耗时（毫秒）：');
  for (const item of timings) {
    console.log(`  ${item.script.padEnd(width)}  ${String(item.ms).padStart(7)}`);
  }
  const total = timings.reduce((sum, item) => sum + item.ms, 0);
  console.log(`  ${'合计'.padEnd(width)}  ${String(total).padStart(7)}`);
}

const cliOptions = parseCliOptions(process.argv.slice(2));
if (cliOptions.list) {
  console.log(BUSINESS_SCRIPTS.join('\n'));
  process.exit(0);
}
// pg 延迟加载，让 --list / 参数错误在没有 node_modules 时也能工作
const { Client } = (await import('pg')).default;
const selectedScripts = cliOptions.only
  ? BUSINESS_SCRIPTS.filter((name) => cliOptions.only.includes(name))
  : BUSINESS_SCRIPTS;
const fullRun = !cliOptions.only;

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
  if (fullRun) {
    await runScript('scripts/hermes-config-contract.mjs');
    await runProcess(process.execPath, [
      '-r',
      'ts-node/register',
      'scripts/agent-runtime.contract.ts',
    ]);
  }
  await admin.connect();
  if (fullRun) {
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
  }
  await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  databaseCreated = true;
  console.log(`临时测试数据库：${TEST_DATABASE}`);

  if (fullRun) {
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
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/check-module-migration.ts']);
    await runProcess(process.execPath, [
      '-r',
      'ts-node/register',
      'scripts/check-schema-drift.ts',
    ]);
  } else {
    // --only：跳过契约、初始化演练与旧 PIN 迁移，只灌种子后直接跑选中的业务脚本
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'src/seed.ts']);
    console.log(`  ✓ --only 模式，只运行：${selectedScripts.join(', ')}`);
  }

  api = startApi();
  await waitForApi(api);
  for (const name of selectedScripts) {
    await runScript(`scripts/${name}.mjs`);
  }
  // 日志断言依赖 observability.mjs 与 security-consistency.mjs 两个脚本发出的请求 ID
  if (
    fullRun ||
    (selectedScripts.includes('observability') &&
      selectedScripts.includes('security-consistency'))
  ) {
    await wait(50);
    assertApiLogs(activeApiOutput);
  }

  if (fullRun) {
    await stopApi();
    testEnvironment.LOGIN_RATE_LIMIT = '3';
    api = startApi();
    await waitForApi(api);
    await runScript('scripts/login-rate-limit.mjs');
  }
} finally {
  printTimings();
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

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_PORT = Number(process.env.TEST_API_PORT || 3199);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const TEST_DATABASE = `family_app_test_${randomUUID().replaceAll('-', '')}`;
// API 的标准输出同时写一份到这个文件，脚本可以数日志（比如「落失败只记一次」）
const API_LOG_FILE = join(tmpdir(), `family-app-api-log-${randomUUID()}.log`);
const TEST_UPLOAD_DIR = join(
  tmpdir(),
  `family-app-api-test-${randomUUID().replaceAll('-', '')}`,
);
const testEnvironment = {
  API_LOG_FILE,
  ...process.env,
  API_URL,
  BOOTSTRAP_SECRET: 'family-app-api-test-bootstrap-secret',
  DB_NAME: TEST_DATABASE,
  CORS_ORIGINS: 'http://localhost:8081,http://192.168.1.20:8081',
  JWT_EXPIRES_SECONDS: '900',
  JWT_SECRET: 'family-app-api-test-secret',
  AGENT_PURGE_POLL_INTERVAL_MS: '100',
  AGENT_ROUTINE_POLL_INTERVAL_MS: '100',
  FINANCE_RECURRING_POLL_INTERVAL_MS: '200',
  AGENT_RUNTIME_KEY: 'family-app-api-test-runtime-key',
  // J4.2：native 运行时的模型在测试里换成回放套件（按原话挑录制，其余走剧本模型），只在测试模式生效
  AGENT_NATIVE_PROVIDER: `replay:${join(dirname(fileURLToPath(import.meta.url)), 'fixtures/agent-native/suite.json')}`,
  AGENT_RUNTIME_URL: 'http://127.0.0.1:3200',
  REFRESH_TOKEN_EXPIRES_SECONDS: '2592000',
  REMINDER_POLL_INTERVAL_MS: '200',
  NOTIFICATION_DELIVERY_POLL_INTERVAL_MS: '100',
  NOTIFICATION_DELIVERY_RETRY_BASE_MS: '100',
  NOTIFICATION_DELIVERY_TIMEOUT_MS: '1000',
  BACKUP_SCHEDULER_POLL_INTERVAL_MS: '100',
  BACKUP_EVENTS_WATCH_MS: '200',
  EVENTS_HEARTBEAT_MS: '300',
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
  // 服务器默认预留了地址、令牌文件还不存在：和演示栈刚装好 HA 时一样（smart-home.mjs 验这一点）
  HOME_ASSISTANT_BASE_URL: 'http://127.0.0.1:1',
  HOME_ASSISTANT_TOKEN: '',
  HOME_ASSISTANT_TOKEN_FILE: join(tmpdir(), `family-app-ha-token-missing-${randomUUID()}.txt`),
  HOME_ASSISTANT_COMMAND_TIMEOUT_MS: '1500',
  SMART_HOME_POLL_MS: '300',
  SMART_HOME_RECONNECT_MIN_MS: '200',
  SMART_HOME_RECONNECT_MAX_MS: '1000',
  SMART_HOME_RECONCILE_MS: '1000',
  SMART_HOME_LINKS_POLL_MS: '300',
  SMOKE_DATE: '2199-12-28',
  UPLOAD_DIR: TEST_UPLOAD_DIR,
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForApi(processHandle) {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processHandle.exitCode != null) {
      throw new Error(`API 提前退出，状态码 ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(`${API_URL}/health/ready`);
      if (response.ok) {
        // 启动耗时进日志：ts-node 随代码变多会变慢，超时前能先看出趋势
        console.log(`  ✓ API 就绪用时 ${Date.now() - startedAt}ms`);
        return;
      }
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
let timingLabel = '';

async function runScript(path, ...args) {
  const startedAt = Date.now();
  try {
    await runProcess(process.execPath, [path, ...args]);
  } finally {
    timings.push({ script: `${path.replace(/^scripts\//, '')}${timingLabel}`, ms: Date.now() - startedAt });
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
  'tasks-points-hook',
  'finance',
  'finance-recurring',
  'finance-credit',
  'finance-import',
  'finance-edit',
  'finance-screenshot',
  'assistant-utterances',
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
  'agent-routines',
  'agent-proposal-groups',
  'agent-native',
  'agent-cloud',
  'travel',
  'members-activities',
  'media',
  'media-source-settings',
  'media-connector-settings',
  'moviepilot-webhook',
  'media-library',
  'playback-webhook',
  'system-modules',
  'smart-home',
  'smart-home-control',
  'smart-home-webhook',
  'smart-home-links',
  'smart-home-link-hooks',
  'smart-home-panel',
  'smart-home-attention',
  'today-attention',
  'events',
  'households',
  'household-isolation',
  'security-consistency',
  'shopping-inventory',
  'food-batches',
  'assets',
  'assets-inventory-rollback',
  'locations',
  'map',
  'map-rooms',
  'upload',
  'password-setup',
];

function parseCliOptions(argv) {
  const options = { only: null, list: false, agentRuntime: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--list') options.list = true;
    // --agent-runtime=native：本地确定性助理改由 native 循环 + 剧本模型执行；both：先照常跑，再换干净的库在 native 下
    // 把选中的 agent*.mjs 跑第二遍（全量模式默认就是 both）
    else if (argument.startsWith('--agent-runtime=')) options.agentRuntime = argument.slice('--agent-runtime='.length);
    else if (argument === '--only') {
      options.only = (argv[index + 1] ?? '').split(',');
      index += 1;
    } else if (argument.startsWith('--only=')) {
      options.only = argument.slice('--only='.length).split(',');
    }
  }
  if (options.agentRuntime && !['native', 'both'].includes(options.agentRuntime)) {
    throw new Error(`--agent-runtime 只认 native / both：${options.agentRuntime}`);
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
if (cliOptions.agentRuntime === 'native') testEnvironment.AGENT_TEST_RUNTIME = 'native';
/** J4.2：在 native 运行时下再跑一遍的脚本——选中的 agent*.mjs（全量即全部）。 */
const AGENT_SCRIPTS = selectedScripts.filter((name) => name.startsWith('agent'));
const nativeSecondPass = (fullRun || cliOptions.agentRuntime === 'both') && AGENT_SCRIPTS.length > 0;

function startApi() {
  activeApiOutput = '';
  writeFileSync(API_LOG_FILE, '');
  const child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/main.ts'], {
    env: testEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    activeApiOutput += chunk;
    appendFileSync(API_LOG_FILE, chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    activeApiOutput += chunk;
    appendFileSync(API_LOG_FILE, chunk);
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

const DB_CONNECTION = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
};
const admin = new Client({ ...DB_CONNECTION, database: 'postgres' });
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
    // 迁移演练一律在有数据的库上跑（教训 29）：先经 API 灌夹具，再停 API 做 up → down → up。
    api = startApi();
    await waitForApi(api);
    await runScript('scripts/migration-fixture.mjs');
    await stopApi();
    await runScript('scripts/agent-proposal-groups.mjs', '--migration');
    await runScript('scripts/agent-routines.mjs', '--migration');
    await runScript('scripts/agent-profiles.mjs', '--migration');
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/check-module-migration.ts']);
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/check-upgrade-migration.ts']);
    await runProcess(process.execPath, [
      '-r',
      'ts-node/register',
      'scripts/check-schema-drift.ts',
    ]);
    // J1b：内核注册表与共享纯函数的单测
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/kernel-units.check.ts']);
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/finance-recurring.check.ts']);
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/finance-import.check.ts']);
    // J4 第四批 K2：截图记账的纯函数（付款方式 → 账户、回复解析、日期归一、文件头）
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/finance-screenshot.check.ts']);
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/multipart.check.ts']);
    // J4.0：packages/agent-core 的单测（录制回放，不打真模型）
    await runProcess(process.execPath, [
      '-r',
      'ts-node/register',
      '../../packages/agent-core/tests/agent-core.check.ts',
    ]);
    // J4.1：小管家工具注册表（MCP tools/list 快照、schema、工具集合 == manifest、别名）
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/agent-tools.check.ts']);
    // J4 第四批：设备一句状态 @family/shared 与 web 卡片两份实现一致（小管家 get_device_status 用前者）
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/smart-home-status.check.ts']);
    // J4.3：发给云端模型前的脱敏
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'scripts/agent-redact.check.ts']);
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
    const loginRateLimit = testEnvironment.LOGIN_RATE_LIMIT;
    testEnvironment.LOGIN_RATE_LIMIT = '3';
    api = startApi();
    await waitForApi(api);
    await runScript('scripts/login-rate-limit.mjs');

    await stopApi();
    testEnvironment.LOGIN_RATE_LIMIT = loginRateLimit;
  }
  if (nativeSecondPass) {
    // J4.2 第二遍：全部 agent*.mjs 在 native 运行时下再跑一遍——本地助理的剧本改由 native 循环 + 剧本模型执行，
    // agent-native 用回放录制。黑盒不能在同一个库上重跑（固定日期的数据会撞），所以换干净的库：灌种子、
    // 补跑三个 agent 黑盒的迁移演练（agent-profiles 等的 API 阶段要用它们造的历史数据），再起 API。
    await stopApi();
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [TEST_DATABASE]);
    await admin.query(`DROP DATABASE "${TEST_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
    await runProcess(process.execPath, ['-r', 'ts-node/register', 'src/seed.ts']);
    testEnvironment.AGENT_TEST_RUNTIME = 'native';
    timingLabel = '（native）';
    console.log(`\n第二遍：${AGENT_SCRIPTS.join('、')} 在 native 运行时下（干净的库）`);
    for (const name of ['agent-proposal-groups', 'agent-routines', 'agent-profiles']) {
      if (AGENT_SCRIPTS.includes(name)) await runScript(`scripts/${name}.mjs`, '--migration');
    }
    api = startApi();
    await waitForApi(api);
    for (const name of AGENT_SCRIPTS) {
      await runScript(`scripts/${name}.mjs`);
    }
    // 确认第二遍真的走了 native：经 API 开的 run，运行时版本全是 native 循环，没有一个是本地确定性助理
    const verify = new Client({ ...DB_CONNECTION, database: TEST_DATABASE });
    await verify.connect();
    const versions = Object.fromEntries((await verify.query(
      `SELECT "runtimeVersion" AS version, COUNT(*)::int AS count FROM agent_runs
        WHERE "runtimeVersion" IN ('family-fake-2', 'native-loop-1') GROUP BY 1`,
    )).rows.map((row) => [row.version, row.count]));
    await verify.end();
    if (versions['family-fake-2'] || !versions['native-loop-1']) {
      throw new Error(`断言失败: 第二遍的 run 没有全部走 native（${JSON.stringify(versions)}）`);
    }
    console.log(`  ✓ 第二遍经 API 开的 ${versions['native-loop-1']} 个 run 全部走 native 循环（runtimeVersion=native-loop-1）`);
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
  await rm(API_LOG_FILE, { force: true });
}

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('ts-node/register');
const AppDataSource = require('../src/database/data-source.ts').default;
const { AgentRoutineService } = require(
  '../src/agent/agent-routine.service.ts',
);
const {
  AgentRoutine,
  AgentRoutineItem,
  AgentSetting,
} = require('../src/entities/index.ts');

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('agent-routines.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function waitFor(check, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return value;
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录例行任务回归`);
  return response.data;
}

async function runMigrationPhase() {
  await AppDataSource.initialize();
  try {
    let latest = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    if (latest[0]?.name === 'AddSubscriptionRenewalCycle1785232300000') {
      await AppDataSource.undoLastMigration();
      latest = await AppDataSource.query(
        `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
      );
      const renewalColumn = await AppDataSource.query(
        `SELECT count(*)::int AS n
         FROM information_schema.columns
         WHERE table_name = 'home_assets'
           AND column_name = 'renewalIntervalMonths'`,
      );
      assert(
        latest[0]?.name === 'AddSubscriptionAsset1785232200000' &&
          renewalColumn[0].n === 0,
        '订阅续费周期迁移可干净回退并移除新增列',
      );
    }
    if (latest[0]?.name === 'AddSubscriptionAsset1785232200000') {
      const owners = await AppDataSource.query(
        `SELECT id, "householdId" FROM members
         WHERE role = 'owner' AND "disabledAt" IS NULL
         ORDER BY "createdAt" ASC LIMIT 1`,
      );
      const owner = owners[0];
      if (!owner) throw new Error('找不到订阅资产迁移专项所需的家庭 owner');
      const subscriptionId = randomUUID();
      await AppDataSource.query(
        `INSERT INTO home_assets (
           id, "householdId", name, category, "renewsOn", "createdById"
         ) VALUES ($1, $2, '迁移回退测试订阅', 'subscription', CURRENT_DATE + 7, $3)`,
        [subscriptionId, owner.householdId, owner.id],
      );
      await AppDataSource.undoLastMigration();
      latest = await AppDataSource.query(
        `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
      );
      const subscriptionRows = await AppDataSource.query(
        `SELECT count(*)::int AS n FROM home_assets WHERE id = $1`,
        [subscriptionId],
      );
      const categoryCheck = await AppDataSource.query(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conname = 'CHK_home_assets_category'`,
      );
      assert(
        latest[0]?.name === 'AddFamilyFinance1785232100000' &&
          subscriptionRows[0].n === 0 &&
          !categoryCheck[0]?.definition.includes('subscription'),
        '有 subscription 资产时迁移先删行再还原五类 CHECK',
      );
    }
    if (latest[0]?.name === 'AddFamilyFinance1785232100000') {
      await AppDataSource.undoLastMigration();
      latest = await AppDataSource.query(
        `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
      );
    }
    if (latest[0]?.name === 'AddAgentProposalGroups1785232000000') {
      await AppDataSource.undoLastMigration();
      latest = await AppDataSource.query(
        `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
      );
    }
    assert(
      latest[0]?.name === 'AddAgentWeeklyReport1785231900000',
      '专项演练从 A7.4-B 周报迁移开始',
    );
    const owners = await AppDataSource.query(
      `SELECT id, "householdId" FROM members
       WHERE role = 'owner' AND "disabledAt" IS NULL
       ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const owner = owners[0];
    if (!owner) throw new Error('找不到迁移专项所需的家庭 owner');
    await AppDataSource.query(
      `INSERT INTO agent_routines (
         "householdId", kind, enabled, "scheduleHour", "scheduleMinute",
         "nextRunAt"
       ) VALUES ($1, 'weekly_report', false, 20, 0, now() + interval '7 days')
       ON CONFLICT ("householdId", kind) DO NOTHING`,
      [owner.householdId],
    );
    await AppDataSource.undoLastMigration();
    const previous = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    const weeklyRows = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM agent_routines WHERE kind = 'weekly_report'`,
    );
    assert(
      previous[0]?.name === 'AddAgentRoutines1785231800000' &&
        weeklyRows[0].n === 0,
      '存在 weekly_report 行时周报迁移仍可先删数据再干净回退',
    );
    await AppDataSource.undoLastMigration();
    const memoryMigration = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      memoryMigration[0]?.name === 'AddAgentMemory1785231700000',
      '继续回退后仍可演练 A7.4-B 第一批迁移',
    );

    const insertedSettings = await AppDataSource.query(
      `INSERT INTO agent_settings (
         "householdId", enabled, "updatedByMemberId"
       ) VALUES ($1, false, $2)
       ON CONFLICT ("householdId") DO NOTHING
       RETURNING id`,
      [owner.householdId, owner.id],
    );

    await AppDataSource.runMigrations();
    const settings = await AppDataSource.query(
      `SELECT "dailyRoutineNotificationLimit", "routineNotificationsEnabled"
       FROM agent_settings WHERE "householdId" = $1`,
      [owner.householdId],
    );
    const routines = await AppDataSource.query(
      `SELECT kind, enabled, "scheduleHour", "scheduleMinute", "nextRunAt"
       FROM agent_routines WHERE "householdId" = $1`,
      [owner.householdId],
    );
    assert(
      settings[0]?.dailyRoutineNotificationLimit === 3 &&
        settings[0]?.routineNotificationsEnabled === false,
      '既有 agent_settings 行真实回填每日上限 3 且例行通知默认关闭',
    );
    assert(
      routines[0]?.kind === 'nightly_digest' &&
        routines[0]?.enabled === false &&
        routines[0]?.scheduleHour === 21 &&
        routines[0]?.scheduleMinute === 0 &&
        Boolean(routines[0]?.nextRunAt),
      '既有家庭回填默认关闭的 21:00 每晚汇总',
    );
    if (insertedSettings[0]?.id) {
      await AppDataSource.query(`DELETE FROM agent_settings WHERE id = $1`, [
        insertedSettings[0].id,
      ]);
    }
    console.log('A7.4-B 周报与第一批迁移回退、既有行和重新迁移专项通过');
  } finally {
    await AppDataSource.destroy();
  }
}

async function createHouseholdFixture(
  db,
  label,
  {
    notificationsEnabled = true,
    limit = 3,
    ownerDisabled = false,
    withAdmin = false,
    kind = 'nightly_digest',
    enabled = true,
  } = {},
) {
  const householdId = randomUUID();
  const ownerId = randomUUID();
  const adminId = withAdmin ? randomUUID() : null;
  const routineId = randomUUID();
  await db.query(
    `INSERT INTO households (id, name, slug)
     VALUES ($1, $2, $3)`,
    [householdId, `例行任务${label}`, `agent-routine-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO members (
       id, "householdId", name, "avatarEmoji", role, "disabledAt"
     ) VALUES ($1, $2, $3, 'O', 'owner', $4)`,
    [ownerId, householdId, `${label} owner`, ownerDisabled ? new Date() : null],
  );
  if (adminId) {
    await db.query(
      `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
       VALUES ($1, $2, $3, 'A', 'admin')`,
      [adminId, householdId, `${label} admin`],
    );
  }
  await db.query(
    `INSERT INTO agent_settings (
       "householdId", enabled, "dailyRoutineNotificationLimit",
       "routineNotificationsEnabled", "updatedByMemberId"
     ) VALUES ($1, false, $2, $3, $4)`,
    [householdId, limit, notificationsEnabled, ownerId],
  );
  await db.query(
    `INSERT INTO agent_routines (
       id, "householdId", kind, enabled, "scheduleHour", "scheduleMinute",
       "nextRunAt"
     ) VALUES ($1, $2, $3, $4, $5, 0, now() + interval '1 day')`,
    [routineId, householdId, kind, enabled, kind === 'weekly_report' ? 20 : 21],
  );
  return { householdId, ownerId, adminId, routineId };
}

function notificationInput(fixture, label, summary = `${label}待处理事项`) {
  return {
    householdId: fixture.householdId,
    routineKind: 'nightly_digest',
    sourceType: 'test_fact',
    sourceId: randomUUID(),
    type: 'agent_routine_test',
    title: `${label}例行提醒`,
    summary,
    targetPath: '/assistant',
  };
}

async function runApiPhase() {
  await AppDataSource.initialize();
  const db = AppDataSource;
  const weeklyMetrics = new Map();
  const calendar = {
    list: async (_start, _end, user) =>
      weeklyMetrics.get(user.householdId)?.calendar ?? [],
  };
  const shopping = {
    list: async (householdId, date) =>
      (weeklyMetrics.get(householdId)?.shopping ?? []).filter(
        (item) => item.date === date,
      ),
  };
  const inventory = {
    list: async (householdId) =>
      weeklyMetrics.get(householdId)?.inventory ?? [],
  };
  const service = new AgentRoutineService(
    db.getRepository(AgentRoutine),
    db.getRepository(AgentRoutineItem),
    db.getRepository(AgentSetting),
    calendar,
    shopping,
    inventory,
    db,
  );
  // 让本脚本这个使用 stub 数据的 service 独占派发：在同一事务里把例行任务置为到期，
  // 事务持有这些行的锁，API 进程自己的轮询器（FOR UPDATE SKIP LOCKED）会跳过它们，
  // 不会用真实库数据抢先生成周报/晚报，导致断言里的聚合文案对不上（之前是偶发失败）。
  async function dispatchExclusively(routineIds) {
    await db.transaction(async (manager) => {
      await manager.query(
        `UPDATE agent_routines SET "nextRunAt" = now() - interval '1 minute'
         WHERE id = ANY($1::uuid[])`,
        [routineIds],
      );
      const scoped = new AgentRoutineService(
        manager.getRepository(AgentRoutine),
        manager.getRepository(AgentRoutineItem),
        manager.getRepository(AgentSetting),
        calendar,
        shopping,
        inventory,
        { transaction: (callback) => callback(manager) },
      );
      await scoped.dispatchDue();
    });
  }
  try {
    const owner = await login('爸爸');
    const member = await login('妈妈');

    console.log('1. 管理权限、设置 PATCH 与乐观并发');
    const routines = await request('/agent/routines', owner.accessToken);
    const memberRoutines = await request('/agent/routines', member.accessToken);
    const current = routines.data.find(
      (routine) => routine.kind === 'nightly_digest',
    );
    const currentWeekly = routines.data.find(
      (routine) => routine.kind === 'weekly_report',
    );
    const updated = await request(
      '/agent/routines/nightly_digest',
      owner.accessToken,
      'PATCH',
      {
        enabled: true,
        scheduleHour: 22,
        scheduleMinute: 15,
        householdId: randomUUID(),
        memberId: randomUUID(),
        expectedVersion: current.version,
      },
    );
    const stale = await request(
      '/agent/routines/nightly_digest',
      owner.accessToken,
      'PATCH',
      { enabled: false, expectedVersion: current.version },
    );
    const nextWeeklyRun = new Date(
      new Date(currentWeekly.nextRunAt).getTime() + 7 * 86_400_000,
    ).toISOString();
    const weeklyUpdated = await request(
      '/agent/routines/weekly_report',
      owner.accessToken,
      'PATCH',
      {
        enabled: true,
        nextRunAt: nextWeeklyRun,
        householdId: randomUUID(),
        memberId: randomUUID(),
        expectedVersion: currentWeekly.version,
      },
    );
    const settings = await request('/agent/settings', owner.accessToken);
    const settingsUpdated = await request(
      '/agent/settings',
      owner.accessToken,
      'PATCH',
      {
        dailyRoutineNotificationLimit: 4,
        routineNotificationsEnabled: true,
        householdId: randomUUID(),
        memberId: randomUUID(),
        expectedVersion: settings.data.version,
      },
    );
    const deliveryDisabled = await request(
      '/agent/routines/nightly_digest/delivery',
      owner.accessToken,
      'PUT',
      {
        enabled: false,
        expectedSettingsVersion: settingsUpdated.data.version,
        expectedRoutineVersion: updated.data.version,
      },
    );
    const disabledSettings = await request('/agent/settings', owner.accessToken);
    const disabledRoutines = await request('/agent/routines', owner.accessToken);
    const disabledNightly = disabledRoutines.data.find(
      (routine) => routine.kind === 'nightly_digest',
    );
    const deliveryRestored = await request(
      '/agent/routines/nightly_digest/delivery',
      owner.accessToken,
      'PUT',
      {
        enabled: true,
        expectedSettingsVersion: deliveryDisabled.data.settingsVersion,
        expectedRoutineVersion: deliveryDisabled.data.routine.version,
      },
    );
    assert(
      routines.status === 200 &&
        routines.data.length === 2 &&
        memberRoutines.status === 403 &&
        currentWeekly.enabled === false &&
        currentWeekly.scheduleHour === 20 &&
        currentWeekly.scheduleMinute === 0 &&
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          weekday: 'short',
        }).format(new Date(currentWeekly.nextRunAt)) === 'Sun' &&
        weeklyUpdated.status === 200 &&
        weeklyUpdated.data.enabled === true &&
        weeklyUpdated.data.nextRunAt === nextWeeklyRun &&
        updated.status === 200 &&
        updated.data.scheduleHour === 22 &&
        updated.data.scheduleMinute === 15 &&
        stale.status === 409 &&
        settingsUpdated.status === 200 &&
        settingsUpdated.data.dailyRoutineNotificationLimit === 4 &&
        settingsUpdated.data.routineNotificationsEnabled === true &&
        deliveryDisabled.status === 200 &&
        deliveryDisabled.data.enabled === false &&
        disabledSettings.data.routineNotificationsEnabled === false &&
        disabledNightly.enabled === false &&
        deliveryRestored.status === 200 &&
        deliveryRestored.data.enabled === true,
      '仅 manage_agent 可管理两种例行任务，周报默认周日 20:00 关闭且 PATCH 支持 nextRunAt',
    );
    assert(
      deliveryDisabled.data.settingsVersion === settingsUpdated.data.version + 1 &&
        deliveryDisabled.data.routine.version === updated.data.version + 1,
      '主动提醒通过单一事务同时更新通知总开关与夜间汇总任务',
    );

    console.log('2. 每日通知上限、limit=0 与关闭时仍积压');
    const limited = await createHouseholdFixture(db, '上限', {
      limit: 1,
      withAdmin: true,
    });
    const limitedResults = [
      await service.enqueueNotification(
        notificationInput(
          limited,
          '上限一',
          'AGENT_DATA_KEY=routine-test-secret 上限一待处理事项',
        ),
      ),
      ...(await Promise.all([
        service.enqueueNotification(notificationInput(limited, '上限二')),
        service.enqueueNotification(notificationInput(limited, '上限三')),
      ])),
    ];
    const limitedNotifications = await db.query(
      `SELECT "recipientId" FROM notifications
       WHERE "householdId" = $1 AND module = 'agent'`,
      [limited.householdId],
    );
    const limitedPending = await db.query(
      `SELECT id FROM agent_routine_items
       WHERE "householdId" = $1 AND status = 'pending'`,
      [limited.householdId],
    );
    assert(
      limitedResults.filter((result) => result.delivered).length === 1 &&
        limitedResults.filter((result) => result.queued).length === 2 &&
        limitedNotifications.length === 1 &&
        limitedNotifications[0].recipientId === limited.ownerId &&
        limitedPending.length === 2,
      'limit=1 时只向 owner 发一条即时通知，其余事项进入 pending',
    );

    const zero = await createHouseholdFixture(db, '零上限', { limit: 0 });
    await service.enqueueNotification(notificationInput(zero, '零上限一'));
    await service.enqueueNotification(notificationInput(zero, '零上限二'));
    const zeroState = await db.query(
      `SELECT
         (SELECT count(*)::int FROM notifications WHERE "householdId" = $1 AND module = 'agent') AS notifications,
         (SELECT count(*)::int FROM agent_routine_items WHERE "householdId" = $1 AND status = 'pending') AS pending`,
      [zero.householdId],
    );
    assert(
      zeroState[0].notifications === 0 && zeroState[0].pending === 2,
      'limit=0 时不发即时通知，全部事项进入 pending',
    );

    const disabled = await createHouseholdFixture(db, '通知关闭', {
      notificationsEnabled: false,
    });
    await service.enqueueNotification(
      notificationInput(
        disabled,
        '通知关闭',
        'AGENT_DATA_KEY=routine-test-secret 待处理事项',
      ),
    );
    const disabledState = await db.query(
      `SELECT
         (SELECT count(*)::int FROM notifications WHERE "householdId" = $1 AND module = 'agent') AS notifications,
         (SELECT count(*)::int FROM agent_routine_items WHERE "householdId" = $1 AND status = 'pending') AS pending,
         (SELECT summary FROM agent_routine_items WHERE "householdId" = $1 LIMIT 1) AS summary`,
      [disabled.householdId],
    );
    assert(
      disabledState[0].notifications === 0 &&
        disabledState[0].pending === 1 &&
        !disabledState[0].summary.includes('routine-test-secret'),
      'routineNotificationsEnabled=false 时不发通知但保留脱敏后的 pending',
    );

    console.log('3. 家庭隔离、owner-only、停用 owner 容错与提案硬约束');
    const familyA = await createHouseholdFixture(db, '家庭A', {
      withAdmin: true,
    });
    const familyB = await createHouseholdFixture(db, '家庭B');
    const noOwner = await createHouseholdFixture(db, '停用Owner', {
      ownerDisabled: true,
    });
    const healthy = await createHouseholdFixture(db, '健康家庭');
    await db.query(
      `INSERT INTO agent_routine_items (
         "householdId", "routineKind", "sourceType", "sourceId", summary
       ) VALUES
         ($1, 'nightly_digest', 'test_fact', $2, '仅家庭A可见的事项'),
         ($3, 'nightly_digest', 'test_fact', $4, '仅家庭B可见的事项')`,
      [familyA.householdId, randomUUID(), familyB.householdId, randomUUID()],
    );
    const confirmedBefore = await db.query(
      `SELECT count(*)::int AS n FROM agent_action_proposals
       WHERE status = 'confirmed'`,
    );
    const profileId = randomUUID();
    const conversationId = randomUUID();
    await db.query(
      `INSERT INTO agent_member_profiles (
         id, "householdId", "memberId", enabled, "assistantName",
         "responseStyle", "memoryEnabled", "memorySuggestionEnabled",
         "proactiveRoutinesEnabled"
       ) VALUES ($1, $2, $3, true, '小管家', 'balanced', true, false, false)`,
      [profileId, familyA.householdId, familyA.ownerId],
    );
    await db.query(
      `INSERT INTO agent_conversations (
         id, "householdId", "createdByMemberId", "agentProfileId", title,
         "expiresAt"
       ) VALUES ($1, $2, $3, $4, '例行任务敏感正文隔离', now() + interval '7 days')`,
      [conversationId, familyA.householdId, familyA.ownerId, profileId],
    );
    await db.query(
      `INSERT INTO agent_messages (
         "householdId", "conversationId", "memberId", role,
         "contentCiphertext", "contentNonce", "contentVersion"
       ) VALUES ($1, $2, $3, 'user', 'conversation-secret', 'test-nonce', 1)`,
      [familyA.householdId, conversationId, familyA.ownerId],
    );
    await db.query(
      `INSERT INTO agent_memory_items (
         "householdId", "ownerMemberId", scope, kind, category, "memoryKey",
         "contentCiphertext", "contentNonce", "contentVersion", "sourceType",
         status, "confidenceSource"
       ) VALUES (
         $1, $2, 'member_private', 'preference', 'other', 'other',
         'memory-secret', 'test-nonce', 1, 'user_explicit', 'candidate', 'explicit'
       )`,
      [familyA.householdId, familyA.ownerId],
    );
    await dispatchExclusively([
      familyA.routineId,
      familyB.routineId,
      noOwner.routineId,
      healthy.routineId,
    ]);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const delivered = await db.query(
        `SELECT count(*)::int AS n FROM notifications
         WHERE "householdId" = ANY($1::uuid[])
           AND module = 'agent' AND type = 'agent_nightly_digest'`,
        [[familyA.householdId, familyB.householdId]],
      );
      if (delivered[0].n === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const confirmedAfter = await db.query(
      `SELECT count(*)::int AS n FROM agent_action_proposals
       WHERE status = 'confirmed'`,
    );
    const workerNotifications = await db.query(
      `SELECT "householdId", "recipientId", body
       FROM notifications
       WHERE "householdId" = ANY($1::uuid[])
         AND module = 'agent' AND type = 'agent_nightly_digest'`,
      [[
        familyA.householdId,
        familyB.householdId,
        noOwner.householdId,
        healthy.householdId,
      ]],
    );
    const notificationA = workerNotifications.find(
      (entry) => entry.householdId === familyA.householdId,
    );
    const notificationB = workerNotifications.find(
      (entry) => entry.householdId === familyB.householdId,
    );
    const noOwnerRoutine = await db.query(
      `SELECT "lastRunAt", "nextRunAt" FROM agent_routines WHERE id = $1`,
      [noOwner.routineId],
    );
    assert(
      notificationA?.recipientId === familyA.ownerId &&
        notificationA.body.includes('仅家庭A可见的事项') &&
        !notificationA.body.includes('仅家庭B可见的事项') &&
        notificationB?.recipientId === familyB.ownerId &&
        notificationB.body.includes('仅家庭B可见的事项') &&
        !notificationB.body.includes('仅家庭A可见的事项'),
      '每晚汇总按家庭隔离，含 admin 的家庭也只向 owner 发送',
    );
    assert(
      !workerNotifications.some(
        (entry) => entry.householdId === noOwner.householdId,
      ) &&
        workerNotifications.some(
          (entry) => entry.householdId === healthy.householdId,
        ) &&
        Boolean(noOwnerRoutine[0]?.lastRunAt) &&
        new Date(noOwnerRoutine[0]?.nextRunAt).getTime() > Date.now(),
      '停用 owner 的家庭被跳过并推进调度，worker 继续处理其他家庭',
    );
    assert(
      confirmedBefore[0].n === confirmedAfter[0].n,
      'worker 触发前后没有新增 confirmed 操作提案',
    );

    console.log('4. 同日幂等、晚到事项保留与敏感正文隔离');
    await db.query(
      `INSERT INTO agent_routine_items (
         "householdId", "routineKind", "sourceType", "sourceId", summary
       ) VALUES ($1, 'nightly_digest', 'test_fact', $2, '同日首次汇总后的晚到事项')`,
      [familyA.householdId, randomUUID()],
    );
    await dispatchExclusively([familyA.routineId]);
    const idempotent = await db.query(
      `SELECT
         (SELECT count(*)::int FROM notifications
          WHERE "householdId" = $1 AND module = 'agent'
            AND type = 'agent_nightly_digest') AS notifications,
         (SELECT count(*)::int FROM agent_routine_items
          WHERE "householdId" = $1 AND status = 'pending'
            AND summary = '同日首次汇总后的晚到事项') AS pending`,
      [familyA.householdId],
    );
    const leaked = await db.query(
      `SELECT count(*)::int AS n FROM notifications
       WHERE module = 'agent'
         AND coalesce(body, '') ~ '(routine-test-secret|AGENT_DATA_KEY|conversation-secret|memory-secret)'`,
    );
    assert(
      idempotent[0].notifications === 1 && idempotent[0].pending === 1,
      '同一天重复触发不重复发汇总，首次汇总后的事项留到下一轮',
    );
    assert(
      leaked[0].n === 0 &&
        workerNotifications.every((entry) => entry.body.length <= 500),
      '通知正文不包含密钥、对话正文、记忆正文且不超过 500 字',
    );

    console.log('5. 订阅与药品临期项、窗口过滤与同日幂等');
    const expiry = await createHouseholdFixture(db, '临期提醒');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const dateAfter = (days) => {
      const value = new Date(`${today}T00:00:00.000Z`);
      value.setUTCDate(value.getUTCDate() + days);
      return value.toISOString().slice(0, 10);
    };
    const dueSubscriptionId = randomUUID();
    const farSubscriptionId = randomUUID();
    const expiredSubscriptionId = randomUUID();
    const retiredSubscriptionId = randomUUID();
    await db.query(
      `INSERT INTO home_assets (
         id, "householdId", name, category, "renewsOn", status, "createdById"
       ) VALUES
         ($1, $5, '家庭影音会员', 'subscription', $6, 'active', $10),
         ($2, $5, '远期云存储', 'subscription', $7, 'active', $10),
         ($3, $5, '已过期宽带', 'subscription', $8, 'active', $10),
         ($4, $5, '已停用会员', 'subscription', $9, 'retired', $10)`,
      [
        dueSubscriptionId,
        farSubscriptionId,
        expiredSubscriptionId,
        retiredSubscriptionId,
        expiry.householdId,
        dateAfter(7),
        dateAfter(15),
        dateAfter(-1),
        dateAfter(7),
        expiry.ownerId,
      ],
    );
    const dueMedicineItemId = randomUUID();
    const farMedicineItemId = randomUUID();
    const expiredMedicineItemId = randomUUID();
    await db.query(
      `INSERT INTO inventory_items (
         id, "householdId", name, category, quantity, unit,
         "lowStockThreshold", "restockQuantity"
       ) VALUES
         ($1, $4, '家庭感冒药', '药品', 2, '盒', 1, 1),
         ($2, $4, '远期维生素', '药品', 2, '瓶', 1, 1),
         ($3, $4, '已过期药品', '药品', 2, '盒', 1, 1)`,
      [
        dueMedicineItemId,
        farMedicineItemId,
        expiredMedicineItemId,
        expiry.householdId,
      ],
    );
    const dueMedicineBatchId = randomUUID();
    const farMedicineBatchId = randomUUID();
    const expiredMedicineBatchId = randomUUID();
    await db.query(
      `INSERT INTO inventory_batches (
         id, "householdId", "inventoryItemId", quantity, "receivedOn",
         "expiresOn", "sourceType", "sourceId", "createdById"
       ) VALUES
         ($1, $4, $5, 1, $8, $9, 'manual', $11, $12),
         ($2, $4, $6, 1, $8, $10, 'manual', $13, $12),
         ($3, $4, $7, 1, $8, $14, 'manual', $15, $12)`,
      [
        dueMedicineBatchId,
        farMedicineBatchId,
        expiredMedicineBatchId,
        expiry.householdId,
        dueMedicineItemId,
        farMedicineItemId,
        expiredMedicineItemId,
        today,
        dateAfter(7),
        dateAfter(15),
        randomUUID(),
        expiry.ownerId,
        randomUUID(),
        dateAfter(-1),
        randomUUID(),
      ],
    );
    await dispatchExclusively([expiry.routineId]);
    const expiryItems =
      (await waitFor(async () => {
        const rows = await db.query(
          `SELECT "sourceType", "sourceId", summary, status
           FROM agent_routine_items
           WHERE "householdId" = $1
             AND "sourceType" IN ('subscription_renewal', 'medicine_expiry')
           ORDER BY "sourceType"`,
          [expiry.householdId],
        );
        return rows.length === 2 ? rows : null;
      })) ?? [];
    assert(
      expiryItems.length === 2 &&
        expiryItems.some(
          (item) =>
            item.sourceType === 'subscription_renewal' &&
            item.sourceId === dueSubscriptionId &&
            item.summary.includes('家庭影音会员') &&
            item.summary.includes('7 天'),
        ) &&
        expiryItems.some(
          (item) =>
            item.sourceType === 'medicine_expiry' &&
            item.sourceId === dueMedicineBatchId &&
            item.summary.includes('家庭感冒药') &&
            item.summary.includes('7 天'),
        ),
      '7 天后续费的订阅和到期的药品批次进入每晚汇总',
    );
    assert(
      !expiryItems.some((item) =>
        [
          farSubscriptionId,
          expiredSubscriptionId,
          retiredSubscriptionId,
          farMedicineBatchId,
          expiredMedicineBatchId,
        ].includes(item.sourceId),
      ),
      '超过 14 天、已过期和已停用的临期来源不进入汇总',
    );
    await db.query(
      `DELETE FROM notifications
       WHERE "householdId" = $1 AND type = 'agent_nightly_digest'`,
      [expiry.householdId],
    );
    await dispatchExclusively([expiry.routineId]);
    const expiryCounts = await db.query(
      `SELECT "sourceType", "sourceId", count(*)::int AS n
       FROM agent_routine_items
       WHERE "householdId" = $1
         AND "sourceType" IN ('subscription_renewal', 'medicine_expiry')
       GROUP BY "sourceType", "sourceId"`,
      [expiry.householdId],
    );
    assert(
      expiryCounts.length === 2 && expiryCounts.every((item) => item.n === 1),
      '同一来源当日已有 pending 或 digested 条目时不重复写入',
    );
    await db.query(
      `UPDATE home_assets SET status = 'retired'
       WHERE id = ANY($1::uuid[])`,
      [[
        dueSubscriptionId,
        farSubscriptionId,
        expiredSubscriptionId,
        retiredSubscriptionId,
      ]],
    );
    await db.query(
      `UPDATE inventory_batches SET quantity = 0
       WHERE id = ANY($1::uuid[])`,
      [[dueMedicineBatchId, farMedicineBatchId, expiredMedicineBatchId]],
    );

    console.log('6. 家庭周报聚合、家庭隔离、owner-only 与停用 owner 容错');
    const weeklyA = await createHouseholdFixture(db, '周报A', {
      kind: 'weekly_report',
      withAdmin: true,
    });
    const weeklyB = await createHouseholdFixture(db, '周报B', {
      kind: 'weekly_report',
    });
    const weeklyNoOwner = await createHouseholdFixture(db, '周报停用Owner', {
      kind: 'weekly_report',
      ownerDisabled: true,
    });
    const weeklyHealthy = await createHouseholdFixture(db, '周报健康家庭', {
      kind: 'weekly_report',
    });
    const reportDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    weeklyMetrics.set(weeklyA.householdId, {
      calendar: [
        { module: 'task', status: 'done' },
        { module: 'task', status: 'done' },
        { module: 'menu', status: 'done' },
      ],
      shopping: [
        { date: reportDate, checked: true },
        { date: reportDate, checked: false },
      ],
      inventory: [
        {
          quantity: '0',
          lowStockThreshold: '1',
          batchSummary: { expiringCount: 0, expiredCount: 0 },
        },
      ],
    });
    weeklyMetrics.set(weeklyB.householdId, {
      calendar: [
        ...Array.from({ length: 5 }, () => ({
          module: 'task',
          status: 'done',
        })),
        { module: 'menu', status: 'open' },
      ],
      shopping: [],
      inventory: [],
    });
    await db.query(
      `INSERT INTO agent_routine_items (
         "householdId", "routineKind", "sourceType", "sourceId", summary
       ) VALUES
         ($1, 'nightly_digest', 'test_fact', $2, '周报A被拦截事项一'),
         ($1, 'nightly_digest', 'test_fact', $3, '周报A被拦截事项二'),
         ($4, 'nightly_digest', 'test_fact', $5, '周报B被拦截事项')`,
      [
        weeklyA.householdId,
        randomUUID(),
        randomUUID(),
        weeklyB.householdId,
        randomUUID(),
      ],
    );
    const weeklyConfirmedBefore = await db.query(
      `SELECT count(*)::int AS n FROM agent_action_proposals
       WHERE status = 'confirmed'`,
    );
    await dispatchExclusively([
      weeklyA.routineId,
      weeklyB.routineId,
      weeklyNoOwner.routineId,
      weeklyHealthy.routineId,
    ]);
    const weeklyConfirmedAfter = await db.query(
      `SELECT count(*)::int AS n FROM agent_action_proposals
       WHERE status = 'confirmed'`,
    );
    const weeklyNotifications = await db.query(
      `SELECT "householdId", "recipientId", body
       FROM notifications
       WHERE "householdId" = ANY($1::uuid[])
         AND module = 'agent' AND type = 'agent_weekly_report'`,
      [[
        weeklyA.householdId,
        weeklyB.householdId,
        weeklyNoOwner.householdId,
        weeklyHealthy.householdId,
      ]],
    );
    const reportA = weeklyNotifications.find(
      (entry) => entry.householdId === weeklyA.householdId,
    );
    const reportB = weeklyNotifications.find(
      (entry) => entry.householdId === weeklyB.householdId,
    );
    assert(
      reportA?.recipientId === weeklyA.ownerId &&
        reportA.body.includes('完成任务 2 项') &&
        reportA.body.includes('菜单执行 1/1 餐') &&
        reportA.body.includes('购物清单完成 1/2 项') &&
        reportA.body.includes('当前库存告警 1 项') &&
        reportA.body.includes('进入汇总 2 项') &&
        !reportA.body.includes('完成任务 5 项') &&
        reportB?.recipientId === weeklyB.ownerId &&
        reportB.body.includes('完成任务 5 项') &&
        !reportB.body.includes('完成任务 2 项'),
      '周报只含本家庭聚合数据，含 admin 的家庭也只向 owner 发送',
    );
    assert(
      !weeklyNotifications.some(
        (entry) => entry.householdId === weeklyNoOwner.householdId,
      ) &&
        weeklyNotifications.some(
          (entry) => entry.householdId === weeklyHealthy.householdId,
        ),
      '停用 owner 的周报被跳过，worker 继续处理其他周报行',
    );
    assert(
      weeklyConfirmedBefore[0].n === weeklyConfirmedAfter[0].n,
      '周报 worker 不新增 confirmed 操作提案',
    );

    console.log('7. 周级幂等、两种 kind 互不干扰与正文隔离');
    await dispatchExclusively([weeklyA.routineId]);
    const weeklyIdempotent = await db.query(
      `SELECT count(*)::int AS n FROM notifications
       WHERE "householdId" = $1 AND module = 'agent'
         AND type = 'agent_weekly_report'`,
      [weeklyA.householdId],
    );
    const weeklyOnly = await createHouseholdFixture(db, '仅周报', {
      kind: 'weekly_report',
    });
    await db.query(
      `INSERT INTO agent_routines (
         "householdId", kind, enabled, "scheduleHour", "scheduleMinute",
         "nextRunAt"
       ) VALUES ($1, 'nightly_digest', false, 21, 0, now() - interval '1 minute')`,
      [weeklyOnly.householdId],
    );
    const nightlyOnly = await createHouseholdFixture(db, '仅夜间', {
      kind: 'nightly_digest',
    });
    await db.query(
      `INSERT INTO agent_routines (
         "householdId", kind, enabled, "scheduleHour", "scheduleMinute",
         "nextRunAt"
       ) VALUES ($1, 'weekly_report', false, 20, 0, now() - interval '1 minute')`,
      [nightlyOnly.householdId],
    );
    await dispatchExclusively([weeklyOnly.routineId, nightlyOnly.routineId]);
    const separatedKinds = await db.query(
      `SELECT "householdId", type FROM notifications
       WHERE "householdId" = ANY($1::uuid[]) AND module = 'agent'`,
      [[weeklyOnly.householdId, nightlyOnly.householdId]],
    );
    const weeklyLeaks = await db.query(
      `SELECT count(*)::int AS n FROM notifications
       WHERE type = 'agent_weekly_report'
         AND coalesce(body, '') ~ '(routine-test-secret|AGENT_DATA_KEY|conversation-secret|memory-secret)'`,
    );
    assert(
      weeklyIdempotent[0].n === 1,
      '同一周内重复触发只产生一条周报通知',
    );
    assert(
      separatedKinds.length === 2 &&
        separatedKinds.some(
          (entry) =>
            entry.householdId === weeklyOnly.householdId &&
            entry.type === 'agent_weekly_report',
        ) &&
        separatedKinds.some(
          (entry) =>
            entry.householdId === nightlyOnly.householdId &&
            entry.type === 'agent_nightly_digest',
        ),
      '只启用一种 kind 时不会触发另一种例行任务',
    );
    assert(
      weeklyLeaks[0].n === 0 &&
        weeklyNotifications.every((entry) => entry.body.length <= 500),
      '周报正文不包含密钥、对话或记忆正文且不超过 500 字',
    );

    console.log('A7.4-B 每晚汇总、临期提醒、家庭周报与通知上限回归通过');
  } finally {
    await AppDataSource.destroy();
  }
}

if (process.argv.includes('--migration')) await runMigrationPhase();
else await runApiPhase();

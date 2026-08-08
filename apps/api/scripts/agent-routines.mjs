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
    const latest = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      latest[0]?.name === 'AddAgentRoutines1785231800000',
      '专项演练从 A7.4-B 最新迁移开始',
    );
    await AppDataSource.undoLastMigration();
    const previous = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      previous[0]?.name === 'AddAgentMemory1785231700000',
      'A7.4-B 迁移可干净回退到 A7.2',
    );

    const owners = await AppDataSource.query(
      `SELECT id, "householdId" FROM members
       WHERE role = 'owner' AND "disabledAt" IS NULL
       ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const owner = owners[0];
    if (!owner) throw new Error('找不到迁移专项所需的家庭 owner');
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
    console.log('A7.4-B 迁移回退、既有行构造和重新迁移专项通过');
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
     ) VALUES ($1, $2, 'nightly_digest', true, 21, 0, now() + interval '1 day')`,
    [routineId, householdId],
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
  const calendar = {
    list: async () => [],
  };
  const service = new AgentRoutineService(
    db.getRepository(AgentRoutine),
    db.getRepository(AgentRoutineItem),
    db.getRepository(AgentSetting),
    calendar,
    db,
  );
  try {
    const owner = await login('爸爸');
    const member = await login('妈妈');

    console.log('1. 管理权限、设置 PATCH 与乐观并发');
    const routines = await request('/agent/routines', owner.accessToken);
    const memberRoutines = await request('/agent/routines', member.accessToken);
    const current = routines.data.find(
      (routine) => routine.kind === 'nightly_digest',
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
    assert(
      routines.status === 200 &&
        memberRoutines.status === 403 &&
        updated.status === 200 &&
        updated.data.scheduleHour === 22 &&
        updated.data.scheduleMinute === 15 &&
        stale.status === 409 &&
        settingsUpdated.status === 200 &&
        settingsUpdated.data.dailyRoutineNotificationLimit === 4 &&
        settingsUpdated.data.routineNotificationsEnabled === true,
      '仅 manage_agent 可管理家庭例行任务，设置支持 PATCH 且版本冲突返回 409',
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
    await db.query(
      `UPDATE agent_routines SET "nextRunAt" = now() - interval '1 minute'
       WHERE id = ANY($1::uuid[])`,
      [[
        familyA.routineId,
        familyB.routineId,
        noOwner.routineId,
        healthy.routineId,
      ]],
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
    await service.dispatchDue();
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
    await db.query(
      `UPDATE agent_routines SET "nextRunAt" = now() - interval '1 minute'
       WHERE id = $1`,
      [familyA.routineId],
    );
    await service.dispatchDue();
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

    console.log('A7.4-B 例行任务与通知上限回归通过');
  } finally {
    await AppDataSource.destroy();
  }
}

if (process.argv.includes('--migration')) await runMigrationPhase();
else await runApiPhase();

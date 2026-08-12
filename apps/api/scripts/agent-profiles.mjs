import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
require('ts-node/register');
const AppDataSource = require('../src/database/data-source.ts').default;
const {
  decryptAgentContent,
  encryptAgentContent,
} = require('../src/agent/agent.crypto.ts');

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const HISTORY_TITLE = 'A7.1 迁移历史密文';
const HISTORY_CONTENT = '迁移前写入的历史消息仍可正常解密';

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
  assert(response.status === 201, `${loginName}可以登录成员档案回归`);
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
    }
    if (latest[0]?.name === 'AddSubscriptionAsset1785232200000') {
      await AppDataSource.undoLastMigration();
      latest = await AppDataSource.query(
        `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
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
    await AppDataSource.undoLastMigration();
    const routineMigration = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      routineMigration[0]?.name === 'AddAgentRoutines1785231800000',
      '回退周报迁移后仍保留 A7.4-B 第一批',
    );
    await AppDataSource.undoLastMigration();
    const memoryMigration = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      memoryMigration[0]?.name === 'AddAgentMemory1785231700000',
      '回退 A7.4-B 第一批后仍可演练 A7.2 和 A7.1',
    );
    await AppDataSource.undoLastMigration();
    const profileMigration = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      profileMigration[0]?.name === 'AddAgentMemberProfiles1785231600000',
      '回退 A7.2 后仍可单独演练 A7.1 回填',
    );
    await AppDataSource.undoLastMigration();

    const activeRows = await AppDataSource.query(
      `SELECT id, "householdId" FROM members
       WHERE name = '妈妈' AND "disabledAt" IS NULL
       LIMIT 1`,
    );
    const active = activeRows[0];
    if (!active) throw new Error('找不到迁移专项所需的活动成员');

    const disabledMemberId = randomUUID();
    const disabledConversationId = randomUUID();
    const disabledRunId = randomUUID();
    const activeConversationId = randomUUID();
    const activeRunId = randomUUID();
    const activeMessageId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO members (
         id, "householdId", name, "avatarEmoji", role, "disabledAt"
       ) VALUES ($1, $2, 'A7.1 停用成员', 'D', 'member', now())`,
      [disabledMemberId, active.householdId],
    );
    await AppDataSource.query(
      `INSERT INTO agent_conversations (
         id, "householdId", "createdByMemberId", title, "expiresAt"
       ) VALUES
         ($1, $2, $3, 'A7.1 停用成员历史会话', now() + interval '30 days'),
         ($4, $2, $5, $6, now() + interval '30 days')`,
      [
        disabledConversationId,
        active.householdId,
        disabledMemberId,
        activeConversationId,
        active.id,
        HISTORY_TITLE,
      ],
    );
    await AppDataSource.query(
      `INSERT INTO agent_runs (
         id, "householdId", "conversationId", "requestedByMemberId",
         "clientRequestId", "runtimeKind", "runtimeVersion", "modelAlias",
         status, "authorizationExpiresAt", "startedAt", "finishedAt"
       ) VALUES
         ($1, $2, $3, $4, $5, 'fake', 'migration-contract', 'hermes-agent',
          'completed', now() + interval '5 minutes', now(), now()),
         ($6, $2, $7, $8, $9, 'fake', 'migration-contract', 'hermes-agent',
          'completed', now() + interval '5 minutes', now(), now())`,
      [
        disabledRunId,
        active.householdId,
        disabledConversationId,
        disabledMemberId,
        `profile-disabled:${disabledRunId}`,
        activeRunId,
        activeConversationId,
        active.id,
        `profile-active:${activeRunId}`,
      ],
    );
    const encrypted = encryptAgentContent(
      HISTORY_CONTENT,
      active.householdId,
      activeConversationId,
    );
    if (!encrypted) throw new Error('迁移专项测试环境缺少对话加密密钥');
    await AppDataSource.query(
      `INSERT INTO agent_messages (
         id, "householdId", "conversationId", "memberId", "runId", role,
         "contentCiphertext", "contentNonce", "contentVersion"
       ) VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8)`,
      [
        activeMessageId,
        active.householdId,
        activeConversationId,
        active.id,
        activeRunId,
        encrypted.contentCiphertext,
        encrypted.contentNonce,
        encrypted.contentVersion,
      ],
    );

    await AppDataSource.runMigrations();
    const disabledState = await AppDataSource.query(
      `SELECT profile.id, profile.enabled,
              conversation."agentProfileId" AS "conversationProfileId",
              run."agentProfileId" AS "runProfileId"
       FROM agent_member_profiles AS profile
       JOIN agent_conversations AS conversation
         ON conversation."createdByMemberId" = profile."memberId"
        AND conversation."householdId" = profile."householdId"
       JOIN agent_runs AS run
         ON run."requestedByMemberId" = profile."memberId"
        AND run."householdId" = profile."householdId"
       WHERE profile."memberId" = $1
         AND conversation.id = $2
         AND run.id = $3`,
      [disabledMemberId, disabledConversationId, disabledRunId],
    );
    const activeState = await AppDataSource.query(
      `SELECT profile.id,
              conversation."agentProfileId" AS "conversationProfileId",
              run."agentProfileId" AS "runProfileId",
              message."contentCiphertext", message."contentNonce",
              message."contentVersion"
       FROM agent_member_profiles AS profile
       JOIN agent_conversations AS conversation
         ON conversation.id = $2
       JOIN agent_runs AS run ON run.id = $3
       JOIN agent_messages AS message ON message.id = $4
       WHERE profile."householdId" = $1
         AND profile."memberId" = $5`,
      [
        active.householdId,
        activeConversationId,
        activeRunId,
        activeMessageId,
        active.id,
      ],
    );
    const disabled = disabledState[0];
    const migrated = activeState[0];
    assert(
      disabled &&
        disabled.enabled === false &&
        disabled.conversationProfileId === disabled.id &&
        disabled.runProfileId === disabled.id,
      '停用成员也会创建禁用档案并绑定历史会话和运行',
    );
    assert(
      migrated &&
        migrated.conversationProfileId === migrated.id &&
        migrated.runProfileId === migrated.id &&
        migrated.contentCiphertext === encrypted.contentCiphertext &&
        migrated.contentNonce === encrypted.contentNonce &&
        migrated.contentVersion === encrypted.contentVersion &&
        decryptAgentContent(
          migrated.contentCiphertext,
          migrated.contentNonce,
          active.householdId,
          activeConversationId,
        ) === HISTORY_CONTENT,
      '活动成员历史绑定完成且消息密文、Nonce、版本和既有 AAD 均未改变',
    );

    await AppDataSource.query(
      `UPDATE members SET "disabledAt" = NULL WHERE id = $1`,
      [disabledMemberId],
    );
    await AppDataSource.query(`DELETE FROM agent_conversations WHERE id = $1`, [
      disabledConversationId,
    ]);
    await AppDataSource.query(
      `DELETE FROM agent_member_profiles WHERE "memberId" = $1`,
      [disabledMemberId],
    );
    await AppDataSource.query(`DELETE FROM members WHERE id = $1`, [
      disabledMemberId,
    ]);
    console.log('A7.1/A7.2 迁移回退、历史构造和重新迁移专项通过');
  } finally {
    await AppDataSource.destroy();
  }
}

async function runApiPhase() {
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'family',
    password: process.env.DB_PASSWORD || 'family123',
    database: process.env.DB_NAME || 'family_app',
  });
  await db.connect();
  try {
    const owner = await login('爸爸');
    const member = await login('妈妈');

    console.log('1. 普通成员自助读取和修改自己的小管家档案');
    const current = await request('/agent/profile', member.accessToken);
    const ownerBefore = await db.query(
      `SELECT id, "assistantName" FROM agent_member_profiles
       WHERE "householdId" = $1 AND "memberId" = $2`,
      [owner.member.householdId, owner.member.id],
    );
    const updated = await request('/agent/profile', member.accessToken, 'PATCH', {
      memberId: owner.member.id,
      householdId: randomUUID(),
      agentProfileId: ownerBefore.rows[0].id,
      assistantName: '\n我的\u0000管家\r',
      responseStyle: 'detailed',
      memorySuggestionEnabled: true,
      expectedVersion: current.data.version,
    });
    const memberRow = await db.query(
      `SELECT id, "memberId", "assistantName", "responseStyle",
              "memorySuggestionEnabled", version
       FROM agent_member_profiles
       WHERE "householdId" = $1 AND "memberId" = $2`,
      [member.member.householdId, member.member.id],
    );
    const ownerAfter = await db.query(
      `SELECT id, "assistantName" FROM agent_member_profiles WHERE id = $1`,
      [ownerBefore.rows[0].id],
    );
    assert(
      current.status === 200 &&
        updated.status === 200 &&
        updated.data.memberId === member.member.id &&
        updated.data.assistantName === '我的管家' &&
        updated.data.responseStyle === 'detailed' &&
        memberRow.rows[0].id === current.data.id &&
        memberRow.rows[0].memberId === member.member.id &&
        memberRow.rows[0].assistantName === '我的管家' &&
        memberRow.rows[0].memorySuggestionEnabled === true &&
        ownerAfter.rows[0].assistantName === ownerBefore.rows[0].assistantName,
      '无 manage_agent 的普通成员可修改自己，身份注入被忽略且称呼控制字符被剥除',
    );

    const stale = await request('/agent/profile', member.accessToken, 'PATCH', {
      assistantName: '过期版本不应生效',
      expectedVersion: current.data.version,
    });
    const settings = await request('/agent/settings', member.accessToken);
    const forbiddenSettings = await request(
      '/agent/settings',
      member.accessToken,
      'PUT',
      { enabled: true, expectedVersion: settings.data.version },
    );
    assert(
      stale.status === 409 && forbiddenSettings.status === 403,
      '过期档案版本返回 409，普通成员仍不能修改家庭级设置',
    );

    console.log('2. 新会话和新运行绑定发起成员档案');
    const conversation = await request(
      '/agent/conversations',
      member.accessToken,
      'POST',
      { title: 'A7.1 新绑定回归' },
    );
    const run = await request(
      `/agent/conversations/${conversation.data.id}/messages`,
      member.accessToken,
      'POST',
      { message: '验证成员档案绑定', clientRequestId: randomUUID() },
    );
    const binding = await db.query(
      `SELECT conversation."agentProfileId" AS "conversationProfileId",
              run."agentProfileId" AS "runProfileId",
              profile."memberId"
       FROM agent_conversations AS conversation
       JOIN agent_runs AS run ON run.id = $2
       JOIN agent_member_profiles AS profile
         ON profile.id = conversation."agentProfileId"
       WHERE conversation.id = $1`,
      [conversation.data.id, run.data.id],
    );
    assert(
      conversation.status === 201 &&
        run.status === 202 &&
        binding.rows[0].conversationProfileId === memberRow.rows[0].id &&
        binding.rows[0].runProfileId === memberRow.rows[0].id &&
        binding.rows[0].memberId === member.member.id,
      '新会话与新运行的 agentProfileId 非空并指向发起成员',
    );

    console.log('3. 回填后的历史密文仍通过原会话接口返回原文');
    const historical = await db.query(
      `SELECT id, "agentProfileId" FROM agent_conversations
       WHERE "householdId" = $1 AND "createdByMemberId" = $2 AND title = $3`,
      [member.member.householdId, member.member.id, HISTORY_TITLE],
    );
    const historicalDetail = await request(
      `/agent/conversations/${historical.rows[0].id}`,
      member.accessToken,
    );
    assert(
      historical.rows[0].agentProfileId === memberRow.rows[0].id &&
        historicalDetail.status === 200 &&
        historicalDetail.data.messages.some(
          (message) => message.content === HISTORY_CONTENT,
        ),
      '历史会话按创建成员回填档案且原有消息仍可解密返回',
    );

    console.log('成员 Agent 档案 API 回归通过');
  } finally {
    await db.end();
  }
}

if (process.argv.includes('--migration')) await runMigrationPhase();
else await runApiPhase();

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
require('ts-node/register');
const AppDataSource = require('../src/database/data-source.ts').default;
const {
  AGENT_MEMORY_TOOLS,
  AGENT_PROPOSAL_TOOLS,
  AGENT_READ_TOOLS,
} = require('../src/agent/agent.types.ts');

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const MCP_KEY = process.env.AGENT_MCP_KEY || 'family-app-local-agent-mcp-key';
const DATABASE = process.env.DB_NAME || 'family_app';
const MIGRATION = process.argv.includes('--migration');

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('agent-proposal-groups.mjs 只允许在 API 临时测试库中运行');
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
  return { status: response.status, data: json?.data, error: json?.error, body: json };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录组提案回归`);
  return response.data;
}

async function mcp(body) {
  const response = await fetch(`${BASE}/internal/agent/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${MCP_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
  const payload = dataLine ? dataLine.slice(6) : text;
  return { status: response.status, body: payload ? JSON.parse(payload) : null };
}

function toolCall(id, name, runId, args = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: { runId, ...args } },
  };
}

function toolResult(response) {
  const text = response.body?.result?.content?.[0]?.text;
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runMigrationPhase() {
  await AppDataSource.initialize();
  try {
    // 按已应用的迁移顺序定位专项目标；新增迁移无需再更新本脚本的名称列表。
    const applied = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC`,
    );
    const targetIndex = applied.findIndex((row) => row.name === 'AddAgentProposalGroups1785232000000');
    assert(targetIndex >= 0, '专项目标迁移必须已经应用');
    for (const migration of applied.slice(0, targetIndex)) {
      const latestBeforeUndo = await AppDataSource.query(
        `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
      );
      assert(latestBeforeUndo[0]?.name === migration.name, '只回退目标之后的迁移');
      await AppDataSource.undoLastMigration();
    }
    const proposalGroupLatest = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    assert(
      proposalGroupLatest[0]?.name === 'AddAgentProposalGroups1785232000000',
      'A7.5 专项演练从组提案迁移开始',
    );
    const members = await AppDataSource.query(
      `SELECT id, "householdId" FROM members
       WHERE role = 'owner' AND "disabledAt" IS NULL
       ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const member = members[0];
    if (!member) throw new Error('找不到 A7.5 迁移演练成员');
    await AppDataSource.query(
      `INSERT INTO agent_settings ("householdId", enabled, "updatedByMemberId")
       VALUES ($1, true, $2) ON CONFLICT ("householdId") DO NOTHING`,
      [member.householdId, member.id],
    );
    const profiles = await AppDataSource.query(
      `INSERT INTO agent_member_profiles ("householdId", "memberId")
       VALUES ($1, $2) ON CONFLICT ("householdId", "memberId")
       DO UPDATE SET "updatedAt" = agent_member_profiles."updatedAt"
       RETURNING id`,
      [member.householdId, member.id],
    );
    const conversationId = randomUUID();
    const runId = randomUUID();
    const groupId = randomUUID();
    const proposalId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO agent_conversations
         (id, "householdId", "createdByMemberId", "agentProfileId", title, "expiresAt")
       VALUES ($1, $2, $3, $4, 'A7.5 迁移回退夹具', now() + interval '1 day')`,
      [conversationId, member.householdId, member.id, profiles[0].id],
    );
    await AppDataSource.query(
      `INSERT INTO agent_runs (
         id, "householdId", "conversationId", "requestedByMemberId", "agentProfileId",
         "clientRequestId", "runtimeKind", "runtimeVersion", "modelAlias", status,
         "allowedTools", "authorizationExpiresAt", "startedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'fake', 'a7.5-migration', 'hermes-agent',
         'running', '["propose_plan"]'::jsonb, now() + interval '5 minutes', now())`,
      [
        runId,
        member.householdId,
        conversationId,
        member.id,
        profiles[0].id,
        `a7.5-migration:${runId}`,
      ],
    );
    await AppDataSource.query(
      `INSERT INTO agent_proposal_groups (
         id, "householdId", "conversationId", "runId", "requestedByMemberId",
         title, summary, "expiresAt"
       ) VALUES ($1, $2, $3, $4, $5, '迁移组', '存在子提案时回退', now() + interval '1 day')`,
      [groupId, member.householdId, conversationId, runId, member.id],
    );
    await AppDataSource.query(
      `INSERT INTO agent_action_proposals (
         id, "householdId", "runId", "createdByMemberId", "groupId", "stepOrder",
         "actionType", payload, preview, "requestFingerprint", "idempotencyKey", "expiresAt"
       ) VALUES ($1, $2, $3, $4, $5, 1, 'task',
         '{"title":"迁移子项","startsOn":"2199-12-30"}'::jsonb,
         '{"title":"迁移子项","summary":"迁移验证","changes":[]}'::jsonb,
         $6, $7, now() + interval '1 day')`,
      [
        proposalId,
        member.householdId,
        runId,
        member.id,
        groupId,
        'a'.repeat(64),
        `a7.5-migration-proposal:${proposalId}`,
      ],
    );
    await AppDataSource.query(
      `INSERT INTO agent_proposal_group_events
         ("householdId", "groupId", "actorMemberId", operation, "stepCount")
       VALUES ($1, $2, $3, 'created', 1)`,
      [member.householdId, groupId, member.id],
    );

    await AppDataSource.undoLastMigration();
    const afterRevert = await AppDataSource.query(
      `SELECT name FROM app_migrations ORDER BY id DESC LIMIT 1`,
    );
    const proposalSurvived = await AppDataSource.query(
      `SELECT id FROM agent_action_proposals WHERE id = $1`,
      [proposalId],
    );
    assert(
      afterRevert[0]?.name === 'AddAgentWeeklyReport1785231900000' &&
        proposalSurvived.length === 1,
      '存在 group、事件和子提案数据时 A7.5 可干净回退，既有提案历史保留',
    );
    await AppDataSource.query(
      `UPDATE agent_settings
       SET "proposalToolsEnabled" = '["propose_task","propose_reminder","propose_poll","propose_menu","propose_shopping_items"]'::jsonb
       WHERE "householdId" = $1`,
      [member.householdId],
    );
    await AppDataSource.runMigrations();
    const migrated = await AppDataSource.query(
      `SELECT "groupId", "stepOrder" FROM agent_action_proposals WHERE id = $1`,
      [proposalId],
    );
    const settings = await AppDataSource.query(
      `SELECT "proposalToolsEnabled" FROM agent_settings WHERE "householdId" = $1`,
      [member.householdId],
    );
    assert(
      migrated[0]?.groupId == null &&
        migrated[0]?.stepOrder == null &&
        settings[0]?.proposalToolsEnabled.includes('propose_plan'),
      '重新迁移后既有提案两列保持 NULL，既有完整白名单补入 propose_plan',
    );
    console.log('A7.5 迁移 run -> revert -> run 专项通过');
  } finally {
    await AppDataSource.destroy();
  }
}

async function createToolRun(db, user, allowedTools) {
  const conversation = await request('/agent/conversations', user.accessToken, 'POST', {
    title: 'A7.5 多步骤提案回归',
  });
  const profile = await db.query(
    `SELECT id FROM agent_member_profiles
     WHERE "householdId" = $1 AND "memberId" = $2`,
    [user.member.householdId, user.member.id],
  );
  const runId = randomUUID();
  await db.query(
    `INSERT INTO agent_runs (
       id, "householdId", "conversationId", "requestedByMemberId", "agentProfileId",
       "clientRequestId", "runtimeKind", "runtimeVersion", "modelAlias", status,
       "allowedTools", "authorizationExpiresAt", "startedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, 'fake', 'a7.5-contract', 'hermes-agent',
       'running', $7, now() + interval '10 minutes', now())`,
    [
      runId,
      user.member.householdId,
      conversation.data.id,
      user.member.id,
      profile.rows[0].id,
      `a7.5:${runId}`,
      JSON.stringify(allowedTools),
    ],
  );
  return { conversationId: conversation.data.id, runId };
}

function taskStep(title, startsOn = '2199-12-30', extra = {}) {
  return { type: 'task', title, startsOn, recurrence: 'once', ...extra };
}

async function runApiPhase() {
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'family',
    password: process.env.DB_PASSWORD || 'family123',
    database: DATABASE,
  });
  await db.connect();
  try {
    const owner = await login('爸爸');
    const settingsResponse = await request('/agent/settings', owner.accessToken);
    const requiredProposalTools = [...AGENT_PROPOSAL_TOOLS];
    if (
      !settingsResponse.data.enabled ||
      requiredProposalTools.some(
        (tool) => !settingsResponse.data.proposalToolsEnabled.includes(tool),
      )
    ) {
      const updated = await request('/agent/settings', owner.accessToken, 'PUT', {
        enabled: true,
        proposalToolsEnabled: requiredProposalTools,
        expectedVersion: settingsResponse.data.version,
      });
      assert(updated.status === 200, 'A7.5 回归启用了完整提案工具白名单');
    }
    const toolRun = await createToolRun(db, owner, [
      'propose_plan',
      'propose_task',
    ]);

    const listed = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const actualNames = (listed.body?.result?.tools ?? [])
      .map((tool) => tool.name)
      .sort();
    const expectedNames = [
      ...AGENT_READ_TOOLS,
      ...AGENT_PROPOSAL_TOOLS,
      ...AGENT_MEMORY_TOOLS,
    ].sort();
    console.log(`1. MCP 目录、描述和 ${expectedNames.length} 工具契约`);
    const planDescription = listed.body?.result?.tools?.find(
      (tool) => tool.name === 'propose_plan',
    )?.description;
    assert(
      JSON.stringify(actualNames) === JSON.stringify(expectedNames) &&
        actualNames.length === expectedNames.length &&
        planDescription?.includes('必须只调用本工具') &&
        planDescription?.includes('不支持只确认其中几步') &&
        planDescription?.includes('财务记账不能放入本工具'),
      `MCP 精确注册 ${expectedNames.length} 个工具，propose_plan 明确多模块整组确认和财务隔离语义`,
    );

    console.log('2. 创建、注入字段忽略、上限和成员范围');
    const injectedHouseholdId = randomUUID();
    const injectedMemberId = randomUUID();
    const injectedGroupId = randomUUID();
    const injected = toolResult(
      await mcp(
        toolCall(2, 'propose_plan', toolRun.runId, {
          title: '注入字段忽略计划',
          summary: '身份与顺序必须由服务端决定',
          householdId: injectedHouseholdId,
          memberId: injectedMemberId,
          groupId: injectedGroupId,
          steps: [
            taskStep('注入字段任务', '2199-12-21', {
              householdId: injectedHouseholdId,
              memberId: injectedMemberId,
              groupId: injectedGroupId,
              stepOrder: 99,
            }),
          ],
        }),
      ),
    );
    const injectedRows = await db.query(
      `SELECT g."householdId", g."requestedByMemberId", p."groupId", p."stepOrder"
       FROM agent_proposal_groups g
       JOIN agent_action_proposals p ON p."groupId" = g.id
       WHERE g.id = $1`,
      [injected.id],
    );
    const beforeTooMany = await db.query(
      `SELECT count(*)::int AS n FROM agent_proposal_groups WHERE "runId" = $1`,
      [toolRun.runId],
    );
    const tooMany = await mcp(
      toolCall(3, 'propose_plan', toolRun.runId, {
        title: '超限计划',
        summary: '不应产生部分数据',
        steps: Array.from({ length: 9 }, (_, index) =>
          taskStep(`超限任务 ${index + 1}`),
        ),
      }),
    );
    const afterTooMany = await db.query(
      `SELECT count(*)::int AS n FROM agent_proposal_groups WHERE "runId" = $1`,
      [toolRun.runId],
    );
    assert(
      injectedRows.rows[0].householdId === owner.member.householdId &&
        injectedRows.rows[0].requestedByMemberId === owner.member.id &&
        injectedRows.rows[0].groupId === injected.id &&
        injectedRows.rows[0].stepOrder === 1 &&
        beforeTooMany.rows[0].n === afterTooMany.rows[0].n &&
        (tooMany.body?.result?.isError === true || tooMany.body?.error),
      '身份、groupId 和 stepOrder 注入被忽略，超过 8 项整体拒绝且无部分数据',
    );

    console.log('3. 全有或全无回滚与独立 failed 审计');
    const sourceTask = await request('/tasks', owner.accessToken, 'POST', {
      title: `A7.5 临时提醒来源-${randomUUID()}`,
      startsOn: '2199-12-20',
      recurrence: 'once',
    });
    const rollbackTitle = `A7.5 必须回滚-${randomUUID()}`;
    const secretMarker = `proposal-body-${randomUUID()}`;
    const failedGroup = toolResult(
      await mcp(
        toolCall(4, 'propose_plan', toolRun.runId, {
          title: '原子回滚计划',
          summary: secretMarker,
          steps: [
            taskStep(rollbackTitle, '2199-12-22'),
            {
              type: 'reminder',
              sourceModule: 'task',
              sourceId: sourceTask.data.id,
              occurrenceDate: '2199-12-20',
              remindAt: '2199-12-19T10:00:00.000+08:00',
              recipientIds: [owner.member.id],
            },
          ],
        }),
      ),
    );
    await db.query(`DELETE FROM household_tasks WHERE id = $1`, [sourceTask.data.id]);
    const failedConfirm = await request(
      `/agent/proposal-groups/${failedGroup.id}/confirm`,
      owner.accessToken,
      'POST',
      { expectedVersion: failedGroup.version },
    );
    const rollbackState = await db.query(
      `SELECT
         (SELECT count(*)::int FROM household_tasks WHERE title = $1) AS tasks,
         (SELECT status FROM agent_proposal_groups WHERE id = $2) AS group_status,
         (SELECT count(*)::int FROM agent_proposal_group_events
            WHERE "groupId" = $2 AND operation = 'failed') AS failed_events,
         (SELECT jsonb_agg(to_jsonb(e)) FROM agent_proposal_group_events e
            WHERE e."groupId" = $2) AS events`,
      [rollbackTitle, failedGroup.id],
    );
    assert(
      failedConfirm.status === 409 &&
        rollbackState.rows[0].tasks === 0 &&
        rollbackState.rows[0].group_status === 'failed' &&
        rollbackState.rows[0].failed_events === 1 &&
        !JSON.stringify(failedConfirm.body).includes(secretMarker) &&
        !JSON.stringify(rollbackState.rows[0].events).includes(secretMarker),
      '任一子项失败时全部业务写入回滚，failed 状态与脱敏事件在独立事务保留',
    );

    console.log('4. 成功、重复确认、版本冲突与单提案兼容');
    const successTaskA = `A7.5 成功任务 A-${randomUUID()}`;
    const successTaskB = `A7.5 成功任务 B-${randomUUID()}`;
    const successGroup = toolResult(
      await mcp(
        toolCall(5, 'propose_plan', toolRun.runId, {
          title: '成功整组计划',
          summary: '两项任务按顺序执行',
          steps: [taskStep(successTaskA), taskStep(successTaskB)],
        }),
      ),
    );
    const stale = await request(
      `/agent/proposal-groups/${successGroup.id}/confirm`,
      owner.accessToken,
      'POST',
      { expectedVersion: 99 },
    );
    const confirmed = await request(
      `/agent/proposal-groups/${successGroup.id}/confirm`,
      owner.accessToken,
      'POST',
      { expectedVersion: successGroup.version },
    );
    const repeatedConfirm = await request(
      `/agent/proposal-groups/${successGroup.id}/confirm`,
      owner.accessToken,
      'POST',
      { expectedVersion: successGroup.version },
    );
    const successRows = await db.query(
      `SELECT count(*)::int AS n FROM household_tasks WHERE title = ANY($1::text[])`,
      [[successTaskA, successTaskB]],
    );
    const singleTitle = `A7.5 独立提案-${randomUUID()}`;
    const single = toolResult(
      await mcp(
        toolCall(6, 'propose_task', toolRun.runId, {
          title: singleTitle,
          startsOn: '2199-12-30',
          recurrence: 'once',
        }),
      ),
    );
    const singleConfirmed = await request(
      `/agent/proposals/${single.id}/confirm`,
      owner.accessToken,
      'POST',
      {
        expectedVersion: single.version,
        clientRequestId: randomUUID(),
      },
    );
    const singleState = await db.query(
      `SELECT "groupId", "stepOrder" FROM agent_action_proposals WHERE id = $1`,
      [single.id],
    );
    assert(
      stale.status === 409 &&
        confirmed.data.status === 'confirmed' &&
        repeatedConfirm.data.status === 'confirmed' &&
        successRows.rows[0].n === 2 &&
        singleConfirmed.data.status === 'executed' &&
        singleState.rows[0].groupId == null &&
        singleState.rows[0].stepOrder == null,
      '整组确认幂等且版本冲突返回 409，既有独立提案仍单独执行且新列为 NULL',
    );

    console.log('5. 过期、放弃和事件不可变');
    const expiringGroup = toolResult(
      await mcp(
        toolCall(7, 'propose_plan', toolRun.runId, {
          title: '过期组',
          summary: '过期后只能全部放弃',
          steps: [taskStep(`过期任务-${randomUUID()}`)],
        }),
      ),
    );
    await db.query(
      `UPDATE agent_proposal_groups SET "expiresAt" = now() - interval '1 minute'
       WHERE id = $1`,
      [expiringGroup.id],
    );
    const expiredConfirm = await request(
      `/agent/proposal-groups/${expiringGroup.id}/confirm`,
      owner.accessToken,
      'POST',
      { expectedVersion: expiringGroup.version },
    );
    const expiredDetail = await request(
      `/agent/proposal-groups/${expiringGroup.id}`,
      owner.accessToken,
    );
    const rejected = await request(
      `/agent/proposal-groups/${expiringGroup.id}/reject`,
      owner.accessToken,
      'POST',
      { expectedVersion: expiredDetail.data.version },
    );
    const repeatedReject = await request(
      `/agent/proposal-groups/${expiringGroup.id}/reject`,
      owner.accessToken,
      'POST',
      { expectedVersion: expiredDetail.data.version },
    );
    const eventId = failedGroup.events[0].id;
    let updateImmutable = false;
    let deleteImmutable = false;
    try {
      await db.query(
        `UPDATE agent_proposal_group_events SET operation = 'confirmed' WHERE id = $1`,
        [eventId],
      );
    } catch (error) {
      updateImmutable = error.code === '55000';
    }
    try {
      await db.query(`DELETE FROM agent_proposal_group_events WHERE id = $1`, [eventId]);
    } catch (error) {
      deleteImmutable = error.code === '55000';
    }
    assert(
      expiredConfirm.status === 409 &&
        expiredDetail.data.status === 'expired' &&
        rejected.data.status === 'rejected' &&
        repeatedReject.data.status === 'rejected' &&
        updateImmutable &&
        deleteImmutable,
      '过期组不能确认但可整组放弃，重复放弃幂等，事件 UPDATE/DELETE 均被 55000 拒绝',
    );

    console.log('6. 跨家庭隔离与例行任务机制防护');
    const foreignHouseholdId = randomUUID();
    const foreignMemberId = randomUUID();
    const foreignProfileId = randomUUID();
    const foreignConversationId = randomUUID();
    const foreignRunId = randomUUID();
    const foreignGroupId = randomUUID();
    await db.query(
      `INSERT INTO households (id, name, slug) VALUES ($1, 'A7.5 隔离家庭', $2)`,
      [foreignHouseholdId, `a7-5-${randomUUID()}`],
    );
    await db.query(
      `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
       VALUES ($1, $2, 'A7.5 隔离成员', 'I', 'owner')`,
      [foreignMemberId, foreignHouseholdId],
    );
    await db.query(
      `INSERT INTO agent_member_profiles (id, "householdId", "memberId")
       VALUES ($1, $2, $3)`,
      [foreignProfileId, foreignHouseholdId, foreignMemberId],
    );
    await db.query(
      `INSERT INTO agent_conversations
         (id, "householdId", "createdByMemberId", "agentProfileId", title, "expiresAt")
       VALUES ($1, $2, $3, $4, '隔离对话', now() + interval '1 day')`,
      [foreignConversationId, foreignHouseholdId, foreignMemberId, foreignProfileId],
    );
    await db.query(
      `INSERT INTO agent_runs (
         id, "householdId", "conversationId", "requestedByMemberId", "agentProfileId",
         "clientRequestId", "runtimeKind", "runtimeVersion", "modelAlias", status,
         "authorizationExpiresAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'fake', 'a7.5-isolation', 'hermes-agent',
         'completed', now() + interval '5 minutes')`,
      [
        foreignRunId,
        foreignHouseholdId,
        foreignConversationId,
        foreignMemberId,
        foreignProfileId,
        `a7.5-foreign:${foreignRunId}`,
      ],
    );
    await db.query(
      `INSERT INTO agent_proposal_groups (
         id, "householdId", "conversationId", "runId", "requestedByMemberId",
         title, summary, "expiresAt"
       ) VALUES ($1, $2, $3, $4, $5, '隔离组', '不可跨家庭读取', now() + interval '1 day')`,
      [
        foreignGroupId,
        foreignHouseholdId,
        foreignConversationId,
        foreignRunId,
        foreignMemberId,
      ],
    );
    const crossRead = await request(
      `/agent/proposal-groups/${foreignGroupId}`,
      owner.accessToken,
    );
    const crossConfirm = await request(
      `/agent/proposal-groups/${foreignGroupId}/confirm`,
      owner.accessToken,
      'POST',
      { expectedVersion: 1 },
    );
    const routine = await db.query(
      `SELECT id, enabled, "nextRunAt", version FROM agent_routines
       WHERE "householdId" = $1 AND kind = 'nightly_digest' LIMIT 1`,
      [owner.member.householdId],
    );
    const confirmedBefore = await db.query(
      `SELECT count(*)::int AS n FROM agent_proposal_groups
       WHERE "householdId" = $1 AND status = 'confirmed'`,
      [owner.member.householdId],
    );
    await db.query(
      `UPDATE agent_settings SET "routineNotificationsEnabled" = true
       WHERE "householdId" = $1`,
      [owner.member.householdId],
    );
    await db.query(
      `UPDATE agent_routines SET enabled = true, "nextRunAt" = now() - interval '1 minute'
       WHERE id = $1`,
      [routine.rows[0].id],
    );
    let routineAdvanced = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const state = await db.query(
        `SELECT "nextRunAt" > now() AS advanced FROM agent_routines WHERE id = $1`,
        [routine.rows[0].id],
      );
      if (state.rows[0]?.advanced) {
        routineAdvanced = true;
        break;
      }
    }
    const confirmedAfter = await db.query(
      `SELECT count(*)::int AS n FROM agent_proposal_groups
       WHERE "householdId" = $1 AND status = 'confirmed'`,
      [owner.member.householdId],
    );
    await db.query(
      `UPDATE agent_routines SET enabled = false WHERE id = $1`,
      [routine.rows[0].id],
    );
    await db.query(
      `UPDATE agent_settings SET "routineNotificationsEnabled" = false
       WHERE "householdId" = $1`,
      [owner.member.householdId],
    );
    assert(
      crossRead.status === 404 &&
        crossConfirm.status === 404 &&
        routineAdvanced &&
        confirmedBefore.rows[0].n === confirmedAfter.rows[0].n,
      '跨家庭无法读取或确认组提案，例行任务实际触发后未确认任何组',
    );

    const listedPending = await request(
      '/agent/proposal-groups?status=pending',
      owner.accessToken,
    );
    assert(
      listedPending.status === 200 &&
        listedPending.data.every(
          (group) =>
            group.status === 'pending' &&
            group.requestedByMemberId === owner.member.id &&
            group.steps.length >= 1,
        ),
      '组提案列表按状态和当前成员范围返回完整子项',
    );
    console.log('A7.5 多步骤家庭协调提案 API 回归通过');
  } finally {
    await db.end();
  }
}

if (MIGRATION) await runMigrationPhase();
else await runApiPhase();

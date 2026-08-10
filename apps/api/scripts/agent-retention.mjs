import { createCipheriv, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
require('ts-node/register');
const {
  decryptAgentContent,
  decryptAgentMemoryContent,
  encryptAgentMemoryContent,
} = require('../src/agent/agent.crypto.ts');
const { agentDataKey } = require('../src/common/config.ts');

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  assert(response.status === 201, `${loginName}可以登录保留期回归`);
  return response.data;
}

async function waitForRun(token, conversationId, runId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const detail = await request(`/agent/conversations/${conversationId}`, token);
    const run = detail.data?.runs?.find((entry) => entry.id === runId);
    if (run?.status === 'completed') return;
    if (run && ['failed', 'cancelled'].includes(run.status)) {
      throw new Error(`运行提前结束为 ${run.status}`);
    }
    await wait(50);
  }
  throw new Error(`等待智能体运行 ${runId} 超时`);
}

async function createConversationWithRun(token, message) {
  const conversation = await request('/agent/conversations', token, 'POST', {});
  const clientRequestId = randomUUID();
  const run = await request(
    `/agent/conversations/${conversation.data.id}/messages`,
    token,
    'POST',
    { message, clientRequestId },
  );
  if (conversation.status !== 201 || run.status !== 202) {
    throw new Error('无法创建保留期测试对话');
  }
  await waitForRun(token, conversation.data.id, run.data.id);
  return {
    conversationId: conversation.data.id,
    runId: run.data.id,
    clientRequestId,
  };
}

function configuredAgentKey() {
  const key = agentDataKey();
  if (!key) throw new Error('测试环境缺少有效 AGENT_DATA_KEY');
  return key;
}

function legacyCiphertext(content, householdId, conversationId) {
  const nonce = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', configuredAgentKey(), nonce);
  cipher.setAAD(
    Buffer.from(`agent:${householdId}:${conversationId}`, 'utf8'),
  );
  const payload = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    contentCiphertext: payload.toString('base64'),
    contentNonce: nonce.toString('base64'),
  };
}

async function retentionState(db, conversationId, runId, eventId, clientRequestId) {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM agent_messages WHERE "conversationId" = $1) AS messages,
       (SELECT COUNT(*)::int FROM agent_conversations WHERE id = $1) AS conversations,
       (SELECT COUNT(*)::int FROM agent_runs WHERE id = $2 AND "clientRequestId" = $4) AS runs,
       (SELECT COUNT(*)::int FROM agent_tool_events WHERE id = $3) AS events,
       (SELECT COUNT(*)::int FROM agent_tool_events
        WHERE id = $3
          AND "presentationCiphertext" IS NULL
          AND "presentationNonce" IS NULL
          AND "presentationVersion" IS NULL) AS redacted`,
    [conversationId, runId, eventId, clientRequestId],
  );
  return result.rows[0];
}

async function waitForPurge(db, conversationId, runId, eventId, clientRequestId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await retentionState(
      db,
      conversationId,
      runId,
      eventId,
      clientRequestId,
    );
    if (
      state.messages === 0 &&
      state.conversations === 1 &&
      state.runs === 1 &&
      state.events === 1 &&
      state.redacted === 1
    ) {
      return state;
    }
    await wait(100);
  }
  throw new Error(`等待对话 ${conversationId} 正文清理超时`);
}

async function insertPresentationEvent(db, householdId, runId) {
  const eventId = randomUUID();
  await db.query(
    `INSERT INTO agent_tool_events (
       id, "householdId", "runId", "toolName", "sourceModule", status,
       "presentationCiphertext", "presentationNonce", "presentationVersion",
       "startedAt", "finishedAt"
     ) VALUES ($1, $2, $3, 'get_tasks', 'task', 'completed', $4, $5, 1, now(), now())`,
    [
      eventId,
      householdId,
      runId,
      Buffer.from(`retention-${eventId}`).toString('base64'),
      Buffer.alloc(12, 3).toString('base64'),
    ],
  );
  return eventId;
}

console.log('1. 会话与记忆加密 AAD 契约');
const householdId = randomUUID();
const memberId = randomUUID();
const conversationId = randomUUID();
const memoryItemId = randomUUID();
const legacy = legacyCiphertext('既有会话密文', householdId, conversationId);
assert(
  decryptAgentContent(
    legacy.contentCiphertext,
    legacy.contentNonce,
    householdId,
    conversationId,
  ) === '既有会话密文',
  '既有 agent:household:conversation AAD 密文仍可解密',
);
const encryptedMemory = encryptAgentMemoryContent(
  '仅本人可见的偏好',
  householdId,
  memberId,
  memoryItemId,
);
assert(
  encryptedMemory &&
    decryptAgentMemoryContent(
      encryptedMemory.contentCiphertext,
      encryptedMemory.contentNonce,
      householdId,
      memberId,
      memoryItemId,
    ) === '仅本人可见的偏好',
  '记忆密文绑定家庭、所有者和记忆项',
);
let wrongOwnerRejected = false;
try {
  decryptAgentMemoryContent(
    encryptedMemory.contentCiphertext,
    encryptedMemory.contentNonce,
    householdId,
    randomUUID(),
    memoryItemId,
  );
} catch {
  wrongOwnerRejected = true;
}
assert(wrongOwnerRejected, '错误所有者无法解密记忆正文');

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

  console.log('2. 到期会话擦正文并保留运行与审计元数据');
  const expired = await createConversationWithRun(
    owner.accessToken,
    '检查到期对话清理',
  );
  const expiredEventId = await insertPresentationEvent(
    db,
    owner.member.householdId,
    expired.runId,
  );
  const beforeExpiry = await retentionState(
    db,
    expired.conversationId,
    expired.runId,
    expiredEventId,
    expired.clientRequestId,
  );
  await db.query(
    `UPDATE agent_conversations
     SET status = 'expired', "expiresAt" = now() - interval '1 minute'
     WHERE id = $1`,
    [expired.conversationId],
  );
  const afterExpiry = await waitForPurge(
    db,
    expired.conversationId,
    expired.runId,
    expiredEventId,
    expired.clientRequestId,
  );
  assert(
    beforeExpiry.messages > 0 &&
      beforeExpiry.events === 1 &&
      beforeExpiry.redacted === 0 &&
      afterExpiry.messages === 0 &&
      afterExpiry.conversations === 1 &&
      afterExpiry.runs === 1 &&
      afterExpiry.events === 1 &&
      afterExpiry.redacted === 1,
    '到期后消息行删除，运行幂等键和工具事件保留且展示密文清空',
  );

  console.log('3. 未到期会话正文不被误删');
  const active = await createConversationWithRun(
    owner.accessToken,
    '检查仍在保留期内的对话',
  );
  const activeEventId = await insertPresentationEvent(
    db,
    owner.member.householdId,
    active.runId,
  );
  const activeBefore = await retentionState(
    db,
    active.conversationId,
    active.runId,
    activeEventId,
    active.clientRequestId,
  );
  await wait(500);
  const activeAfter = await retentionState(
    db,
    active.conversationId,
    active.runId,
    activeEventId,
    active.clientRequestId,
  );
  assert(
    activeBefore.messages > 0 &&
      activeBefore.events === 1 &&
      activeBefore.redacted === 0 &&
      activeAfter.messages === activeBefore.messages &&
      activeAfter.events === 1 &&
      activeAfter.redacted === 0,
    '轮询不会清理仍在保留期内的消息和展示正文',
  );

  console.log('4. 已归档且超过保留期的正文同样清理');
  const archived = await createConversationWithRun(
    owner.accessToken,
    '检查归档对话清理',
  );
  const archivedEventId = await insertPresentationEvent(
    db,
    owner.member.householdId,
    archived.runId,
  );
  await db.query(
    `UPDATE agent_conversations AS conversation
     SET status = 'archived',
         "expiresAt" = now() + interval '1 day',
         "updatedAt" = now() - ((setting."retentionDays" + 1) * interval '1 day')
     FROM agent_settings AS setting
     WHERE conversation.id = $1
       AND setting."householdId" = conversation."householdId"`,
    [archived.conversationId],
  );
  const archivedState = await waitForPurge(
    db,
    archived.conversationId,
    archived.runId,
    archivedEventId,
    archived.clientRequestId,
  );
  assert(
    archivedState.messages === 0 &&
      archivedState.conversations === 1 &&
      archivedState.runs === 1 &&
      archivedState.events === 1 &&
      archivedState.redacted === 1,
    '归档超过家庭保留期后只擦正文并保留元数据',
  );

  let immutable = false;
  try {
    await db.query(
      `UPDATE agent_tool_events SET "toolName" = 'tampered' WHERE id = $1`,
      [expiredEventId],
    );
  } catch (error) {
    immutable = error.code === '55000';
  }
  assert(immutable, '展示密文擦除后工具审计的其他字段仍不可修改');

  console.log('智能体保留期 API 回归通过');
} finally {
  await db.end();
}

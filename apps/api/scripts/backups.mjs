import { randomUUID } from 'node:crypto';
import pg from 'pg';

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
  assert(response.status === 201, `${loginName}可以登录备份回归`);
  return response.data;
}

async function waitForNotification(token, type) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request('/notifications?includeRead=true', token);
    const found = response.data.find((notification) => notification.type === type);
    if (found) return found;
    await wait(100);
  }
  throw new Error(`等待系统通知超时: ${type}`);
}

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
  const ownerToken = owner.accessToken;
  const memberToken = member.accessToken;

  console.log('1. 策略权限、校验与下一次运行时间');
  const memberDashboard = await request('/system/backups', memberToken);
  const memberUpdate = await request('/system/backups/policy', memberToken, 'PUT', {
    scheduleEnabled: true,
    frequency: 'daily',
    weeklyDay: null,
    scheduledHour: 3,
    scheduledMinute: 0,
    retentionDays: 30,
    retentionCount: 14,
    capacityWarningPercent: 80,
    capacityCriticalPercent: 90,
    restoreDrillEnabled: false,
    restoreDrillDay: 1,
    restoreDrillHour: 4,
  });
  assert(
    memberDashboard.status === 403 && memberUpdate.status === 403,
    '普通成员不能读取或修改家庭备份控制面',
  );

  const invalid = await request('/system/backups/policy', ownerToken, 'PUT', {
    scheduleEnabled: true,
    frequency: 'weekly',
    weeklyDay: 2,
    scheduledHour: 3,
    scheduledMinute: 10,
    retentionDays: 30,
    retentionCount: 14,
    capacityWarningPercent: 91,
    capacityCriticalPercent: 90,
    restoreDrillEnabled: true,
    restoreDrillDay: 2,
    restoreDrillHour: 4,
  });
  assert(invalid.status === 400, '容量警告阈值不能高于严重阈值');

  const updated = await request('/system/backups/policy', ownerToken, 'PUT', {
    scheduleEnabled: true,
    frequency: 'weekly',
    weeklyDay: 2,
    scheduledHour: 3,
    scheduledMinute: 10,
    retentionDays: 21,
    retentionCount: 9,
    capacityWarningPercent: 75,
    capacityCriticalPercent: 90,
    restoreDrillEnabled: true,
    restoreDrillDay: 2,
    restoreDrillHour: 4,
  });
  assert(
    updated.status === 200 &&
      updated.data.frequency === 'weekly' &&
      updated.data.nextBackupAt &&
      updated.data.nextRestoreDrillAt,
    '管理员可以保存每周备份、保留、容量和每月恢复演练策略',
  );

  console.log('2. 手动备份幂等、并发和取消');
  const backupKey = `backup:${randomUUID()}`;
  const [first, duplicate] = await Promise.all([
    request('/system/backups/runs', ownerToken, 'POST', {
      idempotencyKey: backupKey,
    }),
    request('/system/backups/runs', ownerToken, 'POST', {
      idempotencyKey: backupKey,
    }),
  ]);
  assert(
    first.status === 201 &&
      duplicate.status === 201 &&
      first.data.id === duplicate.data.id,
    '并发重复请求通过家庭幂等键收敛为同一备份任务',
  );
  const activeConflict = await request('/system/backups/runs', ownerToken, 'POST', {
    idempotencyKey: `backup:${randomUUID()}`,
  });
  const memberQueue = await request('/system/backups/runs', memberToken, 'POST', {
    idempotencyKey: `backup:${randomUUID()}`,
  });
  assert(
    activeConflict.status === 409 && memberQueue.status === 403,
    '同家庭活动备份拒绝重复排队且普通成员不能触发',
  );
  const cancelled = await request(
    `/system/backups/runs/${first.data.id}/cancel`,
    ownerToken,
    'PATCH',
  );
  const cancelledAgain = await request(
    `/system/backups/runs/${first.data.id}/cancel`,
    ownerToken,
    'PATCH',
  );
  assert(
    cancelled.data.status === 'cancelled' && cancelledAgain.data.id === cancelled.data.id,
    '等待任务可明确取消且重复取消返回同一状态',
  );

  console.log('3. 完成状态、恢复演练和响应脱敏');
  const completedRequest = await request('/system/backups/runs', ownerToken, 'POST', {
    idempotencyKey: `backup:${randomUUID()}`,
  });
  const backupLabel = `${owner.member.householdId}/${completedRequest.data.id}`;
  await db.query(
    `UPDATE backup_runs
     SET status = 'succeeded',
         "startedAt" = now(),
         "finishedAt" = now(),
         "heartbeatAt" = now(),
         "backupLabel" = $2,
         "databaseBytes" = 1024,
         "uploadsBytes" = 2048,
         "totalBytes" = 3072,
         "checksumVerified" = true,
         "resultSummary" = '回归备份完成',
         "updatedAt" = now()
     WHERE id = $1`,
    [completedRequest.data.id, backupLabel],
  );
  await waitForNotification(ownerToken, 'backup_backup_succeeded');
  const dashboard = await request('/system/backups', ownerToken);
  const completed = dashboard.data.runs.find(
    (run) => run.id === completedRequest.data.id,
  );
  assert(
    dashboard.status === 200 &&
      completed.artifactAvailable === true &&
      completed.totalBytes === '3072' &&
      !JSON.stringify(dashboard.data).includes(backupLabel),
    '完成备份显示大小和校验状态但不暴露 worker 文件标签或路径',
  );

  const restoreKey = `restore:${randomUUID()}`;
  const restore = await request(
    `/system/backups/runs/${completed.id}/restore-drills`,
    ownerToken,
    'POST',
    { idempotencyKey: restoreKey },
  );
  const restoreDuplicate = await request(
    `/system/backups/runs/${completed.id}/restore-drills`,
    ownerToken,
    'POST',
    { idempotencyKey: restoreKey },
  );
  assert(
    restore.status === 201 &&
      restore.data.sourceBackupRunId === completed.id &&
      restoreDuplicate.data.id === restore.data.id,
    '恢复演练只引用已校验且仍保留的备份并支持幂等重试',
  );

  console.log('4. 跨家庭隔离、容量告警与活动审计');
  const foreignHouseholdId = randomUUID();
  const foreignRunId = randomUUID();
  await db.query(
    `INSERT INTO households (id, name, slug, timezone)
     VALUES ($1, '隔离家庭', $2, 'Asia/Shanghai')`,
    [foreignHouseholdId, `backup-isolation-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO backup_policies ("householdId") VALUES ($1)`,
    [foreignHouseholdId],
  );
  await db.query(
    `INSERT INTO backup_runs (
       id, "householdId", kind, status, trigger, "idempotencyKey",
       "finishedAt", "backupLabel", "checksumVerified", retained
     ) VALUES ($1, $2, 'backup', 'succeeded', 'manual', $3, now(), $4, true, true)`,
    [
      foreignRunId,
      foreignHouseholdId,
      `foreign:${randomUUID()}`,
      `${foreignHouseholdId}/${foreignRunId}`,
    ],
  );
  const foreignRestore = await request(
    `/system/backups/runs/${foreignRunId}/restore-drills`,
    ownerToken,
    'POST',
    { idempotencyKey: `restore:${randomUUID()}` },
  );
  const foreignCancel = await request(
    `/system/backups/runs/${foreignRunId}/cancel`,
    ownerToken,
    'PATCH',
  );
  assert(
    foreignRestore.status === 404 && foreignCancel.status === 404,
    '跨家庭备份在恢复和取消接口中都按不存在处理',
  );

  await request(`/system/backups/runs/${restore.data.id}/cancel`, ownerToken, 'PATCH');
  const capacity = await request('/system/backups/capacity-checks', ownerToken, 'POST', {
    idempotencyKey: `capacity:${randomUUID()}`,
  });
  await db.query(
    `UPDATE backup_runs
     SET status = 'succeeded', "startedAt" = now(), "finishedAt" = now(),
         "resultSummary" = '容量已刷新', "updatedAt" = now()
     WHERE id = $1`,
    [capacity.data.id],
  );
  await db.query(
    `UPDATE backup_policies
     SET "lastStorageCheckedAt" = now(),
         "storageTotalBytes" = 10000,
         "storageUsedBytes" = 9200,
         "storageAvailableBytes" = 800,
         "capacityStatus" = 'critical',
         "capacityNotifiedStatus" = NULL,
         "workerLastSeenAt" = now()
     WHERE "householdId" = $1`,
    [owner.member.householdId],
  );
  await waitForNotification(ownerToken, 'backup_capacity_critical');
  const capacityDashboard = await request('/system/backups', ownerToken);
  const activities = await request('/activities?scope=all&limit=50', ownerToken);
  assert(
    capacityDashboard.data.policy.capacityStatus === 'critical' &&
      capacityDashboard.data.workerOnline === true,
    '容量严重状态和 worker 在线心跳进入家庭备份仪表盘',
  );
  assert(
    activities.data.some((activity) => activity.action === 'backup_policy_updated') &&
      activities.data.some((activity) => activity.action === 'backup_queued'),
    '策略修改、任务排队和取消写入家庭活动审计',
  );

  console.log('备份运维 API 回归通过');
} finally {
  await db.end();
}

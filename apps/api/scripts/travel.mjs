import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

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
  assert(response.status === 201, `${loginName}可以登录家庭出行回归`);
  return response.data;
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

  console.log('1. 行程创建幂等、日期校验和维护权限');
  const createKey = randomUUID();
  const createBody = {
    title: '家庭周末短途',
    destination: '杭州周边',
    startDate: '2199-12-20',
    endDate: '2199-12-22',
    note: '只保存家庭协作说明',
    idempotencyKey: createKey,
  };
  const createdPair = await Promise.all([
    request('/travel-plans', owner.accessToken, 'POST', createBody),
    request('/travel-plans', owner.accessToken, 'POST', createBody),
  ]);
  assert(
    createdPair.every((entry) => entry.status === 201) &&
      createdPair[0].data.id === createdPair[1].data.id &&
      createdPair[0].data.version === 1,
    '并发重复创建收敛为同一个行程',
  );
  const planId = createdPair[0].data.id;
  const payloadConflict = await request('/travel-plans', owner.accessToken, 'POST', {
    ...createBody,
    destination: '不同地区',
  });
  const invalidRange = await request('/travel-plans', member.accessToken, 'POST', {
    title: '错误日期',
    startDate: '2199-12-22',
    endDate: '2199-12-20',
    idempotencyKey: randomUUID(),
  });
  const memberUpdate = await request(
    `/travel-plans/${planId}`,
    member.accessToken,
    'PATCH',
    {
      title: '越权更新',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
  );
  assert(
    payloadConflict.status === 409 &&
      invalidRange.status === 400 &&
      memberUpdate.status === 403,
    '不同载荷复用幂等键、无效日期和跨创建者维护均被拒绝',
  );

  console.log('2. 家庭分工、清单协作和并发版本');
  const members = await request('/members', owner.accessToken);
  const memberId = members.data.find((entry) => entry.name === '妈妈').id;
  const firstItem = await request(
    `/travel-plans/${planId}/items`,
    owner.accessToken,
    'POST',
    {
      title: '充电设备',
      category: 'electronics',
      quantity: 2,
      assignedMemberId: memberId,
      idempotencyKey: randomUUID(),
    },
  );
  const firstItemRow = firstItem.data.items.find((item) => item.title === '充电设备');
  const completedByAssignee = await request(
    `/travel-plans/${planId}/items/${firstItemRow.id}/complete`,
    member.accessToken,
    'POST',
    { expectedVersion: 1, idempotencyKey: randomUUID() },
  );
  const pendingItem = await request(
    `/travel-plans/${planId}/items`,
    member.accessToken,
    'POST',
    {
      title: '出发前关闭家中设备',
      category: 'other',
      idempotencyKey: randomUUID(),
    },
  );
  const pendingRow = pendingItem.data.items.find(
    (item) => item.title === '出发前关闭家中设备',
  );
  const concurrentUpdates = await Promise.all([
    request(
      `/travel-plans/${planId}/items/${pendingRow.id}`,
      owner.accessToken,
      'PATCH',
      {
        note: '并发更新 A',
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      },
    ),
    request(
      `/travel-plans/${planId}/items/${pendingRow.id}`,
      owner.accessToken,
      'PATCH',
      {
        note: '并发更新 B',
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      },
    ),
  ]);
  assert(
    firstItem.status === 201 &&
      completedByAssignee.data.counts.completed === 1 &&
      pendingItem.status === 201 &&
      concurrentUpdates.filter((entry) => entry.status === 200).length === 1 &&
      concurrentUpdates.filter((entry) => entry.status === 409).length === 1,
    '负责人可完成清单、家庭成员可协作添加且并发更新不覆盖',
  );

  console.log('3. 模板创建、一次应用和防重复');
  const template = await request('/travel-templates', member.accessToken, 'POST', {
    title: '两日通用模板',
    description: '非敏感家庭物品清单',
    items: [
      { title: '换洗衣物', category: 'clothing', quantity: 2 },
      { title: '洗护用品', category: 'toiletries', quantity: 1 },
    ],
    idempotencyKey: randomUUID(),
  });
  const applyKey = randomUUID();
  const applyBody = {
    expectedPlanVersion: pendingItem.data.version,
    expectedTemplateVersion: template.data.version,
    idempotencyKey: applyKey,
  };
  const applied = await request(
    `/travel-plans/${planId}/templates/${template.data.id}/apply`,
    owner.accessToken,
    'POST',
    applyBody,
  );
  const appliedAgain = await request(
    `/travel-plans/${planId}/templates/${template.data.id}/apply`,
    owner.accessToken,
    'POST',
    applyBody,
  );
  const appliedWithNewKey = await request(
    `/travel-plans/${planId}/templates/${template.data.id}/apply`,
    owner.accessToken,
    'POST',
    {
      ...applyBody,
      expectedPlanVersion: applied.data.version,
      idempotencyKey: randomUUID(),
    },
  );
  assert(
    template.status === 201 &&
      applied.status === 201 &&
      applied.data.items.filter((item) => item.fromTemplate).length === 2 &&
      appliedAgain.data.items.length === applied.data.items.length &&
      appliedAgain.data.version === applied.data.version &&
      appliedWithNewKey.status === 409,
    '模板应用展示预计项、同一操作重试不重复且同一模板不能二次应用',
  );

  console.log('4. 日历、提醒和显式完成状态');
  const calendar = await request(
    '/calendar?start=2199-12-01&end=2199-12-31',
    owner.accessToken,
  );
  const sources = await request(
    '/reminder-sources?start=2199-12-01&end=2199-12-31',
    owner.accessToken,
  );
  const reminder = await request('/reminders', owner.accessToken, 'POST', {
    sourceModule: 'travel',
    sourceId: planId,
    remindAt: '2199-12-19T01:00:00.000Z',
    recipientIds: [owner.member.id, memberId],
  });
  const blockedComplete = await request(
    `/travel-plans/${planId}/complete`,
    owner.accessToken,
    'POST',
    { expectedVersion: applied.data.version, idempotencyKey: randomUUID() },
  );
  assert(
    calendar.data.some((entry) => entry.module === 'travel' && entry.sourceId === planId) &&
      sources.data.some((entry) => entry.module === 'travel' && entry.sourceId === planId) &&
      reminder.status === 201 &&
      blockedComplete.status === 409,
    '出发日进入日历和提醒来源，存在待处理清单时不能静默完成',
  );

  let current = await request(`/travel-plans/${planId}`, owner.accessToken);
  for (const item of current.data.items.filter((entry) => entry.status === 'pending')) {
    current = await request(
      `/travel-plans/${planId}/items/${item.id}/skip`,
      owner.accessToken,
      'POST',
      { expectedVersion: item.version, idempotencyKey: randomUUID() },
    );
  }
  const completedPlan = await request(
    `/travel-plans/${planId}/complete`,
    owner.accessToken,
    'POST',
    { expectedVersion: current.data.version, idempotencyKey: randomUUID() },
  );
  const remindersAfterComplete = await request('/reminders?status=all', owner.accessToken);
  const reopened = await request(
    `/travel-plans/${planId}/reopen`,
    owner.accessToken,
    'POST',
    { expectedVersion: completedPlan.data.version, idempotencyKey: randomUUID() },
  );
  assert(
    completedPlan.data.status === 'completed' &&
      remindersAfterComplete.data.find((entry) => entry.id === reminder.data.id).status ===
        'cancelled' &&
      reopened.data.status === 'planned' &&
      reopened.data.completedAt === null,
    '明确完成会取消待发提醒且可以显式重新打开，不自动恢复提醒',
  );

  console.log('5. 家庭隔离、不可变操作与活动审计');
  const foreignHouseholdId = randomUUID();
  const foreignMemberId = randomUUID();
  const foreignPlanId = randomUUID();
  await db.query(
    `INSERT INTO households (id, name, slug, timezone)
     VALUES ($1, '出行隔离家庭', $2, 'Asia/Shanghai')`,
    [foreignHouseholdId, `travel-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '隔离成员', 'T', 'owner')`,
    [foreignMemberId, foreignHouseholdId],
  );
  await db.query(
    `INSERT INTO travel_plans (
       id, "householdId", title, "startDate", "endDate", "createdById", "updatedById"
     ) VALUES ($1, $2, '其他家庭行程', '2199-12-20', '2199-12-21', $3, $3)`,
    [foreignPlanId, foreignHouseholdId, foreignMemberId],
  );
  const crossDetail = await request(`/travel-plans/${foreignPlanId}`, owner.accessToken);
  const crossUpdate = await request(
    `/travel-plans/${foreignPlanId}`,
    owner.accessToken,
    'PATCH',
    {
      title: '不应成功',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
  );
  const operationRow = await db.query(
    `SELECT id FROM travel_operations WHERE "planId" = $1 ORDER BY "createdAt" LIMIT 1`,
    [planId],
  );
  let immutableProtected = false;
  try {
    await db.query(`UPDATE travel_operations SET operation = 'tampered' WHERE id = $1`, [
      operationRow.rows[0].id,
    ]);
  } catch (error) {
    immutableProtected = error.code === '55000';
  }
  const activities = await request('/activities?scope=all&limit=100', owner.accessToken);
  assert(
    crossDetail.status === 404 &&
      crossUpdate.status === 404 &&
      immutableProtected &&
      activities.data.some(
        (activity) =>
          activity.module === 'travel' &&
          activity.action === 'travel_plan_created' &&
          !JSON.stringify(activity).includes(createBody.note),
      ),
    '跨家庭访问返回不存在、操作历史不可变且活动审计不复制备注',
  );

  console.log('家庭出行 API 回归通过');
} finally {
  await db.end();
}

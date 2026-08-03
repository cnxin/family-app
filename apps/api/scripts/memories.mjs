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

async function uploadPhoto(path, token, idempotencyKey, caption) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append('caption', caption);
  form.append('idempotencyKey', idempotencyKey);
  form.append('file', new Blob([png], { type: 'image/png' }), 'memory.png');
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
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
  assert(response.status === 201, `${loginName}可以登录家庭回忆回归`);
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

  console.log('1. 创建幂等、标签规范化和载荷冲突');
  const createKey = randomUUID();
  const createBody = {
    title: '第一次全家露营',
    happenedOn: '2026-05-02',
    category: 'travel',
    story: '大家一起搭好帐篷，晚上看到了很亮的星星。',
    tags: ['露营', '周末', '露营'],
    idempotencyKey: createKey,
  };
  const createdPair = await Promise.all([
    request('/memories', member.accessToken, 'POST', createBody),
    request('/memories', member.accessToken, 'POST', createBody),
  ]);
  assert(
    createdPair.every((item) => item.status === 201) &&
      createdPair[0].data.id === createdPair[1].data.id &&
      createdPair[0].data.version === 1 &&
      createdPair[0].data.tags.length === 2,
    '并发重复创建收敛为同一条回忆并规范化标签',
  );
  const memoryId = createdPair[0].data.id;
  const keyConflict = await request('/memories', member.accessToken, 'POST', {
    ...createBody,
    story: '不同内容',
    idempotencyKey: createKey,
  });
  assert(keyConflict.status === 409, '相同幂等键不能复用于不同内容');

  console.log('2. 创建者权限、版本并发和组合检索');
  const ownerCannotEditYet = await request(
    `/memories/${memoryId}`,
    owner.accessToken,
    'PATCH',
    {
      story: '管理员补充的家庭记录',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
  );
  assert(
    ownerCannotEditYet.status === 200 && ownerCannotEditYet.data.version === 2,
    '家庭管理员可以协助维护成员创建的回忆',
  );
  const staleUpdate = await request(
    `/memories/${memoryId}`,
    member.accessToken,
    'PATCH',
    {
      title: '旧版本覆盖',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
  );
  const searched = await request(
    '/memories?q=%E9%9C%B2%E8%90%A5&category=travel&tag=%E5%91%A8%E6%9C%AB&year=2026',
    owner.accessToken,
  );
  assert(
    staleUpdate.status === 409 &&
      searched.status === 200 &&
      searched.data.some((memory) => memory.id === memoryId),
    '旧版本编辑被拒绝且关键词、分类、标签和年份可组合检索',
  );

  console.log('3. 私有照片、上传幂等和短时签名读取');
  const photoKey = randomUUID();
  const photo = await uploadPhoto(
    `/memories/${memoryId}/photos`,
    member.accessToken,
    photoKey,
    '搭好帐篷后的合照',
  );
  const photoAgain = await uploadPhoto(
    `/memories/${memoryId}/photos`,
    member.accessToken,
    photoKey,
    '搭好帐篷后的合照',
  );
  const photoConflict = await uploadPhoto(
    `/memories/${memoryId}/photos`,
    member.accessToken,
    photoKey,
    '不同说明',
  );
  const content = await fetch(`${BASE}${photo.data.contentUrl}`);
  assert(
    photo.status === 201 &&
      photoAgain.data.id === photo.data.id &&
      photoConflict.status === 409 &&
      content.status === 200 &&
      content.headers.get('cache-control') === 'private, no-store' &&
      content.headers.get('content-type')?.startsWith('image/png'),
    '照片私有保存、重复上传收敛并仅通过短时签名读取',
  );

  console.log('4. 归档恢复、来源隔离和不可变操作记录');
  const archiveKey = randomUUID();
  const archived = await request(
    `/memories/${memoryId}/archive`,
    member.accessToken,
    'POST',
    { expectedVersion: 2, idempotencyKey: archiveKey },
  );
  const archivedAgain = await request(
    `/memories/${memoryId}/archive`,
    member.accessToken,
    'POST',
    { expectedVersion: 2, idempotencyKey: archiveKey },
  );
  const restored = await request(
    `/memories/${memoryId}/restore`,
    member.accessToken,
    'POST',
    { expectedVersion: 3, idempotencyKey: randomUUID() },
  );
  assert(
    archived.status === 201 &&
      archived.data.version === 3 &&
      archivedAgain.data.version === 3 &&
      restored.status === 201 &&
      restored.data.version === 4,
    '归档和恢复均使用版本与幂等保护',
  );

  const foreignHouseholdId = randomUUID();
  const foreignMemberId = randomUUID();
  const foreignTravelId = randomUUID();
  const foreignMemoryId = randomUUID();
  await db.query(
    `INSERT INTO households (id, name, slug, timezone)
     VALUES ($1, '回忆隔离家庭', $2, 'Asia/Shanghai')`,
    [foreignHouseholdId, `memory-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '隔离成员', 'M', 'owner')`,
    [foreignMemberId, foreignHouseholdId],
  );
  await db.query(
    `INSERT INTO travel_plans (
       id, "householdId", title, "startDate", "endDate", "createdById", "updatedById"
     ) VALUES ($1, $2, '其他家庭行程', '2026-04-01', '2026-04-02', $3, $3)`,
    [foreignTravelId, foreignHouseholdId, foreignMemberId],
  );
  await db.query(
    `INSERT INTO family_memories (
       id, "householdId", title, "happenedOn", category, "createdById", "updatedById"
     ) VALUES ($1, $2, '其他家庭回忆', '2026-04-02', 'travel', $3, $3)`,
    [foreignMemoryId, foreignHouseholdId, foreignMemberId],
  );
  const crossDetail = await request(
    `/memories/${foreignMemoryId}`,
    owner.accessToken,
  );
  const crossSource = await request('/memories', owner.accessToken, 'POST', {
    title: '错误关联',
    happenedOn: '2026-04-02',
    category: 'travel',
    sourceModule: 'travel',
    sourceId: foreignTravelId,
    idempotencyKey: randomUUID(),
  });
  let immutableProtected = false;
  try {
    await db.query(
      `UPDATE family_memory_operations SET "actorName" = '篡改' WHERE "memoryId" = $1`,
      [memoryId],
    );
  } catch (error) {
    immutableProtected = error.code === '55000';
  }
  const activities = await request(
    '/activities?scope=all&limit=100',
    owner.accessToken,
  );
  const memoryActivities = activities.data.filter(
    (activity) => activity.module === 'memory',
  );
  assert(
    crossDetail.status === 404 &&
      crossSource.status === 404 &&
      immutableProtected &&
      memoryActivities.some(
        (activity) => activity.action === 'family_memory_created',
      ) &&
      !JSON.stringify(memoryActivities).includes('管理员补充的家庭记录'),
    '跨家庭回忆和来源不可见，操作记录不可变且活动审计不复制正文',
  );

  console.log('家庭回忆 API 回归通过');
} finally {
  await db.end();
}

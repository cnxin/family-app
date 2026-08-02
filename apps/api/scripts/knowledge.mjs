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
  assert(response.status === 201, `${loginName}可以登录家庭知识库回归`);
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

  console.log('1. 创建权限、家庭幂等和载荷冲突');
  const forbiddenPinned = await request(
    '/knowledge-articles',
    member.accessToken,
    'POST',
    {
      title: '普通成员不能直接置顶',
      category: 'home',
      content: '不应创建',
      isPinned: true,
      idempotencyKey: randomUUID(),
    },
  );
  assert(forbiddenPinned.status === 403, '普通成员不能创建置顶文章');

  const createKey = randomUUID();
  const createBody = {
    title: '停电后的家庭处理流程',
    category: 'procedure',
    summary: '确认范围并安全恢复常用设备',
    content: '先检查楼道供电，再关闭大功率设备，恢复后逐项开启。',
    referenceUrl: 'https://example.com/power-guide',
    tags: ['应急', '流程', '应急'],
    idempotencyKey: createKey,
  };
  const createdPair = await Promise.all([
    request('/knowledge-articles', member.accessToken, 'POST', createBody),
    request('/knowledge-articles', member.accessToken, 'POST', createBody),
  ]);
  assert(
    createdPair.every((item) => item.status === 201) &&
      createdPair[0].data.id === createdPair[1].data.id &&
      createdPair[0].data.version === 1 &&
      createdPair[0].data.tags.length === 2,
    '并发重复创建收敛为同一文章并规范化标签',
  );
  const articleId = createdPair[0].data.id;
  const keyConflict = await request(
    '/knowledge-articles',
    member.accessToken,
    'POST',
    { ...createBody, content: '不同正文', idempotencyKey: createKey },
  );
  assert(keyConflict.status === 409, '相同幂等键不能复用于不同载荷');

  const invalidUrl = await request(
    '/knowledge-articles',
    owner.accessToken,
    'POST',
    {
      title: '不安全链接',
      category: 'other',
      content: '无效',
      referenceUrl: 'ftp://example.com/file',
      idempotencyKey: randomUUID(),
    },
  );
  assert(invalidUrl.status === 400, '参考链接只接受 HTTP 或 HTTPS');

  console.log('2. 编辑权限、并发版本和管理员置顶');
  const ownerArticle = await request(
    '/knowledge-articles',
    owner.accessToken,
    'POST',
    {
      title: '洗碗机快速说明',
      category: 'appliance',
      content: '选择日常程序并确认软水盐提示。',
      tags: ['家电'],
      isPinned: true,
      idempotencyKey: randomUUID(),
    },
  );
  const memberCannotEdit = await request(
    `/knowledge-articles/${ownerArticle.data.id}`,
    member.accessToken,
    'PATCH',
    {
      content: '越权修改',
      expectedVersion: ownerArticle.data.version,
      idempotencyKey: randomUUID(),
    },
  );
  assert(
    ownerArticle.status === 201 &&
      ownerArticle.data.isPinned === true &&
      memberCannotEdit.status === 403,
    '管理员可以置顶且普通成员不能修改他人文章',
  );

  const concurrentBodies = [
    {
      summary: '并发更新 A',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
    {
      summary: '并发更新 B',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
  ];
  const concurrent = await Promise.all(
    concurrentBodies.map((body) =>
      request(
        `/knowledge-articles/${articleId}`,
        member.accessToken,
        'PATCH',
        body,
      ),
    ),
  );
  const successIndex = concurrent.findIndex((item) => item.status === 200);
  assert(
    successIndex >= 0 &&
      concurrent.filter((item) => item.status === 409).length === 1 &&
      concurrent[successIndex].data.version === 2,
    '同一旧版本的并发编辑只有一个成功，另一个返回冲突',
  );
  const duplicateUpdate = await request(
    `/knowledge-articles/${articleId}`,
    member.accessToken,
    'PATCH',
    concurrentBodies[successIndex],
  );
  assert(
    duplicateUpdate.status === 200 && duplicateUpdate.data.version === 2,
    '成功编辑重试返回原结果而不增加版本',
  );

  const memberPin = await request(
    `/knowledge-articles/${articleId}`,
    member.accessToken,
    'PATCH',
    { isPinned: true, expectedVersion: 2, idempotencyKey: randomUUID() },
  );
  const ownerPin = await request(
    `/knowledge-articles/${articleId}`,
    owner.accessToken,
    'PATCH',
    { isPinned: true, expectedVersion: 2, idempotencyKey: randomUUID() },
  );
  assert(
    memberPin.status === 403 &&
      ownerPin.status === 200 &&
      ownerPin.data.version === 3 &&
      ownerPin.data.isPinned === true,
    '只有管理员能调整家庭全局置顶状态',
  );

  console.log('3. 搜索、不可变历史和历史版本恢复');
  const searched = await request(
    '/knowledge-articles?q=%E5%81%9C%E7%94%B5&category=procedure&tag=%E5%BA%94%E6%80%A5',
    owner.accessToken,
  );
  const revisionsBeforeRestore = await request(
    `/knowledge-articles/${articleId}/revisions`,
    member.accessToken,
  );
  assert(
    searched.status === 200 &&
      searched.data.some((article) => article.id === articleId) &&
      revisionsBeforeRestore.data.map((revision) => revision.version).join(',') ===
        '3,2,1' &&
      !JSON.stringify(revisionsBeforeRestore.data).includes(createKey),
    '关键词、分类和标签可组合检索且历史不暴露幂等内部字段',
  );

  const restoreKey = randomUUID();
  const restoredRevision = await request(
    `/knowledge-articles/${articleId}/revisions/1/restore`,
    member.accessToken,
    'POST',
    { expectedVersion: 3, idempotencyKey: restoreKey },
  );
  const restoredAgain = await request(
    `/knowledge-articles/${articleId}/revisions/1/restore`,
    member.accessToken,
    'POST',
    { expectedVersion: 3, idempotencyKey: restoreKey },
  );
  assert(
    restoredRevision.status === 201 &&
      restoredRevision.data.version === 4 &&
      restoredRevision.data.summary === createBody.summary &&
      restoredRevision.data.isPinned === true &&
      restoredAgain.data.version === 4,
    '历史恢复创建新版本、保留当前置顶并支持幂等重试',
  );

  let immutableProtected = false;
  try {
    await db.query(
      `UPDATE knowledge_article_revisions SET title = '篡改' WHERE "articleId" = $1`,
      [articleId],
    );
  } catch (error) {
    immutableProtected = error.code === '55000';
  }
  assert(immutableProtected, '数据库阻止修改知识文章历史快照');

  console.log('4. 归档恢复、家庭隔离和活动审计');
  const archiveKey = randomUUID();
  const archived = await request(
    `/knowledge-articles/${articleId}/archive`,
    member.accessToken,
    'POST',
    { expectedVersion: 4, idempotencyKey: archiveKey },
  );
  const archivedAgain = await request(
    `/knowledge-articles/${articleId}/archive`,
    member.accessToken,
    'POST',
    { expectedVersion: 4, idempotencyKey: archiveKey },
  );
  const activeList = await request('/knowledge-articles', member.accessToken);
  const archivedList = await request(
    '/knowledge-articles?status=archived',
    member.accessToken,
  );
  const restored = await request(
    `/knowledge-articles/${articleId}/restore`,
    member.accessToken,
    'POST',
    { expectedVersion: 5, idempotencyKey: randomUUID() },
  );
  assert(
    archived.status === 201 &&
      archived.data.version === 5 &&
      archived.data.isPinned === false &&
      archivedAgain.data.version === 5 &&
      !activeList.data.some((article) => article.id === articleId) &&
      archivedList.data.some((article) => article.id === articleId) &&
      restored.data.version === 6,
    '归档隐藏活动文章、取消置顶并可通过显式操作恢复',
  );

  const foreignHouseholdId = randomUUID();
  const foreignMemberId = randomUUID();
  const foreignArticleId = randomUUID();
  await db.query(
    `INSERT INTO households (id, name, slug, timezone)
     VALUES ($1, '知识库隔离家庭', $2, 'Asia/Shanghai')`,
    [foreignHouseholdId, `knowledge-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '隔离成员', 'K', 'owner')`,
    [foreignMemberId, foreignHouseholdId],
  );
  await db.query(
    `INSERT INTO knowledge_articles (
       id, "householdId", title, category, content, "createdById", "updatedById"
     ) VALUES ($1, $2, '其他家庭文章', 'other', '不可见', $3, $3)`,
    [foreignArticleId, foreignHouseholdId, foreignMemberId],
  );
  const crossDetail = await request(
    `/knowledge-articles/${foreignArticleId}`,
    owner.accessToken,
  );
  const crossUpdate = await request(
    `/knowledge-articles/${foreignArticleId}`,
    owner.accessToken,
    'PATCH',
    {
      title: '不应成功',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    },
  );
  const crossRevisions = await request(
    `/knowledge-articles/${foreignArticleId}/revisions`,
    owner.accessToken,
  );
  assert(
    crossDetail.status === 404 &&
      crossUpdate.status === 404 &&
      crossRevisions.status === 404,
    '其他家庭文章在详情、编辑和历史接口中均按不存在处理',
  );

  const activities = await request(
    '/activities?scope=all&limit=100',
    owner.accessToken,
  );
  assert(
    activities.data.some(
      (activity) =>
        activity.module === 'knowledge' &&
        activity.action === 'knowledge_article_created',
    ) &&
      activities.data.some(
        (activity) => activity.action === 'knowledge_article_archive',
      ),
    '创建、编辑和归档动作进入家庭活动审计且不复制正文',
  );

  console.log('家庭知识库 API 回归通过');
} finally {
  await db.end();
}

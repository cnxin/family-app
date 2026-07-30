import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const CREDENTIAL = 'household-metadata-secret-2468';

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
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录`);
  return response.body.data;
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

const otherHouseholdId = randomUUID();
await db.connect();

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const initial = await request('/media/metadata-sources', owner.accessToken);
  const forbidden = await request(
    '/media/metadata-sources',
    member.accessToken,
  );
  assert(
    initial.status === 200 &&
      initial.body.data.length === 3 &&
      forbidden.status === 403 &&
      !JSON.stringify(initial.body).includes('credentialEncrypted'),
    '只有家庭管理员可以读取数据源设置且接口不返回密文字段',
  );

  const invalid = await request(
    '/media/metadata-sources/unknown',
    owner.accessToken,
    'PUT',
    { isEnabled: true },
  );
  assert(invalid.status === 404, '拒绝未知影视数据源');

  const updated = await request(
    '/media/metadata-sources/tmdb',
    owner.accessToken,
    'PUT',
    {
      isEnabled: true,
      baseUrl: 'http://127.0.0.1:1/3?ignored=true',
      imageBaseUrl: 'https://images.household.test/w500',
      credentialKind: 'token',
      credential: CREDENTIAL,
    },
  );
  const tmdb = updated.body.data.find((item) => item.provider === 'tmdb');
  const serialized = JSON.stringify(updated.body);
  assert(
    updated.status === 200 &&
      tmdb.mode === 'household' &&
      tmdb.configured === true &&
      tmdb.baseUrl === 'http://127.0.0.1:1/3' &&
      tmdb.credentialHint === '****2468' &&
      !serialized.includes(CREDENTIAL),
    '家庭管理员可以保存 TMDB 地址和凭据且响应只返回末尾提示',
  );

  const search = await request(
    '/media/search?query=家庭配置解密测试&type=movie',
    member.accessToken,
  );
  assert(
    search.status === 200 &&
      search.body.data.sources.find((item) => item.provider === 'tmdb').state ===
        'offline' &&
      !JSON.stringify(search.body).includes(CREDENTIAL),
    '普通成员搜索会使用家庭配置并保持凭据脱敏',
  );

  const householdId = owner.member.householdId;
  const encrypted = await db.query(
    `SELECT "credentialEncrypted", "credentialHint"
     FROM household_media_source_configs
     WHERE "householdId" = $1 AND provider = 'tmdb'`,
    [householdId],
  );
  assert(
    encrypted.rows.length === 1 &&
      encrypted.rows[0].credentialEncrypted.startsWith('v1:') &&
      encrypted.rows[0].credentialEncrypted !== CREDENTIAL &&
      !encrypted.rows[0].credentialEncrypted.includes(CREDENTIAL) &&
      encrypted.rows[0].credentialHint === '****2468',
    '家庭凭据使用带认证加密落库而不是保存明文',
  );

  await db.query(
    'INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)',
    [otherHouseholdId, '数据源隔离测试家庭', `media-source-${otherHouseholdId}`],
  );
  await db.query(
    `INSERT INTO household_media_source_configs
       ("householdId", provider, "baseUrl", "credentialKind", "credentialHint", settings)
     VALUES ($1, 'tmdb', 'https://other-household.invalid/3', 'token', '****9999', '{}')`,
    [otherHouseholdId],
  );
  const isolated = await request('/media/metadata-sources', owner.accessToken);
  assert(
    isolated.status === 200 &&
      !JSON.stringify(isolated.body).includes('other-household.invalid') &&
      isolated.body.data.find((item) => item.provider === 'tmdb').credentialHint ===
        '****2468',
    '家庭数据源配置按家庭隔离',
  );

  const activities = await request('/activities?limit=100', owner.accessToken);
  const activity = activities.body.data.find(
    (item) => item.action === 'media_source_config_updated',
  );
  assert(
    activity &&
      activity.metadata.provider === 'tmdb' &&
      !JSON.stringify(activity).includes(CREDENTIAL) &&
      !JSON.stringify(activity).includes('127.0.0.1'),
    '数据源修改写入活动记录但不记录地址或凭据',
  );

  const reset = await request(
    '/media/metadata-sources/tmdb',
    owner.accessToken,
    'DELETE',
  );
  const restored = reset.body.data.find((item) => item.provider === 'tmdb');
  const removed = await db.query(
    `SELECT 1 FROM household_media_source_configs
     WHERE "householdId" = $1 AND provider = 'tmdb'`,
    [householdId],
  );
  assert(
    reset.status === 200 &&
      restored.mode === 'server_default' &&
      removed.rows.length === 0,
    '可以删除家庭覆盖并恢复服务器默认设置',
  );

  console.log('\n家庭影视数据源设置测试全部通过');
} finally {
  await db.query('DELETE FROM households WHERE id = $1', [otherHouseholdId]);
  await db.end();
}

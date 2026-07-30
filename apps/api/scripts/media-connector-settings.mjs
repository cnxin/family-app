import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const CREDENTIAL = 'household-connector-secret-8642';

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
  return { status: response.status, body: text ? JSON.parse(text) : null };
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
  const initial = await request('/media/connector-settings', owner.accessToken);
  const forbidden = await request('/media/connector-settings', member.accessToken);
  assert(
    initial.status === 200 &&
      initial.body.data.length === 3 &&
      forbidden.status === 403 &&
      !JSON.stringify(initial.body).includes('credentialEncrypted'),
    '只有家庭管理员可以读取连接设置且接口不返回密文字段',
  );

  const unknown = await request(
    '/media/connector-settings/unknown',
    owner.accessToken,
    'PUT',
    { isEnabled: true },
  );
  assert(unknown.status === 404, '拒绝未知媒体服务');

  const updated = await request(
    '/media/connector-settings/plex',
    owner.accessToken,
    'PUT',
    {
      name: '家庭 Plex',
      isEnabled: true,
      baseUrl: 'http://127.0.0.1:1/path?ignored=true',
      credential: CREDENTIAL,
      isPrimary: true,
    },
  );
  const plex = updated.body.data.find((item) => item.kind === 'plex');
  assert(
    updated.status === 200 &&
      plex.mode === 'household' &&
      plex.name === '家庭 Plex' &&
      plex.baseUrl === 'http://127.0.0.1:1' &&
      plex.credentialHint === '****8642' &&
      plex.isPrimary === true &&
      !JSON.stringify(updated.body).includes(CREDENTIAL),
    '管理员可以保存 Plex 地址、名称、主库和凭据且响应保持脱敏',
  );

  const status = await request('/media/connectors?refresh=true', member.accessToken);
  const runtimePlex = status.body.data.find((item) => item.kind === 'plex');
  assert(
    status.status === 200 &&
      runtimePlex.state === 'offline' &&
      runtimePlex.name === '家庭 Plex' &&
      !JSON.stringify(status.body).includes(CREDENTIAL),
    '普通成员会使用家庭连接配置且运行状态不暴露凭据',
  );

  const tested = await request(
    '/media/connector-settings/plex/test',
    owner.accessToken,
    'POST',
  );
  assert(
    tested.status === 201 && tested.body.data.state === 'offline',
    '管理员可以主动测试已保存的连接',
  );

  const householdId = owner.member.householdId;
  const encrypted = await db.query(
    `SELECT i."householdId", s."credentialEncrypted", s."credentialHint"
     FROM integrations i
     INNER JOIN integration_secrets s ON s."integrationId" = i.id
     WHERE i."householdId" = $1 AND i.kind = 'plex'`,
    [householdId],
  );
  assert(
    encrypted.rows.length === 1 &&
      encrypted.rows[0].credentialEncrypted.startsWith('v1:') &&
      encrypted.rows[0].credentialEncrypted !== CREDENTIAL &&
      !encrypted.rows[0].credentialEncrypted.includes(CREDENTIAL) &&
      encrypted.rows[0].credentialHint === '****8642',
    '连接凭据在独立密钥表中使用带认证加密保存',
  );

  const embyUpdated = await request(
    '/media/connector-settings/emby',
    owner.accessToken,
    'PUT',
    {
      name: '家庭 Emby',
      isEnabled: true,
      baseUrl: 'http://127.0.0.1:2',
      credential: 'emby-household-key-9753',
      isPrimary: true,
    },
  );
  const libraries = embyUpdated.body.data.filter((item) => item.role === 'library');
  assert(
    embyUpdated.status === 200 &&
      libraries.filter((item) => item.isPrimary).length === 1 &&
      libraries.find((item) => item.kind === 'emby').isPrimary === true,
    'Plex 与 Emby 可并存且切换主媒体库保持唯一',
  );

  await db.query(
    'INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)',
    [otherHouseholdId, '连接隔离测试家庭', `connector-${otherHouseholdId}`],
  );
  await db.query(
    `INSERT INTO integrations
       ("householdId", kind, name, "baseUrl", capabilities, settings)
     VALUES ($1, 'plex', '其他家庭 Plex', 'https://other-household.invalid', '["library"]', '{}')`,
    [otherHouseholdId],
  );
  const isolated = await request('/media/connector-settings', owner.accessToken);
  assert(
    isolated.status === 200 &&
      !JSON.stringify(isolated.body).includes('other-household.invalid') &&
      isolated.body.data.find((item) => item.kind === 'plex').name === '家庭 Plex',
    '媒体服务设置按家庭隔离',
  );

  const activities = await request('/activities?limit=100', owner.accessToken);
  const activity = activities.body.data.find(
    (item) => item.action === 'media_connector_config_updated',
  );
  assert(
    activity &&
      activity.metadata.kind &&
      !JSON.stringify(activity).includes(CREDENTIAL) &&
      !JSON.stringify(activity).includes('127.0.0.1'),
    '连接修改写入活动记录但不记录地址或凭据',
  );

  const resetPlex = await request(
    '/media/connector-settings/plex',
    owner.accessToken,
    'DELETE',
  );
  const resetEmby = await request(
    '/media/connector-settings/emby',
    owner.accessToken,
    'DELETE',
  );
  const remaining = await db.query(
    `SELECT 1 FROM integrations
     WHERE "householdId" = $1 AND kind IN ('plex', 'emby')`,
    [householdId],
  );
  assert(
    resetPlex.status === 200 &&
      resetEmby.status === 200 &&
      remaining.rows.length === 0,
    '恢复默认会级联删除家庭连接凭据',
  );

  console.log('\n家庭媒体连接设置测试全部通过');
} finally {
  await db.query('DELETE FROM households WHERE id = $1', [otherHouseholdId]);
  await db.end();
}

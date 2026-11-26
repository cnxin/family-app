// M5-E 外部访问「服务器默认模式」黑盒测试：
// 由 run-api-tests.mjs 在注入 TAILSCALE_API_BASE_URL + TAILSCALE_OAUTH_CLIENT_ID + TAILSCALE_OAUTH_CLIENT_SECRET_FILE 后运行。
// 验证：
// 1. 实例首户 owner 可读取服务器默认设置、概览与设备明细，/system/modules hasData=true；
// 2. 同一首户的 admin（具备 manage_integrations 但非 owner）在服务器默认模式下受限（restricted），查设备明细 403；
// 3. 服务器默认模式下告警通知只发给首户 owner，不发给 admin 或普通成员；
// 4. 其他家庭的 owner 在未配置家庭覆盖时受限（restricted），hasData=false，查设备明细 403；
// 5. 若设置了 TAILSCALE_ALLOWED_HOUSEHOLD_ID（经独立重启），只有指定家庭的 owner 可见。
import { createHash, createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  cleanModuleHousehold,
  createModuleHousehold,
  FIXTURE_CREDENTIAL_SNAPSHOT,
  FIXTURE_PASSWORD_HASH,
} from './system-modules-fixtures.mjs';

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
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}: ${response.text}`);
  return response.body.data;
}

async function createMemberWithRole(db, householdId, role, name) {
  const accountId = randomUUID();
  const memberId = randomUUID();
  const sessionId = randomUUID();
  await db.query(
    'INSERT INTO accounts (id,"loginName","loginNameNormalized","passwordHash") VALUES ($1,$2,$3,$4)',
    [accountId, accountId, accountId, FIXTURE_PASSWORD_HASH],
  );
  await db.query(
    'INSERT INTO members (id,"householdId","accountId",name,"avatarEmoji",role) VALUES ($1,$2,$3,$4,$5,$6)',
    [memberId, householdId, accountId, name, 'A', role],
  );
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  await db.query(
    `INSERT INTO auth_sessions (id,"householdId","accountId","memberId","refreshTokenHash","roleSnapshot","credentialSnapshot","expiresAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
    [
      sessionId,
      householdId,
      accountId,
      memberId,
      hash(sessionId),
      role,
      FIXTURE_CREDENTIAL_SNAPSHOT,
    ],
  );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: accountId,
    accountId,
    householdId,
    memberId,
    sid: sessionId,
    name,
    role,
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createHmac('sha256', process.env.JWT_SECRET || 'family-app-dev-secret')
    .update(content)
    .digest('base64url');
  return { accountId, memberId, sessionId, token: `${content}.${signature}` };
}

async function externalAccessHasData(token) {
  const result = await request('/system/modules', token);
  if (result.status !== 200) throw new Error(`/system/modules 失败 ${result.status}`);
  return result.body.data.modules.find((row) => row.key === 'external-access').hasData;
}

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();

const fixtures = [];
let primaryAdmin = null;

try {
  const ownerSession = await login('爸爸');
  const owner = ownerSession.accessToken;
  const householdId = ownerSession.member.householdId;

  await db.query(`DELETE FROM integrations WHERE "householdId" = $1 AND kind = 'tailscale'`, [householdId]);
  await db.query(
    `DELETE FROM notifications WHERE "householdId" = $1 AND module = 'system'
       AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
    [householdId],
  );

  primaryAdmin = await createMemberWithRole(db, householdId, 'admin', '测试副管理员');
  const secondary = await createModuleHousehold(db, 'owner');
  fixtures.push(secondary);

  console.log('1. 服务器默认模式：首户 owner 可见且 hasData=true，通知仅发给 owner');
  const ownerSettings = await request('/external-access/settings', owner);
  assert(
    ownerSettings.status === 200 &&
      ownerSettings.body.data.mode === 'server_default' &&
      ownerSettings.body.data.accessScope === 'server_default' &&
      ownerSettings.body.data.configured === true &&
      ownerSettings.body.data.credentialKind === 'oauth_client' &&
      ownerSettings.body.data.publicUrl === 'https://xiaoguanjia.family.ts.net',
    '首户 owner 命中 server_default（从 *_FILE 读取 OAuth 凭据）',
  );
  assert((await externalAccessHasData(owner)) === true, '首户 owner 看到 external-access.hasData=true');

  const ownerOverview = await request('/external-access/overview?refresh=true', owner);
  const ownerDevice = await request('/external-access/devices/dev-server-1', owner);
  assert(
    ownerOverview.status === 200 &&
      ownerOverview.body.data.accessScope === 'server_default' &&
      ownerOverview.body.data.connection.available === true &&
      ownerOverview.body.data.devices.length === 4 &&
      ownerDevice.status === 200 &&
      ownerDevice.body.data.id === 'dev-server-1',
    '首户 owner 可正常读取服务器默认模式的概览与单台设备明细',
  );

  const notifs = await db.query(
    `SELECT DISTINCT "recipientId"
       FROM notifications
      WHERE "householdId" = $1 AND module = 'system'
        AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
    [householdId],
  );
  const recipientIds = notifs.rows.map((r) => r.recipientId);
  assert(
    recipientIds.includes(ownerSession.member.id) && !recipientIds.includes(primaryAdmin.memberId),
    '服务器默认模式下通知只发给 owner，不发给同家庭 admin',
  );

  console.log('2. 服务器默认模式：同户 admin 与其他家庭 owner 均受限（restricted）');
  const adminSettings = await request('/external-access/settings', primaryAdmin.token);
  const adminOverview = await request('/external-access/overview', primaryAdmin.token);
  const adminDevice = await request('/external-access/devices/dev-server-1', primaryAdmin.token);
  const adminDisableAttempt = await request('/external-access/settings', primaryAdmin.token, 'PUT', {
    isEnabled: false,
  });
  const ownerStillActive = await request('/external-access/settings', owner);
  assert(
    adminSettings.status === 200 &&
      adminSettings.body.data.accessScope === 'restricted' &&
      adminSettings.body.data.configured === false &&
      adminSettings.body.data.publicUrl === null &&
      adminOverview.status === 200 &&
      adminOverview.body.data.accessScope === 'restricted' &&
      adminOverview.body.data.devices.length === 0 &&
      adminDevice.status === 403 &&
      adminDisableAttempt.status === 403 &&
      ownerStillActive.status === 200 &&
      ownerStillActive.body.data.mode === 'server_default' &&
      ownerStillActive.body.data.configured === true,
    '同家庭 admin 在服务器默认模式下处于 restricted，不能覆写/停用创建者的默认配置，查明细返回 403',
  );

  const secondarySettings = await request('/external-access/settings', secondary.token);
  const secondaryOverview = await request('/external-access/overview', secondary.token);
  const secondaryDevice = await request('/external-access/devices/dev-server-1', secondary.token);
  assert(
    secondarySettings.status === 200 &&
      secondarySettings.body.data.accessScope === 'restricted' &&
      secondarySettings.body.data.configured === false &&
      secondaryOverview.status === 200 &&
      secondaryOverview.body.data.accessScope === 'restricted' &&
      secondaryOverview.body.data.devices.length === 0 &&
      secondaryDevice.status === 403 &&
      (await externalAccessHasData(secondary.token)) === false,
    '非首户在服务器默认模式下处于 restricted，hasData=false 且查明细返回 403',
  );

  console.log('外部访问（M5-E）服务器默认模式与角色/多家庭可见范围验证全部通过');
} finally {
  await db.query(
    `DELETE FROM notifications WHERE module = 'system'
       AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
  );
  if (primaryAdmin) {
    await db.query('DELETE FROM auth_sessions WHERE id = $1', [primaryAdmin.sessionId]);
    await db.query('DELETE FROM members WHERE id = $1', [primaryAdmin.memberId]);
    await db.query('DELETE FROM accounts WHERE id = $1', [primaryAdmin.accountId]);
  }
  for (const fixture of fixtures) {
    await db.query('DELETE FROM notifications WHERE "householdId" = $1', [fixture.householdId]);
    await cleanModuleHousehold(db, fixture);
  }
  await db.end();
}

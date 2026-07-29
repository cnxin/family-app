import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const BOOTSTRAP_SECRET =
  process.env.BOOTSTRAP_SECRET || 'family-app-api-test-bootstrap-secret';

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
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
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
  const initialStatus = await request('/auth/setup/status');
  assert(
    initialStatus.status === 200 &&
      initialStatus.body.data.initialized === false &&
      Object.keys(initialStatus.body.data).length === 1 &&
      initialStatus.headers.get('cache-control') === 'no-store',
    '空数据库只公开尚未初始化状态',
  );

  const bootstrapInput = {
    bootstrapSecret: BOOTSTRAP_SECRET,
    householdName: '初始化测试家庭',
    householdSlug: 'bootstrap-test-home',
    timezone: 'Asia/Shanghai',
    ownerName: '首位管理员',
    loginName: 'bootstrap-owner',
    password: 'bootstrap-password-2468',
  };
  const wrongSecret = await request(
    '/auth/setup/bootstrap',
    null,
    'POST',
    { ...bootstrapInput, bootstrapSecret: 'wrong-bootstrap-secret' },
  );
  assert(wrongSecret.status === 401, '错误初始化密钥不能创建家庭');

  const concurrentBootstrap = await Promise.all([
    request('/auth/setup/bootstrap', null, 'POST', bootstrapInput),
    request('/auth/setup/bootstrap', null, 'POST', bootstrapInput),
  ]);
  const initialized = concurrentBootstrap.find(
    (response) => response.status === 201,
  );
  assert(
    concurrentBootstrap.filter((response) => response.status === 201).length === 1 &&
      concurrentBootstrap.filter((response) => response.status === 409).length === 1,
    '并发初始化只有一个请求可以成功',
  );
  const ownerSession = initialized.body.data;
  const ownerPayload = JSON.parse(
    Buffer.from(ownerSession.accessToken.split('.')[1], 'base64url').toString('utf8'),
  );
  assert(
    ownerPayload.sub === ownerPayload.accountId &&
      ownerPayload.memberId !== ownerPayload.accountId &&
      ownerSession.member.role === 'owner',
    '初始化会建立独立账号、所有者成员身份和账号化 JWT',
  );

  const secondBootstrap = await request(
    '/auth/setup/bootstrap',
    null,
    'POST',
    bootstrapInput,
  );
  const anonymousMembers = await request('/members');
  assert(
    secondBootstrap.status === 409 && anonymousMembers.status === 401,
    '初始化永久单次生效且成员目录不再匿名公开',
  );

  const ownerToken = ownerSession.accessToken;
  const created = await request(
    '/household/invitations',
    ownerToken,
    'POST',
    {
      memberName: '受邀成员',
      avatarEmoji: 'J',
      role: 'member',
      expiresInHours: 48,
    },
  );
  const invitation = created.body.data;
  const tokenRow = await db.query(
    'SELECT "tokenHash" FROM household_invitations WHERE id = $1',
    [invitation.id],
  );
  const expectedHash = createHash('sha256')
    .update(invitation.invitationToken, 'utf8')
    .digest('hex');
  assert(
    created.status === 201 &&
      tokenRow.rows[0].tokenHash === expectedHash &&
      tokenRow.rows[0].tokenHash !== invitation.invitationToken,
    '邀请仅在创建时返回明文且数据库只保存 SHA-256 摘要',
  );

  const preview = await request(
    '/auth/invitations/preview',
    null,
    'POST',
    { invitationToken: invitation.invitationToken },
  );
  assert(
    preview.status === 200 &&
      preview.body.data.householdName === '初始化测试家庭' &&
      preview.body.data.memberName === '受邀成员',
    '持有邀请码可以在领取前核对目标家庭和成员档案',
  );

  const redeemed = await request(
    '/auth/invitations/redeem',
    null,
    'POST',
    {
      invitationToken: invitation.invitationToken,
      loginName: 'invited-member',
      password: 'invited-password-2468',
    },
  );
  const replayed = await request(
    '/auth/invitations/redeem',
    null,
    'POST',
    {
      invitationToken: invitation.invitationToken,
      loginName: 'replay-member',
      password: 'replayed-password-2468',
    },
  );
  const memberCreateInvitation = await request(
    '/household/invitations',
    redeemed.body.data.accessToken,
    'POST',
    { memberName: '不应创建' },
  );
  assert(
    redeemed.status === 201 &&
      redeemed.body.data.member.name === '受邀成员' &&
      replayed.status === 410 &&
      memberCreateInvitation.status === 403,
    '邀请领取会原子创建成员、阻止重放并遵守成员管理权限',
  );

  const expiring = (
    await request('/household/invitations', ownerToken, 'POST', {
      memberName: '过期成员',
      expiresInHours: 1,
    })
  ).body.data;
  await db.query(
    `UPDATE household_invitations
     SET "expiresAt" = now() - interval '1 minute'
     WHERE id = $1`,
    [expiring.id],
  );
  const expiredPreview = await request(
    '/auth/invitations/preview',
    null,
    'POST',
    { invitationToken: expiring.invitationToken },
  );

  const revocable = (
    await request('/household/invitations', ownerToken, 'POST', {
      memberName: '撤销成员',
    })
  ).body.data;
  const revoked = await request(
    `/household/invitations/${revocable.id}`,
    ownerToken,
    'DELETE',
  );
  const revokedPreview = await request(
    '/auth/invitations/preview',
    null,
    'POST',
    { invitationToken: revocable.invitationToken },
  );
  assert(
    expiredPreview.status === 410 &&
      revoked.status === 200 &&
      revokedPreview.status === 410,
    '过期和主动撤销的邀请码均不能继续使用',
  );

  console.log('\n安全初始化与成员邀请测试全部通过');
} finally {
  await db.end();
}

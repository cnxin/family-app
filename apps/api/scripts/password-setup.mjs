// C2 批 2 黑盒：首次登录强制设密码。迁移来的老账号没有 passwordHash，用登录名 + 空密码能登录，
// 但在设好密码之前，除了「设密码」和「退出登录」，其它接口一律 403 PASSWORD_SETUP_REQUIRED；
// 设密码不用输旧密码；设完当前会话照常可用，空密码不再能登录。独立家庭，不碰种子家庭的成员数。
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const DATABASE = process.env.DB_NAME || 'family_app';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('password-setup.mjs 只允许在 API 临时测试库中运行');
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: DATABASE,
});
await db.connect();

const ids = { household: randomUUID(), account: randomUUID(), member: randomUUID() };
const loginName = `pwsetup-${ids.account.slice(0, 8)}`;
const newPassword = 'first-login-password-2468';

try {
  await db.query('INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)', [ids.household, '设密码测试家庭', `pwsetup-${ids.household}`]);
  // 老账号：没有 passwordHash（同 1785226900000 迁移里没 PIN 的成员）
  await db.query('INSERT INTO accounts (id, "loginName", "loginNameNormalized") VALUES ($1, $2, $3)', [ids.account, loginName, loginName]);
  await db.query(
    'INSERT INTO members (id, "householdId", "accountId", name, "avatarEmoji", role) VALUES ($1, $2, $3, $4, $5, $6)',
    [ids.member, ids.household, ids.account, '老成员', 'L', 'member'],
  );

  console.log('1. 空密码账号用登录名登录：能登录，但标着要先设密码');
  const login = await request('/auth/login', null, 'POST', { loginName, password: '' });
  const wrongPassword = await request('/auth/login', null, 'POST', { loginName, password: 'guess-1234' });
  const token = login.body?.data?.accessToken;
  assert(
    login.status === 201 && login.body.data.account.requiresPasswordSetup === true && wrongPassword.status === 401,
    '登录名 + 空密码 201，requiresPasswordSetup=true；乱填一个密码照旧 401',
  );

  console.log('2. 设好密码之前：其它接口 403 PASSWORD_SETUP_REQUIRED');
  const blocked = await Promise.all(['/dishes', '/today/attention', '/tasks?start=2026-10-01&end=2026-10-02', '/household/members'].map((path) => request(path, token)));
  const blockedWrite = await request('/tasks', token, 'POST', { title: '设密码前不该建出来', startsOn: '2026-10-08' });
  const created = await db.query('SELECT count(*)::int AS n FROM household_tasks WHERE "householdId" = $1', [ids.household]);
  assert(
    blocked.every((one) => one.status === 403 && one.body.error.code === 'PASSWORD_SETUP_REQUIRED') &&
      blockedWrite.status === 403 && blockedWrite.body.error.code === 'PASSWORD_SETUP_REQUIRED' &&
      created.rows[0].n === 0,
    '读、写接口都 403 PASSWORD_SETUP_REQUIRED，什么都没写进去',
  );

  console.log('3. 设密码：不用输旧密码；太短 400');
  const tooShort = await request('/accounts/me/password', token, 'PATCH', { newPassword: 'short' });
  const set = await request('/accounts/me/password', token, 'PATCH', { newPassword });
  const [{ passwordHash }] = (await db.query('SELECT "passwordHash" FROM accounts WHERE id = $1', [ids.account])).rows;
  assert(
    tooShort.status === 400 && set.status === 200 && set.body.data.requiresPasswordSetup === false &&
      typeof passwordHash === 'string' && passwordHash.length > 0 && passwordHash !== newPassword,
    '不带旧密码直接设：200、requiresPasswordSetup=false、库里存的是散列；少于 8 位 400',
  );

  console.log('4. 设完：当前会话照常可用；空密码不能再登录，新密码能');
  const after = await request('/dishes', token);
  const emptyAgain = await request('/auth/login', null, 'POST', { loginName, password: '' });
  const withNew = await request('/auth/login', null, 'POST', { loginName, password: newPassword });
  assert(
    after.status === 200 && emptyAgain.status === 401 && withNew.status === 201 && withNew.body.data.account.requiresPasswordSetup === false,
    '设完后当前会话读得到数据；空密码 401；新密码 201 且不再要求设密码',
  );

  console.log('5. 设密码前也能退出登录');
  await db.query('UPDATE accounts SET "passwordHash" = NULL WHERE id = $1', [ids.account]);
  const again = await request('/auth/login', null, 'POST', { loginName, password: '' });
  const logout = await request('/auth/logout', again.body.data.accessToken, 'POST');
  const afterLogout = await request('/accounts/me/password', again.body.data.accessToken, 'PATCH', { newPassword });
  assert(
    again.status === 201 && logout.status === 200 && afterLogout.status === 401,
    '没设密码时退出登录 200，退出后这个令牌连设密码也不行（401）',
  );

  console.log('首次登录设密码黑盒全部通过');
} finally {
  await db.query('DELETE FROM auth_sessions WHERE "accountId" = $1', [ids.account]).catch(() => undefined);
  await db.query('DELETE FROM members WHERE id = $1', [ids.member]).catch(() => undefined);
  await db.query('DELETE FROM accounts WHERE id = $1', [ids.account]).catch(() => undefined);
  await db.query('DELETE FROM households WHERE id = $1', [ids.household]).catch(() => undefined);
  await db.end();
}

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AuthSession } from '@family/contracts';
import { apiURL } from './helpers';

interface Fixture {
  householdId: string;
  memberId: string;
  accountId: string;
  token: string;
}

function signToken(input: { accountId: string; householdId: string; memberId: string; sessionId: string; role: string; name: string }) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: input.accountId,
    accountId: input.accountId,
    householdId: input.householdId,
    memberId: input.memberId,
    sid: input.sessionId,
    name: input.name,
    role: input.role,
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createHmac('sha256', process.env.JWT_SECRET || 'family-app-dev-secret')
    .update(content)
    .digest('base64url');
  return `${content}.${signature}`;
}

function toSession(input: Fixture & { role: AuthSession['member']['role']; name: string }): AuthSession {
  return {
    token: input.token,
    accessToken: input.token,
    refreshToken: '',
    householdTimezone: 'Asia/Shanghai',
    account: { id: input.accountId, loginName: input.accountId, requiresPasswordSetup: false },
    member: {
      id: input.memberId,
      householdId: input.householdId,
      name: input.name,
      avatarEmoji: '家',
      role: input.role,
      prefersCooking: false,
      disabledAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

export function tokenApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const send = async <T>(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: unknown) => {
    const response = await request[method](`${apiURL}${path}`, { headers, data: body });
    const text = await response.text();
    expect(response.ok(), `${method.toUpperCase()} ${path} → ${response.status()} ${text}`).toBeTruthy();
    return (text ? JSON.parse(text).data : undefined) as T;
  };
  return {
    get: <T>(path: string) => send<T>('get', path),
    post: <T>(path: string, body?: unknown) => send<T>('post', path, body),
    patch: <T>(path: string, body?: unknown) => send<T>('patch', path, body),
    put: <T>(path: string, body?: unknown) => send<T>('put', path, body),
  };
}

/** 隔离库里的空家庭。演示家庭的临期资产会把「这一件」淹没进合并卡，所以留意用例不用它。 */
export async function attentionHousehold(page: Page, request: APIRequestContext) {
  if (process.env.E2E_ISOLATED !== '1' || !/^family_app_web_test_[a-f0-9]+$/.test(process.env.DB_NAME ?? '')) {
    throw new Error('留意夹具只能在隔离浏览器测试库运行');
  }
  const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
  const { Client } = requireApi('pg');
  const { createModuleHousehold } = requireApi('./scripts/system-modules-fixtures.mjs');
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'family',
    password: process.env.DB_PASSWORD || 'family123',
    database: process.env.DB_NAME,
  });
  await db.connect();
  let owner: Fixture;
  let member: Fixture;
  try {
    owner = await createModuleHousehold(db, 'owner');
    const memberId = randomUUID();
    const accountId = randomUUID();
    const sessionId = randomUUID();
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    await db.query('INSERT INTO accounts (id,"loginName","loginNameNormalized") VALUES ($1,$2,$3)', [accountId, accountId, accountId]);
    await db.query(
      'INSERT INTO members (id,"householdId","accountId",name,"avatarEmoji",role) VALUES ($1,$2,$3,$4,$5,$6)',
      [memberId, owner.householdId, accountId, '普通成员', '员', 'member'],
    );
    await db.query(
      `INSERT INTO auth_sessions (id,"householdId","accountId","memberId","refreshTokenHash","roleSnapshot","credentialSnapshot","expiresAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
      [sessionId, owner.householdId, accountId, memberId, hash(sessionId), 'member', hash('family-app-credential:no-pin')],
    );
    member = {
      householdId: owner.householdId,
      memberId,
      accountId,
      token: signToken({
        accountId, householdId: owner.householdId, memberId, sessionId, role: 'member', name: '普通成员',
      }),
    };
  } finally {
    await db.end();
  }
  const ownerSession = toSession({ ...owner, role: 'owner', name: '模块测试成员' });
  const memberSession = toSession({ ...member, role: 'member', name: '普通成员' });
  await page.addInitScript((session) => {
    const locked = localStorage.getItem('family-app.attention-session-lock');
    localStorage.setItem('family-app.session', locked ?? JSON.stringify(session));
  }, ownerSession);
  return {
    owner,
    member,
    api: tokenApi(request, owner.token),
    async asMember() {
      await page.evaluate((session) => {
        localStorage.setItem('family-app.attention-session-lock', JSON.stringify(session));
      }, memberSession);
      await page.reload();
    },
  };
}

export async function insertOfflineBackup(householdId: string) {
  const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
  const { Client } = requireApi('pg');
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'family',
    password: process.env.DB_PASSWORD || 'family123',
    database: process.env.DB_NAME,
  });
  await db.connect();
  try {
    await db.query('INSERT INTO backup_policies ("householdId") VALUES ($1)', [householdId]);
  } finally {
    await db.end();
  }
}

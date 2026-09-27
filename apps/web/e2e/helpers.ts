import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 隔离 API 的地址（run-web-tests 传进来）；本机开发时走 Caddy 的 /api 前缀。 */
export const apiURL = process.env.FAMILY_API_URL ?? 'http://localhost:8088/api';
export const loginName = process.env.E2E_LOGIN_NAME ?? '爸爸';
export const password = process.env.E2E_ACCOUNT_PASSWORD ?? 'family1234';

export const authFiles = {
  mobile: resolve(process.cwd(), 'e2e/.auth/mobile.json'),
  desktop: resolve(process.cwd(), 'e2e/.auth/desktop.json'),
  sessions: resolve(process.cwd(), 'e2e/.auth/sessions.json'),
};

export interface Session {
  accessToken: string;
  member: { id: string; name: string };
}

/** setup 阶段登录一次存下来的令牌；用例里不再登录（登录接口有限流）。 */
function sessionOf(as: string): Session {
  const sessions = JSON.parse(readFileSync(authFiles.sessions, 'utf8')) as Record<string, Session>;
  const session = sessions[as];
  if (!session) throw new Error(`setup 没有给「${as}」留令牌，先在 auth.setup.ts 里加`);
  return session;
}

/** 直接调 API 造数据 / 清数据，别让每条用例都从 UI 点出前置状态。 */
export function apiClient(request: APIRequestContext, as: string = loginName) {
  const session = sessionOf(as);
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  return {
    memberId: session.member.id,
    /** 少数接口要带 body 的 DELETE 之类 apiClient 没包，拿令牌自己发 */
    accessToken: session.accessToken,
    async get<T>(path: string) {
      const response = await request.get(`${apiURL}${path}`, { headers });
      expect(response.ok(), `GET ${path} → ${response.status()}`).toBeTruthy();
      return ((await response.json()) as { data: T }).data;
    },
    async post<T>(path: string, body: unknown) {
      const response = await request.post(`${apiURL}${path}`, { headers, data: body });
      expect(response.ok(), `POST ${path} → ${response.status()} ${await response.text()}`).toBeTruthy();
      return ((await response.json()) as { data: T }).data;
    },
    async put<T>(path: string, body: unknown) {
      const response = await request.put(`${apiURL}${path}`, { headers, data: body });
      expect(response.ok(), `PUT ${path} → ${response.status()} ${await response.text()}`).toBeTruthy();
      return ((await response.json()) as { data: T }).data;
    },
    async patch<T>(path: string, body: unknown) {
      const response = await request.patch(`${apiURL}${path}`, { headers, data: body });
      expect(response.ok(), `PATCH ${path} → ${response.status()} ${await response.text()}`).toBeTruthy();
      return ((await response.json()) as { data: T }).data;
    },
    async delete(path: string) {
      const response = await request.delete(`${apiURL}${path}`, { headers });
      expect(response.ok(), `DELETE ${path} → ${response.status()}`).toBeTruthy();
    },
  };
}

/** 收集页面运行期错误；用例结束时断言为空。 */
export function watchPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** 页面和主内容区都不该横向溢出——用户对手机端「能左右晃」零容忍。 */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector('main');
    return {
      root: root.scrollWidth - root.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(overflow.root, '整页横向溢出').toBeLessThanOrEqual(0);
  expect(overflow.main, '主内容区横向溢出').toBeLessThanOrEqual(0);
}

export function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 用例自己造的数据都带这个前缀，方便事后按名字清掉。 */
export function stamp(label: string) {
  return `e2e·${label}·${Date.now().toString(36)}`;
}

export interface FreshSession {
  accessToken: string;
  refreshToken: string;
  member: { id: string; name: string };
}

/**
 * 邀请 + 兑换现开一个普通成员和它自己的会话（不走登录接口，不撞限流）。
 * 会改会话状态、或者会清掉「本人」数据的用例用它，别动 setup 存下的共享令牌。
 * 用完记得 `admin.patch(/household/members/:id/status, { enabled: false })`。
 */
export async function freshMemberSession(request: APIRequestContext, label: string) {
  const admin = apiClient(request);
  const invitation = await admin.post<{ invitationToken: string }>('/household/invitations', {
    memberName: stamp(label),
    role: 'member',
    expiresInHours: 1,
  });
  const redeemed = await request.post(`${apiURL}/auth/invitations/redeem`, {
    data: {
      invitationToken: invitation.invitationToken,
      loginName: `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      password: 'fresh-pass-1234',
    },
  });
  expect(redeemed.status(), await redeemed.text()).toBe(201);
  return ((await redeemed.json()) as { data: FreshSession }).data;
}

/** 让页面第一次加载时带上这份会话；之后刷新不再覆盖（续期写回的新令牌要留着）。 */
export async function seedSession(page: Page, session: FreshSession) {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('e2e.seeded')) {
      localStorage.setItem('family-app.session', value);
      sessionStorage.setItem('e2e.seeded', '1');
    }
  }, JSON.stringify(session));
}

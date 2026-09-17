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

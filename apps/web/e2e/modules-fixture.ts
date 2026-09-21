import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AuthSession, ModuleOverride, ShelfModuleKey, SystemModuleState } from '@family/contracts';
import { apiURL } from './helpers';

/** 仅隔离库：复用 F3 的家庭 / 真实鉴权夹具，绝不清空或修改演示家庭的数据。 */
export async function emptyModuleHousehold(page: Page, request: APIRequestContext, role = 'owner') {
  if (process.env.E2E_ISOLATED !== '1' || !/^family_app_web_test_[a-f0-9]+$/.test(process.env.DB_NAME ?? '')) {
    throw new Error('模块空家庭夹具只能在隔离浏览器测试库运行');
  }
  const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
  const { Client } = requireApi('pg');
  const { createModuleHousehold } = requireApi('./scripts/system-modules-fixtures.mjs');
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'family', password: process.env.DB_PASSWORD || 'family123', database: process.env.DB_NAME,
  });
  await db.connect();
  let fixture;
  try { fixture = await createModuleHousehold(db, role); } finally { await db.end(); }
  const session: AuthSession = {
    token: fixture.token, accessToken: fixture.token, refreshToken: '', householdTimezone: 'Asia/Shanghai',
    account: { id: fixture.accountId, loginName: fixture.accountId, requiresPasswordSetup: false },
    member: { id: fixture.memberId, householdId: fixture.householdId, name: '模块测试成员', avatarEmoji: '家',
      role: role as AuthSession['member']['role'], prefersCooking: false, disabledAt: null, createdAt: new Date().toISOString() },
  };
  await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  return {
    session,
    async states(): Promise<SystemModuleState[]> {
      const response = await request.get(`${apiURL}/system/modules`, { headers });
      expect(response.status()).toBe(200);
      return (await response.json()).data.modules;
    },
    async override(key: ShelfModuleKey, override: ModuleOverride) {
      const response = await request.patch(`${apiURL}/system/modules/${key}`, { headers, data: { override } });
      expect(response.status()).toBe(200);
    },
  };
}

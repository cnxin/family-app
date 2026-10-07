import { QueryClient } from '@tanstack/react-query';
import type { AuthSession } from '@family/contracts';
import { describe, expect, it, vi } from 'vitest';
import { prefetchRoute, roleCan } from './prefetch';

// K 收尾：财务概览的意图预取按能力（view_finance）而不是角色，成员也预取。

function session(role: 'owner' | 'admin' | 'member') {
  return { member: { role }, householdTimezone: 'Asia/Shanghai' } as unknown as AuthSession;
}

function prefetchedKeys(path: string, who: AuthSession | null) {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'prefetchQuery').mockResolvedValue(undefined);
  prefetchRoute(client, path, who);
  return spy.mock.calls.map(([options]) => JSON.stringify(options.queryKey));
}

describe('财务概览预取', () => {
  it('成员和管理员都预取当月汇总与账户', () => {
    for (const role of ['member', 'admin', 'owner'] as const) {
      const keys = prefetchedKeys('/house/finance', session(role));
      expect(keys.some((key) => key.startsWith('["finance","summary","'))).toBe(true);
      expect(keys).toContain('["finance","accounts"]');
    }
  });

  it('没登录不预取；别的页面不碰财务', () => {
    expect(prefetchedKeys('/house/finance', null)).toEqual([]);
    expect(prefetchedKeys('/house/assets', session('member')).some((key) => key.includes('finance'))).toBe(false);
  });

  it('能力按 manifest 的能力表判', () => {
    expect(roleCan(session('member'), 'view_finance')).toBe(true);
    expect(roleCan(session('member'), 'manage_points')).toBe(false);
    expect(roleCan(session('admin'), 'manage_points')).toBe(true);
    expect(roleCan(null, 'view_finance')).toBe(false);
  });
});

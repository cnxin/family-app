import { describe, expect, it } from 'vitest';
import type { ExternalAccessDeviceSummary, ExternalAccessTestResult } from '@family/contracts';
import {
  deviceAttentionNeeded,
  deviceStatusBadge,
  filterDevices,
  formatKeyExpiry,
  formatRelativeSeen,
  osLabel,
  permissionSummary,
  sortDevices,
} from './external-access-copy';

function device(overrides: Partial<ExternalAccessDeviceSummary> = {}): ExternalAccessDeviceSummary {
  return {
    id: 'dev-1',
    name: 'phone.family.ts.net',
    hostname: 'phone',
    user: 'dad@example.com',
    os: 'iOS',
    clientVersion: '1.80.1',
    updateAvailable: false,
    authorized: true,
    connectedToControl: true,
    isExternal: false,
    lastSeen: '2026-11-25T10:00:00.000Z',
    expires: '2027-03-01T00:00:00.000Z',
    keyExpiryDisabled: false,
    expiresInDays: 90,
    offlineDays: null,
    isServerNode: false,
    ...overrides,
  };
}

describe('external-access-copy', () => {
  it('规范化系统名与兜底', () => {
    expect(osLabel('ios')).toBe('iOS');
    expect(osLabel('MACOS')).toBe('macOS');
    expect(osLabel('FreeBSD')).toBe('FreeBSD');
    expect(osLabel('CustomOS')).toBe('CustomOS');
    expect(osLabel(null)).toBe('未知系统');
  });

  it('格式化相对在线时间', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    expect(formatRelativeSeen(null, true, now)).toBe('当前在线');
    expect(formatRelativeSeen(null, false, now)).toBe('暂无在线记录');
    expect(formatRelativeSeen('2026-11-25T11:59:30.000Z', false, now)).toBe('刚刚在线');
    expect(formatRelativeSeen('2026-11-25T11:30:00.000Z', false, now)).toBe('30 分钟前在线');
    expect(formatRelativeSeen('2026-11-25T07:00:00.000Z', false, now)).toBe('5 小时前在线');
    expect(formatRelativeSeen('2026-11-20T12:00:00.000Z', false, now)).toBe('5 天前在线');
  });

  it('密钥到期文案与颜色语义', () => {
    expect(formatKeyExpiry(device({ keyExpiryDisabled: true }))).toEqual({
      label: '密钥永不过期',
      tone: 'ok',
    });
    expect(formatKeyExpiry(device({ expires: null, expiresInDays: null }))).toEqual({
      label: '无到期记录',
      tone: 'muted',
    });
    expect(formatKeyExpiry(device({ expiresInDays: -1 }))).toEqual({
      label: '密钥已过期',
      tone: 'danger',
    });
    expect(formatKeyExpiry(device({ expiresInDays: 0 }))).toEqual({
      label: '今日到期',
      tone: 'danger',
    });
    expect(formatKeyExpiry(device({ expiresInDays: 7 }))).toEqual({
      label: '7 天后到期',
      tone: 'warm',
    });
    expect(formatKeyExpiry(device({ expiresInDays: 45 }))).toEqual({
      label: '45 天后到期',
      tone: 'muted',
    });
  });

  it('需留意判定与状态徽章', () => {
    const healthy = device();
    expect(deviceAttentionNeeded(healthy)).toBe(false);
    expect(deviceStatusBadge(healthy)).toEqual({ label: '在线', tone: 'ok' });

    const unauth = device({ authorized: false, connectedToControl: false });
    expect(deviceAttentionNeeded(unauth)).toBe(true);
    expect(deviceStatusBadge(unauth)).toEqual({ label: '待授权', tone: 'warm' });

    const expiring = device({ expiresInDays: 10 });
    expect(deviceAttentionNeeded(expiring)).toBe(true);

    const stale = device({ connectedToControl: false, offlineDays: 35 });
    expect(deviceAttentionNeeded(stale)).toBe(true);
    expect(deviceStatusBadge(stale)).toEqual({ label: '离线 35 天', tone: 'warm' });

    const shortOffline = device({ connectedToControl: false, offlineDays: 2 });
    expect(deviceAttentionNeeded(shortOffline)).toBe(false);
    expect(deviceStatusBadge(shortOffline)).toEqual({ label: '离线', tone: 'muted' });
  });

  it('排序与筛选：小管家节点 > 待授权 > 即将到期 > 在线 > 名称', () => {
    const server = device({ id: 'server', name: 'z-server', isServerNode: true });
    const unauth = device({ id: 'unauth', name: 'b-guest', authorized: false, connectedToControl: false });
    const expiring = device({ id: 'exp', name: 'c-phone', expiresInDays: 5 });
    const online = device({ id: 'online', name: 'a-mac', connectedToControl: true });
    const offline = device({ id: 'offline', name: 'a-ipad', connectedToControl: false, offlineDays: 3 });

    const sorted = sortDevices([offline, online, expiring, unauth, server]);
    expect(sorted.map((d) => d.id)).toEqual(['server', 'unauth', 'exp', 'online', 'offline']);
    expect(filterDevices(sorted, 'online').map((d) => d.id)).toEqual(['server', 'exp', 'online']);
    expect(filterDevices(sorted, 'attention').map((d) => d.id)).toEqual(['unauth', 'exp']);
    expect(filterDevices(sorted, 'all')).toHaveLength(5);
  });

  it('权限探针摘要', () => {
    const base: ExternalAccessTestResult = {
      ok: true,
      available: true,
      readOnlyVerified: true,
      permissionLevel: 'read_only',
      checkedAt: '2026-11-25T10:00:00.000Z',
      message: 'ok',
      deviceCount: 3,
      matchedNodeName: 'xiaoguanjia.family.ts.net',
      credentialKind: 'oauth_client',
    };
    expect(permissionSummary(base)).toEqual({ label: '只读权限已核验', tone: 'ok' });
    expect(permissionSummary({ ...base, ok: false, readOnlyVerified: false, permissionLevel: 'read_write' })).toEqual({
      label: '含写权限（阶段 1 禁止）',
      tone: 'danger',
    });
    expect(permissionSummary({ ...base, ok: false, readOnlyVerified: false, permissionLevel: 'unknown' })).toEqual({
      label: '权限未能确认',
      tone: 'warm',
    });
  });
});

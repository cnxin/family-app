import type {
  ExternalAccessAlert,
  ExternalAccessDeviceDetail,
  ExternalAccessDeviceSummary,
  ExternalAccessSummaryStats,
} from '@family/contracts';
import { householdToday } from '@family/shared';

export const KEY_EXPIRY_ALERT_DAYS = 14;
export const STALE_OFFLINE_ALERT_DAYS = 30;

/**
 * Tailscale 控制面 API v2 设备对象的受控白名单视图。
 * 故意不声明也不读取 machineKey / nodeKey / tailnetLockKey / clientConnectivity。
 */
export interface TailscaleRawDevice {
  id: string;
  name?: string;
  hostname?: string;
  user?: string;
  os?: string;
  clientVersion?: string;
  updateAvailable?: boolean;
  authorized?: boolean;
  connectedToControl?: boolean;
  isExternal?: boolean;
  lastSeen?: string;
  expires?: string;
  keyExpiryDisabled?: boolean;
  addresses?: unknown;
  tags?: unknown;
  blocksIncomingConnections?: boolean;
  created?: string;
}

function cleanString(value: unknown, maxLength = 256): string | null {
  if (typeof value !== 'string') return null;
  let cleaned = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) cleaned += value[i];
  }
  const trimmed = cleaned.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function parseOptionalIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('0001-01-01')) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stringList(value: unknown, limit = 32): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const cleaned = cleanString(entry, 128);
    if (cleaned) items.push(cleaned);
    if (items.length >= limit) break;
  }
  return items;
}

function isoDateDiffDays(fromIsoDate: string, toIsoDate: string): number {
  const fromUtc = Date.parse(`${fromIsoDate}T00:00:00.000Z`);
  const toUtc = Date.parse(`${toIsoDate}T00:00:00.000Z`);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/** 去掉 Tailscale DNS 名称尾部点号，便于界面展示与首段主机名比对。 */
function cleanDeviceName(raw: TailscaleRawDevice): string {
  const dns = cleanString(raw.name, 256)?.replace(/\.+$/, '');
  if (dns) return dns;
  const host = cleanString(raw.hostname, 120);
  return host ?? raw.id;
}

export function matchServerNode(
  raw: Pick<TailscaleRawDevice, 'name' | 'hostname'>,
  nodeHostname: string | null | undefined,
): boolean {
  const target = cleanString(nodeHostname, 120)?.toLowerCase();
  if (!target) return false;
  const hostname = cleanString(raw.hostname, 120)?.toLowerCase();
  if (hostname && hostname === target) return true;
  const dns = cleanString(raw.name, 256)?.replace(/\.+$/, '').toLowerCase();
  if (!dns) return false;
  if (dns === target) return true;
  const firstLabel = dns.split('.')[0];
  return firstLabel === target;
}

export function presentTailscaleDeviceDetail(
  raw: TailscaleRawDevice,
  nodeHostname: string | null | undefined,
  timezone: string,
  now: Date,
): ExternalAccessDeviceDetail {
  const name = cleanDeviceName(raw);
  const hostname = cleanString(raw.hostname, 120) ?? name.split('.')[0] ?? raw.id;
  const connectedToControl = Boolean(raw.connectedToControl);
  const keyExpiryDisabled = Boolean(raw.keyExpiryDisabled);
  const lastSeenDate = parseOptionalIsoDate(raw.lastSeen);
  const expiresDate = keyExpiryDisabled ? null : parseOptionalIsoDate(raw.expires);
  const createdDate = parseOptionalIsoDate(raw.created);
  const today = householdToday(timezone, now);

  let expiresInDays: number | null = null;
  if (!keyExpiryDisabled && expiresDate) {
    const dueOn = householdToday(timezone, expiresDate);
    expiresInDays = isoDateDiffDays(today, dueOn);
  }

  let offlineDays: number | null = null;
  if (!connectedToControl && lastSeenDate) {
    const diffMs = Math.max(0, now.getTime() - lastSeenDate.getTime());
    offlineDays = Math.floor(diffMs / 86_400_000);
  }

  return {
    id: raw.id,
    name,
    hostname,
    user: cleanString(raw.user, 256),
    os: cleanString(raw.os, 64),
    clientVersion: cleanString(raw.clientVersion, 64),
    updateAvailable: Boolean(raw.updateAvailable),
    authorized: raw.authorized !== false,
    connectedToControl,
    isExternal: Boolean(raw.isExternal),
    isServerNode: matchServerNode(raw, nodeHostname),
    lastSeen: lastSeenDate ? lastSeenDate.toISOString() : null,
    expires: expiresDate ? expiresDate.toISOString() : null,
    keyExpiryDisabled,
    expiresInDays,
    offlineDays,
    addresses: stringList(raw.addresses, 16),
    tags: stringList(raw.tags, 32),
    blocksIncomingConnections: Boolean(raw.blocksIncomingConnections),
    created: createdDate ? createdDate.toISOString() : null,
  };
}

/** 概览列表剥离 addresses / tags / created 等明细字段，遵守方案 §5.3。 */
export function toDeviceSummary(
  detail: ExternalAccessDeviceDetail,
): ExternalAccessDeviceSummary {
  return {
    id: detail.id,
    name: detail.name,
    hostname: detail.hostname,
    user: detail.user,
    os: detail.os,
    clientVersion: detail.clientVersion,
    updateAvailable: detail.updateAvailable,
    authorized: detail.authorized,
    connectedToControl: detail.connectedToControl,
    isExternal: detail.isExternal,
    isServerNode: detail.isServerNode,
    lastSeen: detail.lastSeen,
    expires: detail.expires,
    keyExpiryDisabled: detail.keyExpiryDisabled,
    expiresInDays: detail.expiresInDays,
    offlineDays: detail.offlineDays,
  };
}

export function sortDevices(
  devices: ExternalAccessDeviceDetail[],
): ExternalAccessDeviceDetail[] {
  return devices.slice().sort((left, right) => {
    if (left.isServerNode !== right.isServerNode) {
      return Number(right.isServerNode) - Number(left.isServerNode);
    }
    if (left.authorized !== right.authorized) {
      return Number(left.authorized) - Number(right.authorized);
    }
    if (left.connectedToControl !== right.connectedToControl) {
      return Number(right.connectedToControl) - Number(left.connectedToControl);
    }
    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

export function computeExternalAccessAlerts(
  devices: ExternalAccessDeviceSummary[],
  timezone: string,
): ExternalAccessAlert[] {
  const alerts: ExternalAccessAlert[] = [];
  for (const device of devices) {
    if (
      !device.keyExpiryDisabled &&
      device.expires &&
      device.expiresInDays !== null &&
      device.expiresInDays <= KEY_EXPIRY_ALERT_DAYS
    ) {
      const dueOn = householdToday(timezone, new Date(device.expires));
      const label = device.isServerNode ? `${device.hostname}（小管家节点）` : device.hostname;
      const message =
        device.expiresInDays < 0
          ? `${label} 的 Tailscale 密钥已过期 ${Math.abs(device.expiresInDays)} 天，请尽快重新认证`
          : device.expiresInDays === 0
            ? `${label} 的 Tailscale 密钥今天到期，请尽快处理`
            : `${label} 的 Tailscale 密钥将在 ${device.expiresInDays} 天后到期（${dueOn}）`;
      alerts.push({
        kind: 'key_expiring',
        deviceId: device.id,
        deviceName: device.hostname,
        isServerNode: device.isServerNode,
        dueOn,
        daysRemaining: device.expiresInDays,
        offlineDays: device.offlineDays,
        message,
      });
    }
    if (
      !device.connectedToControl &&
      device.offlineDays !== null &&
      device.offlineDays >= STALE_OFFLINE_ALERT_DAYS
    ) {
      const label = device.isServerNode ? `${device.hostname}（小管家节点）` : device.hostname;
      alerts.push({
        kind: 'stale_offline',
        deviceId: device.id,
        deviceName: device.hostname,
        isServerNode: device.isServerNode,
        dueOn: null,
        daysRemaining: null,
        offlineDays: device.offlineDays,
        message: `${label} 已连续离线 ${device.offlineDays} 天，如已更换设备建议在 Tailscale 控制台清理`,
      });
    }
  }
  return alerts.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'key_expiring' ? -1 : 1;
    if (left.isServerNode !== right.isServerNode) {
      return Number(right.isServerNode) - Number(left.isServerNode);
    }
    return (left.daysRemaining ?? 9999) - (right.daysRemaining ?? 9999);
  });
}

export function computeExternalAccessSummary(
  devices: ExternalAccessDeviceSummary[],
  alerts: ExternalAccessAlert[],
): ExternalAccessSummaryStats {
  return {
    totalDevices: devices.length,
    onlineDevices: devices.filter((device) => device.connectedToControl).length,
    unauthorizedDevices: devices.filter((device) => !device.authorized).length,
    expiringSoonCount: alerts.filter((alert) => alert.kind === 'key_expiring').length,
    staleOfflineCount: alerts.filter((alert) => alert.kind === 'stale_offline').length,
    externalDevices: devices.filter((device) => device.isExternal).length,
  };
}

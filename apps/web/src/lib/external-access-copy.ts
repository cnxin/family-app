import type {
  ExternalAccessDeviceSummary,
  ExternalAccessTestResult,
} from '@family/contracts';

export type DeviceFilter = 'all' | 'online' | 'attention';
export type StatusTone = 'ok' | 'warm' | 'danger' | 'muted';

const OS_NAMES: Record<string, string> = {
  ios: 'iOS',
  ipados: 'iPadOS',
  macos: 'macOS',
  android: 'Android',
  linux: 'Linux',
  windows: 'Windows',
  freebsd: 'FreeBSD',
  tvos: 'tvOS',
};

export function osLabel(os: string | null): string {
  if (!os) return '未知系统';
  const normalized = os.trim().toLowerCase();
  return OS_NAMES[normalized] ?? os;
}

export function formatClock(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

export function formatDateTime(value: string | null, timeZone: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

export function formatDateOnly(value: string | null, timeZone: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  }).format(date);
}

export function formatRelativeSeen(
  lastSeen: string | null,
  connectedToControl: boolean,
  now = new Date(),
): string {
  if (connectedToControl) return '当前在线';
  if (!lastSeen) return '暂无在线记录';
  const date = new Date(lastSeen);
  if (Number.isNaN(date.getTime())) return '暂无在线记录';
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 2) return '刚刚在线';
  if (minutes < 60) return `${minutes} 分钟前在线`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前在线`;
  const days = Math.floor(hours / 24);
  return `${days} 天前在线`;
}

export function formatKeyExpiry(
  device: Pick<ExternalAccessDeviceSummary, 'keyExpiryDisabled' | 'expires' | 'expiresInDays'>,
): { label: string; tone: StatusTone } {
  if (device.keyExpiryDisabled) {
    return { label: '密钥永不过期', tone: 'ok' };
  }
  if (device.expiresInDays == null || !device.expires) {
    return { label: '无到期记录', tone: 'muted' };
  }
  if (device.expiresInDays < 0) {
    return { label: '密钥已过期', tone: 'danger' };
  }
  if (device.expiresInDays === 0) {
    return { label: '今日到期', tone: 'danger' };
  }
  if (device.expiresInDays <= 14) {
    return { label: `${device.expiresInDays} 天后到期`, tone: 'warm' };
  }
  return { label: `${device.expiresInDays} 天后到期`, tone: 'muted' };
}

export function deviceAttentionNeeded(device: ExternalAccessDeviceSummary): boolean {
  if (!device.authorized) return true;
  if (!device.keyExpiryDisabled && device.expiresInDays != null && device.expiresInDays <= 14) return true;
  if (!device.connectedToControl && device.offlineDays != null && device.offlineDays >= 30) return true;
  return false;
}

export function deviceStatusBadge(device: ExternalAccessDeviceSummary): { label: string; tone: StatusTone } {
  if (!device.authorized) return { label: '待授权', tone: 'warm' };
  if (device.connectedToControl) return { label: '在线', tone: 'ok' };
  if (device.offlineDays != null && device.offlineDays >= 30) {
    return { label: `离线 ${device.offlineDays} 天`, tone: 'warm' };
  }
  return { label: '离线', tone: 'muted' };
}

export function sortDevices(devices: readonly ExternalAccessDeviceSummary[]): ExternalAccessDeviceSummary[] {
  return [...devices].sort((left, right) => {
    if (left.isServerNode !== right.isServerNode) return left.isServerNode ? -1 : 1;
    if (left.authorized !== right.authorized) return left.authorized ? 1 : -1;
    const leftExpiring = !left.keyExpiryDisabled && left.expiresInDays != null && left.expiresInDays <= 14;
    const rightExpiring = !right.keyExpiryDisabled && right.expiresInDays != null && right.expiresInDays <= 14;
    if (leftExpiring !== rightExpiring) return leftExpiring ? -1 : 1;
    if (left.connectedToControl !== right.connectedToControl) return left.connectedToControl ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

export function filterDevices(
  devices: readonly ExternalAccessDeviceSummary[],
  filter: DeviceFilter,
): ExternalAccessDeviceSummary[] {
  if (filter === 'online') return devices.filter((device) => device.connectedToControl);
  if (filter === 'attention') return devices.filter(deviceAttentionNeeded);
  return [...devices];
}

export function permissionSummary(result: ExternalAccessTestResult): { label: string; tone: StatusTone } {
  if (result.permissionLevel === 'read_only') return { label: '只读权限已核验', tone: 'ok' };
  if (result.permissionLevel === 'read_write') return { label: '含写权限（阶段 1 禁止）', tone: 'danger' };
  return { label: '权限未能确认', tone: 'warm' };
}

export const TONE_PILL: Record<StatusTone, string> = {
  ok: 'bg-accent-soft text-accent',
  warm: 'bg-warm-soft text-warm',
  danger: 'bg-danger/10 text-danger',
  muted: 'bg-muted text-ink-soft',
};

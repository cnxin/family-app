import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  ExternalAccessConnection,
  ExternalAccessDeviceDetail,
  ExternalAccessDeviceList,
  ExternalAccessOverview,
  ExternalAccessSession,
  ExternalAccessTestResult,
  TestExternalAccessSettingsBody,
} from '@family/contracts';
import type { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import {
  extractTailscaleIngress,
  type TailscaleIngressRequestLike,
} from '../common/tailscale-ingress';
import type { MemberRole } from '../entities';
import { ExternalAccessNotifierService } from './external-access-notifier.service';
import {
  ExternalAccessSettingsService,
  type ResolvedTailscaleAccess,
} from './external-access-settings.service';
import {
  computeExternalAccessAlerts,
  computeExternalAccessSummary,
  matchServerNode,
  presentTailscaleDeviceDetail,
  sortDevices,
  toDeviceSummary,
} from './tailscale.alerts';
import {
  fetchTailscaleDevice,
  fetchTailscaleDevices,
  probeTailscaleReadOnly,
  TailscaleApiError,
} from './tailscale.client';
import { isPublicUrlCorsMatched } from './tailscale.config';

/** 方案 §5.3：概览与设备列表默认 60 秒缓存，可用 ?refresh=true 主动刷新。 */
const OVERVIEW_CACHE_MS = 60_000;
const REACHABLE_PERSIST_MS = 60_000;

interface CachedSnapshot {
  version: string;
  atMs: number;
  checkedAt: string;
  available: boolean;
  message: string;
  devices: ExternalAccessDeviceDetail[];
}

function errorMessage(error: unknown): string {
  return error instanceof TailscaleApiError
    ? error.message
    : '连不上 Tailscale 控制面，请检查网络或凭据设置';
}

function emptySummary() {
  return {
    totalDevices: 0,
    onlineDevices: 0,
    unauthorizedDevices: 0,
    expiringSoonCount: 0,
    staleOfflineCount: 0,
    externalDevices: 0,
  };
}

function unconfiguredConnection(checkedAt: string, message: string): ExternalAccessConnection {
  return { configured: false, available: false, checkedAt, message, cached: false };
}

function failedTestResult(
  checkedAt: string,
  message: string,
  credentialKind: ExternalAccessTestResult['credentialKind'],
): ExternalAccessTestResult {
  return {
    ok: false,
    available: false,
    readOnlyVerified: false,
    permissionLevel: 'unknown',
    checkedAt,
    message,
    deviceCount: null,
    matchedNodeName: null,
    credentialKind,
  };
}

function emptyOverview(
  resolved: Pick<ResolvedTailscaleAccess, 'accessScope' | 'accessMessage' | 'publicUrl' | 'nodeHostname'>,
  checkedAt: string,
  message: string,
): ExternalAccessOverview {
  const restricted = resolved.accessScope === 'restricted';
  return {
    accessScope: resolved.accessScope,
    accessMessage: restricted ? resolved.accessMessage : null,
    connection: unconfiguredConnection(checkedAt, message),
    publicUrl: restricted ? null : resolved.publicUrl,
    corsOriginMatched: restricted ? null : isPublicUrlCorsMatched(resolved.publicUrl),
    nodeHostname: restricted ? null : resolved.nodeHostname,
    node: null,
    summary: emptySummary(),
    devices: [],
    alerts: [],
  };
}

@Injectable()
export class ExternalAccessService {
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly inflight = new Map<string, Promise<CachedSnapshot>>();
  private readonly unreachable = new Map<string, Date>();
  private readonly reachablePersistedAt = new Map<string, number>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly settings: ExternalAccessSettingsService,
    private readonly notifier: ExternalAccessNotifierService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  forget(householdId: string) {
    this.generations.set(householdId, (this.generations.get(householdId) ?? 0) + 1);
    this.cache.delete(householdId);
    const prefix = `${householdId}:`;
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
    this.unreachable.delete(householdId);
    this.reachablePersistedAt.delete(householdId);
  }

  noteReachable(householdId: string, ok: boolean) {
    const now = this.clock.now();
    if (!ok) {
      if (!this.unreachable.has(householdId)) this.unreachable.set(householdId, now);
      return;
    }
    const recovered = this.unreachable.delete(householdId);
    const written = this.reachablePersistedAt.get(householdId);
    if (!recovered && written !== undefined && Math.abs(now.getTime() - written) < REACHABLE_PERSIST_MS) {
      return;
    }
    this.reachablePersistedAt.set(householdId, now.getTime());
    void this.settings.markReachable(householdId, now).catch(() => {
      this.reachablePersistedAt.delete(householdId);
    });
  }

  async unreachableSince(householdId: string): Promise<Date | null> {
    const failing = this.unreachable.get(householdId);
    if (!failing) return null;
    const last = await this.settings.lastReachableAt(householdId);
    return last && last.getTime() < failing.getTime() ? last : failing;
  }

  session(request: TailscaleIngressRequestLike | undefined, user: JwtUser): ExternalAccessSession {
    const ingress = extractTailscaleIngress(request);
    if (!ingress.viaTailscale) {
      return { viaTailscale: false, login: null, name: null };
    }
    if (user.role === 'member') {
      return { viaTailscale: true, login: null, name: null };
    }
    return { viaTailscale: true, login: ingress.login, name: ingress.name };
  }

  async test(
    body: TestExternalAccessSettingsBody,
    user: JwtUser,
  ): Promise<ExternalAccessTestResult> {
    const checkedAt = this.clock.now().toISOString();
    const resolved = await this.settings.resolveForDraftTest(user, body);
    if (resolved.accessScope === 'restricted') {
      return failedTestResult(
        checkedAt,
        resolved.accessMessage ?? '本实例未向你的家庭开放外部访问管理',
        null,
      );
    }
    if (!resolved.target) {
      return failedTestResult(
        checkedAt,
        '还没有配置完整的 Tailscale 控制面凭据',
        body.credentialKind ?? null,
      );
    }

    try {
      const outcome = await probeTailscaleReadOnly(resolved.target);
      const matched = outcome.devices.find((device) =>
        matchServerNode(device, resolved.nodeHostname),
      );
      return {
        ok: outcome.available && outcome.readOnlyVerified,
        available: outcome.available,
        readOnlyVerified: outcome.readOnlyVerified,
        permissionLevel: outcome.permissionLevel,
        checkedAt,
        message: outcome.message,
        deviceCount: outcome.devices.length,
        matchedNodeName: matched ? (matched.name?.replace(/\.+$/, '') || matched.hostname || matched.id) : null,
        credentialKind: resolved.target.credentialKind,
      };
    } catch (error) {
      return failedTestResult(checkedAt, errorMessage(error), resolved.target.credentialKind);
    }
  }

  async overview(user: JwtUser, refresh = false): Promise<ExternalAccessOverview> {
    return this.buildOverview(user.householdId, user.role, refresh, true);
  }

  async overviewForBackground(
    householdId: string,
    role: MemberRole,
    refresh: boolean,
    syncNotifications: boolean,
  ): Promise<ExternalAccessOverview> {
    return this.buildOverview(householdId, role, refresh, syncNotifications);
  }

  async devices(user: JwtUser, refresh = false): Promise<ExternalAccessDeviceList> {
    const resolved = await this.settings.resolve(user.householdId, user.role);
    const checkedAt = this.clock.now().toISOString();
    if (resolved.accessScope === 'restricted') {
      return {
        accessScope: 'restricted',
        accessMessage: resolved.accessMessage,
        connection: unconfiguredConnection(
          checkedAt,
          resolved.accessMessage ?? '本实例未向你的家庭开放外部访问管理',
        ),
        devices: [],
      };
    }
    if (!resolved.target) {
      return {
        accessScope: resolved.accessScope,
        accessMessage: null,
        connection: unconfiguredConnection(checkedAt, '还没有配置 Tailscale 控制面凭据'),
        devices: [],
      };
    }
    const timezone = await this.householdTimezone(user.householdId);
    const { snapshot, cached } = await this.getSnapshot(user.householdId, resolved, timezone, refresh);
    return {
      accessScope: resolved.accessScope,
      accessMessage: null,
      connection: this.presentConnection(snapshot, cached),
      devices: snapshot.devices,
    };
  }

  async device(user: JwtUser, deviceId: string): Promise<ExternalAccessDeviceDetail> {
    const resolved = await this.settings.resolve(user.householdId, user.role);
    if (resolved.accessScope === 'restricted') {
      throw new ForbiddenException(resolved.accessMessage ?? '本实例未向你的家庭开放外部访问管理');
    }
    if (!resolved.target) {
      throw new NotFoundException('尚未配置 Tailscale 外部访问');
    }
    const timezone = await this.householdTimezone(user.householdId);
    try {
      const raw = await fetchTailscaleDevice(resolved.target, deviceId);
      this.noteReachable(user.householdId, true);
      if (!raw) throw new NotFoundException('找不到这台 Tailscale 设备');
      return presentTailscaleDeviceDetail(raw, resolved.nodeHostname, timezone, this.clock.now());
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.noteReachable(user.householdId, false);
      throw new ServiceUnavailableException(errorMessage(error));
    }
  }

  private async buildOverview(
    householdId: string,
    role: MemberRole,
    refresh: boolean,
    syncNotifications: boolean,
  ): Promise<ExternalAccessOverview> {
    const resolved = await this.settings.resolve(householdId, role);
    const checkedAt = this.clock.now().toISOString();
    if (resolved.accessScope === 'restricted') {
      return emptyOverview(
        resolved,
        checkedAt,
        resolved.accessMessage ?? '本实例未向你的家庭开放外部访问管理',
      );
    }
    if (!resolved.target) {
      return emptyOverview(resolved, checkedAt, '还没有配置 Tailscale 控制面凭据');
    }

    const timezone = await this.householdTimezone(householdId);
    const { snapshot, cached } = await this.getSnapshot(householdId, resolved, timezone, refresh);
    const summaries = snapshot.devices.map(toDeviceSummary);
    const alerts = snapshot.available ? computeExternalAccessAlerts(summaries, timezone) : [];
    const node = summaries.find((device) => device.isServerNode) ?? null;

    if (syncNotifications && !cached && snapshot.available && alerts.length > 0) {
      try {
        await this.notifier.syncAlerts(householdId, resolved.accessScope, alerts, timezone);
      } catch {
        // 通知入库失败不影响概览面板读取
      }
    }

    return {
      accessScope: resolved.accessScope,
      accessMessage: null,
      connection: this.presentConnection(snapshot, cached),
      publicUrl: resolved.publicUrl,
      corsOriginMatched: isPublicUrlCorsMatched(resolved.publicUrl),
      nodeHostname: resolved.nodeHostname,
      node,
      summary: computeExternalAccessSummary(summaries, alerts),
      devices: summaries,
      alerts,
    };
  }

  private presentConnection(snapshot: CachedSnapshot, cached: boolean): ExternalAccessConnection {
    return {
      configured: true,
      available: snapshot.available,
      checkedAt: snapshot.checkedAt,
      message: snapshot.message,
      cached,
    };
  }

  private async getSnapshot(
    householdId: string,
    resolved: ResolvedTailscaleAccess,
    timezone: string,
    refresh: boolean,
  ): Promise<{ snapshot: CachedSnapshot; cached: boolean }> {
    const nowMs = this.clock.now().getTime();
    if (!refresh) {
      const existing = this.cache.get(householdId);
      if (
        existing &&
        existing.version === resolved.version &&
        Math.abs(nowMs - existing.atMs) < OVERVIEW_CACHE_MS
      ) {
        return { snapshot: existing, cached: true };
      }
    }

    const inflightKey = `${householdId}:${resolved.version}`;
    if (!refresh) {
      const active = this.inflight.get(inflightKey);
      if (active) {
        return { snapshot: await active, cached: false };
      }
    }

    const generation = this.generations.get(householdId) ?? 0;
    const task = this.fetchFreshSnapshot(householdId, resolved, timezone, generation).finally(() => {
      if (this.inflight.get(inflightKey) === task) {
        this.inflight.delete(inflightKey);
      }
    });
    this.inflight.set(inflightKey, task);
    const snapshot = await task;
    if ((this.generations.get(householdId) ?? 0) === generation) {
      this.cache.set(householdId, snapshot);
    }
    return { snapshot, cached: false };
  }

  private async fetchFreshSnapshot(
    householdId: string,
    resolved: ResolvedTailscaleAccess,
    timezone: string,
    generation: number,
  ): Promise<CachedSnapshot> {
    const now = this.clock.now();
    const checkedAt = now.toISOString();
    try {
      const rawDevices = await fetchTailscaleDevices(resolved.target!);
      if ((this.generations.get(householdId) ?? 0) === generation) {
        this.noteReachable(householdId, true);
      }
      const devices = sortDevices(
        rawDevices.map((raw) =>
          presentTailscaleDeviceDetail(raw, resolved.nodeHostname, timezone, now),
        ),
      );
      return {
        version: resolved.version,
        atMs: now.getTime(),
        checkedAt,
        available: true,
        message: `已连接控制面，共 ${devices.length} 台设备`,
        devices,
      };
    } catch (error) {
      if ((this.generations.get(householdId) ?? 0) === generation) {
        this.noteReachable(householdId, false);
      }
      return {
        version: resolved.version,
        atMs: now.getTime(),
        checkedAt,
        available: false,
        message: errorMessage(error),
        devices: [],
      };
    }
  }

  private async householdTimezone(householdId: string): Promise<string> {
    const rows: { timezone: string }[] = await this.dataSource.query(
      'SELECT timezone FROM households WHERE id = $1',
      [householdId],
    );
    return rows[0]?.timezone ?? 'Asia/Shanghai';
  }
}

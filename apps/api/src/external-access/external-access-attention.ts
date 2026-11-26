import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Capability } from '../auth/capabilities';
import type { MemberRole } from '../entities';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';
import { ExternalAccessService } from './external-access.service';
import { deterministicExternalAccessUuid, isolatedTestMode } from './tailscale.config';

const ATTENTION_WAIT_MS = 1_500;
const DEFAULT_OFFLINE_ATTENTION_MS = 3_600_000;

function offlineAttentionThresholdMs(): number {
  if (isolatedTestMode()) {
    const raw = process.env.EXTERNAL_ACCESS_OFFLINE_ATTENTION_MS?.trim();
    if (raw) {
      const configured = Number(raw);
      if (Number.isFinite(configured) && configured >= 0) return configured;
    }
  }
  return DEFAULT_OFFLINE_ATTENTION_MS;
}

/**
 * 外部访问留意来源（挂到今天页 AttentionRegistry）：
 * - key-expiring：14 天内到期的 Tailscale 节点/设备密钥（entity.id 使用确定性 UUID）；
 * - offline：Tailscale 控制面连续不可达超过阈值（默认 1 小时，entity.id 为 householdId）。
 * 仅对具备 manage_integrations 能力的管理员生效，且遵守多家庭可见范围。
 */
@Injectable()
export class ExternalAccessAttentionSource implements AttentionSource, OnModuleInit {
  readonly domain = 'external-access' as const;
  readonly kinds = ['key-expiring', 'offline'] as const;

  constructor(
    private readonly registry: AttentionRegistry,
    private readonly externalAccess: ExternalAccessService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async run(
    context: AttentionRuleContext,
    can: (capability: Capability) => boolean,
  ): Promise<AttentionCandidate[]> {
    if (!can('manage_integrations')) return [];

    const roleRows: { role: MemberRole }[] = await this.dataSource.query(
      'SELECT role FROM members WHERE id = $1 AND "householdId" = $2 LIMIT 1',
      [context.memberId, context.householdId],
    );
    const role = roleRows[0]?.role;
    if (!role || role === 'member') return [];

    const overview = await Promise.race([
      this.externalAccess
        .overviewForBackground(context.householdId, role, false, false)
        .catch(() => null),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ATTENTION_WAIT_MS);
        timer.unref?.();
      }),
    ]);

    const candidates: AttentionCandidate[] = [];
    if (overview && overview.accessScope !== 'restricted' && overview.connection.configured) {
      if (overview.connection.available) {
        for (const alert of overview.alerts) {
          if (alert.kind !== 'key_expiring') continue;
          candidates.push({
            domain: 'external-access',
            kind: 'key-expiring',
            id: deterministicExternalAccessUuid(context.householdId, alert.deviceId),
            name: alert.deviceName,
            dueOn: alert.dueOn ?? undefined,
            overdue: (alert.daysRemaining ?? 0) < 0,
          });
        }
      } else {
        const since = await this.externalAccess.unreachableSince(context.householdId);
        if (since && context.now.getTime() - since.getTime() >= offlineAttentionThresholdMs()) {
          candidates.push({
            domain: 'external-access',
            kind: 'offline',
            id: context.householdId,
            name: 'Tailscale 控制面',
            overdue: false,
          });
        }
      }
    }

    return candidates;
  }
}

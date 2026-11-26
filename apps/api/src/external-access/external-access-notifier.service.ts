import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import type { ExternalAccessAccessScope, ExternalAccessAlert } from '@family/contracts';
import { householdToday } from '@family/shared';
import { Clock } from '../common/clock';
import { Member, Notification, type MemberRole } from '../entities';
import { EventBus } from '../events/event-bus';
import { deterministicExternalAccessUuid } from './tailscale.config';

const ALERT_TARGET_PATH = '/house/external-access';

function notificationTypeForAlert(alert: ExternalAccessAlert): string {
  if (alert.kind === 'key_expiring') {
    return alert.dueOn
      ? `external_access_key_expiring:${alert.dueOn}`
      : 'external_access_key_expiring';
  }
  return 'external_access_stale_offline';
}

function notificationCopyForAlert(alert: ExternalAccessAlert): { title: string; body: string } {
  const prefix = alert.isServerNode ? `${alert.deviceName}（小管家节点）` : alert.deviceName;
  if (alert.kind === 'key_expiring') {
    const title =
      alert.daysRemaining !== null && alert.daysRemaining < 0
        ? `${prefix} 访问密钥已过期`
        : `${prefix} 访问密钥即将到期`;
    return { title: title.slice(0, 160), body: alert.message.slice(0, 500) };
  }
  return {
    title: `${prefix} 已长时间离线`.slice(0, 160),
    body: alert.message.slice(0, 500),
  };
}

/**
 * 外部访问到期 / 长期离线通知同步器（docs/external-access-plan.md §5.1、§5.6）：
 * - 密钥 14 天内到期、设备离线 ≥ 30 天写入 notifications（module = 'system'）；
 * - 同一家庭同一设备同一事件每天每名管理员最多一条；
 * - 密钥到期日变化时 type 含 dueOn（external_access_key_expiring:YYYY-MM-DD），会重新计算并补发新到期提醒；
 * - 服务器默认模式下仅发给 owner，家庭覆盖模式下发给 owner + admin。
 */
@Injectable()
export class ExternalAccessNotifierService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async syncAlerts(
    householdId: string,
    accessScope: ExternalAccessAccessScope,
    alerts: ExternalAccessAlert[],
    timezone: string,
  ): Promise<number> {
    if (accessScope === 'restricted' || alerts.length === 0) return 0;
    const now = this.clock.now();
    const today = householdToday(timezone, now);
    const recipientRoles: MemberRole[] =
      accessScope === 'server_default' ? ['owner'] : ['owner', 'admin'];

    const inserted = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('external-access-notify:' || $1))`,
        [householdId],
      );

      const recipients = await manager.getRepository(Member).find({
        where: {
          householdId,
          role: In(recipientRoles),
          disabledAt: IsNull(),
        },
        select: { id: true },
      });
      if (recipients.length === 0) return 0;

      const existingRows: { recipientId: string; sourceId: string | null; type: string }[] =
        await manager.query(
          `SELECT "recipientId", "sourceId", type
             FROM notifications
            WHERE "householdId" = $1
              AND module = 'system'
              AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')
              AND ("createdAt" AT TIME ZONE $2)::date = $3::date`,
          [householdId, timezone, today],
        );
      const sentToday = new Set(
        existingRows.map((row) => `${row.recipientId}|${row.sourceId ?? ''}|${row.type}`),
      );

      const repo = manager.getRepository(Notification);
      const pending: Notification[] = [];
      for (const alert of alerts) {
        const sourceId = deterministicExternalAccessUuid(householdId, alert.deviceId);
        const type = notificationTypeForAlert(alert);
        const copy = notificationCopyForAlert(alert);
        for (const recipient of recipients) {
          const dedupKey = `${recipient.id}|${sourceId}|${type}`;
          if (sentToday.has(dedupKey)) continue;
          sentToday.add(dedupKey);
          pending.push(
            repo.create({
              householdId,
              recipientId: recipient.id,
              module: 'system',
              type,
              sourceId,
              title: copy.title,
              body: copy.body,
              targetPath: ALERT_TARGET_PATH,
              readAt: null,
              externalRoutedAt: null,
              createdAt: now,
            }),
          );
        }
      }

      if (pending.length === 0) return 0;
      await repo.save(pending);
      return pending.length;
    });

    if (inserted > 0) {
      this.events.publish({ householdId, domains: ['notifications'] });
    }
    return inserted;
  }
}

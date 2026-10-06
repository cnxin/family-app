import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  ATTENTION_THRESHOLDS,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 备份（内核）的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class BackupAttentionRule implements AttentionSource {
  readonly domain = 'backups' as const;
  readonly kinds = ['backup'] as const;

  constructor(private readonly db: DataSource) {}

  run({ householdId, now }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'backups' AS domain, 'backup' AS kind,
             p.id, '备份' AS name, NULL::text AS "dueOn", false AS overdue
        FROM backup_policies p
       WHERE p."householdId" = $1
         AND (
           (
             SELECT r.status
               FROM backup_runs r
              WHERE r."householdId" = p."householdId"
                AND r.kind = 'backup'
              ORDER BY r."createdAt" DESC
              LIMIT 1
           ) = 'failed'
           OR p."workerLastSeenAt" IS NULL
           OR p."workerLastSeenAt" < $2::timestamptz - interval '${ATTENTION_THRESHOLDS.backupWorkerOfflineSeconds} seconds'
         )`,
      [householdId, now],
    );
  }
}

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 */
@Injectable()
export class BackupsAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly backup: BackupAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.backup);
  }
}

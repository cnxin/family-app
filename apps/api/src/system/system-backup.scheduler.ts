import { EventBus } from '../events/event-bus';
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { BackupPolicy, BackupRun, Member, Notification } from '../entities';
import { runLabel, calculateNextBackup, calculateNextRestoreDrill } from './system-backup.helpers';

/** 备份后台：启动时开两个定时器，处理到期的自动备份 / 恢复演练、回收卡住的任务、发完成与容量告警通知、推送备份变更事件（J7.2 从 SystemBackupService 拆出）。 */
@Injectable()
export class SystemBackupScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private processing = false;
  /** 每个家庭上一次看到的「运行记录最新更新时间 / 备份程序是否在线」，变了才推事件。 */
  private readonly lastSeen = new Map<string, string>();

  constructor(
    @InjectRepository(BackupPolicy)
    private readonly policies: Repository<BackupPolicy>,
    @InjectRepository(BackupRun)
    private readonly runs: Repository<BackupRun>,
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(process.env.BACKUP_SCHEDULER_POLL_INTERVAL_MS || 30_000);
    const interval = Number.isFinite(configured)
      ? Math.max(500, Math.min(configured, 300_000))
      : 30_000;
    void this.processOperations();
    this.timer = setInterval(() => void this.processOperations(), interval);
    this.timer.unref();
    // 备份 worker 是 shell 脚本，直接改库，API 感知不到；这里看一眼有没有变化，变了推 backups
    const watch = Number(process.env.BACKUP_EVENTS_WATCH_MS || 5_000);
    this.watchTimer = setInterval(
      () => void this.publishBackupChanges(),
      Number.isFinite(watch) ? Math.max(100, Math.min(watch, 60_000)) : 5_000,
    );
    this.watchTimer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.timer = null;
    this.watchTimer = null;
  }

  private async publishBackupChanges() {
    try {
      const rows: { householdId: string; runsAt: Date | null; seenAt: Date | null }[] =
        await this.dataSource.query(`
          SELECT p."householdId" AS "householdId",
                 (SELECT MAX(r."updatedAt") FROM backup_runs r WHERE r."householdId" = p."householdId") AS "runsAt",
                 p."workerLastSeenAt" AS "seenAt"
            FROM backup_policies p`);
      const now = Date.now();
      for (const row of rows) {
        const online = Boolean(row.seenAt && now - new Date(row.seenAt).getTime() < 90_000);
        const signature = `${row.runsAt ? new Date(row.runsAt).toISOString() : '-'}|${online}`;
        const previous = this.lastSeen.get(row.householdId);
        this.lastSeen.set(row.householdId, signature);
        if (previous !== undefined && previous !== signature) {
          this.events.publish({ householdId: row.householdId, domains: ['backups'] });
        }
      }
    } catch {
      /* 观察失败不影响备份本身；下一轮再看 */
    }
  }

  private async processOperations() {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.recoverStaleRuns();
      const due = await this.policies
        .createQueryBuilder('policy')
        .where(
          '(policy."scheduleEnabled" = true AND (policy."nextBackupAt" IS NULL OR policy."nextBackupAt" <= now()))',
        )
        .orWhere(
          '(policy."restoreDrillEnabled" = true AND (policy."nextRestoreDrillAt" IS NULL OR policy."nextRestoreDrillAt" <= now()))',
        )
        .orderBy('policy.updatedAt', 'ASC')
        .take(20)
        .getMany();
      for (const policy of due) await this.enqueueDuePolicy(policy.id);
      await this.notifyFinishedRuns();
      await this.notifyCapacityAlerts();
    } finally {
      this.processing = false;
    }
  }

  private async enqueueDuePolicy(policyId: string) {
    await this.dataSource.transaction(async (manager) => {
      const policies = manager.getRepository(BackupPolicy);
      const runs = manager.getRepository(BackupRun);
      const policy = await policies.findOne({
        where: { id: policyId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!policy) return;
      const now = new Date();
      if (policy.scheduleEnabled && (!policy.nextBackupAt || policy.nextBackupAt <= now)) {
        const scheduledFor = policy.nextBackupAt ?? now;
        await runs
          .createQueryBuilder()
          .insert()
          .values({
            householdId: policy.householdId,
            kind: 'backup',
            status: 'queued',
            trigger: 'scheduled',
            requestedById: null,
            idempotencyKey: `scheduled:backup:${scheduledFor.toISOString()}`,
            scheduledFor,
          })
          .orIgnore()
          .execute();
        policy.nextBackupAt = await calculateNextBackup(manager, policy);
      }
      if (
        policy.restoreDrillEnabled &&
        (!policy.nextRestoreDrillAt || policy.nextRestoreDrillAt <= now)
      ) {
        const scheduledFor = policy.nextRestoreDrillAt ?? now;
        const source = await runs.findOne({
          where: {
            householdId: policy.householdId,
            kind: 'backup',
            status: 'succeeded',
            retained: true,
            checksumVerified: true,
          },
          order: { finishedAt: 'DESC' },
        });
        if (source) {
          await runs
            .createQueryBuilder()
            .insert()
            .values({
              householdId: policy.householdId,
              kind: 'restore_drill',
              status: 'queued',
              trigger: 'scheduled',
              sourceBackupRunId: source.id,
              requestedById: null,
              idempotencyKey: `scheduled:restore:${scheduledFor.toISOString()}`,
              scheduledFor,
            })
            .orIgnore()
            .execute();
        }
        policy.nextRestoreDrillAt = await calculateNextRestoreDrill(
          manager,
          policy,
        );
      }
      await policies.save(policy);
    });
  }

  private async recoverStaleRuns() {
    const configured = Number(process.env.BACKUP_RUN_STALE_MS || 7_200_000);
    const staleMs = Number.isFinite(configured)
      ? Math.max(300_000, Math.min(configured, 86_400_000))
      : 7_200_000;
    await this.runs
      .createQueryBuilder()
      .update()
      .set({
        status: 'failed',
        finishedAt: () => 'now()',
        errorCode: 'worker_timeout',
        errorMessage: '备份 worker 心跳超时，任务已停止',
      })
      .where('status = :status', { status: 'running' })
      .andWhere(
        `COALESCE("heartbeatAt", "startedAt", "updatedAt") < now() - (:staleMs * interval '1 millisecond')`,
        { staleMs },
      )
      .execute();
  }

  private async notifyFinishedRuns() {
    const completed = await this.runs.find({
      where: {
        notifiedAt: IsNull(),
        finishedAt: Not(IsNull()),
        status: In(['succeeded', 'failed']),
      },
      order: { finishedAt: 'ASC' },
      take: 30,
    });
    for (const candidate of completed) {
      await this.dataSource.transaction(async (manager) => {
        const runs = manager.getRepository(BackupRun);
        const run = await runs.findOne({
          where: { id: candidate.id },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (!run || run.notifiedAt || run.kind === 'capacity_check') return;
        const recipients = await manager.getRepository(Member).find({
          where: {
            householdId: run.householdId,
            role: In(['owner', 'admin']),
            disabledAt: IsNull(),
          },
        });
        const successful = run.status === 'succeeded';
        await manager.getRepository(Notification).save(
          recipients.map((recipient) =>
            manager.getRepository(Notification).create({
              householdId: run.householdId,
              recipientId: recipient.id,
              module: 'system',
              type: `backup_${run.kind}_${run.status}`,
              sourceId: run.id,
              title: `${runLabel(run.kind)}${successful ? '成功' : '失败'}`,
              body: successful
                ? run.resultSummary ?? '运维任务已经完成'
                : run.errorMessage ?? '请在系统备份页查看状态并重试',
              targetPath: '/system-backups',
              readAt: null,
              externalRoutedAt: null,
            }),
          ),
        );
        run.notifiedAt = new Date();
        await runs.save(run);
      });
    }
  }

  private async notifyCapacityAlerts() {
    const candidates = await this.policies
      .createQueryBuilder('policy')
      .where(`policy."capacityStatus" IN ('warning', 'critical')`)
      .andWhere(
        `(policy."capacityNotifiedStatus" IS NULL OR policy."capacityNotifiedStatus" <> policy."capacityStatus")`,
      )
      .take(20)
      .getMany();
    for (const candidate of candidates) {
      await this.dataSource.transaction(async (manager) => {
        const policies = manager.getRepository(BackupPolicy);
        const policy = await policies.findOne({
          where: { id: candidate.id },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (
          !policy ||
          !['warning', 'critical'].includes(policy.capacityStatus) ||
          policy.capacityNotifiedStatus === policy.capacityStatus
        ) {
          return;
        }
        const recipients = await manager.getRepository(Member).find({
          where: {
            householdId: policy.householdId,
            role: In(['owner', 'admin']),
            disabledAt: IsNull(),
          },
        });
        const used = policy.storageTotalBytes
          ? Math.round(
              (Number(policy.storageUsedBytes ?? 0) /
                Number(policy.storageTotalBytes)) *
                100,
            )
          : null;
        await manager.getRepository(Notification).save(
          recipients.map((recipient) =>
            manager.getRepository(Notification).create({
              householdId: policy.householdId,
              recipientId: recipient.id,
              module: 'system',
              type: `backup_capacity_${policy.capacityStatus}`,
              sourceId: policy.id,
              title:
                policy.capacityStatus === 'critical'
                  ? '备份空间严重不足'
                  : '备份空间接近上限',
              body:
                used == null
                  ? '备份存储容量状态异常，请检查存储目录'
                  : `备份存储已使用 ${used}%，请及时清理或扩容`,
              targetPath: '/system-backups',
              readAt: null,
              externalRoutedAt: null,
            }),
          ),
        );
        policy.capacityNotifiedStatus = policy.capacityStatus as
          | 'warning'
          | 'critical';
        policy.capacityAlertedAt = new Date();
        await policies.save(policy);
      });
    }
  }
}

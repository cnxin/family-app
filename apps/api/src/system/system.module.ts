import { SystemModulesController } from './system-modules.controller';
import { SystemModulesService } from './system-modules.service';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Param,
  Patch,
  Post,
  Put,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import {
  BackupPolicy,
  BackupRun,
  BackupRunKind,
  BackupScheduleFrequency,
  Member,
  Notification,
} from '../entities';

class UpdateBackupPolicyDto {
  @IsBoolean()
  scheduleEnabled: boolean;

  @IsIn(['daily', 'weekly'])
  frequency: BackupScheduleFrequency;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weeklyDay?: number | null;

  @IsInt()
  @Min(0)
  @Max(23)
  scheduledHour: number;

  @IsInt()
  @Min(0)
  @Max(59)
  scheduledMinute: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays: number;

  @IsInt()
  @Min(1)
  @Max(365)
  retentionCount: number;

  @IsInt()
  @Min(1)
  @Max(98)
  capacityWarningPercent: number;

  @IsInt()
  @Min(2)
  @Max(99)
  capacityCriticalPercent: number;

  @IsBoolean()
  restoreDrillEnabled: boolean;

  @IsInt()
  @Min(1)
  @Max(28)
  restoreDrillDay: number;

  @IsInt()
  @Min(0)
  @Max(23)
  restoreDrillHour: number;
}

class QueueBackupRunDto {
  @Matches(/^[A-Za-z0-9_.:-]{8,180}$/)
  idempotencyKey: string;
}

function assertBackupAdmin(user: JwtUser) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new ForbiddenException('只有家庭管理员可以管理备份');
  }
}

function runLabel(kind: BackupRunKind) {
  if (kind === 'backup') return '完整备份';
  if (kind === 'restore_drill') return '恢复演练';
  return '容量检查';
}

@Injectable()
class SystemBackupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(
    @InjectRepository(BackupPolicy)
    private readonly policies: Repository<BackupPolicy>,
    @InjectRepository(BackupRun)
    private readonly runs: Repository<BackupRun>,
    private readonly dataSource: DataSource,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(process.env.BACKUP_SCHEDULER_POLL_INTERVAL_MS || 30_000);
    const interval = Number.isFinite(configured)
      ? Math.max(500, Math.min(configured, 300_000))
      : 30_000;
    void this.processOperations();
    this.timer = setInterval(() => void this.processOperations(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dashboard(user: JwtUser) {
    assertBackupAdmin(user);
    const policy = await this.ensurePolicy(user.householdId);
    const runs = await this.runs.find({
      where: { householdId: user.householdId },
      order: { createdAt: 'DESC' },
      take: 60,
    });
    const workerOnline = Boolean(
      policy.workerLastSeenAt &&
        Date.now() - policy.workerLastSeenAt.getTime() < 90_000,
    );
    return {
      policy: this.presentPolicy(policy),
      workerOnline,
      activeRun: runs.find((run) => ['queued', 'running'].includes(run.status))
        ? this.presentRun(
            runs.find((run) => ['queued', 'running'].includes(run.status))!,
          )
        : null,
      runs: runs.map((run) => this.presentRun(run)),
    };
  }

  async updatePolicy(dto: UpdateBackupPolicyDto, user: JwtUser) {
    assertBackupAdmin(user);
    if (dto.frequency === 'weekly' && dto.weeklyDay == null) {
      throw new BadRequestException('每周备份需要选择星期');
    }
    if (dto.capacityWarningPercent >= dto.capacityCriticalPercent) {
      throw new BadRequestException('容量警告阈值必须低于严重阈值');
    }
    const policy = await this.dataSource.transaction(async (manager) => {
      let current = await manager.getRepository(BackupPolicy).findOne({
        where: { householdId: user.householdId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!current) {
        current = manager.getRepository(BackupPolicy).create({
          householdId: user.householdId,
        });
      }
      Object.assign(current, dto, {
        weeklyDay: dto.frequency === 'weekly' ? dto.weeklyDay! : null,
      });
      current.nextBackupAt = dto.scheduleEnabled
        ? await this.calculateNextBackup(manager, current)
        : null;
      current.nextRestoreDrillAt = dto.restoreDrillEnabled
        ? await this.calculateNextRestoreDrill(manager, current)
        : null;
      await manager.getRepository(BackupPolicy).save(current);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'backup_policy_updated',
        summary: `${user.name} 更新了家庭备份策略`,
        detail: dto.scheduleEnabled ? '自动备份已启用' : '自动备份已关闭',
        targetPath: '/system-backups',
        metadata: {
          frequency: current.frequency,
          retentionDays: current.retentionDays,
          retentionCount: current.retentionCount,
          restoreDrillEnabled: current.restoreDrillEnabled,
        },
      });
      return current;
    });
    return this.presentPolicy(policy);
  }

  queueBackup(dto: QueueBackupRunDto, user: JwtUser) {
    return this.queueManualRun('backup', dto.idempotencyKey, null, user);
  }

  queueCapacityCheck(dto: QueueBackupRunDto, user: JwtUser) {
    return this.queueManualRun('capacity_check', dto.idempotencyKey, null, user);
  }

  async queueRestoreDrill(
    sourceId: string,
    dto: QueueBackupRunDto,
    user: JwtUser,
  ) {
    assertBackupAdmin(user);
    const source = await this.runs.findOne({
      where: {
        id: sourceId,
        householdId: user.householdId,
        kind: 'backup',
        status: 'succeeded',
        retained: true,
        checksumVerified: true,
      },
    });
    if (!source) throw new NotFoundException('可用于演练的备份不存在');
    return this.queueManualRun(
      'restore_drill',
      dto.idempotencyKey,
      source.id,
      user,
    );
  }

  async cancelRun(id: string, user: JwtUser) {
    assertBackupAdmin(user);
    return this.dataSource.transaction(async (manager) => {
      const run = await manager.getRepository(BackupRun).findOne({
        where: { id, householdId: user.householdId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!run) throw new NotFoundException('备份操作不存在');
      if (run.status === 'cancelled') return this.presentRun(run);
      if (run.status !== 'queued') {
        throw new ConflictException('只有等待执行的操作可以取消');
      }
      run.status = 'cancelled';
      run.finishedAt = new Date();
      run.resultSummary = '由家庭管理员在执行前取消';
      await manager.getRepository(BackupRun).save(run);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'backup_run_cancelled',
        summary: `${user.name} 取消了${runLabel(run.kind)}`,
        targetPath: '/system-backups',
        metadata: { runId: run.id, kind: run.kind },
      });
      return this.presentRun(run);
    });
  }

  private async queueManualRun(
    kind: BackupRunKind,
    idempotencyKey: string,
    sourceBackupRunId: string | null,
    user: JwtUser,
  ) {
    assertBackupAdmin(user);
    return this.dataSource.transaction(async (manager) => {
      const policy = await this.lockOrCreatePolicy(manager, user.householdId);
      const repository = manager.getRepository(BackupRun);
      const existing = await repository.findOneBy({
        householdId: user.householdId,
        idempotencyKey,
      });
      if (existing) return this.presentRun(existing);
      const active = await repository.findOne({
        where: {
          householdId: user.householdId,
          kind,
          status: In(['queued', 'running']),
        },
        order: { createdAt: 'ASC' },
      });
      if (active) {
        throw new ConflictException(`${runLabel(kind)}已有任务正在等待或执行`);
      }
      const run = await repository.save(
        repository.create({
          householdId: user.householdId,
          kind,
          status: 'queued',
          trigger: 'manual',
          sourceBackupRunId,
          requestedById: user.memberId,
          idempotencyKey,
          scheduledFor: new Date(),
        }),
      );
      await recordActivity(manager, user, {
        module: 'system',
        action: `${kind}_queued`,
        summary: `${user.name} 请求了${runLabel(kind)}`,
        targetPath: '/system-backups',
        metadata: { runId: run.id, sourceBackupRunId, policyId: policy.id },
      });
      return this.presentRun(run);
    });
  }

  private async ensurePolicy(householdId: string) {
    await this.policies
      .createQueryBuilder()
      .insert()
      .values({ householdId })
      .orIgnore()
      .execute();
    return this.policies.findOneByOrFail({ householdId });
  }

  private async lockOrCreatePolicy(manager: EntityManager, householdId: string) {
    await manager
      .getRepository(BackupPolicy)
      .createQueryBuilder()
      .insert()
      .values({ householdId })
      .orIgnore()
      .execute();
    return manager.getRepository(BackupPolicy).findOneOrFail({
      where: { householdId },
      lock: { mode: 'pessimistic_write' },
      loadEagerRelations: false,
    });
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
        policy.nextBackupAt = await this.calculateNextBackup(manager, policy);
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
        policy.nextRestoreDrillAt = await this.calculateNextRestoreDrill(
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

  private async calculateNextBackup(
    executor: Pick<EntityManager, 'query'>,
    policy: Pick<
      BackupPolicy,
      | 'householdId'
      | 'frequency'
      | 'weeklyDay'
      | 'scheduledHour'
      | 'scheduledMinute'
    >,
  ) {
    const rows = await executor.query(
      `
        WITH local_time AS (
          SELECT h."timezone", now() AT TIME ZONE h."timezone" AS local_now
          FROM households h WHERE h.id = $1
        ), candidate AS (
          SELECT "timezone", local_now,
            date_trunc('day', local_now)
              + make_interval(
                  days => CASE WHEN $2 = 'weekly'
                    THEN mod($3 - extract(dow FROM local_now)::integer + 7, 7)
                    ELSE 0 END,
                  hours => $4,
                  mins => $5
                ) AS local_candidate
          FROM local_time
        )
        SELECT (
          local_candidate + CASE
            WHEN local_candidate <= local_now
              THEN CASE WHEN $2 = 'weekly' THEN interval '7 days' ELSE interval '1 day' END
            ELSE interval '0 days'
          END
        ) AT TIME ZONE "timezone" AS "nextAt"
        FROM candidate
      `,
      [
        policy.householdId,
        policy.frequency,
        policy.weeklyDay ?? 0,
        policy.scheduledHour,
        policy.scheduledMinute,
      ],
    );
    return new Date(rows[0].nextAt);
  }

  private async calculateNextRestoreDrill(
    executor: Pick<EntityManager, 'query'>,
    policy: Pick<BackupPolicy, 'householdId' | 'restoreDrillDay' | 'restoreDrillHour'>,
  ) {
    const rows = await executor.query(
      `
        WITH local_time AS (
          SELECT h."timezone", now() AT TIME ZONE h."timezone" AS local_now
          FROM households h WHERE h.id = $1
        ), candidate AS (
          SELECT "timezone", local_now,
            date_trunc('month', local_now)
              + make_interval(days => $2 - 1, hours => $3) AS local_candidate
          FROM local_time
        )
        SELECT (
          local_candidate + CASE WHEN local_candidate <= local_now
            THEN interval '1 month' ELSE interval '0 months' END
        ) AT TIME ZONE "timezone" AS "nextAt"
        FROM candidate
      `,
      [policy.householdId, policy.restoreDrillDay, policy.restoreDrillHour],
    );
    return new Date(rows[0].nextAt);
  }

  private presentPolicy(policy: BackupPolicy) {
    const {
      id,
      scheduleEnabled,
      frequency,
      weeklyDay,
      scheduledHour,
      scheduledMinute,
      retentionDays,
      retentionCount,
      capacityWarningPercent,
      capacityCriticalPercent,
      restoreDrillEnabled,
      restoreDrillDay,
      restoreDrillHour,
      nextBackupAt,
      nextRestoreDrillAt,
      lastStorageCheckedAt,
      storageTotalBytes,
      storageAvailableBytes,
      storageUsedBytes,
      capacityStatus,
      capacityAlertedAt,
      workerLastSeenAt,
      updatedAt,
    } = policy;
    return {
      id,
      scheduleEnabled,
      frequency,
      weeklyDay,
      scheduledHour,
      scheduledMinute,
      retentionDays,
      retentionCount,
      capacityWarningPercent,
      capacityCriticalPercent,
      restoreDrillEnabled,
      restoreDrillDay,
      restoreDrillHour,
      nextBackupAt,
      nextRestoreDrillAt,
      lastStorageCheckedAt,
      storageTotalBytes,
      storageAvailableBytes,
      storageUsedBytes,
      capacityStatus,
      capacityAlertedAt,
      workerLastSeenAt,
      updatedAt,
    };
  }

  private presentRun(run: BackupRun) {
    return {
      id: run.id,
      kind: run.kind,
      status: run.status,
      trigger: run.trigger,
      sourceBackupRunId: run.sourceBackupRunId,
      requestedBy: run.requestedBy
        ? {
            id: run.requestedBy.id,
            name: run.requestedBy.name,
            avatarEmoji: run.requestedBy.avatarEmoji,
          }
        : null,
      scheduledFor: run.scheduledFor,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      heartbeatAt: run.heartbeatAt,
      databaseBytes: run.databaseBytes,
      uploadsBytes: run.uploadsBytes,
      totalBytes: run.totalBytes,
      checksumVerified: run.checksumVerified,
      restoredMigrationCount: run.restoredMigrationCount,
      retentionDeletedCount: run.retentionDeletedCount,
      retained: run.retained,
      purgedAt: run.purgedAt,
      artifactAvailable:
        run.kind === 'backup' && run.status === 'succeeded' && run.retained,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      resultSummary: run.resultSummary,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }
}

@Controller('system/backups')
class SystemBackupController {
  constructor(private readonly service: SystemBackupService) {}

  @Get()
  dashboard(@CurrentUser() user: JwtUser) {
    return this.service.dashboard(user);
  }

  @Put('policy')
  updatePolicy(
    @Body() dto: UpdateBackupPolicyDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updatePolicy(dto, user);
  }

  @Post('runs')
  queueBackup(@Body() dto: QueueBackupRunDto, @CurrentUser() user: JwtUser) {
    return this.service.queueBackup(dto, user);
  }

  @Post('capacity-checks')
  queueCapacityCheck(
    @Body() dto: QueueBackupRunDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.queueCapacityCheck(dto, user);
  }

  @Post('runs/:id/restore-drills')
  queueRestoreDrill(
    @Param('id') id: string,
    @Body() dto: QueueBackupRunDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.queueRestoreDrill(id, dto, user);
  }

  @Patch('runs/:id/cancel')
  cancelRun(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancelRun(id, user);
  }
}

@Controller('health')
class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Header('Cache-Control', 'no-store')
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Header('Cache-Control', 'no-store')
  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('数据库尚未就绪');
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([BackupPolicy, BackupRun, Member, Notification])],
  controllers: [HealthController, SystemBackupController, SystemModulesController],
  providers: [SystemBackupService, SystemModulesService],
})
export class SystemModule {}

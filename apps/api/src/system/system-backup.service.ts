import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { BackupPolicy, BackupRun, BackupRunKind } from '../entities';
import { UpdateBackupPolicyDto, QueueBackupRunDto } from './system.dto';
import {
  assertBackupAdmin,
  runLabel,
  lockOrCreatePolicy,
  calculateNextBackup,
  calculateNextRestoreDrill,
  presentPolicy,
  presentRun,
} from './system-backup.helpers';

@Injectable()
export class SystemBackupService {
  constructor(
    @InjectRepository(BackupPolicy)
    private readonly policies: Repository<BackupPolicy>,
    @InjectRepository(BackupRun)
    private readonly runs: Repository<BackupRun>,
    private readonly dataSource: DataSource,
  ) {}

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
      policy: presentPolicy(policy),
      workerOnline,
      activeRun: runs.find((run) => ['queued', 'running'].includes(run.status))
        ? presentRun(
            runs.find((run) => ['queued', 'running'].includes(run.status))!,
          )
        : null,
      runs: runs.map((run) => presentRun(run)),
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
        ? await calculateNextBackup(manager, current)
        : null;
      current.nextRestoreDrillAt = dto.restoreDrillEnabled
        ? await calculateNextRestoreDrill(manager, current)
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
    return presentPolicy(policy);
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
      if (run.status === 'cancelled') return presentRun(run);
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
      return presentRun(run);
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
      const policy = await lockOrCreatePolicy(manager, user.householdId);
      const repository = manager.getRepository(BackupRun);
      const existing = await repository.findOneBy({
        householdId: user.householdId,
        idempotencyKey,
      });
      if (existing) return presentRun(existing);
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
      return presentRun(run);
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
}

import { ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { BackupPolicy, BackupRun, BackupRunKind } from '../entities';

export function assertBackupAdmin(user: JwtUser) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new ForbiddenException('只有家庭管理员可以管理备份');
  }
}

export function runLabel(kind: BackupRunKind) {
  if (kind === 'backup') return '完整备份';
  if (kind === 'restore_drill') return '恢复演练';
  return '容量检查';
}

export async function lockOrCreatePolicy(manager: EntityManager, householdId: string) {
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

export async function calculateNextBackup(
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

export async function calculateNextRestoreDrill(
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

export function presentPolicy(policy: BackupPolicy) {
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

export function presentRun(run: BackupRun) {
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

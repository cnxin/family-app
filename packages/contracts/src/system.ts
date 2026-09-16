import { z } from 'zod';
import {
  idParams,
  isoDateTime,
  memberBriefSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/system/system.module.ts 与 docs/m13-system-backups-acceptance.md
//
// 备份策略与任务经 presentPolicy() / presentRun() 逐字段挑选。bigint 列（*Bytes）在 pg 驱动里是字符串，
// 响应原样回传字符串，客户端自己 Number()。运行时数据（容量、worker 心跳）在没跑过 worker 时都是 null，
// 所以一律 nullable 而不是 optional——字段总在，值可能为空。health 两个端点是 @Public 的探针。

export const BACKUP_SCHEDULE_FREQUENCIES = ['daily', 'weekly'] as const;
export const backupScheduleFrequency = z.enum(BACKUP_SCHEDULE_FREQUENCIES);
export type BackupScheduleFrequency = z.infer<typeof backupScheduleFrequency>;

export const BACKUP_RUN_KINDS = ['backup', 'restore_drill', 'capacity_check'] as const;
export const backupRunKind = z.enum(BACKUP_RUN_KINDS);
export type BackupRunKind = z.infer<typeof backupRunKind>;

export const BACKUP_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const backupRunStatus = z.enum(BACKUP_RUN_STATUSES);
export type BackupRunStatus = z.infer<typeof backupRunStatus>;

export const BACKUP_RUN_TRIGGERS = ['manual', 'scheduled'] as const;
export const backupRunTrigger = z.enum(BACKUP_RUN_TRIGGERS);
export type BackupRunTrigger = z.infer<typeof backupRunTrigger>;

export const BACKUP_CAPACITY_STATUSES = ['unknown', 'ok', 'warning', 'critical'] as const;
export const backupCapacityStatus = z.enum(BACKUP_CAPACITY_STATUSES);
export type BackupCapacityStatus = z.infer<typeof backupCapacityStatus>;

/** pg bigint → 十进制字符串。 */
const bigintString = z.string().regex(/^\d+$/);

// ---- 响应 -------------------------------------------------------------------

export const backupPolicySchema = z.object({
  id: uuid,
  scheduleEnabled: z.boolean(),
  frequency: backupScheduleFrequency,
  weeklyDay: z.number().int().min(0).max(6).nullable(),
  scheduledHour: z.number().int(),
  scheduledMinute: z.number().int(),
  retentionDays: z.number().int(),
  retentionCount: z.number().int(),
  capacityWarningPercent: z.number().int(),
  capacityCriticalPercent: z.number().int(),
  restoreDrillEnabled: z.boolean(),
  restoreDrillDay: z.number().int(),
  restoreDrillHour: z.number().int(),
  nextBackupAt: nullableDateTime,
  nextRestoreDrillAt: nullableDateTime,
  lastStorageCheckedAt: nullableDateTime,
  storageTotalBytes: bigintString.nullable(),
  storageAvailableBytes: bigintString.nullable(),
  storageUsedBytes: bigintString.nullable(),
  capacityStatus: backupCapacityStatus,
  capacityAlertedAt: nullableDateTime,
  workerLastSeenAt: nullableDateTime,
  updatedAt: isoDateTime,
});
export type BackupPolicy = z.infer<typeof backupPolicySchema>;

export const backupRunSchema = z.object({
  id: uuid,
  kind: backupRunKind,
  status: backupRunStatus,
  trigger: backupRunTrigger,
  sourceBackupRunId: uuid.nullable(),
  requestedBy: memberBriefSchema.nullable(),
  scheduledFor: nullableDateTime,
  startedAt: nullableDateTime,
  finishedAt: nullableDateTime,
  heartbeatAt: nullableDateTime,
  databaseBytes: bigintString.nullable(),
  uploadsBytes: bigintString.nullable(),
  totalBytes: bigintString.nullable(),
  checksumVerified: z.boolean().nullable(),
  restoredMigrationCount: z.number().int().nullable(),
  retentionDeletedCount: z.number().int(),
  retained: z.boolean(),
  purgedAt: nullableDateTime,
  artifactAvailable: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  resultSummary: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BackupRun = z.infer<typeof backupRunSchema>;

export const backupDashboardSchema = z.object({
  policy: backupPolicySchema,
  workerOnline: z.boolean(),
  activeRun: backupRunSchema.nullable(),
  runs: z.array(backupRunSchema),
});
export type BackupDashboard = z.infer<typeof backupDashboardSchema>;

export const healthSchema = z.object({ status: z.literal('ok') });

// ---- 请求 -------------------------------------------------------------------

export const updateBackupPolicyBody = z.object({
  scheduleEnabled: z.boolean(),
  frequency: backupScheduleFrequency,
  weeklyDay: z.number().int().min(0).max(6).nullish(),
  scheduledHour: z.number().int().min(0).max(23),
  scheduledMinute: z.number().int().min(0).max(59),
  retentionDays: z.number().int().min(1).max(3650),
  retentionCount: z.number().int().min(1).max(365),
  capacityWarningPercent: z.number().int().min(1).max(98),
  capacityCriticalPercent: z.number().int().min(2).max(99),
  restoreDrillEnabled: z.boolean(),
  restoreDrillDay: z.number().int().min(1).max(28),
  restoreDrillHour: z.number().int().min(0).max(23),
});
export type UpdateBackupPolicyBody = z.infer<typeof updateBackupPolicyBody>;

export const queueBackupRunBody = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_.:-]{8,180}$/),
});

// ---- 端点 -------------------------------------------------------------------

export const system = {
  backups: defineEndpoint({
    method: 'GET',
    path: '/system/backups',
    summary: '备份看板：策略 + worker 在线状态 + 最近 60 次任务（管理员）',
    response: backupDashboardSchema,
  }),
  updatePolicy: defineEndpoint({
    method: 'PUT',
    path: '/system/backups/policy',
    summary: '整体替换备份策略并重算下次备份/演练时间（管理员）',
    body: updateBackupPolicyBody,
    response: backupPolicySchema,
  }),
  queueBackup: defineEndpoint({
    method: 'POST',
    path: '/system/backups/runs',
    summary: '手动排队一次完整备份（幂等；同类任务排队中则 409）',
    body: queueBackupRunBody,
    response: backupRunSchema,
  }),
  queueCapacityCheck: defineEndpoint({
    method: 'POST',
    path: '/system/backups/capacity-checks',
    summary: '手动排队一次容量检查（幂等）',
    body: queueBackupRunBody,
    response: backupRunSchema,
  }),
  queueRestoreDrill: defineEndpoint({
    method: 'POST',
    path: '/system/backups/runs/:id/restore-drills',
    summary: '基于某次成功且校验过的备份排队恢复演练（幂等）',
    params: idParams,
    body: queueBackupRunBody,
    response: backupRunSchema,
  }),
  cancelRun: defineEndpoint({
    method: 'PATCH',
    path: '/system/backups/runs/:id/cancel',
    summary: '取消等待中的任务（幂等）',
    params: idParams,
    response: backupRunSchema,
  }),
  live: defineEndpoint({
    method: 'GET',
    path: '/health/live',
    summary: '进程存活探针（公开）',
    response: healthSchema,
  }),
  ready: defineEndpoint({
    method: 'GET',
    path: '/health/ready',
    summary: '就绪探针：数据库可查则 ok，否则 503（公开）',
    response: healthSchema,
  }),
};

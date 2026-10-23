import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';

export type BackupScheduleFrequency = 'daily' | 'weekly';

export type BackupRunKind = 'backup' | 'restore_drill' | 'capacity_check';

export type BackupRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type BackupRunTrigger = 'manual' | 'scheduled';

export type BackupCapacityStatus = 'unknown' | 'ok' | 'warning' | 'critical';

@Entity('backup_policies')
@Unique('UQ_backup_policies_household', ['householdId'])
@Check(
  'CHK_backup_policies_frequency',
  `"frequency" IN ('daily', 'weekly')`,
)
@Check(
  'CHK_backup_policies_schedule',
  `"scheduledHour" BETWEEN 0 AND 23 AND "scheduledMinute" BETWEEN 0 AND 59 AND ("weeklyDay" IS NULL OR "weeklyDay" BETWEEN 0 AND 6)`,
)
@Check(
  'CHK_backup_policies_retention',
  `"retentionDays" BETWEEN 1 AND 3650 AND "retentionCount" BETWEEN 1 AND 365`,
)
@Check(
  'CHK_backup_policies_capacity_thresholds',
  `"capacityWarningPercent" BETWEEN 1 AND 98 AND "capacityCriticalPercent" BETWEEN 2 AND 99 AND "capacityWarningPercent" < "capacityCriticalPercent"`,
)
@Check(
  'CHK_backup_policies_restore_schedule',
  `"restoreDrillDay" BETWEEN 1 AND 28 AND "restoreDrillHour" BETWEEN 0 AND 23`,
)
@Check(
  'CHK_backup_policies_capacity_status',
  `"capacityStatus" IN ('unknown', 'ok', 'warning', 'critical') AND ("capacityNotifiedStatus" IS NULL OR "capacityNotifiedStatus" IN ('warning', 'critical'))`,
)
export class BackupPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_backup_policies_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ default: false })
  scheduleEnabled: boolean;

  @Column({ type: 'varchar', length: 16, default: 'daily' })
  frequency: BackupScheduleFrequency;

  @Column({ type: 'smallint', nullable: true })
  weeklyDay: number | null;

  @Column({ type: 'smallint', default: 3 })
  scheduledHour: number;

  @Column({ type: 'smallint', default: 0 })
  scheduledMinute: number;

  @Column({ type: 'int', default: 30 })
  retentionDays: number;

  @Column({ type: 'int', default: 14 })
  retentionCount: number;

  @Column({ type: 'smallint', default: 80 })
  capacityWarningPercent: number;

  @Column({ type: 'smallint', default: 90 })
  capacityCriticalPercent: number;

  @Column({ default: false })
  restoreDrillEnabled: boolean;

  @Column({ type: 'smallint', default: 1 })
  restoreDrillDay: number;

  @Column({ type: 'smallint', default: 4 })
  restoreDrillHour: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextBackupAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRestoreDrillAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastStorageCheckedAt: Date | null;

  @Column({ type: 'bigint', nullable: true })
  storageTotalBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  storageAvailableBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  storageUsedBytes: string | null;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  capacityStatus: BackupCapacityStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  capacityNotifiedStatus: Exclude<BackupCapacityStatus, 'unknown' | 'ok'> | null;

  @Column({ type: 'timestamptz', nullable: true })
  capacityAlertedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  workerLastSeenAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('backup_runs')
@Unique('UQ_backup_runs_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Index('IDX_backup_runs_queue', ['status', 'createdAt'])
@Index('IDX_backup_runs_household_history', [
  'householdId',
  'createdAt',
])
@Check(
  'CHK_backup_runs_kind',
  `"kind" IN ('backup', 'restore_drill', 'capacity_check')`,
)
@Check(
  'CHK_backup_runs_status',
  `"status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
)
@Check(
  'CHK_backup_runs_trigger',
  `"trigger" IN ('manual', 'scheduled')`,
)
@Check(
  'CHK_backup_runs_source',
  `("kind" = 'restore_drill' AND "sourceBackupRunId" IS NOT NULL) OR ("kind" <> 'restore_drill' AND "sourceBackupRunId" IS NULL)`,
)
@Check(
  'CHK_backup_runs_sizes',
  `("databaseBytes" IS NULL OR "databaseBytes" >= 0) AND ("uploadsBytes" IS NULL OR "uploadsBytes" >= 0) AND ("totalBytes" IS NULL OR "totalBytes" >= 0) AND ("restoredMigrationCount" IS NULL OR "restoredMigrationCount" >= 0) AND "retentionDeletedCount" >= 0`,
)
export class BackupRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_backup_runs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 24 })
  kind: BackupRunKind;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: BackupRunStatus;

  @Column({ type: 'varchar', length: 16 })
  trigger: BackupRunTrigger;

  @ManyToOne(() => BackupRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sourceBackupRunId',
    foreignKeyConstraintName: 'FK_backup_runs_source',
  })
  sourceBackupRun: BackupRun | null;

  @Column({ type: 'uuid', nullable: true })
  sourceBackupRunId: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'requestedById',
    foreignKeyConstraintName: 'FK_backup_runs_requested_by',
  })
  requestedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  requestedById: string | null;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledFor: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  notifiedAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true, select: false })
  backupLabel: string | null;

  @Column({ type: 'bigint', nullable: true })
  databaseBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  uploadsBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  totalBytes: string | null;

  @Column({ type: 'boolean', nullable: true })
  checksumVerified: boolean | null;

  @Column({ type: 'int', nullable: true })
  restoredMigrationCount: number | null;

  @Column({ type: 'int', default: 0 })
  retentionDeletedCount: number;

  @Column({ default: true })
  retained: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  purgedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  resultSummary: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
